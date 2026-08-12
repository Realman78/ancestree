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
  t.ok(dom.errors.length === 0, 'no runtime errors on load' + (dom.errors.length ? ': ' + dom.errors[0] : ''));
  const nPeople = Object.keys(FT.state.people).length;
  t.ok($$('.card').length === nPeople, 'one card per person (' + nPeople + ')');
  t.ok($('#edges path.edge').getAttribute('d').length > 50, 'connector paths are drawn');
  t.ok($$('#edges .union-mark').length === 3, 'a union marker per couple');
  t.ok($$('.card .entry-count:not([hidden])').length === 3, 'diary badges only on people with entries');
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
  t.ok($('#wordCount').textContent === '4 words', 'the word count updates');

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
  t.ok(
    JSON.parse(w.localStorage.getItem('heirloom.tree.v1')).people[josip].name === 'Josip K.',
    'edits are saved to localStorage'
  );

  t.section('read-only (what a recipient sees)');
  FT.adoptDocument(FT.normalize(FT.demoTree()), true);
  t.ok(d.body.classList.contains('read-only'), 'read-only mode engages');
  t.ok(!$('#roBanner').hidden, 'a banner explains the tree is shared');
  t.ok($('#pill').hidden, 'the editing pill is hidden');
  t.ok($('#treeTitle').disabled, 'the title cannot be renamed');
  FT.openBook(Object.keys(FT.state.people)[0]);
  t.ok(!$('#pageLeft input') && !$('#pageRight textarea'), 'the book has no editable fields');
  t.ok($$('#pageLeft .pf-value').length > 0, 'but the facts are still shown');
  t.ok(!$('#pageLeft .pf-clampwrap.editable'), '"Known for" is not editable either');
  FT.closeBook();
  t.ok(
    !!JSON.parse(w.localStorage.getItem('heirloom.tree.v1')).people[josip],
    'viewing a shared tree does not overwrite my own saved tree'
  );

  $('[data-action="copyToMine"]').click();
  t.ok(!d.body.classList.contains('read-only'), '"Make a copy" hands back an editable tree');
  t.ok(FT.state.title.endsWith('(copy)'), 'and names it as a copy');

  t.section('hostile input from a shared link');
  const evil = FT.normalize({
    title: 'x',
    people: { e1: { name: '<img src=x onerror="window.__pwned=1">', knownFor: '<script>window.__pwned=1<\/script>' } },
    unions: {},
  });
  FT.adoptDocument(evil, true);
  FT.openBook('e1');
  t.ok(!w.__pwned, 'no script runs from a malicious name');
  t.ok(d.querySelectorAll('#nodes img, #pageLeft img').length === 0, 'markup is escaped, not injected');
  t.ok($('#pageLeft .person-name').textContent.includes('<img'), 'it renders as literal text');
  FT.closeBook();
};
