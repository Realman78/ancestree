/* Real Chromium. This is the only suite that does layout and hit-testing, so it
   is the only one that can catch "the page renders but nothing is clickable". */
module.exports = async function (t, h) {
  const { chromium } = require('playwright');

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
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
    const blocker = await topOf('#exportBtn');
    t.ok(['#bookOverlay', '#askDialog'].includes(blocker), 'without the fix, an invisible overlay (' + blocker + ') covers the toolbar');
    await page.click('#exportBtn', { timeout: 2000 }).catch(() => {});
    t.ok(
      !(await page.locator('#exportMenu').isVisible()),
      'and the click does nothing — the reported freeze'
    );

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    t.ok((await topOf('#exportBtn')) !== '#bookOverlay', 'with the fix, nothing covers the toolbar');
    for (const sel of ['#bookOverlay', '#askDialog', '#pill', '#treeMenu', '#exportMenu']) {
      t.ok((await page.locator(sel).boundingBox()) === null, sel + ' occupies no space while hidden');
    }

    t.section('first visit and the sample');
    t.ok((await page.locator('.card').count()) === 0, 'a first visit shows an empty board');
    await page.click('[data-action="demo"]');
    await page.waitForTimeout(500);
    t.ok((await page.locator('.card').count()) === 9, 'the sample loads on request');

    const n0 = await page.locator('.card').count();
    await page.click('[data-action="add"]');
    await page.waitForTimeout(400);
    t.ok((await page.locator('.card').count()) === n0 + 1, '"+ Person" adds a card');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await page.evaluate(() => {
      FT.openBook(Object.keys(FT.state.people)[0]);
    });
    await page.waitForTimeout(400);
    t.ok(await page.locator('#bookOverlay').isVisible(), 'a book can be opened');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    t.ok(!(await page.locator('#bookOverlay').isVisible()), 'Escape closes the book');

    t.section('a way to the source');
    // The README's claim that nothing leaves your browser is only worth making
    // if you can go and check it, so the route has to exist in the app.
    const src = await page.evaluate(() => {
      const a = document.querySelector('.source-link');
      if (!a) return null;
      const bar = document.querySelector('.statusbar').getBoundingClientRect();
      const box = a.getBoundingClientRect();
      return {
        href: a.href,
        target: a.target,
        rel: a.rel,
        label: a.getAttribute('aria-label') || '',
        inlineMark: !!a.querySelector('svg path'),
        remoteAsset: !!a.querySelector('img'),
        insideBar: box.right <= bar.right + 0.5 && box.left >= bar.left - 0.5,
      };
    });
    t.ok(!!src, 'the status bar carries a link to the source');
    t.ok(/^https:\/\/github\.com\/[\w-]+\/[\w-]+$/.test(src.href),
      'pointing at a GitHub repository (' + src.href + ')');
    t.ok(src.target === '_blank', 'opening in a new tab, so work in progress is not lost');
    t.ok(/noopener/.test(src.rel), 'with noopener');
    t.ok(src.label.length > 0, 'and an accessible name for the icon-only form');
    t.ok(src.inlineMark && !src.remoteAsset,
      'the mark is inline SVG — nothing is fetched from GitHub to draw it');
    t.ok(src.insideBar, 'and it sits inside the bar');

    // Narrow enough for a phone: the word goes, the mark and the name stay.
    await page.setViewportSize({ width: 400, height: 800 });
    await page.waitForTimeout(300);
    const narrow = await page.evaluate(() => {
      const a = document.querySelector('.source-link');
      const bar = document.querySelector('.statusbar').getBoundingClientRect();
      const overflow = [...document.querySelector('.statusbar').children]
        .filter((c) => getComputedStyle(c).display !== 'none')
        .some((c) => c.getBoundingClientRect().right > bar.right + 0.5);
      return {
        stillThere: a.getBoundingClientRect().width > 0,
        wordHidden: getComputedStyle(a.querySelector('span')).display === 'none',
        overflow,
      };
    });
    t.ok(narrow.stillThere, 'on a phone the link survives');
    t.ok(narrow.wordHidden, 'as the mark alone');
    t.ok(!narrow.overflow, 'and nothing in the bar overflows');
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.waitForTimeout(300);

    t.section('a new person is named in place');
    await page.evaluate(() => {
      localStorage.clear();
      location.reload();
    });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(600);

    await page.click('[data-action="add"]');
    await page.waitForTimeout(400);
    t.ok(!(await page.locator('#bookOverlay').isVisible()),
      'the book no longer opens over the canvas');
    const field = page.locator('.card .name-edit');
    t.ok(await field.isVisible(), 'the name becomes an input on the card');
    t.ok(
      await page.evaluate(() => document.activeElement.classList.contains('name-edit')),
      'already focused');
    t.ok(
      await page.evaluate(() => {
        const el = document.activeElement;
        return el.selectionStart === 0 && el.selectionEnd === el.value.length;
      }),
      'with the placeholder name selected, so typing replaces it');

    await page.keyboard.type('Ruth Miller');
    await page.waitForTimeout(400);
    t.ok(
      await page.evaluate(() => FT.peopleList().some((p) => p.name === 'Ruth Miller')),
      'typing renames the person as you go');
    t.ok(
      (await page.locator('.card .initials').first().textContent()) === 'RM',
      'and the initials follow along');

    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    t.ok((await page.locator('.card .name-edit').count()) === 0, 'Enter finishes the edit');
    t.ok((await page.locator('.card .name').first().textContent()) === 'Ruth Miller',
      'leaving the name in place');

    // Typing must not reach the canvas shortcuts.
    await page.click('.card');
    await page.waitForTimeout(200);
    const before = await page.evaluate(() => FT.peopleList().length);
    await page.click('#pill [data-action="child"]');
    await page.waitForTimeout(400);
    t.ok(await page.locator('.card .name-edit').isVisible(), '"+ Child" names the child in place too');
    await page.keyboard.type('nnn');
    await page.waitForTimeout(300);
    t.ok(
      await page.evaluate(() => FT.peopleList().length) === before + 1,
      'the "n" shortcut does not fire while typing a name'
    );
    t.ok(
      await page.evaluate(() => FT.peopleList().some((p) => p.name === 'nnn')),
      'the characters land in the field'
    );

    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    t.ok((await page.locator('.card .name-edit').count()) === 0, 'Escape leaves the field');
    t.ok(
      await page.evaluate(() => !FT.peopleList().some((p) => p.name === 'nnn')),
      'and puts the name back'
    );

    // Clicking away commits rather than losing the edit.
    await page.evaluate(() => {
      const id = Object.keys(FT.state.people)[0];
      FT.select(id);
      FT.beginRename(id);
    });
    await page.waitForTimeout(300);
    await page.fill('.card .name-edit', 'Committed By Blur');
    await page.click('#stage', { position: { x: 80, y: 420 } });
    await page.waitForTimeout(400);
    t.ok((await page.locator('.card .name-edit').count()) === 0, 'clicking away closes the field');
    t.ok(
      await page.evaluate(() => FT.peopleList().some((p) => p.name === 'Committed By Blur')),
      'keeping what was typed'
    );

    await page.evaluate(() => {
      localStorage.clear();
      location.reload();
    });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(600);
    await page.click('[data-action="demo"]');
    await page.waitForTimeout(600);

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

    t.section('clicking a relationship line');
    await page.evaluate(() => {
      localStorage.clear();
      location.reload();
    });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(600);
    await page.click('[data-action="demo"]');
    await page.waitForTimeout(500);
    await page.click('[data-action="arrange"]');
    await page.waitForTimeout(800);

    // Aim a real mouse click at a point actually ON the stroke, to prove the hit
    // target is reachable and not buried. (A bounding-box centre is no good: an
    // orthogonal path's box centre usually lies off the line entirely, and here
    // it lands on a child connector instead.)
    const target = await page.evaluate(() => {
      const p = document.querySelector('#edges path.edge-hit[data-kind="partner"]');
      const pt = p.getPointAtLength(p.getTotalLength() * 0.15);
      const m = p.getScreenCTM();
      return {
        x: m.a * pt.x + m.c * pt.y + m.e,
        y: m.b * pt.x + m.d * pt.y + m.f,
        union: p.dataset.union,
      };
    });
    await page.mouse.click(target.x, target.y);
    await page.waitForTimeout(350);
    t.ok(
      (await page.evaluate(() => (FT.selectedEdge || {}).kind)) === 'partner',
      'a partner line can be clicked and selected'
    );
    t.ok((await page.locator('#edges path.edge.selected').count()) === 1, 'and is highlighted');
    t.ok(await page.locator('#edgePill').isVisible(), 'a pill appears on the line');
    t.ok((await page.locator('#edgeLabel').textContent()).includes('&'), 'naming both partners');
    t.ok(!(await page.locator('#pill').isVisible()), 'the card pill is hidden');

    // Panning must not leave the pill behind.
    const pillBefore = await page.locator('#edgePill').boundingBox();
    await page.mouse.move(700, 700);
    await page.mouse.down();
    await page.mouse.move(760, 740, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const pillAfter = await page.locator('#edgePill').boundingBox();
    t.ok(
      pillAfter === null || Math.abs(pillAfter.x - pillBefore.x - 60) < 6,
      'the pill tracks the line when the canvas is panned'
    );

    t.section('deleting a line with the keyboard');
    await page.evaluate(() => {
      const u = FT.unionList().find((x) => x.partners.length === 2 && x.children.length);
      FT.selectEdge({ kind: 'partner', unionId: u.id, childId: null });
      window.__u = u.id;
      window.__kids = u.children.slice();
      // The keeper is the left-hand partner, matching what is drawn.
      window.__keeper = u.partners.slice()
        .sort(function (a, b) { return FT.state.people[a].x - FT.state.people[b].x; })[0];
    });
    await page.waitForTimeout(250);

    // No dialog handler is registered. Playwright auto-dismisses any dialog,
    // which is exactly the browser-blocks-dialogs case that broke this — so if
    // a confirm() ever comes back, these assertions fail.
    let dialogs = 0;
    page.on('dialog', (dlg) => {
      dialogs++;
      dlg.dismiss();
    });

    await page.keyboard.press('Delete');
    await page.waitForTimeout(400);
    t.ok(
      await page.evaluate(() => FT.state.unions[window.__u].partners.length === 1),
      'Delete removes the selected line with no dialog in the way'
    );
    t.ok(dialogs === 0, 'no dialog was shown');
    t.ok(
      await page.evaluate(() => window.__kids.every((k) => FT.parentsOf(k).includes(window.__keeper))),
      'and the children keep a parent'
    );
    t.ok((await page.locator('#edges path.edge.selected').count()) === 0, 'the highlight clears');
    t.ok(!(await page.locator('#edgePill').isVisible()), 'and so does the pill');

    t.section('undo is offered, not assumed');
    t.ok(await page.locator('#hintUndo').isVisible(), 'the toast carries an Undo button');
    t.ok((await page.locator('#hintText').textContent()).startsWith('Separated'), 'and says what happened');
    await page.click('#hintUndo');
    await page.waitForTimeout(400);
    t.ok(
      await page.evaluate(() => FT.state.unions[window.__u].partners.length === 2),
      'clicking it puts the couple back together'
    );

    t.ok(!(await page.locator('#undoBtn').isDisabled()), 'the toolbar Undo is enabled');
    t.ok(!(await page.locator('#redoBtn').isDisabled()), 'and Redo, having just undone something');
    await page.click('#redoBtn');
    await page.waitForTimeout(400);
    t.ok(
      await page.evaluate(() => FT.state.unions[window.__u].partners.length === 1),
      'Redo reapplies the removal'
    );
    await page.click('#undoBtn');
    await page.waitForTimeout(400);
    t.ok(
      await page.evaluate(() => FT.state.unions[window.__u].partners.length === 2),
      'and Undo takes it back again'
    );

    await page.evaluate(() => {
      const u = FT.unionList().find((x) => x.children.length);
      FT.selectEdge({ kind: 'child', unionId: u.id, childId: u.children[0] });
    });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    t.ok(await page.evaluate(() => FT.selectedEdge === null), 'Escape deselects a line');

    t.section('editing a relationship');
    await page.evaluate(() => {
      FT.adoptDocument(FT.newTree('Remarriage'));
      const id = {};
      ['Joseph', 'Ruth', 'Marta', 'Ivan', 'Petar'].forEach((n) => {
        id[n] = FT.addPerson({ name: n, x: 0, y: 0 }).id;
      });
      const U = (p, c) => {
        const u = FT.newUnion({ partners: p.map((n) => id[n]), children: c.map((n) => id[n]) });
        FT.state.unions[u.id] = u;
        return u;
      };
      window.__u1 = U(['Ruth', 'Joseph'], ['Ivan']).id;
      U(['Joseph', 'Marta'], ['Petar']);
      FT.autoArrange();
      FT.render();
      FT.fitToScreen();
    });
    await page.waitForTimeout(600);

    await page.evaluate(() =>
      FT.selectEdge({ kind: 'partner', unionId: window.__u1, childId: null }));
    await page.waitForTimeout(300);
    t.ok(await page.locator('#edgeUnion').isVisible(), 'a partner line offers its details');
    t.ok((await page.inputValue('#unionStatus')) === 'married', 'defaulting to a marriage');

    await page.fill('#unionFrom', '1948');
    await page.waitForTimeout(400);
    t.ok(
      await page.evaluate(() => FT.state.unions[window.__u1].date === '1948'),
      'a start year is stored on the union'
    );
    t.ok(
      (await page.locator('#edges text.union-label').first().textContent()) === 'm. 1948',
      'and captioned on the line'
    );

    await page.selectOption('#unionStatus', 'ended');
    await page.fill('#unionTo', '1961');
    await page.waitForTimeout(400);
    t.ok(
      await page.evaluate(() => FT.state.unions[window.__u1].status === 'ended'),
      'the relationship can be marked as ended'
    );
    t.ok((await page.locator('#edges .union-break').count()) === 1,
      'which draws the break mark across the line');
    t.ok(
      (await page.locator('#edges text.union-label').first().textContent()) === 'm. 1948 – 1961',
      'and both years are shown'
    );

    await page.selectOption('#unionStatus', 'partners');
    await page.waitForTimeout(400);
    t.ok((await page.locator('#edges path.edge.unwed').count()) >= 1,
      'an unmarried partnership is dashed');
    t.ok((await page.locator('#edges .union-break').count()) === 0, 'and carries no break mark');

    // A child line has no union details to edit.
    await page.evaluate(() => {
      const u = FT.unionList().find((x) => x.children.length);
      FT.selectEdge({ kind: 'child', unionId: u.id, childId: u.children[0] });
    });
    await page.waitForTimeout(250);
    t.ok(!(await page.locator('#edgeUnion').isVisible()), 'a child line shows no relationship fields');

    t.section('a union label is never hidden behind a card');
    const labelClear = await page.evaluate(() => {
      FT.selectEdge(null);
      const cards = Array.from(document.querySelectorAll('.card')).map((c) =>
        c.getBoundingClientRect());
      return Array.from(document.querySelectorAll('#edges text.union-label')).every((t) => {
        const r = t.getBoundingClientRect();
        if (!r.width) return true;
        return !cards.some((c) =>
          r.left < c.right - 1 && r.right > c.left + 1 && r.top < c.bottom - 1 && r.bottom > c.top + 1);
      });
    });
    t.ok(labelClear, 'captions sit clear of every card, not clipped behind one');

    t.section('a reaching partner line goes around, not behind');
    const routed = await page.evaluate(() => {
      FT.adoptDocument(FT.newTree('Three marriages'));
      const id = {};
      ['Joseph', 'Ruth', 'Marta', 'Carol'].forEach((n) => {
        id[n] = FT.addPerson({ name: n, x: 0, y: 0 }).id;
      });
      [['Ruth', 'Joseph'], ['Joseph', 'Marta'], ['Joseph', 'Carol']].forEach((pair) => {
        const u = FT.newUnion({ partners: pair.map((n) => id[n]) });
        FT.state.unions[u.id] = u;
      });
      FT.autoArrange();
      FT.render();
      const people = FT.peopleList();
      // Any partner line that crosses a card's box at card height is passing
      // behind it, which is exactly the ambiguity we set out to remove.
      let through = 0;
      document.querySelectorAll('#edges path.edge[data-kind="partner"]').forEach((path) => {
        const len = path.getTotalLength();
        for (let i = 0; i <= 40; i++) {
          const pt = path.getPointAtLength((len * i) / 40);
          const u = FT.state.unions[path.dataset.union];
          people.forEach((q) => {
            if (u.partners.indexOf(q.id) >= 0) return;
            if (pt.x > q.x + 2 && pt.x < q.x + FT.CARD_W - 2 &&
                pt.y > q.y + 2 && pt.y < q.y + FT.CARD_H - 2) through++;
          });
        }
      });
      return through;
    });
    t.ok(routed === 0, 'no partner line passes through an unrelated card (' + routed + ' points inside)');

    // Put the sample family back for the sections that follow.
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    await page.click('[data-action="demo"]');
    await page.waitForTimeout(600);

    t.section('a cross-generation partner draws differently');
    await page.evaluate(() => {
      const ids = Object.keys(FT.state.people);
      const gp = ids.find((i) => FT.state.people[i].name.startsWith('Joseph'));
      const gc = ids.find((i) => FT.state.people[i].name.startsWith('Emily'));
      FT.linkAsPartners(gp, gc);
      FT.autoArrange();
      FT.render();
    });
    await page.waitForTimeout(500);
    t.ok((await page.locator('#edges path.edge.cross-gen').count()) === 1, 'it is drawn as a dashed link');
    t.ok(
      await page.evaluate(() => FT.peopleList().every((p) => p.y / FT.ROW_H <= 3)),
      'and the tree keeps its generations instead of running off the canvas'
    );

    t.section('a long tree name');
    const LONG = 'The Extended Fairweather Family of Cedar Falls and the Iowa River Valley, 1840 onwards';
    await page.fill('#treeTitle', LONG);
    await page.click('#stage', { position: { x: 60, y: 300 } });
    await page.waitForTimeout(400);
    const title = await page.evaluate(() => {
      const i = document.getElementById('treeTitle');
      return {
        scrollLeft: i.scrollLeft,
        overflowing: i.scrollWidth > i.clientWidth,
        tooltip: i.title,
        ellipsis: getComputedStyle(i).textOverflow,
      };
    });
    t.ok(title.overflowing, 'the name is too long for its box');
    t.ok(title.scrollLeft === 0, 'the beginning is shown, not the end');
    t.ok(title.ellipsis === 'ellipsis', 'the tail is ellipsed');
    t.ok(title.tooltip === LONG, 'and hovering gives the whole name');
    await page.fill('#treeTitle', 'The Miller Family');
    await page.waitForTimeout(300);

    t.section('the zoom readout');
    await page.click('[data-action="fit"]');
    await page.waitForTimeout(400);
    const shown = () => page.locator('#zoomLevel').textContent();
    t.ok(/^\d+%$/.test(await shown()), 'the toolbar states the zoom as a percentage');
    const atFit = await shown();
    await page.click('[data-action="zoomIn"]');
    await page.waitForTimeout(350);
    t.ok((await shown()) !== atFit, 'it changes when you zoom in');
    t.ok(
      parseInt(await shown(), 10) > parseInt(atFit, 10),
      'and the number goes up (' + atFit + ' → ' + (await shown()) + ')'
    );
    await page.click('[data-action="zoomOut"]');
    await page.waitForTimeout(350);
    t.ok((await shown()) === atFit, 'zooming back out returns to the same figure');

    t.section('the zoom menu');
    await page.click('#zoomLevel');
    await page.waitForTimeout(300);
    t.ok(await page.locator('#zoomMenu').isVisible(), 'clicking the readout opens a menu');
    t.ok(
      (await page.inputValue('#zoomInput')) === String(parseInt(await shown(), 10)),
      'seeded with the current zoom'
    );

    await page.fill('#zoomInput', '137');
    await page.press('#zoomInput', 'Enter');
    await page.waitForTimeout(400);
    t.ok((await shown()) === '137%', 'a typed value is applied');
    t.ok(
      Math.abs((await page.evaluate(() => FT.zoomLevel())) - 1.37) < 0.005,
      'and the canvas really is at that scale'
    );
    t.ok(!(await page.locator('#zoomMenu').isVisible()), 'the menu closes after setting');

    await page.click('#zoomLevel');
    await page.waitForTimeout(250);
    await page.click('#zoomMenu [data-zoom="100"]');
    await page.waitForTimeout(400);
    t.ok((await shown()) === '100%', 'a preset sets the zoom');
    t.ok(
      Math.abs((await page.evaluate(() => FT.zoomLevel())) - 1) < 0.001,
      'and the canvas really is at 1:1'
    );

    // Out-of-range input must be clamped, and say so rather than silently differ.
    await page.click('#zoomLevel');
    await page.waitForTimeout(250);
    await page.fill('#zoomInput', '9000');
    await page.press('#zoomInput', 'Enter');
    await page.waitForTimeout(400);
    t.ok((await shown()) === '250%', 'an absurd value is clamped to the maximum');
    t.ok(
      /limited to between/.test(await page.locator('#hintText').textContent()),
      'and the clamp is explained'
    );

    await page.click('#zoomLevel');
    await page.waitForTimeout(250);
    await page.click('#zoomMenu [data-zoom="fit"]');
    await page.waitForTimeout(500);
    t.ok(!(await page.locator('#zoomMenu').isVisible()), 'Fit closes the menu');
    t.ok((await page.locator('.card').first().isVisible()), 'and the tree is on screen');

    await page.click('#zoomLevel');
    await page.waitForTimeout(250);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    t.ok(!(await page.locator('#zoomMenu').isVisible()), 'Escape closes it');
    await page.evaluate(() => FT.zoomTo(1));
    await page.waitForTimeout(300);

    // Ctrl+scroll must keep the readout honest too.
    await page.mouse.move(700, 500);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -200);
    await page.keyboard.up('Control');
    await page.waitForTimeout(350);
    t.ok((await shown()) !== '100%', 'and it follows Ctrl+scroll zooming');

    t.section('a birth surname on the card');
    const cardFit = await page.evaluate(() => {
      FT.zoomTo(1);
      const ids = Object.keys(FT.state.people);
      const a = ids.find((i) => FT.state.people[i].name.startsWith('Ruth'));
      // The worst a card can be asked to hold: a name that wraps to two lines,
      // a long birth surname, and a full lifespan.
      FT.state.people[a].name = 'Anastasia Marianne Fairweather';
      FT.state.people[a].birthSurname = 'Fairweather-Calloway';
      FT.render();
      const card = document.querySelector('[data-id="' + a + '"]');
      const born = card.querySelector('.born');
      const meta = card.querySelector('.meta');
      const cr = card.getBoundingClientRect();
      const mr = meta.getBoundingClientRect();
      const others = ids.filter((i) => i !== a && !FT.state.people[i].birthSurname);
      return {
        shown: !!born,
        text: born ? born.textContent : '',
        ellipsed: born ? born.scrollWidth > born.clientWidth : false,
        insideVertically: mr.bottom <= cr.bottom - 9,
        insideHorizontally: mr.right <= cr.right - 11,
        absentWhenUnset: !document.querySelector('[data-id="' + others[0] + '"] .born'),
        clipped: getComputedStyle(meta).overflow === 'hidden',
      };
    });
    t.ok(cardFit.shown, 'the card shows the surname someone was born with');
    t.ok(/^born /.test(cardFit.text), 'phrased "born X" (' + cardFit.text + ')');
    t.ok(cardFit.absentWhenUnset, 'and nothing is drawn for people who never changed it');
    t.ok(cardFit.insideVertically, 'a two-line name plus surname plus dates still fits the card');
    t.ok(cardFit.insideHorizontally, 'and stays inside it horizontally');
    t.ok(cardFit.ellipsed, 'a long surname is ellipsed rather than pushed out');
    t.ok(cardFit.clipped, 'with the block clipped as a backstop');

    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    await page.click('[data-action="demo"]');
    await page.waitForTimeout(600);

    t.section('the card and chapter page are uncluttered');
    t.ok((await page.locator('.card .entry-count').count()) === 0, 'cards show no chapter badge');
    await page.evaluate(() => {
      const id = Object.keys(FT.state.people).find((i) => FT.state.people[i].entries.length);
      FT.openBook(id);
    });
    await page.waitForTimeout(500);
    t.ok((await page.locator('#wordCount').count()) === 0, 'the chapter page shows no word count');
    await page.click('#closeBook');
    await page.waitForTimeout(400);

    t.section('the detailed SVG keeps its text inside the cards');
    // The reported bug: a long word was never broken, so "known for" ran clean
    // out of its card and across the neighbouring one. Build a deliberately
    // hostile tree and measure every drawn glyph against the card it belongs to.
    const measured = await page.evaluate(() => {
      const D = { w: 340, h: 268 };
      const tree = FT.newTree('Overflow torture');
      const mk = (attrs) => {
        const p = FT.newPerson(attrs);
        tree.people[p.id] = p;
        return p;
      };
      const a = mk({
        name: 'Marina Parkin',
        x: 0, y: 0,
        birth: '1921-03-14', death: '1998-11-02',
        birthplace: 'Cedar Falls',
        birthSurname: 'Fairweather-Calloway',
        // exactly what broke it: one word with no spaces at all
        knownFor: 'unbreakable'.repeat(14),
      });
      const b = mk({
        name: 'Bartholomew Maximilian Fitzwilliam-Fairweather the Third',
        x: 220, y: 0,
        birth: '1925-07-21',
        birthplace: 'A Very Long Place Name In The Middle Of Absolutely Nowhere, Iowa',
        knownFor: 'Kept the village school open through two hard winters and then ' +
          'rebuilt the roof himself, twice, without ever once asking for help.',
      });
      mk({ name: 'Sparse', x: 440, y: 0 });
      tree.unions[FT.uid('u')] = FT.newUnion({ partners: [a.id, b.id], children: [] });
      FT.adoptDocument(tree);

      const host = document.createElement('div');
      host.style.cssText = 'position:absolute;left:-99999px;top:0;';
      host.innerHTML = FT.buildDetailedSvg();
      document.body.appendChild(host);

      const worst = { over: 0, text: '' };
      let checked = 0;
      let collisions = 0;
      let clash = '';
      let brokenWord = false;
      host.querySelectorAll('g[data-person]').forEach((card) => {
        const boxes = [];
        card.querySelectorAll('text').forEach((t) => {
          const bb = t.getBBox();
          checked++;
          const over = Math.max(0, bb.x + bb.width - D.w, -bb.x, bb.y + bb.height - D.h, -bb.y);
          if (over > worst.over) {
            worst.over = over;
            worst.text = t.textContent.slice(0, 40);
          }
          if (/^unbreakable/.test(t.textContent) && t.textContent.length < 120) brokenWord = true;
          boxes.push({ bb, text: t.textContent });
        });
        // A label landing on its own value, or a row on the section below it,
        // is just as broken as text leaving the card.
        for (let i = 0; i < boxes.length; i++) {
          for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i].bb;
            const b = boxes[j].bb;
            if (a.x < b.x + b.width - 0.5 && a.x + a.width > b.x + 0.5 &&
                a.y < b.y + b.height - 0.5 && a.y + a.height > b.y + 0.5) {
              collisions++;
              if (!clash) clash = boxes[i].text.slice(0, 18) + ' / ' + boxes[j].text.slice(0, 18);
            }
          }
        }
      });
      const svg = host.innerHTML;
      host.remove();
      return { worst, checked, collisions, clash, brokenWord, hasEllipsis: /…/.test(svg) };
    });

    t.ok(measured.checked > 20, 'measured every text run on the cards (' + measured.checked + ')');
    t.ok(
      measured.collisions === 0,
      'no two text runs sit on top of each other (' + measured.collisions +
        (measured.clash ? ': ' + measured.clash : '') + ')'
    );
    t.ok(
      measured.worst.over <= 1,
      'nothing spills out of its card (worst overhang ' +
        measured.worst.over.toFixed(1) + 'px' +
        (measured.worst.text ? ' on "' + measured.worst.text + '"' : '') + ')'
    );
    t.ok(measured.brokenWord, 'a word too long for a line is broken instead of running on');
    t.ok(measured.hasEllipsis, 'and what still does not fit is ellipsed');

    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    await page.click('[data-action="demo"]');
    await page.waitForTimeout(600);

    t.section('the detailed SVG downloads');
    await page.click('#exportBtn');
    await page.waitForTimeout(200);
    t.ok(await page.locator('[data-action="exportDetailedSvg"]').isVisible(),
      'the export menu offers it');
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }),
      page.click('#exportMenu [data-action="exportDetailedSvg"]'),
    ]);
    t.ok(/-detailed\.svg$/.test(dl.suggestedFilename()),
      'named as a detailed export (' + dl.suggestedFilename() + ')');
    t.ok(!(await page.locator('#exportMenu').isVisible()), 'and the menu closes behind it');

    t.section('born / died date pickers');
    const josip = await page.evaluate(() =>
      Object.keys(FT.state.people).find((id) => FT.state.people[id].name === 'Joseph Miller')
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
    const dates = await page.locator('.card').filter({ hasText: 'Joseph' }).locator('.dates').textContent();
    t.ok(dates.trim() === '1922 – 1998', 'the card still shows years only (' + dates.trim() + ')');

    t.section('free-text escape hatch for approximate dates');
    const birthField = '[data-field="birth"]';
    const birthToggle = '.date-mode[data-key="birth"]';
    await page.evaluate((id) => FT.openBook(id), josip);
    await page.waitForTimeout(400);
    t.ok((await page.getAttribute(birthField, 'type')) === 'date', 'an exact date shows the picker');
    t.ok((await page.getAttribute(birthToggle, 'data-to')) === 'text', 'with a toggle out to free text');

    await page.locator(birthToggle).click();
    await page.waitForTimeout(400);
    t.ok((await page.getAttribute(birthField, 'type')) === 'text', 'the toggle swaps in a text field');
    await page.fill(birthField, 'c. 1880');
    await page.waitForTimeout(500);
    t.ok((await page.evaluate((id) => FT.state.people[id].birth, josip)) === 'c. 1880', 'an approximate date is stored verbatim');

    await page.click('#closeBook');
    await page.waitForTimeout(400);
    const approx = await page.locator('.card').filter({ hasText: 'Joseph' }).locator('.dates').textContent();
    t.ok(approx.trim().startsWith('1880'), 'the card still finds the year in it (' + approx.trim() + ')');

    await page.evaluate((id) => FT.openBook(id), josip);
    await page.waitForTimeout(400);
    t.ok((await page.getAttribute(birthField, 'type')) === 'text', 'reopening keeps it as text — the mode follows the value');
    t.ok((await page.inputValue(birthField)) === 'c. 1880', 'and it is editable, not stranded');

    await page.locator(birthToggle).click();
    await page.waitForTimeout(400);
    t.ok((await page.getAttribute(birthField, 'type')) === 'date', 'switching back gives the picker');
    t.ok((await page.inputValue(birthField)) === '', 'which cannot display an approximate date, so it sits empty');
    t.ok(await page.locator('.pf-legacy').isVisible(), 'so the approximate value is shown beside it rather than dropped');
    t.ok((await page.locator('.pf-legacy').textContent()).includes('c. 1880'), 'verbatim');
    t.ok((await page.evaluate((id) => FT.state.people[id].birth, josip)) === 'c. 1880', 'and is still what is stored');
    await page.fill(birthField, '1880-01-01');
    await page.waitForTimeout(400);
    t.ok(!(await page.locator('.pf-legacy').isVisible()), 'picking a date replaces it');
    t.ok((await page.evaluate((id) => FT.state.people[id].birth, josip)) === '1880-01-01', 'and overwrites the stored value');

    t.ok(
      (await page.getAttribute('.date-mode[data-key="death"]', 'data-to')) !== null,
      'Died has the same escape hatch'
    );

    t.section('"Known for": two lines, ellipsis, tooltip');
    const short = 'Village blacksmith';
    const long =
      'Village blacksmith for forty years, who reopened the forge after the war and made the ' +
      'iron gate that still stands on the courthouse lawn, with oak leaves along the top rail.';
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
