/* Ancestree — getting a tree in and out.

   Out: JSON (the only lossless form — re-importable, keeps every diary entry),
        SVG (a vector drawing of the canvas), PNG (the same, rasterised).
   In:  JSON only. A picture cannot be read back into a family tree. */
(function () {
  const FT = window.FT;

  function download(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
    }, 1000);
  }

  /* Keep letters from any alphabet — stripping them turned "Kovač" into "kova". */
  function slug(name) {
    return (
      String(name || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, '-')
        .replace(/^-+|-+$/g, '') || 'family-tree'
    );
  }

  // ------------------------------------------------------------------ JSON

  FT.exportFile = function () {
    download(
      new Blob([JSON.stringify(FT.state, null, 2)], { type: 'application/json' }),
      slug(FT.state.title) + '.json'
    );
  };

  /* onDone receives an array: one tree for a plain export, many for a backup. */
  FT.importFile = function (file, onDone) {
    const reader = new FileReader();
    reader.onload = function () {
      let trees = [];
      try {
        trees = FT.readTrees(reader.result);
      } catch (e) {
        FT.emit('hint', { text: 'That file could not be read as a family tree.' });
        return;
      }
      if (!trees.length) {
        FT.emit('hint', { text: 'That file has no people in it.' });
        return;
      }
      if (onDone) onDone(trees);
    };
    reader.onerror = function () {
      FT.emit('hint', { text: 'That file could not be read.' });
    };
    reader.readAsText(file);
  };

  // ------------------------------------------------------- one life's book

  /* Chapters are the part of a tree worth reading rather than looking at, so
     they come out as a document about one person, not as data. */
  function personChapters(p) {
    return p.entries.slice().sort(function (a, b) {
      return String(a.date).localeCompare(String(b.date));
    });
  }

  function chapterHeading(e) {
    const from = FT.prettyDate(e.date);
    const to = e.end ? FT.prettyDate(e.end) : '';
    const when = to ? from + ' – ' + to : from;
    const title = e.title || 'Untitled chapter';
    return { when: when || 'Undated', title: title };
  }

  function personSubtitle(p) {
    const bits = [];
    const span = FT.lifespan(p);
    if (span) bits.push(span);
    if (p.birthSurname) bits.push(FT.bornAs(p));
    if (p.birthplace) bits.push('of ' + p.birthplace);
    return bits.join(' · ');
  }

  FT.chaptersMarkdown = function (personId) {
    const p = FT.state.people[personId];
    if (!p) return '';
    const out = ['# ' + p.name];
    const sub = personSubtitle(p);
    if (sub) out.push('', '*' + sub + '*');
    if (p.knownFor) out.push('', p.knownFor);

    personChapters(p).forEach(function (e) {
      const h = chapterHeading(e);
      out.push('', '---', '', '## ' + h.title, '', '**' + h.when + '**');
      if (e.body.trim()) out.push('', e.body.trim());
    });

    out.push('', '---', '', '*From ' + FT.state.title + '.*');
    return out.join('\n') + '\n';
  };

  FT.exportChaptersMarkdown = function (personId) {
    const p = FT.state.people[personId];
    if (!p) return false;
    if (!p.entries.length) {
      FT.emit('hint', { text: 'There are no chapters to export yet.' });
      return false;
    }
    download(
      new Blob([FT.chaptersMarkdown(personId)], { type: 'text/markdown;charset=utf-8' }),
      slug(p.name) + '-chapters.md'
    );
    return true;
  };

  /* A print view rather than a generated PDF: the browser's own print engine
     typesets far better than anything we could bundle, and "Save as PDF" in the
     print dialog produces the file. Nothing is added to the page permanently. */
  FT.chaptersPrintHtml = function (personId) {
    const p = FT.state.people[personId];
    if (!p) return '';
    const sub = personSubtitle(p);
    const parts = [
      '<header class="pr-head">',
      '<h1>' + esc(p.name) + '</h1>',
      sub ? '<p class="pr-sub">' + esc(sub) + '</p>' : '',
      p.knownFor ? '<p class="pr-known">' + esc(p.knownFor) + '</p>' : '',
      '</header>',
    ];
    personChapters(p).forEach(function (e) {
      const h = chapterHeading(e);
      parts.push(
        '<section class="pr-chapter">',
        '<h2>' + esc(h.title) + '</h2>',
        '<p class="pr-when">' + esc(h.when) + '</p>',
        '<div class="pr-body"><p>' +
          esc(e.body.trim()).replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>') +
          '</p></div>',
        '</section>'
      );
    });
    parts.push('<footer class="pr-foot">From ' + esc(FT.state.title) + '.</footer>');
    return parts.join('');
  };

  FT.printChapters = function (personId) {
    const p = FT.state.people[personId];
    if (!p) return false;
    if (!p.entries.length) {
      FT.emit('hint', { text: 'There are no chapters to print yet.' });
      return false;
    }
    const root = document.getElementById('printRoot');
    root.innerHTML = FT.chaptersPrintHtml(personId);
    document.body.classList.add('printing');

    const done = function () {
      document.body.classList.remove('printing');
      root.innerHTML = '';
      window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    // Some browsers never fire afterprint; do not leave the page stuck.
    setTimeout(done, 60000);

    window.print();
    return true;
  };

  // ------------------------------------------------ every tree in one file

  const ARCHIVE_KIND = 'heirloom-archive';

  /* One file holding the whole shelf. The account-free equivalent of a backup:
     keep it somewhere safe and any browser can be restored from it. */
  FT.exportAll = function () {
    const trees = FT.listDocs()
      .map(function (row) {
        return FT.loadDoc(row.id);
      })
      .filter(Boolean);
    if (!trees.length) {
      FT.emit('hint', { text: 'There are no trees to back up yet.' });
      return false;
    }
    download(
      new Blob([JSON.stringify({ kind: ARCHIVE_KIND, version: 1, trees: trees }, null, 2)], {
        type: 'application/json',
      }),
      'heirloom-backup-' + new Date().toISOString().slice(0, 10) + '.json'
    );
    return true;
  };

  /* Accepts either an archive or a single tree, so one Import can take both. */
  FT.readTrees = function (text) {
    const raw = JSON.parse(text);
    if (raw && raw.kind === ARCHIVE_KIND && Array.isArray(raw.trees)) {
      return raw.trees.map(FT.normalize).filter(function (doc) {
        return Object.keys(doc.people).length;
      });
    }
    const one = FT.normalize(raw);
    return Object.keys(one.people).length ? [one] : [];
  };

  // ------------------------------------------------------------------- SVG

  const esc = FT.escapeHtml;

  /* Fitting text into a card.

     This used to count characters, which is wrong twice over: character width
     varies with the glyph, and a word with no spaces in it was never broken at
     all. A single long word therefore rendered as one enormous line that ran
     clean out of its card and across the neighbouring one.

     So measure. The canvas gives real pixel widths for the same font the SVG
     will ask for, long words are hard-broken, and the result is ellipsed to fit
     the space that actually exists. */
  let measureCtx;

  function widthOf(text, font) {
    if (measureCtx === undefined) {
      try {
        measureCtx = document.createElement('canvas').getContext('2d');
      } catch (e) {
        measureCtx = null;
      }
    }
    if (!measureCtx) return String(text).length * 7; // crude, but never used in a browser
    measureCtx.font = font;
    return measureCtx.measureText(String(text)).width;
  }

  /* Put an ellipsis on a line, trimming until the whole thing fits. */
  function withEllipsis(line, font, maxWidth) {
    let t = String(line);
    while (t && widthOf(t.replace(/\s+$/, '') + '…', font) > maxWidth) t = t.slice(0, -1);
    return t.replace(/\s+$/, '') + '…';
  }

  /* Break one word that is too wide to sit on a line of its own. */
  function breakWord(word, font, maxWidth) {
    const pieces = [];
    let rest = word;
    while (rest && widthOf(rest, font) > maxWidth) {
      let lo = 1;
      let hi = rest.length;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (widthOf(rest.slice(0, mid), font) <= maxWidth) lo = mid;
        else hi = mid - 1;
      }
      pieces.push(rest.slice(0, lo));
      rest = rest.slice(lo);
    }
    if (rest) pieces.push(rest);
    return pieces;
  }

  function fitLines(text, font, maxWidth, maxLines) {
    const words = String(text == null ? '' : text).trim().split(/\s+/).filter(Boolean);
    if (!words.length) return [];

    const lines = [];
    let line = '';
    let truncated = false;

    for (let i = 0; i < words.length && !truncated; i++) {
      const w = words[i];
      const next = line ? line + ' ' + w : w;
      if (widthOf(next, font) <= maxWidth) {
        line = next;
        continue;
      }
      if (line) {
        lines.push(line);
        line = '';
      }
      if (lines.length >= maxLines) {
        truncated = true;
        break;
      }
      if (widthOf(w, font) <= maxWidth) {
        line = w;
        continue;
      }
      // Too wide even alone — split it across lines rather than let it run.
      const pieces = breakWord(w, font, maxWidth);
      for (let k = 0; k < pieces.length - 1 && !truncated; k++) {
        lines.push(pieces[k]);
        if (lines.length >= maxLines) truncated = true;
      }
      if (!truncated) line = pieces[pieces.length - 1];
    }

    if (!truncated && line) lines.push(line);
    if (lines.length > maxLines) {
      lines.length = maxLines;
      truncated = true;
    }
    // Say so when something was dropped, rather than stopping mid-sentence.
    if (truncated && lines.length) {
      lines[lines.length - 1] = withEllipsis(lines[lines.length - 1], font, maxWidth);
    }
    return lines;
  }

  FT.fitLines = fitLines; // exercised directly by the tests

  /* Draw one relationship: the line, its union diamond, the "ended" slashes
     and the date caption. Shared so both exports say the same thing. */
  function edgeSvg(e, scale) {
    const k = scale || 1;
    const dash = e.crossGen ? '9 6' : e.status === 'partners' ? '7 5' : '';
    const stroke = e.crossGen ? '#a8917a' : '#b6a483';
    const out = [
      '<path d="' + e.d + '" fill="none" stroke="' + stroke + '" stroke-width="' +
        2 * k + '" stroke-linejoin="round" stroke-linecap="round"' +
        (dash ? ' stroke-dasharray="' + dash + '"' : '') + '/>',
    ];
    if (e.mark) {
      const r = 6 * k;
      out.push(
        '<path d="M' + e.mark.x + ' ' + (e.mark.y - r) +
          'L' + (e.mark.x + r) + ' ' + e.mark.y +
          'L' + e.mark.x + ' ' + (e.mark.y + r) +
          'L' + (e.mark.x - r) + ' ' + e.mark.y + 'Z" fill="' +
          (e.crossGen ? '#a8917a' : '#b3903f') + '" opacity="0.85"/>'
      );
      if (e.status === 'ended') {
        const a = 9 * k;
        const b = 7 * k;
        out.push(
          '<path d="M' + (e.mark.x + a) + ' ' + (e.mark.y - b) +
            'L' + (e.mark.x + a - 5 * k) + ' ' + (e.mark.y + b) +
            'M' + (e.mark.x + a + 6 * k) + ' ' + (e.mark.y - b) +
            'L' + (e.mark.x + a + k) + ' ' + (e.mark.y + b) +
            '" fill="none" stroke="#a8917a" stroke-width="' + 1.8 * k +
            '" stroke-linecap="round"/>'
        );
      }
    }
    if (e.label && e.labelPos) {
      out.push(
        '<text x="' + e.labelPos.x + '" y="' + e.labelPos.y + '" text-anchor="middle" ' +
          'font-family="Helvetica, Arial, sans-serif" font-size="' + 10 * k +
          '" fill="#9a9084">' + esc(e.label) + '</text>'
      );
    }
    return out.join('');
  }

  const SERIF = 'Georgia, serif';
  const SANS = 'Helvetica, Arial, sans-serif';
  const font = function (size, family) {
    return size + 'px ' + family;
  };

  const TINT = { f: '#b07f9a', m: '#6f8aa8', x: '#7c8a6c' };
  const AVATAR = { f: '#8d5c78', m: '#4f6c8a', x: '#7d4e32' };

  /* A standalone SVG of the whole canvas, mirroring what is on screen. */
  FT.buildSvg = function () {
    const people = FT.peopleList();
    const pad = 48;
    const b = FT.contentBounds();
    const w = Math.max(1, b.w) + pad * 2;
    const h = Math.max(1, b.h) + pad * 2;
    const ox = pad - b.x;
    const oy = pad - b.y;

    const out = [];
    out.push(
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ' +
        'width="' + Math.round(w) + '" height="' + Math.round(h) + '" ' +
        'viewBox="0 0 ' + Math.round(w) + ' ' + Math.round(h) + '">'
    );
    out.push('<title>' + esc(FT.state.title) + '</title>');
    out.push('<rect width="100%" height="100%" fill="#f6f1e7"/>');
    out.push('<g transform="translate(' + ox + ',' + oy + ')">');

    // Connectors, reusing the renderer's own geometry so the drawing matches.
    FT.edgeGeometry().forEach(function (e) {
      out.push(edgeSvg(e, 1));
    });

    people.forEach(function (p) {
      const g = TINT[p.gender] ? p.gender : 'x';
      out.push('<g transform="translate(' + p.x + ',' + p.y + ')">');
      out.push(
        '<rect width="' + FT.CARD_W + '" height="' + FT.CARD_H + '" rx="12" ' +
          'fill="#fffdf8" stroke="#d8cbb4" stroke-width="1"/>'
      );
      out.push('<rect x="0" y="10" width="3" height="' + (FT.CARD_H - 20) +
        '" rx="1.5" fill="' + TINT[g] + '"/>');

      // Portrait: the stored thumbnail is a data: URL, so it travels with the file.
      if (p.photo) {
        const cid = 'clip-' + p.id;
        out.push('<clipPath id="' + cid + '"><circle cx="33" cy="46" r="21"/></clipPath>');
        out.push(
          '<image x="12" y="25" width="42" height="42" preserveAspectRatio="xMidYMid slice" ' +
            'clip-path="url(#' + cid + ')" href="' + p.photo + '" xlink:href="' + p.photo + '"/>'
        );
      } else {
        out.push('<circle cx="33" cy="46" r="21" fill="' + AVATAR[g] + '"/>');
        out.push(
          '<text x="33" y="46" text-anchor="middle" dominant-baseline="central" ' +
            'font-family="Georgia, serif" font-size="15" fill="#fffdf7">' +
            esc(FT.initials(p.name)) + '</text>'
        );
      }

      const lines = fitLines(p.name, font(15, SERIF), FT.CARD_W - 64 - 12, 2);
      const span = FT.lifespan(p);
      const top = lines.length > 1 ? 40 : 47;
      lines.forEach(function (line, i) {
        out.push(
          '<text x="64" y="' + (top + i * 17) + '" font-family="Georgia, serif" ' +
            'font-size="15" fill="#2c2620">' + esc(line) + '</text>'
        );
      });
      if (span) {
        out.push(
          '<text x="64" y="' + (top + lines.length * 17 + 2) + '" ' +
            'font-family="Helvetica, Arial, sans-serif" font-size="11" fill="#6b6154">' +
            esc(span) + '</text>'
        );
      }
      out.push('</g>');
    });

    out.push('</g>');
    out.push(
      '<text x="' + pad + '" y="' + (h - 18) + '" font-family="Georgia, serif" ' +
        'font-size="13" fill="#9a9084">' + esc(FT.state.title) + '</text>'
    );
    out.push('</svg>');
    return out.join('');
  };

  FT.exportSvg = function () {
    if (!FT.peopleList().length) {
      FT.emit('hint', { text: 'Nothing to export yet — the tree is empty.' });
      return;
    }
    download(
      new Blob([FT.buildSvg()], { type: 'image/svg+xml;charset=utf-8' }),
      slug(FT.state.title) + '.svg'
    );
  };


  // -------------------------------------------------------- detailed SVG

  /* The same tree, drawn as a proper chart rather than a canvas snapshot:
     large portraits, room for long names, full dates, birthplace, a two-line
     "known for", and how much has been written about each person.

     The cards are far bigger than the ones on screen, so the arrangement is
     scaled up around them. A uniform scale keeps the layout you built — who
     sits left of whom, who lines up with whom — while opening enough space
     that the bigger cards do not collide. */
  const D = {
    w: 340,
    h: 268, // tall enough for four fact rows plus a two-line "known for"

    scale: 1.85,
    photoR: 38,
    photoCx: 58,
    photoCy: 60,
    textX: 112,
    rowTop: 130,
    rowPitch: 21,
    ruleA: 110,
    ruleB: 204,
    knownLabelY: 222,
    knownTextY: 238,
  };

  /* The label column has to clear the widest label, or the value lands on top
     of it. Measure rather than guess — "BORN AS" is wider than it looks with
     letter-spacing applied. */
  const ROW_LABELS = ['BORN', 'DIED', 'BORN AS', 'FROM'];
  const LABEL_TRACK = 0.13; // matches letter-spacing in the markup, in em
  let valueXCache = 0;
  function valueX() {
    if (valueXCache) return valueXCache;
    const f = font(9.5, SERIF);
    const widest = ROW_LABELS.reduce(function (max, txt) {
      // measureText knows nothing of letter-spacing, so add it back.
      return Math.max(max, widthOf(txt, f) + LABEL_TRACK * 9.5 * txt.length);
    }, 0);
    valueXCache = Math.ceil(20 + widest + 12);
    return valueXCache;
  }

  function detailLayout() {
    const people = {};
    FT.peopleList().forEach(function (p) {
      people[p.id] = { id: p.id, x: p.x * D.scale, y: p.y * D.scale };
    });
    return { people: people, cardW: D.w, cardH: D.h };
  }

  function detailBounds(layout) {
    const ids = Object.keys(layout.people);
    if (!ids.length) return { x: 0, y: 0, w: D.w, h: D.h };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    ids.forEach(function (id) {
      const p = layout.people[id];
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + D.w);
      maxY = Math.max(maxY, p.y + D.h);
    });
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  function detailCard(p) {
    const g = TINT[p.gender] ? p.gender : 'x';
    const out = [];
    const clipId = 'dcard-' + p.id;

    // Text is measured to fit, but the font that renders this file elsewhere may
    // have slightly different metrics. Clip to the card so a few stray pixels
    // can never become text sprawling across the neighbouring one.
    out.push(
      '<clipPath id="' + clipId + '"><rect width="' + D.w + '" height="' + D.h +
        '" rx="16"/></clipPath>'
    );
    out.push('<g clip-path="url(#' + clipId + ')">');
    out.push(
      '<rect width="' + D.w + '" height="' + D.h + '" rx="16" ' +
        'fill="#fffdf8"/>'
    );
    out.push('<rect x="0" y="18" width="4" height="' + (D.h - 36) +
      '" rx="2" fill="' + TINT[g] + '"/>');

    // Portrait
    if (p.photo) {
      const cid = 'dclip-' + p.id;
      out.push('<clipPath id="' + cid + '"><circle cx="' + D.photoCx + '" cy="' +
        D.photoCy + '" r="' + D.photoR + '"/></clipPath>');
      out.push(
        '<image x="' + (D.photoCx - D.photoR) + '" y="' + (D.photoCy - D.photoR) +
          '" width="' + D.photoR * 2 + '" height="' + D.photoR * 2 +
          '" preserveAspectRatio="xMidYMid slice" clip-path="url(#' + cid + ')" ' +
          'href="' + p.photo + '" xlink:href="' + p.photo + '"/>'
      );
      out.push('<circle cx="' + D.photoCx + '" cy="' + D.photoCy + '" r="' + D.photoR +
        '" fill="none" stroke="#e0d4bd" stroke-width="1.5"/>');
    } else {
      out.push('<circle cx="' + D.photoCx + '" cy="' + D.photoCy + '" r="' + D.photoR +
        '" fill="' + AVATAR[g] + '"/>');
      out.push(
        '<text x="' + D.photoCx + '" y="' + D.photoCy + '" text-anchor="middle" ' +
          'dominant-baseline="central" font-family="Georgia, serif" font-size="26" ' +
          'fill="#fffdf7">' + esc(FT.initials(p.name)) + '</text>'
      );
    }

    // How much has been written about them.
    const chapters = p.entries.length;
    if (chapters) {
      out.push(
        '<text x="' + (D.w - 20) + '" y="30" text-anchor="end" ' +
          'font-family="Helvetica, Arial, sans-serif" font-size="10.5" ' +
          'letter-spacing="0.08em" fill="#b3903f">' +
          chapters + (chapters === 1 ? ' CHAPTER' : ' CHAPTERS') + '</text>'
      );
    }

    // Name, over two lines if it needs them, then the lifespan in years.
    const nameLines = fitLines(p.name, font(20, SERIF), D.w - D.textX - 20, 2);
    // 20px type needs more than 23px of pitch, or the two lines touch.
    const NAME_PITCH = 26;
    let y = nameLines.length > 1 ? 50 : 60;
    nameLines.forEach(function (line, i) {
      out.push(
        '<text x="' + D.textX + '" y="' + (y + i * NAME_PITCH) + '" ' +
          'font-family="Georgia, serif" font-size="20" fill="#2c2620">' +
          esc(line) + '</text>'
      );
    });
    y += (nameLines.length - 1) * NAME_PITCH;
    const span = FT.lifespan(p);
    if (span) {
      out.push(
        '<text x="' + D.textX + '" y="' + (y + 22) + '" ' +
          'font-family="Helvetica, Arial, sans-serif" font-size="12.5" ' +
          'letter-spacing="0.04em" fill="#6b6154">' + esc(span) + '</text>'
      );
    }

    out.push('<line x1="20" y1="' + D.ruleA + '" x2="' + (D.w - 20) +
      '" y2="' + D.ruleA + '" stroke="#e7ddca" stroke-width="1"/>');

    // Facts, in whatever order they exist — a sparse person gets a sparse card
    // rather than a column of dashes.
    const rows = [];
    if (p.birth) rows.push(['BORN', FT.prettyDate(p.birth)]);
    if (p.death) rows.push(['DIED', FT.prettyDate(p.death)]);
    if (p.birthSurname) rows.push(['BORN AS', p.birthSurname]);
    if (p.birthplace) rows.push(['FROM', p.birthplace]);

    const vx = valueX();
    let ry = D.rowTop;
    rows.forEach(function (row) {
      out.push(
        '<text x="20" y="' + ry + '" font-family="Georgia, serif" font-size="9.5" ' +
          'letter-spacing="' + LABEL_TRACK + 'em" fill="#9a9084">' + row[0] + '</text>'
      );
      out.push(
        '<text x="' + vx + '" y="' + ry + '" font-family="Helvetica, Arial, sans-serif" ' +
          'font-size="12.5" fill="#3b332a">' +
          esc(fitLines(row[1], font(12.5, SANS), D.w - vx - 20, 1)[0] || '') + '</text>'
      );
      ry += D.rowPitch;
    });

    // Known for: a label and up to two lines, at the foot of the card.
    if (p.knownFor) {
      out.push('<line x1="20" y1="' + D.ruleB + '" x2="' + (D.w - 20) +
        '" y2="' + D.ruleB + '" stroke="#e7ddca" stroke-width="1"/>');
      out.push(
        '<text x="20" y="' + D.knownLabelY + '" font-family="Georgia, serif" ' +
          'font-size="9.5" letter-spacing="' + LABEL_TRACK +
          'em" fill="#9a9084">KNOWN FOR</text>'
      );
      fitLines(p.knownFor, font(12.5, SERIF), D.w - 40, 2).forEach(function (line, i) {
        out.push(
          '<text x="20" y="' + (D.knownTextY + i * 16) + '" font-family="Georgia, serif" ' +
            'font-size="12.5" fill="#3b332a">' + esc(line) + '</text>'
        );
      });
    }

    out.push('</g>');
    // Border last and outside the clip, so it stays a clean unclipped outline.
    out.push(
      '<rect width="' + D.w + '" height="' + D.h + '" rx="16" ' +
        'fill="none" stroke="#d8cbb4" stroke-width="1.25"/>'
    );
    return out.join('');
  }

  /* A standalone SVG chart of the whole tree, with a card per person. */
  FT.buildDetailedSvg = function () {
    const layout = detailLayout();
    const pad = 64;
    const b = detailBounds(layout);
    const w = Math.max(1, b.w) + pad * 2;
    const h = Math.max(1, b.h) + pad * 2 + 34; // room for the title strip
    const ox = pad - b.x;
    const oy = pad - b.y;

    const out = [];
    out.push(
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ' +
        'width="' + Math.round(w) + '" height="' + Math.round(h) + '" ' +
        'viewBox="0 0 ' + Math.round(w) + ' ' + Math.round(h) + '">'
    );
    out.push('<title>' + esc(FT.state.title) + '</title>');
    out.push('<rect width="100%" height="100%" fill="#f6f1e7"/>');
    out.push('<g transform="translate(' + ox + ',' + oy + ')">');

    FT.edgeGeometry(layout).forEach(function (e) {
      out.push(edgeSvg(e, 1.25));
    });

    FT.peopleList().forEach(function (p) {
      const pos = layout.people[p.id];
      out.push('<g data-person="' + esc(p.id) + '" transform="translate(' +
        pos.x + ',' + pos.y + ')">' + detailCard(p) + '</g>');
    });

    out.push('</g>');
    out.push(
      '<text x="' + pad + '" y="' + (h - 26) + '" font-family="Georgia, serif" ' +
        'font-size="17" fill="#8a5637">' + esc(FT.state.title) + '</text>'
    );
    const n = FT.peopleList().length;
    out.push(
      '<text x="' + pad + '" y="' + (h - 10) + '" ' +
        'font-family="Helvetica, Arial, sans-serif" font-size="11" fill="#9a9084">' +
        n + (n === 1 ? ' person' : ' people') + '</text>'
    );
    out.push('</svg>');
    return out.join('');
  };

  FT.exportDetailedSvg = function () {
    if (!FT.peopleList().length) {
      FT.emit('hint', { text: 'Nothing to export yet — the tree is empty.' });
      return false;
    }
    download(
      new Blob([FT.buildDetailedSvg()], { type: 'image/svg+xml;charset=utf-8' }),
      slug(FT.state.title) + '-detailed.svg'
    );
    return true;
  };

  // ------------------------------------------------------------------- PNG

  /* Rasterise the SVG at 2x so it stays sharp when someone zooms in. */
  FT.exportPng = function (scale) {
    if (!FT.peopleList().length) {
      FT.emit('hint', { text: 'Nothing to export yet — the tree is empty.' });
      return Promise.resolve(false);
    }
    const factor = scale || 2;
    const svg = FT.buildSvg();
    const size = /width="(\d+)" height="(\d+)"/.exec(svg);
    const w = size ? Number(size[1]) : 1200;
    const h = size ? Number(size[2]) : 800;

    return new Promise(function (resolve) {
      const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      const img = new Image();
      img.onload = function () {
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(w * factor);
        canvas.height = Math.round(h * factor);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#f6f1e7';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(function (blob) {
          if (!blob) {
            FT.emit('hint', { text: 'The image could not be generated.' });
            return resolve(false);
          }
          download(blob, slug(FT.state.title) + '.png');
          resolve(true);
        }, 'image/png');
      };
      img.onerror = function () {
        FT.emit('hint', { text: 'The image could not be generated.' });
        resolve(false);
      };
      img.src = url;
    });
  };
})();
