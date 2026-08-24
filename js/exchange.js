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

  FT.importFile = function (file, onDone) {
    const reader = new FileReader();
    reader.onload = function () {
      let doc = null;
      try {
        doc = FT.normalize(JSON.parse(reader.result));
      } catch (e) {
        FT.emit('hint', { text: 'That file could not be read as a family tree.' });
        return;
      }
      if (!Object.keys(doc.people).length) {
        FT.emit('hint', { text: 'That file has no people in it.' });
        return;
      }
      if (onDone) onDone(doc);
    };
    reader.onerror = function () {
      FT.emit('hint', { text: 'That file could not be read.' });
    };
    reader.readAsText(file);
  };

  // ------------------------------------------------------------------- SVG

  const esc = FT.escapeHtml;

  /* Cards wrap their name over at most two lines. Measured by character count
     rather than text metrics — good enough for a drawing, and it keeps the
     export synchronous and dependency-free. */
  function wrapName(name, maxChars) {
    const words = String(name || '').trim().split(/\s+/).filter(Boolean);
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
    if (lines.length > 2) {
      lines.length = 2;
      lines[1] = lines[1].slice(0, maxChars - 1) + '…';
    }
    return lines;
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
          '<text x="33" y="51" text-anchor="middle" font-family="Georgia, serif" ' +
            'font-size="15" fill="#fffdf7">' + esc(FT.initials(p.name)) + '</text>'
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
