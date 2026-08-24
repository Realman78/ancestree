#!/usr/bin/env node
/* Runs every suite against a real instance of the app.

   Usage:  npm test            all suites
           npm test model      only suites whose name matches
*/
const h = require('./helpers');

const SUITES = [
  { name: 'model', file: './model.test.js' },
  { name: 'library', file: './library.test.js' },
  { name: 'app', file: './app.test.js' },
  { name: 'export', file: './export.test.js' },
  { name: 'filelink', file: './filelink.test.js' },
  { name: 'photo', file: './photo.test.js' },
  { name: 'browser', file: './browser.test.js', needsBrowser: true },
];

/* The browser suite needs Chromium downloaded once. Report that clearly rather
   than pretending the suite passed. */
async function browserAvailable() {
  try {
    const { chromium } = require('playwright');
    const browser = await chromium.launch();
    await browser.close();
    return true;
  } catch (e) {
    return false;
  }
}

(async () => {
  const filter = process.argv[2];
  const chosen = filter ? SUITES.filter((s) => s.name.includes(filter)) : SUITES;
  if (!chosen.length) {
    console.error('No suite matches "' + filter + '". Known: ' + SUITES.map((s) => s.name).join(', '));
    process.exit(1);
  }

  const server = await h.startServer();
  const results = [];
  let skipped = 0;

  try {
    for (const suite of chosen) {
      if (suite.needsBrowser && !(await browserAvailable())) {
        console.log('\n\x1b[1m' + suite.name + '\x1b[0m  \x1b[33mSKIPPED\x1b[0m');
        console.log('  Chromium is not installed. Run:  npx playwright install chromium');
        console.log('  This is the only suite that does layout and hit-testing.');
        skipped++;
        continue;
      }
      console.log('\n\x1b[1m' + suite.name + '\x1b[0m');
      const t = h.reporter(suite.name);
      try {
        await require(suite.file)(t, h);
      } catch (e) {
        t.failures.push('suite threw: ' + (e && e.stack ? e.stack.split('\n')[0] : e));
        console.log('    \x1b[31m✗ suite threw: ' + (e && e.message) + '\x1b[0m');
        if (process.env.VERBOSE) console.error(e);
      }
      results.push(t);
    }
  } finally {
    await server.stop();
  }

  const passes = results.reduce((n, r) => n + r.passes, 0);
  const failures = results.reduce((a, r) => a.concat(r.failures.map((f) => r.suite + ': ' + f)), []);

  console.log('\n' + '─'.repeat(60));
  if (failures.length) {
    console.log('\x1b[31m' + failures.length + ' failing\x1b[0m, ' + passes + ' passing');
    failures.forEach((f) => console.log('  \x1b[31m✗\x1b[0m ' + f));
  } else {
    console.log('\x1b[32m' + passes + ' passing\x1b[0m');
  }
  if (skipped) console.log('\x1b[33m' + skipped + ' suite(s) skipped\x1b[0m');
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
