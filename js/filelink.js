/* Heirloom — keeping a tree in a real file on disk.

   This is the whole answer to "what if I lose this browser", and to syncing,
   without anyone needing an account. Point a tree at a file and the app writes
   to it as you work. Put that file in a folder that already syncs — Dropbox,
   iCloud Drive, OneDrive, Syncthing — and the tree follows you between machines
   with no service in the middle and nobody holding a copy of your diaries.

   The handle survives reloads in IndexedDB (it cannot be JSON, so localStorage
   is no use). Browsers re-ask for write permission after a restart, which needs
   a click, so a reconnect is offered rather than a prompt out of nowhere. */
(function () {
  const FT = window.FT;

  const DB_NAME = 'heirloom-files';
  const STORE = 'handles';
  const POLL_MS = 4000;

  // ------------------------------------------------------------ IndexedDB

  function openDb() {
    return new Promise(function (resolve, reject) {
      if (typeof indexedDB === 'undefined') return reject(new Error('no indexedDB'));
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        req.result.createObjectStore(STORE);
      };
      req.onsuccess = function () {
        resolve(req.result);
      };
      req.onerror = function () {
        reject(req.error);
      };
    });
  }

  function idb(mode, fn) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE, mode);
        const store = tx.objectStore(STORE);
        const req = fn(store);
        tx.oncomplete = function () {
          resolve(req ? req.result : undefined);
        };
        tx.onerror = function () {
          reject(tx.error);
        };
      });
    });
  }

  const getRecord = (treeId) => idb('readonly', (s) => s.get(treeId)).catch(() => null);
  const putRecord = (treeId, rec) => idb('readwrite', (s) => s.put(rec, treeId)).catch(() => null);
  const delRecord = (treeId) => idb('readwrite', (s) => s.delete(treeId)).catch(() => null);

  // ------------------------------------------------------------ the link

  const links = {}; // treeId -> {handle, name, lastSeen, savedAt, granted}
  let saveTimer = null;
  let pollTimer = null;

  const api = {};
  FT.fileLink = api;

  api.supported = function () {
    return typeof window.showSaveFilePicker === 'function';
  };

  api.statusFor = function (treeId) {
    const link = links[treeId];
    if (!link) return { linked: false };
    return {
      linked: true,
      name: link.name,
      granted: !!link.granted,
      savedAt: link.savedAt || 0,
    };
  };

  function announce() {
    FT.emit('filelink', { status: api.statusFor(FT.state.id) });
  }

  /* Core of linking — takes a handle so tests can supply their own. */
  api.linkTo = async function (treeId, handle, opts) {
    links[treeId] = {
      handle: handle,
      name: handle.name || 'family-tree.json',
      granted: true,
      savedAt: 0,
      lastSeen: 0,
    };
    await putRecord(treeId, { handle: handle, name: links[treeId].name });
    if (!opts || opts.write !== false) await api.writeNow(treeId);
    announce();
    startPolling();
    return true;
  };

  api.unlink = async function (treeId) {
    delete links[treeId];
    await delRecord(treeId);
    announce();
  };

  async function ensurePermission(link, interactive) {
    if (!link.handle.queryPermission) return true;
    const opts = { mode: 'readwrite' };
    let state = await link.handle.queryPermission(opts);
    if (state === 'granted') return true;
    if (!interactive) return false;
    state = await link.handle.requestPermission(opts);
    return state === 'granted';
  }

  /* Write the open tree straight to its file. */
  api.writeNow = async function (treeId) {
    const id = treeId || FT.state.id;
    const link = links[id];
    if (!link) return false;
    if (!(await ensurePermission(link, false))) {
      link.granted = false;
      announce();
      return false;
    }
    try {
      const writable = await link.handle.createWritable();
      await writable.write(JSON.stringify(FT.state, null, 2));
      await writable.close();
      link.granted = true;
      link.savedAt = Date.now();
      // Remember the file's own timestamp so our write is not mistaken for
      // someone else's edit by the change poller.
      try {
        const file = await link.handle.getFile();
        link.lastSeen = file.lastModified;
      } catch (e) {
        link.lastSeen = Date.now();
      }
      announce();
      return true;
    } catch (e) {
      link.granted = false;
      FT.emit('hint', { text: 'Could not write to the linked file — ' + (e.message || e) + '.' });
      announce();
      return false;
    }
  };

  /* Called on every save; coalesced so typing does not thrash the disk. */
  api.scheduleWrite = function () {
    if (!links[FT.state.id]) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      api.writeNow(FT.state.id);
    }, 800);
  };

  /* The file is the tree; the browser copy is only a cache of it. So whenever
     we (re)gain access, take whichever is newer. One comparison, no conflict
     story: a file edited on another machine simply wins. */
  api.adoptNewerFromDisk = async function () {
    const link = links[FT.state.id];
    if (!link || !link.granted) return false;
    try {
      const file = await link.handle.getFile();
      link.lastSeen = file.lastModified;
      if (file.lastModified <= (FT.state.updatedAt || 0)) return false;
      const doc = FT.normalize(JSON.parse(await file.text()));
      doc.id = FT.state.id;
      FT.adoptDocument(doc);
      // Adopting saves, which would queue a write straight back to the file we
      // just read. Drop it: there is nothing to send.
      clearTimeout(saveTimer);
      link.lastSeen = file.lastModified;
      return true;
    } catch (e) {
      return false;
    }
  };

  api.reconnect = async function (treeId) {
    const link = links[treeId];
    if (!link) return false;
    const ok = await ensurePermission(link, true);
    link.granted = ok;
    announce();
    // Read before writing, or reconnecting would push a stale cache over a
    // newer file.
    if (ok && treeId === FT.state.id) {
      const took = await api.adoptNewerFromDisk();
      if (!took) await api.writeNow(treeId);
    } else if (ok) {
      await api.writeNow(treeId);
    }
    return ok;
  };

  // ------------------------------------------------- changed somewhere else

  /* If the file lives in a synced folder, another machine can rewrite it under
     us. Detect that rather than silently overwriting their work. */
  async function pollExternal() {
    const link = links[FT.state.id];
    if (!link || !link.granted || document.hidden) return;
    try {
      if (!(await ensurePermission(link, false))) return;
      const file = await link.handle.getFile();
      if (link.lastSeen && file.lastModified > link.lastSeen + 1500) {
        link.lastSeen = file.lastModified;
        FT.emit('filechanged', { name: link.name });
      }
    } catch (e) {
      /* the file may be gone or locked; the next write will report it */
    }
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(pollExternal, POLL_MS);
  }

  api.reloadFromDisk = async function () {
    const link = links[FT.state.id];
    if (!link) return false;
    try {
      const file = await link.handle.getFile();
      const doc = FT.normalize(JSON.parse(await file.text()));
      doc.id = FT.state.id; // stay the same tree on the shelf
      FT.adoptDocument(doc);
      clearTimeout(saveTimer); // same: do not echo it back
      link.lastSeen = file.lastModified;
      FT.emit('hint', { text: 'Reloaded “' + link.name + '” from disk.' });
      return true;
    } catch (e) {
      FT.emit('hint', { text: 'That file could not be re-read.' });
      return false;
    }
  };

  // --------------------------------------------------------- entry points

  api.pickAndLink = async function () {
    if (!api.supported()) return false;
    let handle;
    try {
      handle = await window.showSaveFilePicker({
        suggestedName: (FT.state.title || 'family-tree').replace(/[^\p{L}\p{N}]+/gu, '-') + '.json',
        types: [{ description: 'Family tree', accept: { 'application/json': ['.json'] } }],
      });
    } catch (e) {
      return false; // the picker was dismissed
    }
    await api.linkTo(FT.state.id, handle);
    FT.emit('hint', { text: 'This tree now saves to ' + handle.name + ' as you work.' });
    return true;
  };

  api.openAndLink = async function () {
    if (typeof window.showOpenFilePicker !== 'function') return false;
    let handle;
    try {
      const picked = await window.showOpenFilePicker({
        types: [{ description: 'Family tree', accept: { 'application/json': ['.json'] } }],
      });
      handle = picked[0];
    } catch (e) {
      return false;
    }
    let doc;
    try {
      const file = await handle.getFile();
      doc = FT.normalize(JSON.parse(await file.text()));
    } catch (e) {
      FT.emit('hint', { text: 'That file could not be read as a family tree.' });
      return false;
    }
    doc.id = FT.uid('t'); // opens as its own tree on the shelf
    FT.save();
    FT.adoptDocument(doc);
    await api.linkTo(doc.id, handle, { write: false });
    FT.emit('hint', { text: 'Opened ' + handle.name + '. Changes now save straight to it.' });
    return true;
  };

  /* Reattach handles saved in a previous session. Permission usually needs a
     click again, so this only records what is available. */
  api.restore = async function () {
    const rows = FT.listDocs();
    for (let i = 0; i < rows.length; i++) {
      const rec = await getRecord(rows[i].id);
      if (rec && rec.handle) {
        links[rows[i].id] = {
          handle: rec.handle,
          name: rec.name || rec.handle.name,
          granted: false,
          savedAt: 0,
          lastSeen: 0,
        };
        const ok = await ensurePermission(links[rows[i].id], false);
        links[rows[i].id].granted = ok;
      }
    }
    if (Object.keys(links).length) startPolling();
    announce();
    // The file may have moved on since this browser last saw it.
    if (await api.adoptNewerFromDisk()) {
      FT.emit('hint', { text: 'Opened the newer version from ' + links[FT.state.id].name + '.' });
    }
  };

  /* Ask the browser to stop treating this data as disposable. Without it,
     storage can be evicted under pressure with no warning. */
  api.requestPersistence = async function () {
    if (!navigator.storage || !navigator.storage.persist) return false;
    try {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    } catch (e) {
      return false;
    }
  };

  api.storageEstimate = async function () {
    if (!navigator.storage || !navigator.storage.estimate) return null;
    try {
      return await navigator.storage.estimate();
    } catch (e) {
      return null;
    }
  };
})();
