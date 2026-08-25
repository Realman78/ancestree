/* Installability and offline support.

   Needs a real browser: jsdom has no service worker, and the point of the
   feature is what happens when the network is taken away. */
module.exports = async function (t, h) {
  const { chromium } = require('playwright');
  const browser = await chromium.launch();

  try {
    t.section('the manifest');
    const ctx0 = await browser.newContext();
    const probe = await ctx0.newPage();
    const res = await probe.request.get(h.BASE + 'manifest.webmanifest');
    t.ok(res.status() === 200, 'is served (' + res.status() + ')');
    t.ok(
      /manifest\+json|application\/json/.test(res.headers()['content-type'] || ''),
      'with a manifest content type (' + res.headers()['content-type'] + ')'
    );
    const manifest = JSON.parse(await res.text());
    t.ok(manifest.name === 'Ancestree', 'names the app');
    t.ok(manifest.display === 'standalone', 'asks to open as its own window');
    t.ok(manifest.start_url === '.', 'starts relative, so any subpath works');
    t.ok(manifest.icons.length >= 2, 'ships more than one icon size');
    t.ok(
      manifest.icons.some((i) => i.purpose === 'maskable'),
      'including a maskable one, so launchers do not crop the mark'
    );
    // Every icon must actually be there — a 404 here is invisible until install.
    for (const icon of manifest.icons) {
      const r = await probe.request.get(h.BASE + icon.src);
      t.ok(r.status() === 200, icon.src + ' is served (' + r.status() + ')');
    }
    const page0 = await ctx0.newPage();
    await page0.goto(h.BASE, { waitUntil: 'networkidle' });
    t.ok(
      (await page0.getAttribute('link[rel="manifest"]', 'href')) === 'manifest.webmanifest',
      'and the page links to it'
    );
    await ctx0.close();

    t.section('working with the network off');
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(h.BASE, { waitUntil: 'networkidle' });
    await page
      .waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 })
      .catch(() => {});
    t.ok(
      await page.evaluate(() => navigator.serviceWorker.controller !== null),
      'a service worker takes control'
    );

    await page.click('[data-action="demo"]');
    await page.waitForTimeout(600);
    const before = await page.evaluate(() => FT.peopleList().length);

    await ctx.setOffline(true);
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(1200);
    t.ok(await page.evaluate(() => !!document.getElementById('stage')), 'the page still loads');
    t.ok(
      await page.evaluate(() => getComputedStyle(document.body).backgroundColor === 'rgb(246, 241, 231)'),
      'with its stylesheet'
    );
    t.ok(await page.evaluate(() => typeof FT === 'object'), 'and its scripts');
    t.ok(
      (await page.evaluate(() => FT.peopleList().length)) === before,
      'and the tree is still there (' + before + ' people)'
    );
    t.ok(errs.length === 0, 'no errors offline' + (errs.length ? ': ' + errs[0] : ''));
    await ctx.setOffline(false);
    await ctx.close();

    t.section('an update is never pinned behind the cache');
    // Cache-first workers are how sites end up serving a months-old build with
    // no way out. This one goes to the network whenever there is one.
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await page2.goto(h.BASE, { waitUntil: 'networkidle' });
    await page2
      .waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 })
      .catch(() => {});

    const fs = require('fs');
    const path = require('path');
    const file = path.join(h.ROOT, 'styles.css');
    const original = fs.readFileSync(file, 'utf8');
    try {
      fs.writeFileSync(file, original.replace('--paper:      #f6f1e7;', '--paper:      #0b3d2e;'));
      await page2.reload({ waitUntil: 'networkidle' });
      await page2.waitForTimeout(500);
      t.ok(
        await page2.evaluate(() => getComputedStyle(document.body).backgroundColor === 'rgb(11, 61, 46)'),
        'a changed file is served fresh, not from the cache'
      );
      // …and that newer copy is what you get offline afterwards.
      await ctx2.setOffline(true);
      await page2.reload({ waitUntil: 'load' });
      await page2.waitForTimeout(800);
      t.ok(
        await page2.evaluate(() => getComputedStyle(document.body).backgroundColor === 'rgb(11, 61, 46)'),
        'and offline then serves that newer copy'
      );
      await ctx2.setOffline(false);
    } finally {
      fs.writeFileSync(file, original);
    }
    await ctx2.close();
  } finally {
    await browser.close();
  }
};
