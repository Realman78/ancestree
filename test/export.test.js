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
    if (p.name === 'Josip Kovač') {
      t.ok(svg.indexOf('Josip') >= 0, 'names are drawn as real text, not paths');
    }
  });

  const edges = FT.edgeGeometry().length;
  const paths = (svg.match(/<path d=/g) || []).length;
  t.ok(paths >= edges, 'every connector is drawn (' + paths + ' paths for ' + edges + ' links)');
  t.ok(/1921 – 1998/.test(svg), 'cards show the lifespan in years');

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

  t.section('an empty tree exports nothing');
  const empty = await h.loadPage();
  empty.window.FT.exportSvg();
  await h.wait(100);
  t.ok(
    /Nothing to export/.test(empty.window.document.getElementById('hintText').textContent),
    'it says so rather than writing an empty file'
  );

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
