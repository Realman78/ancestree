/* Real Chromium. This is the only suite that does layout and hit-testing, so it
   is the only one that can catch "the page renders but nothing is clickable". */
module.exports = async function (t, h) {
  const { chromium } = require('playwright');

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errs.push(m.text());
  });

  try {
    await page.goto(h.BASE, { waitUntil: 'networkidle' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(400);

    /* What is actually under the cursor at this element's centre? */
    const topOf = (sel) =>
      page.evaluate((s) => {
        const r = document.querySelector(s).getBoundingClientRect();
        const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return el ? (el.id ? '#' + el.id : el.className || el.tagName) : 'nothing';
      }, sel);

    t.section('regression: hidden overlays must not cover the page');
    // `[hidden]` is a UA-stylesheet rule and ANY author `display` beats it. The
    // overlays are fixed + inset:0 and still hit-test at opacity 0, so without
    // the global `[hidden] { display: none !important }` they swallow every click.
    await page.addStyleTag({
      content: '.book-overlay[hidden]{display:grid!important}.dialog-overlay[hidden]{display:grid!important}',
    });
    const blocker = await topOf('[data-action="share"]');
    t.ok(['#bookOverlay', '#shareDialog'].includes(blocker), 'without the fix, an invisible overlay (' + blocker + ') covers Share');
    const wasOpen = await page.evaluate(() => !document.getElementById('shareDialog').hidden);
    await page.click('[data-action="share"]', { timeout: 2000 }).catch(() => {});
    t.ok(
      (await page.evaluate(() => !document.getElementById('shareDialog').hidden)) === wasOpen,
      'and the click does nothing — the reported freeze'
    );

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    t.ok((await topOf('[data-action="share"]')) !== '#bookOverlay', 'with the fix, nothing covers the toolbar');
    for (const sel of ['#bookOverlay', '#shareDialog', '#pill', '#roBanner']) {
      t.ok((await page.locator(sel).boundingBox()) === null, sel + ' occupies no space while hidden');
    }

    t.section('toolbar');
    await page.click('[data-action="share"]');
    await page.waitForTimeout(500);
    t.ok(await page.locator('#shareDialog').isVisible(), 'Share opens the dialog');
    t.ok((await page.inputValue('#shareLink')).startsWith('http'), 'and generates a link');
    await page.click('#closeShare');
    await page.waitForTimeout(300);
    t.ok(!(await page.locator('#shareDialog').isVisible()), 'Done closes it');
    t.ok((await topOf('[data-action="share"]')) !== '#shareDialog', 'and it stops blocking the page');

    const n0 = await page.locator('.card').count();
    await page.click('[data-action="add"]');
    await page.waitForTimeout(400);
    t.ok((await page.locator('.card').count()) === n0 + 1, '"+ Person" adds a card');
    t.ok(await page.locator('#bookOverlay').isVisible(), 'and opens their book');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    t.ok(!(await page.locator('#bookOverlay').isVisible()), 'Escape closes the book');

    t.section('canvas');
    const card = page.locator('.card').first();
    await card.click();
    await page.waitForTimeout(250);
    t.ok(await page.locator('#pill').isVisible(), 'clicking a card shows the action pill');

    const box = await card.boundingBox();
    const posBefore = await card.evaluate((el) => el.style.transform);
    await page.mouse.move(box.x + 60, box.y + 40);
    await page.mouse.down();
    await page.mouse.move(box.x + 260, box.y + 190, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(250);
    t.ok((await card.evaluate((el) => el.style.transform)) !== posBefore, 'a card can be dragged');
    t.ok(
      await page.evaluate(() => {
        const p = FT.state.people[FT.selected];
        return p.x % 20 === 0 && p.y % 20 === 0;
      }),
      'and lands snapped to the grid'
    );
    await page.click('[data-action="arrange"]');
    await page.waitForTimeout(700);
    t.ok(await page.evaluate(() => FT.peopleList().every((p) => p.x % 20 === 0 && p.y % 20 === 0)), '"Tidy up" re-lays the tree');

    t.section('born / died date pickers');
    const josip = await page.evaluate(() =>
      Object.keys(FT.state.people).find((id) => FT.state.people[id].name === 'Josip Kovač')
    );
    await page.evaluate((id) => FT.openBook(id), josip);
    await page.waitForTimeout(500);
    t.ok((await page.getAttribute('[data-field="birth"]', 'type')) === 'date', 'Born is a real date picker');
    t.ok((await page.getAttribute('[data-field="death"]', 'type')) === 'date', 'Died is a real date picker');
    t.ok((await page.inputValue('[data-field="birth"]')) === '1921-03-14', 'and is populated from the document');
    await page.fill('[data-field="birth"]', '1922-04-01');
    await page.waitForTimeout(500);
    t.ok((await page.evaluate((id) => FT.state.people[id].birth, josip)) === '1922-04-01', 'picking a date saves it');
    await page.click('#closeBook');
    await page.waitForTimeout(400);
    const dates = await page.locator('.card').filter({ hasText: 'Josip' }).locator('.dates').textContent();
    t.ok(dates.trim() === '1922 – 1998', 'the card still shows years only (' + dates.trim() + ')');

    t.section('legacy free-text dates are not lost');
    await page.evaluate((id) => {
      FT.state.people[id].birth = 'c. 1880';
      FT.openBook(id);
    }, josip);
    await page.waitForTimeout(400);
    t.ok((await page.inputValue('[data-field="birth"]')) === '', 'the picker cannot show it, so it sits empty');
    t.ok(await page.locator('.pf-legacy').isVisible(), 'and the original text is shown beside it rather than dropped');
    t.ok((await page.locator('.pf-legacy').textContent()).includes('c. 1880'), 'showing the value verbatim');
    await page.fill('[data-field="birth"]', '1880-01-01');
    await page.waitForTimeout(400);
    t.ok(!(await page.locator('.pf-legacy').isVisible()), 'picking a date replaces it');

    t.section('"Known for": two lines, ellipsis, tooltip');
    const short = 'Village blacksmith';
    const long =
      'Village blacksmith for forty years, who reopened the forge after the war and made the ' +
      'iron gate that still stands in the square at Sinj, with plane leaves along the top rail.';
    await page.evaluate((v) => { FT.state.people[FT.selected || Object.keys(FT.state.people)[0]].knownFor = v; }, short);
    await page.evaluate((args) => { FT.state.people[args.id].knownFor = args.v; FT.openBook(args.id); }, { id: josip, v: short });
    await page.waitForTimeout(400);
    const wrap = page.locator('.pf-clampwrap');
    const inner = page.locator('.pf-clamp');
    t.ok(await wrap.isVisible(), 'the field renders');
    t.ok((await wrap.getAttribute('title')) === null, 'short text gets no tooltip');
    const oneOrTwo = await wrap.evaluate((el) => el.offsetHeight);

    await page.evaluate((args) => { FT.state.people[args.id].knownFor = args.v; FT.openBook(args.id); }, { id: josip, v: long });
    await page.waitForTimeout(400);
    t.ok((await wrap.evaluate((el) => el.offsetHeight)) === oneOrTwo, 'long text stays exactly two lines tall');
    const metrics = await inner.evaluate((el) => ({
      client: el.clientHeight,
      scroll: el.scrollHeight,
      line: parseFloat(getComputedStyle(el).lineHeight),
    }));
    t.ok(Math.abs(metrics.client - metrics.line * 2) < 2, 'the visible area is exactly two line-heights');
    t.ok(metrics.scroll > metrics.client + 1, 'the rest is clipped — that is what draws the ellipsis');
    t.ok((await wrap.getAttribute('title')) === long, 'and the full text is the hover tooltip');

    // The old bug: a clamp that is a grid item gets blockified, so the clip
    // happened at the padding box and a sliver of line three showed through.
    const bleed = await page.evaluate(() => {
      const w = document.querySelector('.pf-clampwrap');
      const i = w.querySelector('.pf-clamp');
      return i.getBoundingClientRect().bottom <= w.getBoundingClientRect().bottom + 0.5;
    });
    t.ok(bleed, 'no third line bleeds below the clamp');

    await wrap.click();
    await page.waitForTimeout(300);
    t.ok(await page.locator('textarea.pf-multiline').isVisible(), 'clicking it opens a textarea to edit');
    await page.fill('textarea.pf-multiline', 'Blacksmith, and a stubborn one.');
    await page.waitForTimeout(400);
    t.ok(
      (await page.evaluate((id) => FT.state.people[id].knownFor, josip)) === 'Blacksmith, and a stubborn one.',
      'typing saves through'
    );
    await page.locator('.person-name').click();
    await page.waitForTimeout(400);
    t.ok(await page.locator('.pf-clampwrap').isVisible(), 'blurring returns to the clamped view');

    t.section('optional chapter end date');
    t.ok(await page.locator('#addEnd').isVisible(), 'a chapter offers to add an end date');
    t.ok((await page.locator('.entry-end').count()) === 0, 'and has none by default');
    await page.click('#addEnd');
    await page.waitForTimeout(400);
    t.ok(await page.locator('.entry-end').isVisible(), 'clicking it reveals a second date picker');
    const start = await page.inputValue('.entry-date');
    t.ok((await page.inputValue('.entry-end')) === start, 'seeded to the start date');
    t.ok((await page.getAttribute('.entry-end', 'min')) === start, 'and cannot be set before the start');

    await page.fill('.entry-end', '1949-12-31');
    await page.waitForTimeout(500);
    const stored = await page.evaluate((id) => {
      const e = FT.state.people[id].entries.find((x) => x.end);
      return e ? { date: e.date, end: e.end } : null;
    }, josip);
    t.ok(stored && stored.end === '1949-12-31', 'the end date is stored on the chapter');
    t.ok(await page.locator('.toc-span').first().isVisible(), 'the contents mark it as spanning');

    await page.fill('.entry-end', '1900-01-01');
    await page.waitForTimeout(500);
    t.ok(await page.locator('#entryWarn').isVisible(), 'an end before the start is called out');
    await page.fill('.entry-end', '1949-12-31');
    await page.waitForTimeout(400);
    t.ok(!(await page.locator('#entryWarn').isVisible()), 'and the warning clears when fixed');

    await page.click('#clearEnd');
    await page.waitForTimeout(400);
    t.ok((await page.locator('.entry-end').count()) === 0, 'the end date can be removed again');
    t.ok(
      await page.evaluate((id) => FT.state.people[id].entries.every((e) => !e.end), josip),
      'and is cleared from the document'
    );

    t.section('the diary still works');
    await page.click('#pageRight .entry-body');
    await page.type('#pageRight .entry-body', ' Typed in a real browser.');
    await page.waitForTimeout(500);
    t.ok(
      await page.evaluate(() => JSON.stringify(FT.state).includes('Typed in a real browser.')),
      'typing reaches the document'
    );
    await page.click('#closeBook');
    await page.waitForTimeout(400);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    t.ok(
      await page.evaluate(() => JSON.stringify(FT.state).includes('Typed in a real browser.')),
      'and survives a reload'
    );

    t.ok(errs.length === 0, 'no console errors' + (errs.length ? ': ' + errs[0] : ''));
  } finally {
    await browser.close();
  }
};
