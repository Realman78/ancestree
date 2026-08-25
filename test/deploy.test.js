/* The deployment config. None of this runs in the app, but a mistake here
   publishes a broken site — or publishes something that should not be public —
   and neither shows up in any other suite. */
const fs = require('fs');
const path = require('path');

module.exports = function (t, h) {
  const read = (f) => fs.readFileSync(path.join(h.ROOT, f), 'utf8');

  t.section('wrangler config');
  const raw = read('wrangler.jsonc');
  let cfg;
  try {
    // jsonc: strip whole-line comments. Nothing here contains a string with //.
    cfg = JSON.parse(raw.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n'));
  } catch (e) {
    cfg = null;
  }
  t.ok(!!cfg, 'parses');
  t.ok(cfg && cfg.name === 'ancestree', 'names the worker (' + (cfg && cfg.name) + ')');
  t.ok(cfg && !('main' in cfg), 'has no entrypoint, so no code runs on a request');
  t.ok(cfg && cfg.assets && cfg.assets.directory === '.', 'serves the repository root');
  t.ok(cfg && /^\d{4}-\d{2}-\d{2}$/.test(cfg.compatibility_date || ''), 'pins a compatibility date');

  t.section('what gets published');
  const ignore = read('.assetsignore')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  const ignored = (name) =>
    ignore.some((p) => p === name || (p.startsWith('*.') && name.endsWith(p.slice(1))));

  // Anything the app loads must survive the ignore list, or the site 404s.
  const html = read('index.html');
  const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((u) => !/^https?:|^data:|^#/.test(u));
  assets.forEach((a) => {
    t.ok(!ignored(a.split('/')[0]), a + ' is published');
    t.ok(fs.existsSync(path.join(h.ROOT, a)), a + ' exists on disk');
  });

  // The worker precaches by path; a missing one breaks offline silently.
  const shell = [...read('sw.js').matchAll(/'\.\/([^']+)'/g)].map((m) => m[1]);
  shell.forEach((f) => {
    t.ok(!ignored(f.split('/')[0]), 'precached ' + f + ' is published');
  });

  t.ok(!ignored('_headers'), '_headers reaches Cloudflare rather than being ignored');
  t.ok(ignored('test'), 'the test suite is not published');
  t.ok(ignored('node_modules'), 'nor node_modules');
  t.ok(ignored('server.js'), 'nor the dev server');

  t.section('no family data can reach a public site');
  // The one category of file that must never be deployed by accident.
  t.ok(ignored('temp'), 'the scratch export is excluded');
  t.ok(ignored('anything.tree.json'), 'and every *.tree.json');
  const gitignore = read('.gitignore');
  t.ok(/\*\.tree\.json/.test(gitignore) && /(^|\n)temp/.test(gitignore),
    'and git ignores them too, so they cannot be committed either');

  t.section('cache headers');
  const headers = read('_headers');
  t.ok(/must-revalidate/.test(headers),
    'assets revalidate, so a new page is never paired with an old stylesheet');
  t.ok(/\/sw\.js/.test(headers) && /no-cache/.test(headers),
    'and the worker itself is never cached, so an update can always land');
};
