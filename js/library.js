/* Ancestree — the shelf: many trees in one browser.

   Each tree is its own localStorage entry; a small index keeps the list so the
   picker never has to parse every document. Trees are independent — opening a
   new one cannot overwrite another. */
(function () {
  const FT = window.FT;

  /* These keys still say "heirloom" — the app's former name. Renaming them
     would strand every tree already saved in somebody's browser, and the keys
     are invisible, so they stay as they are. */
  const INDEX_KEY = 'heirloom.index.v1';
  const DOC_PREFIX = 'heirloom.doc.';
  const LAST_KEY = 'heirloom.last.v1';
  const LEGACY_KEY = 'heirloom.tree.v1'; // the single-tree era

  function read(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false; // quota — FT.save reports this
    }
  }

  /* [{id, title, updatedAt, people}] — newest first. */
  FT.listDocs = function () {
    const index = read(INDEX_KEY);
    if (!Array.isArray(index)) return [];
    return index
      .filter(function (row) {
        return row && typeof row.id === 'string';
      })
      .sort(function (a, b) {
        return (b.updatedAt || 0) - (a.updatedAt || 0);
      });
  };

  function writeIndex(rows) {
    write(INDEX_KEY, rows);
  }

  /* Keep the index row in step with the document itself. */
  function touchIndex(doc) {
    const rows = FT.listDocs().filter(function (row) {
      return row.id !== doc.id;
    });
    rows.push({
      id: doc.id,
      title: doc.title,
      updatedAt: doc.updatedAt || Date.now(),
      people: Object.keys(doc.people).length,
    });
    writeIndex(rows);
  }

  FT.saveDoc = function (doc) {
    const ok = write(DOC_PREFIX + doc.id, doc);
    if (ok) {
      touchIndex(doc);
      write(LAST_KEY, doc.id);
    }
    return ok;
  };

  FT.loadDoc = function (id) {
    const raw = read(DOC_PREFIX + id);
    return raw ? FT.normalize(raw) : null;
  };

  FT.deleteDoc = function (id) {
    try {
      localStorage.removeItem(DOC_PREFIX + id);
    } catch (e) {
      /* nothing to do */
    }
    writeIndex(
      FT.listDocs().filter(function (row) {
        return row.id !== id;
      })
    );
    if (read(LAST_KEY) === id) write(LAST_KEY, null);
  };

  FT.lastDocId = function () {
    return read(LAST_KEY);
  };

  FT.rememberLastDoc = function (id) {
    write(LAST_KEY, id);
  };

  /* One-time move from the single-tree layout. Runs before anything is listed,
     so an existing tree becomes the first item on the shelf instead of vanishing. */
  FT.migrateLegacy = function () {
    const legacy = read(LEGACY_KEY);
    if (!legacy) return false;
    const doc = FT.normalize(legacy);
    if (Object.keys(doc.people).length) {
      FT.saveDoc(doc);
      FT.rememberLastDoc(doc.id);
    }
    try {
      localStorage.removeItem(LEGACY_KEY);
    } catch (e) {
      /* leaving it behind is harmless */
    }
    return true;
  };

  /* Ask the browser to stop treating this data as disposable. Without it,
     storage can be evicted under disk pressure with no warning. */
  FT.requestPersistence = async function () {
    if (!navigator.storage || !navigator.storage.persist) return false;
    try {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    } catch (e) {
      return false;
    }
  };

  FT.storageEstimate = async function () {
    if (!navigator.storage || !navigator.storage.estimate) return null;
    try {
      return await navigator.storage.estimate();
    } catch (e) {
      return null;
    }
  };

  /* Which tree to show on load: the last one open, else the newest, else none. */
  FT.pickStartupDoc = function () {
    const last = FT.lastDocId();
    if (last) {
      const doc = FT.loadDoc(last);
      if (doc) return doc;
    }
    const rows = FT.listDocs();
    for (let i = 0; i < rows.length; i++) {
      const doc = FT.loadDoc(rows[i].id);
      if (doc) return doc;
    }
    return null;
  };
})();
