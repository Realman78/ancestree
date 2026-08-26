/* A real phone-sized Chromium with touch input.

   The bug that motivated this suite: the toolbar sat on one line beside the
   tree name, ran off the right edge, and a page wider than the screen makes
   the browser shrink the whole layout to fit — which pushed the life book off
   screen as well. Nothing in a desktop-width suite can see that, because at
   1400px the toolbar fits. */
module.exports = async function (t, h) {
  const { chromium, devices } = require('playwright');
  const browser = await chromium.launch();

  try {
    for (const name of ['Pixel 7', 'iPhone 13', 'iPhone SE']) {
      const ctx = await browser.newContext(Object.assign({}, devices[name]));
      const page = await ctx.newPage();
      const errs = [];
      page.on('pageerror', (e) => errs.push(e.message));

      await page.goto(h.BASE, { waitUntil: 'networkidle' });
      // A service worker from an earlier suite would serve its own copy of the
      // stylesheet, and this suite is entirely about the stylesheet.
      await page.evaluate(async () => {
        localStorage.clear();
        if (navigator.serviceWorker)
          for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
        if (window.caches) for (const k of await caches.keys()) await caches.delete(k);
      });
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForTimeout(400);
      // The sample's people all start at 0,0 — the demo action lays them out
      // before adopting. Skipping that would test nine cards in a stack.
      await page.evaluate(() => {
        FT.silently(() => { FT.state = FT.demoTree(); });
        FT.autoArrange();
        FT.adoptDocument(FT.state);
      });
      await page.waitForTimeout(500);

      t.section(name + ' — the app fits the screen');
      const fit = await page.evaluate(() => {
        const de = document.documentElement;
        const out = { scrollW: de.scrollWidth, clientW: de.clientWidth, offscreen: [], small: [] };
        document.querySelectorAll('.topbar button').forEach((el) => {
          const r = el.getBoundingClientRect();
          if (!r.width) return; // inside a closed menu
          if (r.right > de.clientWidth + 0.5 || r.left < -0.5)
            out.offscreen.push((el.textContent || el.id).trim().slice(0, 14));
          if (r.height < 36) out.small.push((el.textContent || el.id).trim().slice(0, 14) + ' ' + Math.round(r.height) + 'px');
        });
        out.topbarH = Math.round(document.querySelector('.topbar').getBoundingClientRect().height);
        out.stageH = Math.round(document.getElementById('stage').getBoundingClientRect().height);
        return out;
      });
      t.ok(fit.scrollW <= fit.clientW,
        'the page is no wider than the screen (' + fit.scrollW + ' ≤ ' + fit.clientW + ')');
      t.ok(fit.offscreen.length === 0,
        'every toolbar control is on screen' + (fit.offscreen.length ? ' — missing ' + fit.offscreen.join(', ') : ''));
      t.ok(fit.small.length === 0,
        'and big enough to hit with a finger' + (fit.small.length ? ' — ' + fit.small.join(', ') : ''));
      t.ok(fit.stageH > fit.topbarH,
        'the canvas still gets more room than the toolbar (' + fit.stageH + ' vs ' + fit.topbarH + ')');

      t.section(name + ' — the life book fits too');
      await page.evaluate(() => FT.openBook(Object.keys(FT.state.people)[0]));
      await page.waitForTimeout(700);
      const book = await page.evaluate(() => {
        const de = document.documentElement;
        const bk = document.querySelector('.book');
        const r = bk.getBoundingClientRect();
        const spilling = [];
        bk.querySelectorAll('*').forEach((el) => {
          const rr = el.getBoundingClientRect();
          if (rr.width && (rr.right > de.clientWidth + 0.5 || rr.left < -0.5))
            spilling.push(((el.className || el.tagName) + '').slice(0, 22));
        });
        return {
          w: Math.round(r.width), left: Math.round(r.left), right: Math.round(r.right),
          screenW: de.clientWidth, spilling: Array.from(new Set(spilling)),
          stacked: getComputedStyle(bk).flexDirection === 'column',
        };
      });
      t.ok(book.left >= -0.5 && book.right <= book.screenW + 0.5,
        'the book sits inside the screen (' + book.left + '..' + book.right + ' of ' + book.screenW + ')');
      t.ok(book.spilling.length === 0,
        'and nothing inside it spills out' + (book.spilling.length ? ' — ' + book.spilling.join(', ') : ''));
      t.ok(book.stacked, 'its two pages stack rather than sitting side by side');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      t.section(name + ' — the menus stay on screen');
      // Each menu hangs off its own button. On a phone that put the tree menu
      // half off the right edge and the zoom menu off the left — and the zoom
      // menu covered the Export button, so Export could not be opened at all.
      for (const [label, btn, menu] of [
        ['the tree menu', '#treeMenuBtn', '#treeMenu'],
        ['the zoom menu', '#zoomLevel', '#zoomMenu'],
        ['the export menu', '#exportBtn', '#exportMenu'],
      ]) {
        await page.click(btn);
        await page.waitForTimeout(250);
        const m = await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (!el || el.hidden) return null;
          const r = el.getBoundingClientRect();
          const de = document.documentElement;
          return {
            box: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)],
            fits: r.left >= -0.5 && r.right <= de.clientWidth + 0.5 && r.bottom <= de.clientHeight + 0.5,
          };
        }, menu);
        if (t.ok(!!m, label + ' opens')) {
          t.ok(m.fits, label + ' fits the screen (' + m.box.join(',') + ')');
        }
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
      }

      t.ok(errs.length === 0, 'no console errors' + (errs.length ? ': ' + errs[0] : ''));
      await ctx.close();
    }

    /* ---------------------------------------------------------- touch input */
    const ctx = await browser.newContext(Object.assign({}, devices['Pixel 7']));
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(h.BASE, { waitUntil: 'networkidle' });
    await page.evaluate(async () => {
      localStorage.clear();
      if (navigator.serviceWorker)
        for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
      if (window.caches) for (const k of await caches.keys()) await caches.delete(k);
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      FT.silently(() => { FT.state = FT.demoTree(); });
      FT.autoArrange();
      FT.adoptDocument(FT.state);
    });
    await page.waitForTimeout(500);

    // Playwright's mouse cannot express two fingers, so drive raw touch points.
    const cdp = await ctx.newCDPSession(page);
    const touch = async (type, pts) => {
      await cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: pts.map(([x, y], i) => ({ x, y, id: i })),
      });
      await page.waitForTimeout(45);
    };
    const zoom = () => page.evaluate(() => FT.zoomLevel());

    t.section('two fingers zoom the canvas');
    // A phone has no wheel, so this is the only way to zoom without the toolbar.
    const z0 = await zoom();
    await touch('touchStart', [[160, 430], [260, 430]]);
    for (let i = 1; i <= 6; i++) await touch('touchMove', [[160 - i * 12, 430], [260 + i * 12, 430]]);
    await touch('touchEnd', []);
    const z1 = await zoom();
    t.ok(z1 > z0, 'pinching out zooms in (' + Math.round(z0 * 100) + '% → ' + Math.round(z1 * 100) + '%)');

    await touch('touchStart', [[80, 430], [340, 430]]);
    for (let i = 1; i <= 6; i++) await touch('touchMove', [[80 + i * 18, 430], [340 - i * 18, 430]]);
    await touch('touchEnd', []);
    const z2 = await zoom();
    t.ok(z2 < z1, 'and pinching in zooms out (' + Math.round(z1 * 100) + '% → ' + Math.round(z2 * 100) + '%)');

    t.section('one finger still does what it did');
    const viewOf = () => page.evaluate(() => document.getElementById('viewport').style.transform);

    // Bare board, not a card — on a laid-out tree a fixed point may well have
    // somebody sitting on it, and that is a drag, not a pan.
    const bareBoard = () =>
      page.evaluate(() => {
        const stage = document.getElementById('stage');
        const de = document.documentElement;
        for (let y = 220; y < de.clientHeight - 70; y += 20)
          for (let x = 15; x < de.clientWidth - 15; x += 20) {
            const hit = document.elementFromPoint(x, y);
            if (!hit || !stage.contains(hit)) continue;
            if (hit.closest('.card') || hit.closest('[data-kind]')) continue;
            return [x, y];
          }
        return null;
      });

    const bare = await bareBoard();
    if (!t.ok(!!bare, 'there is bare board to pan from')) return;

    const beforePan = await viewOf();
    const zBefore = await zoom();
    await touch('touchStart', [bare]);
    for (let i = 1; i <= 5; i++) await touch('touchMove', [[bare[0] + i * 12, bare[1] + i * 6]]);
    await touch('touchEnd', []);
    t.ok((await viewOf()) !== beforePan, 'a finger on the board pans it');
    t.ok((await zoom()) === zBefore, 'and does not zoom it');

    // The pinch left the view wherever it left it; put the tree back on screen
    // and take the point from a card rather than guessing coordinates.
    // Fit, then back to 1:1 — at a whole-tree zoom on a phone the cards are a
    // few dozen pixels wide and nobody is tapping anything precisely.
    await page.evaluate(() => { FT.fitToScreen(); FT.zoomTo(1); });
    await page.waitForTimeout(300);
    // Take the point from a card that is actually the topmost thing there.
    const spot = await page.evaluate(() => {
      const de = document.documentElement;
      for (const el of document.querySelectorAll('.card')) {
        const r = el.getBoundingClientRect();
        const x = Math.round(r.left + 24);
        const y = Math.round(r.top + r.height / 2);
        if (x < 10 || y < 170 || x > de.clientWidth - 10 || y > de.clientHeight - 60) continue;
        const hit = document.elementFromPoint(x, y);
        if (hit && hit.closest && hit.closest('.card') === el) return [x, y];
      }
      return null;
    });
    if (!t.ok(!!spot, 'a card is on screen to try')) return;

    // Cards overlap, so ask the page which one is really under that point.
    const card = await page.evaluate(([x, y]) => {
      const hit = document.elementFromPoint(x, y);
      const el = hit && hit.closest ? hit.closest('.card') : null;
      if (!el) return null;
      const id = el.dataset.id;
      return { id, x: FT.state.people[id].x, y: FT.state.people[id].y };
    }, spot);
    if (!t.ok(!!card, 'and it is what the finger lands on')) return;

    await touch('touchStart', [spot]);
    for (let i = 1; i <= 6; i++) await touch('touchMove', [[spot[0] + i * 9, spot[1] + i * 9]]);
    await touch('touchEnd', []);
    const moved = await page.evaluate(
      (id) => ({ x: FT.state.people[id].x, y: FT.state.people[id].y }),
      card.id
    );
    t.ok(moved.x !== card.x || moved.y !== card.y,
      'a card can be dragged with one finger (' + card.x + ',' + card.y + ' → ' + moved.x + ',' + moved.y + ')');
    t.ok(await page.evaluate((id) => FT.selected === id, card.id), 'and touching it selects that person');

    t.section('the book opens from a card by touch');
    const bookBtn = await page.evaluate((id) => {
      const el = document.querySelector('.card[data-id="' + id + '"] .book-btn');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)];
    }, card.id);
    if (t.ok(!!bookBtn, 'the card carries its book button')) {
      await touch('touchStart', [bookBtn]);
      await touch('touchEnd', []);
      await page.waitForTimeout(700);
      t.ok(await page.evaluate(() => !document.getElementById('bookOverlay').hidden),
        'tapping it opens that life book');
    }

    t.ok(errs.length === 0, 'no console errors' + (errs.length ? ': ' + errs[0] : ''));
    await ctx.close();
  } finally {
    await browser.close();
  }
};
