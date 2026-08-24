/* Heirloom — getting a tree in and out.

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

  /* Wrap to at most `maxLines`, ellipsing what will not fit. Measured by
     character count rather than text metrics — good enough for a drawing, and
     it keeps the export synchronous and dependency-free. */
  function wrapText(text, maxChars, maxLines) {
    const words = String(text || '').trim().split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    words.forEach(function (w) {
      const next = line ? line + ' ' + w : w;
      if (next.length > maxChars && line) {
        lines.push(line);
        line = w;
      } else {
        line = next;
      }
    });
    if (line) lines.push(line);
    if (lines.length > maxLines) {
      lines.length = maxLines;
      const last = lines[maxLines - 1];
      lines[maxLines - 1] = last.slice(0, Math.max(0, maxChars - 1)).replace(/\s+$/, '') + '…';
    }
    return lines;
  }

  function wrapName(name, maxChars) {
    return wrapText(name, maxChars, 2);
  }

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
      out.push(
        '<path d="' + e.d + '" fill="none" stroke="' +
          (e.crossGen ? '#a8917a' : '#b6a483') + '" stroke-width="2" ' +
          'stroke-linejoin="round" stroke-linecap="round"' +
          (e.crossGen ? ' stroke-dasharray="7 5"' : '') + '/>'
      );
      if (e.mark) {
        out.push(
          '<path d="M' + e.mark.x + ' ' + (e.mark.y - 6) +
            'L' + (e.mark.x + 6) + ' ' + e.mark.y +
            'L' + e.mark.x + ' ' + (e.mark.y + 6) +
            'L' + (e.mark.x - 6) + ' ' + e.mark.y + 'Z" fill="' +
            (e.crossGen ? '#a8917a' : '#b3903f') + '" opacity="0.85"/>'
        );
      }
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

      const lines = wrapName(p.name, 17);
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
    h: 244,
    scale: 1.85,
    photoR: 38,
    photoCx: 58,
    photoCy: 60,
    textX: 112,
  };

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

    out.push(
      '<rect width="' + D.w + '" height="' + D.h + '" rx="16" ' +
        'fill="#fffdf8" stroke="#d8cbb4" stroke-width="1.25"/>'
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
    const nameLines = wrapText(p.name, 19, 2);
    let y = nameLines.length > 1 ? 52 : 60;
    nameLines.forEach(function (line, i) {
      out.push(
        '<text x="' + D.textX + '" y="' + (y + i * 23) + '" font-family="Georgia, serif" ' +
          'font-size="20" fill="#2c2620">' + esc(line) + '</text>'
      );
    });
    y += (nameLines.length - 1) * 23;
    const span = FT.lifespan(p);
    if (span) {
      out.push(
        '<text x="' + D.textX + '" y="' + (y + 21) + '" ' +
          'font-family="Helvetica, Arial, sans-serif" font-size="12.5" ' +
          'letter-spacing="0.04em" fill="#6b6154">' + esc(span) + '</text>'
      );
    }

    out.push('<line x1="20" y1="110" x2="' + (D.w - 20) +
      '" y2="110" stroke="#e7ddca" stroke-width="1"/>');

    // Facts, in whatever order they exist — a sparse person gets a sparse card
    // rather than a column of dashes.
    const rows = [];
    if (p.birth) rows.push(['BORN', FT.prettyDate(p.birth)]);
    if (p.death) rows.push(['DIED', FT.prettyDate(p.death)]);
    if (p.birthplace) rows.push(['FROM', p.birthplace]);

    let ry = 132;
    rows.forEach(function (row) {
      out.push(
        '<text x="20" y="' + ry + '" font-family="Georgia, serif" font-size="9.5" ' +
          'letter-spacing="0.13em" fill="#9a9084">' + row[0] + '</text>'
      );
      out.push(
        '<text x="76" y="' + ry + '" font-family="Helvetica, Arial, sans-serif" ' +
          'font-size="12.5" fill="#3b332a">' +
          esc(wrapText(row[1], 30, 1)[0] || '') + '</text>'
      );
      ry += 21;
    });

    // Known for: a label and up to two lines, at the foot of the card.
    if (p.knownFor) {
      out.push('<line x1="20" y1="182" x2="' + (D.w - 20) +
        '" y2="182" stroke="#e7ddca" stroke-width="1"/>');
      out.push(
        '<text x="20" y="200" font-family="Georgia, serif" font-size="9.5" ' +
          'letter-spacing="0.13em" fill="#9a9084">KNOWN FOR</text>'
      );
      wrapText(p.knownFor, 40, 2).forEach(function (line, i) {
        out.push(
          '<text x="20" y="' + (217 + i * 16) + '" font-family="Georgia, serif" ' +
            'font-size="12.5" fill="#3b332a">' + esc(line) + '</text>'
        );
      });
    }

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
      out.push(
        '<path d="' + e.d + '" fill="none" stroke="' +
          (e.crossGen ? '#a8917a' : '#b6a483') + '" stroke-width="2.5" ' +
          'stroke-linejoin="round" stroke-linecap="round"' +
          (e.crossGen ? ' stroke-dasharray="9 6"' : '') + '/>'
      );
      if (e.mark) {
        out.push(
          '<path d="M' + e.mark.x + ' ' + (e.mark.y - 7) +
            'L' + (e.mark.x + 7) + ' ' + e.mark.y +
            'L' + e.mark.x + ' ' + (e.mark.y + 7) +
            'L' + (e.mark.x - 7) + ' ' + e.mark.y + 'Z" fill="' +
            (e.crossGen ? '#a8917a' : '#b3903f') + '" opacity="0.85"/>'
        );
      }
    });

    FT.peopleList().forEach(function (p) {
      const pos = layout.people[p.id];
      out.push('<g transform="translate(' + pos.x + ',' + pos.y + ')">' +
        detailCard(p) + '</g>');
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
