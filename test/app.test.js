/* The wired-up page: rendering, selection, relationship buttons, the book,
   read-only mode, and escaping of hostile input. */
module.exports = async function (t, h) {
  const dom = await h.loadPage();
  const w = dom.window;
  const d = w.document;
  const FT = w.FT;
  const $ = (s) => d.querySelector(s);
  const $$ = (s) => Array.from(d.querySelectorAll(s));

  t.section('boot');
  t.ok($$('.card').length === 0, 'the board starts empty');
  $('[data-action="demo"]').click();
  await h.wait(200);
  t.ok(dom.errors.length === 0, 'no runtime errors on load' + (dom.errors.length ? ': ' + dom.errors[0] : ''));
  const nPeople = Object.keys(FT.state.people).length;
  t.ok($$('.card').length === nPeople, 'one card per person (' + nPeople + ')');
  // One path per relationship, each with a fat transparent twin to click.
  const expectedEdges = FT.unionList().reduce(
    (n, u) => n + (u.partners.length >= 2 ? 1 : 0) + u.children.length, 0);
  t.ok($$('#edges path.edge').length === expectedEdges,
    'one connector per relationship (' + expectedEdges + ')');
  t.ok($$('#edges path.edge-hit').length === expectedEdges, 'each with a hit target');
  t.ok($('#edges path.edge').getAttribute('d').length > 8, 'connector paths have geometry');
  t.ok($$('#edges .union-mark').length === 3, 'a union marker per couple');
  t.ok($$('.card .entry-count').length === 0, 'cards carry no chapter badge');
  t.ok($('#treeTitle').value === FT.state.title, 'title field is bound to the document');
  t.ok($$('.card .dates')[0].textContent.trim().length <= 12, 'cards show years, not full dates');

  t.section('selection and relationships');
  const marko = $$('.card').find((c) => FT.state.people[c.dataset.id].name === 'Marko Kovač');
  FT.select(marko.dataset.id);
  t.ok($('#pill').hidden === false, 'the action pill appears on selection');
  t.ok($('.card.selected').dataset.id === marko.dataset.id, 'the selected card is marked');

  let n = Object.keys(FT.state.people).length;
  $('#pill [data-action="child"]').click();
  t.ok(Object.keys(FT.state.people).length === n + 1, '"+ Child" adds exactly one person');
  t.ok($$('.card').length === n + 1, 'and the canvas re-renders');
  t.ok(FT.parentsOf(FT.selected).includes(marko.dataset.id), 'the child is wired to its parent');

  n = Object.keys(FT.state.people).length;
  FT.select(marko.dataset.id);
  $('#pill [data-action="parent"]').click();
  t.ok(Object.keys(FT.state.people).length === n, 'refuses a third parent');

  t.section('deleting works when the browser blocks dialogs');
  // The reported bug: confirm() returns false in a browser with dialogs
  // suppressed, so every gated action silently did nothing.
  const doomed = FT.addPerson({ name: 'Doomed Soul', x: 0, y: 0 });
  FT.render();
  FT.select(doomed.id);
  $('#pill [data-action="remove"]').click();
  t.ok(!FT.state.people[doomed.id], 'a person is removed without a confirmation dialog');
  t.ok(w.__confirmCalls === 0, 'confirm() is never called');
  t.ok(!$('#hintUndo').hidden, 'and the toast offers a way back');
  t.ok(/Removed Doomed Soul/.test($('#hintText').textContent), 'saying what went (' + $('#hintText').textContent + ')');

  $('#hintUndo').click();
  t.ok(!!FT.state.people[doomed.id], 'the toast Undo brings them back');
  FT.select(doomed.id);
  $('#pill [data-action="remove"]').click();
  t.ok(!FT.state.people[doomed.id], 'removed again for the rest of the run');

  t.section('the undo button');
  t.ok($('#undoBtn').disabled === false, 'Undo is enabled once there is history');
  $('#undoBtn').click();
  t.ok(!!FT.state.people[doomed.id], 'the toolbar Undo works too');
  t.ok($('#redoBtn').disabled === false, 'and Redo becomes available');
  $('#redoBtn').click();
  t.ok(!FT.state.people[doomed.id], 'Redo reapplies it');
  t.ok(FT.canUndo() && !FT.canRedo(), 'history tracks both directions');

  t.section('replacing the whole tree is recoverable');
  // "Start fresh" and "Sample family" no longer ask either, so a stray click
  // must not be the end of someone's tree.
  const beforeReplace = JSON.stringify(FT.state.people);
  $('[data-action="demo"]').click();
  await h.wait(150);
  t.ok(!$('#askDialog').hidden, 'loading the sample over a full board asks first');
  $('#askOk').click();
  await h.wait(250);
  t.ok(JSON.stringify(FT.state.people) !== beforeReplace, 'confirming replaces the board');
  t.ok(!$('#hintUndo').hidden, 'and offers Undo');
  $('#hintUndo').click();
  t.ok(JSON.stringify(FT.state.people) === beforeReplace, 'undo restores what was there, person for person');
  t.ok(w.__confirmCalls === 0, 'no browser dialog was used for any of it');

  t.section('relationship lines are selectable and removable');
  const partnerUnion = FT.unionList().find((u) => u.partners.length === 2 && u.children.length);
  FT.selectEdge({ kind: 'partner', unionId: partnerUnion.id, childId: null });
  t.ok(!!$('#edges path.edge.selected'), 'a selected line is highlighted');
  t.ok($('#pill').hidden, 'and the card pill gives way');
  t.ok(FT.selected === null, 'selecting a line deselects any card');
  t.ok(/&/.test(FT.edgeLabel(FT.selectedEdge)), 'the line is labelled with both names');

  const keptChildren = partnerUnion.children.slice();
  // The keeper is whoever is drawn on the left, so the result matches the canvas.
  const keeper = partnerUnion.partners
    .slice()
    .sort((a, b) => FT.state.people[a].x - FT.state.people[b].x)[0];
  const dropped = partnerUnion.partners.find((id) => id !== keeper);
  $('#edgePill [data-action="removeEdge"]').click();
  t.ok(FT.state.unions[partnerUnion.id].partners.length === 1, 'removing a partner line separates the couple');
  t.ok(FT.state.unions[partnerUnion.id].partners[0] === keeper, 'the union stays with the left-hand partner');
  t.ok(
    keptChildren.every((c) => FT.parentsOf(c).includes(keeper)),
    'their children keep that parent rather than being orphaned'
  );
  t.ok(!!FT.state.people[dropped], 'and the ex-partner stays on the canvas');
  t.ok(FT.selectedEdge === null, 'the selection clears afterwards');

  const childUnion = FT.unionList().find((u) => u.children.length);
  const someChild = childUnion.children[0];
  FT.selectEdge({ kind: 'child', unionId: childUnion.id, childId: someChild });
  $('#edgePill [data-action="removeEdge"]').click();
  t.ok(!FT.parentUnionOf(someChild), 'removing a child line detaches them from their parents');
  t.ok(!!FT.state.people[someChild], 'but the person remains');

  FT.undo();
  t.ok(!!FT.parentUnionOf(someChild), 'undo restores a removed link');
  t.ok(w.__confirmCalls === 0, 'no dialog was used for any of it');

  t.section('crossing lines hop over each other');
  const hop = (edges) => edges.filter((e) => /A5 5/.test(e.d)).length;

  // The sample family has no crossings, so nothing should be embellished.
  FT.adoptDocument(FT.normalize(FT.demoTree()));
  FT.autoArrange();
  t.ok(hop(FT.edgeGeometry()) === 0, 'a tree with no crossings draws none');

  // Three marriages force one connector under the row, where a child's riser
  // from another union crosses it.
  FT.adoptDocument(FT.newTree('Three marriages'));
  const tid = {};
  ['Josip', 'Ana', 'Marta', 'Vera', 'Ivan', 'Petar', 'Nina'].forEach((n) => {
    tid[n] = FT.addPerson({ name: n, x: 0, y: 0 }).id;
  });
  [
    [['Ana', 'Josip'], ['Ivan'], '1948'],
    [['Josip', 'Marta'], ['Petar'], '1957'],
    [['Josip', 'Vera'], ['Nina'], '1970'],
  ].forEach(([pp, cc, dd]) => {
    const un = FT.newUnion({
      partners: pp.map((n) => tid[n]), children: cc.map((n) => tid[n]), date: dd,
    });
    FT.state.unions[un.id] = un;
  });
  FT.autoArrange();
  const geo = FT.edgeGeometry();
  t.ok(hop(geo) >= 1, 'a genuine crossing gets a hop (' + hop(geo) + ')');
  t.ok(
    geo.filter((e) => /A5 5/.test(e.d)).every((e) => e.kind === 'partner' || e.kind === 'child'),
    'drawn on a real connector'
  );

  // Every hop must sit on a horizontal run, and only where two different
  // unions actually cross — a shared junction is not a crossing.
  const hopped = geo.find((e) => /A5 5/.test(e.d));
  t.ok(!!hopped.pts, 'the hopped edge still has its route');
  const arcs = (hopped.d.match(/A5 5/g) || []).length;
  t.ok(arcs === 1, 'with one arc, not a stack of them');

  // Children of one union share their route; they must never hop over each other.
  FT.adoptDocument(FT.newTree('Siblings'));
  const sid = {};
  ['Ma', 'Pa', 'A', 'B', 'C'].forEach((n) => {
    sid[n] = FT.addPerson({ name: n, x: 0, y: 0 }).id;
  });
  const su = FT.newUnion({
    partners: [sid.Ma, sid.Pa], children: [sid.A, sid.B, sid.C],
  });
  FT.state.unions[su.id] = su;
  FT.autoArrange();
  t.ok(hop(FT.edgeGeometry()) === 0, 'siblings sharing one bus never hop over each other');

  FT.adoptDocument(FT.normalize(FT.demoTree()));
  FT.autoArrange();
  FT.render();

  t.section('the book');
  const josip = Object.keys(FT.state.people).find((id) => FT.state.people[id].name === 'Josip Kovač');
  FT.openBook(josip);
  t.ok(!$('#bookOverlay').hidden, 'the book opens');
  t.ok($('#pageLeft .person-name').value === 'Josip Kovač', 'the left page shows the person');
  t.ok($$('#pageLeft .toc-item').length === 2, 'chapters are listed in the contents');
  const entries = FT.state.people[josip].entries;
  t.ok($('#pageRight .entry-body').value === entries[entries.length - 1].body, 'the latest chapter opens');
  t.ok(!!$('#pageLeft .toc-item.current'), 'the open chapter is highlighted');

  const body = $('#pageRight .entry-body');
  body.value = 'Rewritten by the test.';
  body.dispatchEvent(new w.Event('input', { bubbles: true }));
  t.ok(
    FT.state.people[josip].entries.some((e) => e.body === 'Rewritten by the test.'),
    'typing writes through to the document'
  );
  t.ok(!$('#wordCount'), 'the chapter page has no word counter');

  const surname = $('[data-field="birthSurname"]');
  t.ok(!!surname, 'the book has a field for the surname someone was born with');
  surname.value = 'Buljan';
  surname.dispatchEvent(new w.Event('input', { bubbles: true }));
  t.ok(FT.state.people[josip].birthSurname === 'Buljan', 'and it saves through');

  const nameEl = $('#pageLeft .person-name');
  nameEl.value = 'Josip K.';
  nameEl.dispatchEvent(new w.Event('input', { bubbles: true }));
  t.ok(FT.state.people[josip].name === 'Josip K.', 'renaming updates the person');

  const before = FT.state.people[josip].entries.length;
  $('#addEntry').click();
  t.ok(FT.state.people[josip].entries.length === before + 1, 'a new chapter is added');
  $('#deleteEntry').click();
  t.ok(FT.state.people[josip].entries.length === before, 'and can be deleted again');
  FT.closeBook();

  t.section('persistence');
  FT.save();
  const reloaded = FT.loadDoc(FT.state.id);
  t.ok(!!reloaded, 'the open tree is written to its own storage entry');
  t.ok(reloaded.people[josip].name === 'Josip K.', 'edits are saved');
  t.ok(
    FT.listDocs().some((row) => row.id === FT.state.id),
    'and it appears on the shelf'
  );

  t.section('hostile input from an imported file');
  const evil = FT.normalize({
    title: 'x',
    people: { e1: { name: '<img src=x onerror="window.__pwned=1">', knownFor: '<script>window.__pwned=1<\/script>' } },
    unions: {},
  });
  FT.adoptDocument(evil);
  FT.openBook('e1');
  t.ok(!w.__pwned, 'no script runs from a malicious name');
  t.ok(d.querySelectorAll('#nodes img, #pageLeft img').length === 0, 'markup is escaped, not injected');
  t.ok($('#pageLeft .person-name').value.includes('<img'), 'it sits in the field as literal text');
  FT.closeBook();
};
