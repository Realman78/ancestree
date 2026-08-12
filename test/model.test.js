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
