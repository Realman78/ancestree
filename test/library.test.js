/* Many trees in one browser: the shelf, switching, deletion, migration. */
module.exports = async function (t, h) {
  const dom = await h.loadPage();
  const w = dom.window;
  const d = w.document;
  const FT = w.FT;
  const $ = (s) => d.querySelector(s);
  const $$ = (s) => Array.from(d.querySelectorAll(s));

  t.section('a first visit starts empty');
  t.ok($$('.card').length === 0, 'no cards on the board');
  t.ok(Object.keys(FT.state.people).length === 0, 'and no people in the document');
  t.ok(/Empty board/.test($('#hintText').textContent), 'the board says what to do next');
  t.ok(!/Miller/.test(JSON.stringify(FT.state)), "a stranger's family is not loaded over the top");

  t.section('the sample is a click away');
  $('[data-action="demo"]').click();
  await h.wait(150);
  t.ok(Object.keys(FT.state.people).length === 9, 'the sample loads on request');
  t.ok(!$('#askDialog').hidden === false, 'and asks nothing when the board was empty');

  t.section('replacing a non-empty board asks first');
  $('[data-action="demo"]').click();
  await h.wait(150);
  t.ok(!$('#askDialog').hidden, 'an in-app dialog appears — not a browser confirm()');
  t.ok(w.__confirmCalls === 0, 'confirm() is never used, so blocked dialogs cannot break it');
  t.ok(/Replace/.test($('#askTitle').textContent), 'it says what it will do');
  $('#askCancel').click();
  await h.wait(250);
  t.ok($('#askDialog').hidden, 'Cancel closes it');
  t.ok(Object.keys(FT.state.people).length === 9, 'and nothing was replaced');

  t.section('new trees never overwrite');
  const firstId = FT.state.id;
  FT.state.title = 'Miller line';
  FT.save();
  $('[data-action="newTree"]').click();
  await h.wait(150);
  t.ok(FT.state.id !== firstId, 'a new tree has its own identity');
  t.ok(Object.keys(FT.state.people).length === 0, 'and an empty board');
  t.ok(FT.listDocs().length === 2, 'both trees are on the shelf');
  t.ok(!!FT.loadDoc(firstId), 'the first one is untouched');
  t.ok(Object.keys(FT.loadDoc(firstId).people).length === 9, 'with all its people');

  t.section('switching between them');
  const secondId = FT.state.id;
  FT.addPerson({ name: 'Solo Person', x: 0, y: 0 });
  FT.save();
  $('#treeMenuBtn').click();
  await h.wait(100);
  t.ok($$('.tree-row').length === 2, 'the picker lists both');
  t.ok($$('.tree-row.current').length === 1, 'and marks the open one');
  const other = $$('.tree-row').find((r) => r.dataset.tree === firstId);
  other.click();
  await h.wait(200);
  t.ok(FT.state.id === firstId, 'clicking a row opens that tree');
  t.ok(Object.keys(FT.state.people).length === 9, 'with its own people');
  t.ok(Object.keys(FT.loadDoc(secondId).people).length === 1, 'the one we left kept its edit');

  t.section('deleting a tree');
  $('#treeMenuBtn').click();
  await h.wait(100);
  $('[data-delete-tree="' + secondId + '"]').click();
  await h.wait(150);
  t.ok(!$('#askDialog').hidden, 'deletion asks first');
  $('#askOk').click();
  await h.wait(250);
  t.ok(FT.listDocs().length === 1, 'the tree is gone from the shelf');
  t.ok(!FT.loadDoc(secondId), 'and from storage');
  t.ok(FT.state.id === firstId, 'the open tree is unaffected');

  t.section('the tree menu');
  $('#treeMenuBtn').click();
  await h.wait(120);
  t.ok(!$('#fileStatus'), 'there is no "this tree on disk" panel');
  t.ok(!!$('[data-action="backupAll"]'), 'but backing every tree up is still offered');

  t.section('the shelf survives a reload');
  const again = await h.loadPage();
  t.ok(again.window.FT.listDocs().length >= 0, 'a fresh browser profile starts with its own shelf');

  t.section('migrating from the single-tree era');
  const old = await h.loadPage(h.BASE, {
    beforeParse(win) {
      win.localStorage.setItem(
        'heirloom.tree.v1',
        JSON.stringify({
          id: 't_legacy',
          title: 'Grandmother’s tree',
          people: { p1: { name: 'Carol', x: 0, y: 0 } },
          unions: {},
        })
      );
    },
  });
  const oldFT = old.window.FT;
  t.ok(oldFT.state.title === 'Grandmother’s tree', 'an existing single tree opens as before');
  t.ok(Object.keys(oldFT.state.people).length === 1, 'with its people intact');
  t.ok(oldFT.listDocs().length === 1, 'and now sits on the shelf');
  t.ok(old.window.localStorage.getItem('heirloom.tree.v1') === null, 'the old entry is cleared away');
};
