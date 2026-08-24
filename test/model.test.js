/* The document model: layout, relationship edits, integrity, dates, undo. */
module.exports = function (t, h) {
  const FT = h.loadHeadless();

  t.section('layout');
  FT.state = FT.demoTree();
  FT.autoArrange();
  const people = FT.peopleList();
  const by = {};
  people.forEach((p) => (by[p.name.split(' ')[0]] = p));

  t.ok(people.every((p) => p.x % FT.GRID === 0 && p.y % FT.GRID === 0), 'all cards land on the grid');
  t.ok(by.Josip.y === by.Ana.y, 'partners share a row');
  t.ok(by.Marko.y === by.Josip.y + FT.ROW_H, 'children sit one row below their parents');
  t.ok(by.Petra.y === by.Marko.y + FT.ROW_H, 'grandchildren two rows below');
  t.ok(by.Vera.y === by.Marko.y, 'a married-in partner shares the spouse row');
  t.ok(by.Nina.y === by.Petra.y, 'cousins share a row');

  const overlaps = (list) => {
    let n = 0;
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++)
        if (Math.abs(list[i].x - list[j].x) < FT.CARD_W && Math.abs(list[i].y - list[j].y) < FT.CARD_H) n++;
    return n;
  };
  t.ok(overlaps(people) === 0, 'no two cards overlap after tidy-up');

  const u = FT.unionList().find(
    (x) => x.children.length === 2 && x.partners.includes(by.Marko.id)
  );
  const kids = u.children.map((c) => FT.state.people[c]);
  const coupleMid = (FT.state.people[u.partners[0]].x + FT.state.people[u.partners[1]].x) / 2 + FT.CARD_W / 2;
  const kidMid = (Math.min(...kids.map((k) => k.x)) + Math.max(...kids.map((k) => k.x)) + FT.CARD_W) / 2;
  t.ok(Math.abs(coupleMid - kidMid) <= FT.GRID, 'a couple is centred over their children');

  t.section('relationships');
  const kid = FT.addChild(by.Petra.id);
  t.ok(kid && FT.parentsOf(kid.id).includes(by.Petra.id), 'addChild links parent to child');
  const mate = FT.addPartner(by.Petra.id);
  t.ok(mate && FT.partnersOf(by.Petra.id).includes(mate.id), 'addPartner joins the existing union');
  t.ok(FT.parentsOf(kid.id).length === 2, "the new partner becomes the child's second parent");
  t.ok(FT.addParent(by.Josip.id) !== null, 'addParent creates a generation above');
  t.ok(FT.addParent(by.Marko.id) === null, 'refuses a third parent');

  t.section('integrity');
  t.ok(FT.linkAsChild(by.Petra.id, by.Josip.id) === false, 'refuses a link that would loop the tree');
  t.ok(FT.linkAsPartners(by.Josip.id, by.Josip.id) === false, 'refuses self-partnering');
  FT.removePerson(kid.id);
  t.ok(!FT.state.people[kid.id], 'removePerson deletes the person');
  t.ok(
    FT.unionList().every((x) => !x.children.includes(kid.id) && !x.partners.includes(kid.id)),
    'and leaves no dangling references'
  );
  FT.autoArrange();
  t.ok(overlaps(FT.peopleList()) === 0, 'still no overlaps after edits and a re-tidy');

  t.section('a partner from another generation');
  // Rare but real: someone partnered with a descendant. Levelling them onto one
  // row is impossible, and the old layout chased its own tail until the pass cap
  // stopped it, ~16,000px down the canvas.
  const cross = h.loadHeadless();
  cross.state = cross.demoTree();
  const c = {};
  cross.peopleList().forEach((p) => (c[p.name.split(' ')[0]] = p));
  t.ok(cross.linkAsPartners(c.Josip.id, c.Petra.id), 'a grandparent can be partnered with a grandchild');
  t.ok(
    !cross.parentsOf(c.Marko.id).includes(c.Petra.id),
    'and that does not retroactively make her a parent of her own father'
  );
  t.ok(cross.ancestrallyRelated(c.Josip.id, c.Petra.id), 'the pair is recognised as ancestrally related');

  const started = Date.now();
  cross.autoArrange();
  const took = Date.now() - started;
  const rows = cross.peopleList().map((p) => p.y / cross.ROW_H);
  t.ok(took < 2000, 'the layout still settles quickly (' + took + 'ms)');
  t.ok(Math.max(...rows) === 2, 'and keeps its three generations (max row ' + Math.max(...rows) + ')');
  t.ok(cross.state.people[c.Josip.id].y === 0, 'the grandparent stays on the top row');
  t.ok(
    cross.state.people[c.Petra.id].y === 2 * cross.ROW_H,
    'the grandchild stays two rows below, not dragged up to meet them'
  );
  t.ok(overlaps(cross.peopleList()) === 0, 'nothing overlaps');
  t.ok(
    cross.isCrossGenerationUnion(cross.unionsOf(c.Josip.id).find((u) => u.partners.includes(c.Petra.id))),
    'the link is flagged so it can be drawn as a cross-generation one'
  );

  t.section('partnering never rewrites parentage into a loop');
  // Joining a union with a free seat also adopts its children. Fine for a lone
  // parent gaining a partner; a loop if those children are the partner's own
  // ancestors — which sent the layout to row 400 before this guard existed.
  const loop = h.loadHeadless();
  loop.state = loop.demoTree();
  const l = {};
  loop.peopleList().forEach((p) => (l[p.name.split(' ')[0]] = p));
  const grandUnion = loop.unionsOf(l.Josip.id)[0];
  loop.dissolveUnion(grandUnion.id); // leaves Josip a lone parent with a free seat
  t.ok(grandUnion.partners.length === 1, 'a union with one partner and children has a free seat');
  loop.linkAsPartners(l.Josip.id, l.Petra.id);
  t.ok(
    !grandUnion.children.includes(l.Marko.id) || grandUnion.partners.indexOf(l.Petra.id) < 0,
    'the descendant is not seated into the union that produced her own father'
  );
  t.ok(loop.partnersOf(l.Josip.id).includes(l.Petra.id), 'but the partnership is still recorded');
  loop.autoArrange();
  t.ok(
    Math.max(...loop.peopleList().map((p) => p.y / loop.ROW_H)) <= 3,
    'and the layout stays sane (max row ' + Math.max(...loop.peopleList().map((p) => p.y / loop.ROW_H)) + ')'
  );

  t.section('removing a single relationship');
  const doc = h.loadHeadless();
  doc.state = doc.demoTree();
  const d = {};
  doc.peopleList().forEach((p) => (d[p.name.split(' ')[0]] = p));
  const married = doc.unionsOf(d.Josip.id)[0];
  const hadChildren = married.children.slice();
  doc.dissolveUnion(married.id);
  t.ok(doc.state.unions[married.id].partners.length === 1, 'dissolving a couple with children keeps one parent');
  t.ok(hadChildren.every((k) => doc.parentsOf(k).length === 1), 'the children keep that parent');

  const childless = doc.newUnion({ partners: [d.Vera.id, d.Luka.id], children: [] });
  doc.state.unions[childless.id] = childless;
  doc.dissolveUnion(childless.id);
  t.ok(!doc.state.unions[childless.id], 'a childless couple simply goes away');

  const u2 = doc.unionsOf(d.Marko.id)[0];
  doc.detachChild(u2.id, d.Petra.id);
  t.ok(!doc.parentUnionOf(d.Petra.id), 'a detached child has no parents');
  t.ok(!!doc.state.people[d.Petra.id], 'but is still in the tree');

  t.section('multiple partners stay contiguous');
  // Laying out one union at a time let an unrelated card sit between a couple,
  // which made two strangers read as married. The whole partnership component
  // is placed as one run now.
  const mp = h.loadHeadless();
  const build = (unions) => {
    mp.state = mp.newTree('x');
    const id = {};
    const need = new Set();
    unions.forEach((u) => u.p.concat(u.c || []).forEach((n) => need.add(n)));
    need.forEach((n) => (id[n] = mp.addPerson({ name: n, x: 0, y: 0 }).id));
    unions.forEach((u) => {
      mp.state.unions[mp.uid('u')] = mp.newUnion({
        partners: u.p.map((n) => id[n]),
        children: (u.c || []).map((n) => id[n]),
        date: u.d || '',
      });
    });
    mp.autoArrange();
    return id;
  };
  const rowOrder = (y) =>
    mp.peopleList().filter((p) => p.y === y).sort((a, b) => a.x - b.x).map((p) => p.name);
  const adjacent = (aId, bId) =>
    Math.abs(mp.state.people[aId].x - mp.state.people[bId].x) <= mp.CARD_W + mp.SPOUSE_GAP + 1;
  const anyOverlap = () => {
    const L = mp.peopleList();
    for (let i = 0; i < L.length; i++)
      for (let j = i + 1; j < L.length; j++)
        if (Math.abs(L[i].x - L[j].x) < mp.CARD_W && Math.abs(L[i].y - L[j].y) < mp.CARD_H) return true;
    return false;
  };

  let id = build([
    { p: ['Ana', 'Josip'], c: ['Ivan', 'Maja'], d: '1948' },
    { p: ['Josip', 'Marta'], c: ['Petar'], d: '1962' },
  ]);
  t.ok(adjacent(id.Ana, id.Josip) && adjacent(id.Josip, id.Marta),
    'a remarriage seats both spouses beside the person (' + rowOrder(0).join(' ') + ')');
  t.ok(!anyOverlap(), 'with nothing overlapping');
  t.ok(mp.parentsOf(id.Ivan).includes(id.Josip) && !mp.parentsOf(id.Petar).includes(id.Ana),
    'and each set of children keeps its own parents');

  // The case that was actively wrong: both spouses remarry.
  id = build([
    { p: ['Josip', 'Ana'], c: ['Ivan'], d: '1948' },
    { p: ['Josip', 'Marta'], c: ['Petar'], d: '1962' },
    { p: ['Ana', 'Boris'], c: ['Nina'], d: '1965' },
  ]);
  t.ok(adjacent(id.Josip, id.Ana), 'Josip and Ana sit together');
  t.ok(adjacent(id.Josip, id.Marta), 'Josip and Marta sit together');
  t.ok(adjacent(id.Ana, id.Boris), 'Ana and Boris sit together');
  t.ok(!anyOverlap(), 'and nothing overlaps (' + rowOrder(0).join(' ') + ')');
  // Nobody should be parked between a couple, which is what read as a marriage.
  const row = rowOrder(0);
  const between = (a, b) => {
    const i = row.indexOf(a);
    const j = row.indexOf(b);
    return Math.abs(i - j) - 1;
  };
  t.ok(between('Josip', 'Ana') === 0, 'no stranger sits between Josip and Ana');
  t.ok(between('Ana', 'Boris') === 0, 'nor between Ana and Boris');

  // A star cannot seat every spouse adjacent — but it must still be sane.
  id = build([
    { p: ['Ana', 'Josip'], c: ['Ivan'], d: '1948' },
    { p: ['Josip', 'Marta'], c: ['Petar'], d: '1957' },
    { p: ['Josip', 'Vera'], c: ['Nina'], d: '1970' },
  ]);
  t.ok(!anyOverlap(), 'three marriages lay out without overlap (' + rowOrder(0).join(' ') + ')');
  const reaching = mp.unionList().filter((u) => u.partners.length === 2 &&
    !adjacent(u.partners[0], u.partners[1]));
  t.ok(reaching.length <= 1, 'at most one union has to reach past a card');
  t.ok(mp.peopleList().every((p) => p.y / mp.ROW_H <= 1), 'and everyone stays in two rows');

  t.section('union attributes');
  t.ok(mp.newUnion().status === 'married', 'a new union is a marriage by default');
  t.ok(mp.unionLabel({ status: 'married', date: '1948-09-19', endDate: '' }) === 'm. 1948',
    'a marriage is labelled with its year');
  t.ok(mp.unionLabel({ status: 'married', date: '1948', endDate: '1961' }) === 'm. 1948 – 1961',
    'and with both years when it ended');
  t.ok(mp.unionLabel({ status: 'partners', date: '1970' }) === 'since 1970',
    'an unmarried partnership reads differently');
  t.ok(mp.unionLabel({ status: 'married', date: '', endDate: '' }) === '',
    'nothing is drawn when no dates are recorded');
  const sorted = mp.sortUnions([
    { id: 'b', date: '1962' }, { id: 'a', date: '1948' }, { id: 'c', date: '' },
  ]);
  t.ok(sorted.map((u) => u.id).join('') === 'abc', 'unions order chronologically, undated last');

  t.section('born surname');
  t.ok(mp.newPerson().birthSurname === '', 'people start with none');
  t.ok(mp.bornAs({ birthSurname: 'Marić' }) === 'born Marić', 'shown as "born X"');
  t.ok(mp.bornAs({ birthSurname: '  ' }) === '', 'blank stays blank');
  t.ok(mp.normalize({ people: { a: { name: 'A', birthSurname: 42 } } }).people.a.birthSurname === '42',
    'a non-string is coerced rather than trusted');

  t.section('dates');
  t.ok(FT.isIsoDate('1921-03-14') && !FT.isIsoDate('1921'), 'recognises a full date');
  t.ok(FT.yearOf('1921-03-14') === '1921', 'takes the year from a picked date');
  t.ok(FT.yearOf('c. 1880') === '1880', 'takes the year from legacy free text');
  t.ok(FT.yearOf('') === '', 'empty stays empty');
  t.ok(FT.yearOf('unknown') === 'unknown', 'keeps unparseable text rather than blanking it');
  t.ok(
    FT.lifespan({ birth: '1921-03-14', death: '1998-11-02' }) === '1921 – 1998',
    'cards show years only, not full dates'
  );
  t.ok(FT.lifespan({ birth: '1953-09-19', death: '' }) === '1953 –', 'a living person shows an open span');

  t.section('normalize (untrusted input)');
  const junk = FT.normalize({
    title: 42,
    people: { a: { name: '<img onerror=x>', x: 'NaN' } },
    unions: { u1: { partners: ['a', 'ghost'], children: ['ghost'] } },
  });
  t.ok(typeof junk.title === 'string', 'coerces a bad title');
  t.ok(junk.people.a.x === 0, 'replaces a non-numeric coordinate');
  t.ok(junk.unions.u1.partners.length === 1, 'drops references to people who do not exist');
  t.ok(Object.keys(FT.normalize(null).people).length === 0, 'survives null');
  t.ok(FT.normalize({ people: { a: { name: 'x', entries: 'nope' } } }).people.a.entries.length === 0,
    'survives a malformed entries field');

  const ranged = FT.normalize({
    people: {
      a: {
        name: 'x',
        entries: [
          { id: 'e1', date: '1946-06-02', end: '1946-09-15', title: 'ok' },
          { id: 'e2', date: '1950-01-01', end: '1949-01-01', title: 'backwards' },
          { id: 'e3', date: '1960-01-01', title: 'no end' },
        ],
      },
    },
  });
  t.ok(ranged.people.a.entries[0].end === '1946-09-15', 'keeps a valid chapter end date');
  t.ok(ranged.people.a.entries[1].end === '', 'drops an end date that precedes the start');
  t.ok(ranged.people.a.entries[2].end === '', 'defaults a missing end date to empty');

  t.section('undo');
  const before = FT.state.people[by.Ana.id].name;
  FT.checkpoint();
  FT.state.people[by.Ana.id].name = 'CHANGED';
  FT.undo();
  t.ok(FT.state.people[by.Ana.id].name === before, 'undo restores the previous snapshot');
  FT.redo();
  t.ok(FT.state.people[by.Ana.id].name === 'CHANGED', 'redo reapplies it');
};
