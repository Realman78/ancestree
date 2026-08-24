/* Getting a tree out: JSON, SVG, PNG — and back in from JSON only. */
module.exports = async function (t, h) {
  const dom = await h.loadPage();
  const w = dom.window;
  const d = w.document;
  const FT = w.FT;

  // Start from the sample so there is something to draw.
  d.querySelector('[data-action="demo"]').click();
  await h.wait(200);

  t.section('SVG');
  const svg = FT.buildSvg();
  t.ok(svg.startsWith('<svg') && svg.trim().endsWith('</svg>'), 'is a standalone SVG document');
  t.ok(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/.test(svg), 'carries the SVG namespace');

  const people = FT.peopleList();
  const rects = (svg.match(/<rect [^>]*rx="12"/g) || []).length;
  t.ok(rects === people.length, 'one card per person (' + rects + '/' + people.length + ')');
  people.forEach(function (p) {
    if (p.name === 'Joseph Miller') {
      t.ok(svg.indexOf('Joseph') >= 0, 'names are drawn as real text, not paths');
    }
  });

  const edges = FT.edgeGeometry().length;
  const paths = (svg.match(/<path d=/g) || []).length;
  t.ok(paths >= edges, 'every connector is drawn (' + paths + ' paths for ' + edges + ' links)');
  t.ok(/1921 – 1998/.test(svg), 'cards show the lifespan in years');
  t.ok(/m\. 1948/.test(svg), 'and marriages are captioned with their year');

  // A relationship that ended, and an unmarried one, must read differently.
  const u1 = FT.unionList()[0];
  u1.status = 'ended';
  u1.endDate = '1961';
  const endedSvg = FT.buildSvg();
  t.ok(/m\. 1948 – 1961/.test(endedSvg), 'an ended marriage shows both years');
  u1.status = 'partners';
  t.ok(/stroke-dasharray="7 5"/.test(FT.buildSvg()), 'a partnership is dashed');
  u1.status = 'married';
  u1.endDate = '';

  // The export must be parseable, not merely string-shaped.
  const parsed = new w.DOMParser().parseFromString(svg, 'image/svg+xml');
  t.ok(!parsed.querySelector('parsererror'), 'parses as well-formed XML');
  t.ok(parsed.documentElement.getAttribute('viewBox').split(' ').length === 4, 'has a sane viewBox');

  t.section('SVG escaping');
  FT.state.people[Object.keys(FT.state.people)[0]].name = 'Ada <script>&"x" O\'Neill';
  const hostile = FT.buildSvg();
  t.ok(hostile.indexOf('<script>') < 0, 'markup in a name cannot break out into the document');
  t.ok(hostile.indexOf('&lt;script&gt;') >= 0, 'it is escaped as text');
  const hostileDoc = new w.DOMParser().parseFromString(hostile, 'image/svg+xml');
  t.ok(!hostileDoc.querySelector('parsererror'), 'and the file is still well-formed');

  t.section('photos travel with the drawing');
  const withPhoto = Object.keys(FT.state.people)[1];
  FT.state.people[withPhoto].photo =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const photoSvg = FT.buildSvg();
  t.ok(/<image /.test(photoSvg), 'a portrait becomes an <image>');
  t.ok(/href="data:image\/png;base64,/.test(photoSvg), 'embedded inline, so the file stands alone');
  t.ok(/clip-path="url\(#clip-/.test(photoSvg), 'clipped to the portrait circle');

  t.section('fitting text into a fixed width');
  // Character counting was the original bug: it cannot know real glyph widths,
  // and it never broke a word that had no spaces in it.
  const F = '12.5px Georgia, serif';
  const widthOf = (str) => {
    const c = d.createElement('canvas').getContext('2d');
    c.font = F;
    return c.measureText(str).width;
  };
  const LIMIT = 300;
  const fits = (lines) => lines.every((l) => widthOf(l) <= LIMIT + 0.5);

  const runOn = FT.fitLines('marinparin'.repeat(14), F, LIMIT, 2);
  t.ok(runOn.length === 2, 'an unbroken 140-character word is split over both lines');
  t.ok(fits(runOn), 'and every line fits the width it was given');
  t.ok(runOn[1].endsWith('…'), 'with an ellipsis where it was cut');

  const prose = FT.fitLines(
    'Kept the village school open through two hard winters and then rebuilt ' +
      'the roof herself, twice, without ever once asking for help.', F, LIMIT, 2);
  t.ok(prose.length === 2 && fits(prose), 'ordinary prose wraps within the width');
  t.ok(prose[1].endsWith('…'), 'and is marked when it overflows two lines');

  const short = FT.fitLines('Village blacksmith', F, LIMIT, 2);
  t.ok(short.length === 1 && !short[0].endsWith('…'), 'text that fits is left alone');
  t.ok(FT.fitLines('', F, LIMIT, 2).length === 0, 'empty text yields no lines');
  t.ok(FT.fitLines('   ', F, LIMIT, 2).length === 0, 'whitespace yields no lines');

  const oneLine = FT.fitLines('A Very Long Place Name In The Middle Of Nowhere, Iowa',
    F, LIMIT, 1);
  t.ok(oneLine.length === 1 && fits(oneLine), 'a single-line field is held to one line');
  t.ok(oneLine[0].endsWith('…'), 'and ellipsed');

  t.section('the detailed SVG');
  // Give the sample enough detail that every part of the card is exercised.
  // An earlier section renamed the first person to test escaping; put it back
  // so the card reads normally here.
  const josip = Object.keys(FT.state.people).find((i) => FT.state.people[i].birth === '1921-03-14');
  FT.state.people[josip].name = 'Joseph Miller';
  FT.state.people[josip].knownFor =
    'Village blacksmith for forty years, who reopened the forge after the war ' +
    'and made the iron gate that still stands on the courthouse lawn.';
  const detail = FT.buildDetailedSvg();

  const dParsed = new w.DOMParser().parseFromString(detail, 'image/svg+xml');
  t.ok(!dParsed.querySelector('parsererror'), 'parses as well-formed XML');
  t.ok((detail.match(/<g clip-path="url\(#dcard-/g) || []).length === people.length,
    'one detailed card per person');
  t.ok((detail.match(/<clipPath id="dcard-/g) || []).length === people.length,
    'each clipped to its own bounds so text cannot escape it');

  t.ok(/BORN/.test(detail) && /DIED/.test(detail), 'has Born and Died labels');
  t.ok(/14 March 1921/.test(detail), 'dates carry the day and month, not just the year');
  t.ok(/2 November 1998/.test(detail), 'including the death date');
  t.ok(/FROM/.test(detail) && /Cedar Falls, Iowa/.test(detail), 'shows where they were from');
  t.ok(/KNOWN FOR/.test(detail), 'has a known-for section');
  FT.state.people[josip].birthSurname = 'Calloway';
  const withSurname = FT.buildDetailedSvg();
  t.ok(/BORN AS/.test(withSurname) && /Calloway/.test(withSurname),
    'shows the surname someone was born with');
  FT.state.people[josip].birthSurname = '';
  t.ok(/2 CHAPTERS/.test(detail) && /1 CHAPTER/.test(detail),
    'counts chapters, singular and plural');

  // Two lines of known-for, ellipsed rather than overflowing the card.
  const knownLines = (detail.match(/font-size="12.5" fill="#3b332a">[^<]*</g) || []);
  t.ok(knownLines.length > 0, 'known-for is drawn as text lines');
  t.ok(/…/.test(detail), 'and long text is ellipsed to fit two rows');

  t.ok(/font-size="20"/.test(detail), 'names are set larger than the plain export');
  t.ok(/r="38"/.test(detail), 'portraits are larger too');
  t.ok(/dominant-baseline="central"/.test(detail), 'initials are centred in their circle');

  const plainW = Number(/width="(\d+)"/.exec(svg)[1]);
  const detailW = Number(/width="(\d+)"/.exec(detail)[1]);
  t.ok(detailW > plainW, 'the chart is scaled up to fit the bigger cards (' +
    plainW + ' → ' + detailW + ')');

  // The layout must survive the scale-up without cards colliding.
  const boxes = FT.peopleList().map((p) => ({ x: p.x * 1.85, y: p.y * 1.85 }));
  let clashes = 0;
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++)
      if (Math.abs(boxes[i].x - boxes[j].x) < 340 && Math.abs(boxes[i].y - boxes[j].y) < 244) clashes++;
  t.ok(clashes === 0, 'no two detailed cards overlap');

  t.ok(FT.edgeGeometry({ people: {}, cardW: 340, cardH: 244 }).length === 0,
    'edge geometry accepts a supplied layout');

  t.section('a sparse person gets a sparse card');
  const bare = FT.normalize({
    title: 'x', people: { b1: { name: 'Unknown Ancestor' } }, unions: {},
  });
  const savedState = FT.state;
  FT.state = bare;
  const bareSvg = FT.buildDetailedSvg();
  FT.state = savedState;
  t.ok(!/BORN/.test(bareSvg), 'no Born row when there is no birth date');
  t.ok(!/KNOWN FOR/.test(bareSvg), 'no known-for section when nothing is written');
  t.ok(!/CHAPTER/.test(bareSvg), 'no chapter count when the book is empty');
  t.ok(/Unknown Ancestor/.test(bareSvg), 'but the person is still drawn');

  t.section('detailed SVG escaping');
  FT.state.people[josip].birthplace = 'Cedar Falls <script>alert(1)</script>';
  const hostileDetail = FT.buildDetailedSvg();
  t.ok(hostileDetail.indexOf('<script>') < 0, 'markup in a field cannot break out');
  t.ok(!new w.DOMParser().parseFromString(hostileDetail, 'image/svg+xml')
    .querySelector('parsererror'), 'and the file stays well-formed');
  FT.state.people[josip].birthplace = 'Cedar Falls, Iowa';

  t.section("one life's chapters");
  const writer = Object.keys(FT.state.people).find(
    (i) => FT.state.people[i].entries.length >= 2);
  const md = FT.chaptersMarkdown(writer);
  const who = FT.state.people[writer];
  t.ok(md.startsWith('# ' + who.name), 'the markdown opens with the person');
  t.ok((md.match(/^## /gm) || []).length === who.entries.length,
    'one heading per chapter (' + who.entries.length + ')');
  who.entries.forEach((e) => {
    if (e.body.trim()) {
      t.ok(md.indexOf(e.body.trim().split('\n')[0]) > 0, 'chapter text is carried over');
    }
  });
  t.ok(/\*\*\d+ \w+ \d{4}\*\*/.test(md), 'dates are written out in full');
  t.ok(md.indexOf(FT.state.title) > 0, 'and the tree it came from is credited');

  // It is one person's book, not the whole family's.
  const others = FT.peopleList().filter((p) => p.id !== writer && p.entries.length);
  others.forEach((p) => {
    p.entries.forEach((e) => {
      if (e.title) t.ok(md.indexOf(e.title) < 0, "another person's chapters are left out");
    });
  });

  const printed = FT.chaptersPrintHtml(writer);
  const pdoc = new w.DOMParser().parseFromString('<div>' + printed + '</div>', 'text/html');
  t.ok(pdoc.querySelectorAll('.pr-chapter').length === who.entries.length,
    'the print view has the same chapters');
  t.ok(pdoc.querySelectorAll('.pr-body p').length >= who.entries.length,
    'with paragraphs, not one run-on block');
  t.ok(!/<\/p><p>[^<]*<\/div>/.test(printed) && printed.indexOf('<p></p>') < 0,
    'and no stray empty paragraphs');

  // Hostile text must not escape into the document.
  who.entries[0].title = '<script>window.__pwn=1</script>';
  t.ok(FT.chaptersPrintHtml(writer).indexOf('<script>') < 0, 'markup in a title is escaped');
  who.entries[0].title = 'The shop reopens';

  const noChapters = FT.peopleList().find((p) => !p.entries.length);
  t.ok(FT.exportChaptersMarkdown(noChapters.id) === false,
    'a person with no chapters exports nothing');
  t.ok(FT.printChapters(noChapters.id) === false, 'and prints nothing');
  t.ok(/no chapters/.test(d.getElementById('hintText').textContent), 'saying so');

  t.section('an empty tree exports nothing');
  const empty = await h.loadPage();
  empty.window.FT.exportSvg();
  await h.wait(100);
  t.ok(
    /Nothing to export/.test(empty.window.document.getElementById('hintText').textContent),
    'it says so rather than writing an empty file'
  );
  t.ok(empty.window.FT.exportDetailedSvg() === false, 'and the detailed export refuses too');

  t.section('import is JSON only, into its own tree');
  const before = FT.listDocs().length;
  const doc = FT.demoTree();
  doc.title = 'Imported line';
  const file = new w.File([JSON.stringify(doc)], 'tree.json', { type: 'application/json' });
  await new Promise(function (resolve) {
    FT.importFile(file, function (trees) {
      t.ok(Array.isArray(trees) && trees.length === 1, 'a single export yields one tree');
      t.ok(trees[0].title === 'Imported line', 'read back by name');
      t.ok(Object.keys(trees[0].people).length === 9, 'with everyone in it');
      resolve();
    });
  });

  t.section('backing up every tree at once');
  const archive = {
    kind: 'heirloom-archive',
    version: 1,
    trees: [FT.demoTree(), Object.assign(FT.demoTree(), { title: 'Second line' })],
  };
  const many = FT.readTrees(JSON.stringify(archive));
  t.ok(many.length === 2, 'an archive restores every tree in it');
  t.ok(many[1].title === 'Second line', 'each keeping its own name');
  t.ok(FT.readTrees(JSON.stringify(FT.demoTree())).length === 1, 'and a plain export still works');
  t.ok(FT.readTrees(JSON.stringify({ kind: 'heirloom-archive', version: 1, trees: [] })).length === 0,
    'an empty archive yields nothing rather than a blank tree');

  await new Promise(function (resolve) {
    FT.importFile(new w.File(['not json at all'], 'x.json', { type: 'application/json' }), function () {
      t.ok(false, 'garbage should not import');
      resolve();
    });
    setTimeout(function () {
      t.ok(
        /could not be read/.test(d.getElementById('hintText').textContent),
        'garbage is refused with a clear message'
      );
      resolve();
    }, 200);
  });
  t.ok(FT.listDocs().length === before, 'a failed import leaves the shelf alone');
};
