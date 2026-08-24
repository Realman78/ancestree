/* Linking a tree to a file on disk: autosave, permission, and detecting an
   edit made somewhere else (another machine via a synced folder).

   The native file picker cannot be driven from a test, so these exercise the
   core through an injected handle — the same object the picker would hand over. */
module.exports = async function (t, h) {
  const dom = await h.loadPage();
  const w = dom.window;
  const d = w.document;
  const FT = w.FT;

  /* Stands in for a FileSystemFileHandle backed by a real file. */
  function fakeHandle(name, opts) {
    const o = opts || {};
    const state = {
      name: name,
      contents: o.contents || '',
      lastModified: o.lastModified || 1000,
      permission: o.permission || 'granted',
      writes: 0,
    };
    return {
      state: state,
      name: name,
      queryPermission: async () => state.permission,
      requestPermission: async () => {
        state.permission = o.grantOnRequest === false ? 'denied' : 'granted';
        return state.permission;
      },
      getFile: async () => ({
        lastModified: state.lastModified,
        text: async () => state.contents,
      }),
      createWritable: async () => ({
        write: async (text) => {
          state.contents = text;
          state.writes++;
          state.lastModified += 1000;
        },
        close: async () => {},
      }),
    };
  }

  d.querySelector('[data-action="demo"]').click();
  await h.wait(200);

  t.section('linking a tree to a file');
  const handle = fakeHandle('kovac.json');
  await FT.fileLink.linkTo(FT.state.id, handle);
  t.ok(handle.state.writes === 1, 'linking writes the tree out immediately');
  const onDisk = JSON.parse(handle.state.contents);
  t.ok(Object.keys(onDisk.people).length === 9, 'the file holds the whole tree');
  t.ok(onDisk.people[Object.keys(onDisk.people)[0]].entries !== undefined, 'diaries included');

  const status = FT.fileLink.statusFor(FT.state.id);
  t.ok(status.linked && status.granted, 'the tree reports itself linked');
  t.ok(status.name === 'kovac.json', 'and names the file');

  t.section('edits follow to the file');
  const before = handle.state.writes;
  FT.state.title = 'Kovač, on disk';
  FT.save();
  await h.wait(1200); // writes are coalesced
  t.ok(handle.state.writes > before, 'a save writes through to disk');
  t.ok(JSON.parse(handle.state.contents).title === 'Kovač, on disk', 'with the new content');

  t.section('a burst of edits is coalesced');
  const burstStart = handle.state.writes;
  for (let i = 0; i < 12; i++) {
    FT.state.title = 'Typing ' + i;
    FT.save();
  }
  await h.wait(1200);
  const wrote = handle.state.writes - burstStart;
  t.ok(wrote === 1, '12 rapid saves become one disk write (' + wrote + ')');
  t.ok(JSON.parse(handle.state.contents).title === 'Typing 11', 'and the last edit is what landed');

  t.section('permission lost after a browser restart');
  const stale = fakeHandle('stale.json', { permission: 'prompt' });
  const other = FT.newTree('Needs reconnect');
  FT.saveDoc(other);
  await FT.fileLink.linkTo(other.id, stale, { write: false });
  await FT.fileLink.writeNow(other.id);
  t.ok(stale.state.writes === 0, 'a write is refused without permission rather than throwing');
  t.ok(FT.fileLink.statusFor(other.id).granted === false, 'the link reports it needs reconnecting');
  await FT.fileLink.reconnect(other.id);
  t.ok(FT.fileLink.statusFor(other.id).granted === true, 'reconnecting restores it');
  t.ok(stale.state.writes === 1, 'and flushes the tree to disk');

  t.section('refused permission is reported, not swallowed');
  const denied = fakeHandle('denied.json', { permission: 'prompt', grantOnRequest: false });
  const third = FT.newTree('Denied');
  FT.saveDoc(third);
  await FT.fileLink.linkTo(third.id, denied, { write: false });
  const ok = await FT.fileLink.reconnect(third.id);
  t.ok(ok === false, 'reconnect reports failure');
  t.ok(FT.fileLink.statusFor(third.id).granted === false, 'and the link stays marked unusable');

  t.section('the file is the truth, the browser copy is a cache');
  // The realistic case: you edited on another machine yesterday, so the file is
  // newer than what this browser cached. Opening must not push the stale copy.
  const newer = fakeHandle('newer.json');
  const fromElsewhere = FT.demoTree();
  fromElsewhere.title = 'Edited yesterday elsewhere';
  fromElsewhere.updatedAt = Date.now();
  newer.state.contents = JSON.stringify(fromElsewhere);
  newer.state.lastModified = Date.now() + 60000; // the file is ahead

  FT.state.title = 'Stale local copy';
  FT.state.updatedAt = Date.now() - 86400000;
  await FT.fileLink.linkTo(FT.state.id, newer, { write: false });
  const took = await FT.fileLink.adoptNewerFromDisk();
  t.ok(took === true, 'a newer file is adopted on open');
  t.ok(FT.state.title === 'Edited yesterday elsewhere', 'and its contents win');
  t.ok(newer.state.writes === 0, 'the stale cache is never written over it');

  // The other direction: our copy is current, so the file is left alone.
  FT.state.updatedAt = Date.now() + 120000;
  t.ok((await FT.fileLink.adoptNewerFromDisk()) === false, 'an older file is ignored');
  t.ok(FT.state.title === 'Edited yesterday elsewhere', 'and the open tree is untouched');
  await FT.fileLink.unlink(FT.state.id);

  t.section('the file changed on another computer');
  // What a synced folder does: the file is rewritten underneath us.
  const shared = fakeHandle('shared.json');
  await FT.fileLink.linkTo(FT.state.id, shared);
  const remote = FT.demoTree();
  remote.title = 'Edited on the laptop';
  shared.state.contents = JSON.stringify(remote);
  shared.state.lastModified += 60000;

  let noticed = null;
  FT.on('filechanged', function (p) {
    noticed = p;
  });
  await h.wait(5200); // the poller runs every few seconds
  t.ok(!!noticed, 'the change is noticed rather than silently overwritten');
  t.ok(noticed && noticed.name === 'shared.json', 'naming the file that moved');

  await FT.fileLink.reloadFromDisk();
  t.ok(FT.state.title === 'Edited on the laptop', 'reloading takes the other machine’s version');
  t.ok(Object.keys(FT.state.people).length === 9, 'with its people');

  t.section('unlinking');
  await FT.fileLink.unlink(FT.state.id);
  t.ok(FT.fileLink.statusFor(FT.state.id).linked === false, 'the tree is no longer linked');
  const afterUnlink = shared.state.writes;
  FT.state.title = 'Local only';
  FT.save();
  await h.wait(1200);
  t.ok(shared.state.writes === afterUnlink, 'and saves stop reaching that file');
  t.ok(!!FT.loadDoc(FT.state.id), 'but the tree is still kept in the browser');

  t.section('a browser without the API');
  t.ok(typeof FT.fileLink.supported() === 'boolean', 'support is reported, not assumed');
  const noApi = await h.loadPage(h.BASE, {
    beforeParse(win) {
      delete win.showSaveFilePicker;
      delete win.showOpenFilePicker;
    },
  });
  t.ok(noApi.window.FT.fileLink.supported() === false, 'it knows when the API is missing');
  noApi.window.document.getElementById('treeMenuBtn').click();
  await h.wait(150);
  t.ok(
    /cannot write straight to a file/.test(noApi.window.document.getElementById('fileStatus').textContent),
    'and says so instead of offering a button that cannot work'
  );
  t.ok(
    !!noApi.window.document.querySelector('[data-action="backupAll"]'),
    'pointing at the backup that does work everywhere'
  );
};
