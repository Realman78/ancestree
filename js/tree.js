/* Heirloom — canvas: rendering, pan/zoom, dragging with snap + alignment guides. */
(function () {
  const FT = window.FT;

  const stage = document.getElementById('stage');
  const viewport = document.getElementById('viewport');
  const edges = document.getElementById('edges');
  const nodes = document.getElementById('nodes');
  const guides = document.getElementById('guides');
  const pill = document.getElementById('pill');
  const edgePill = document.getElementById('edgePill');

  const view = { x: 120, y: 120, z: 1 };
  const SNAP_RANGE = 14; // world px within which a card magnets to a neighbour's axis

  FT.selected = null;
  FT.selectedEdge = null;
  let linkMode = null; // 'partner' | 'child' — awaiting a second click
  let cards = {}; // id -> element

  // ---------------------------------------------------------------- viewport

  function applyView() {
    viewport.style.transform =
      'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.z + ')';
    stage.style.backgroundSize = FT.GRID * view.z + 'px ' + FT.GRID * view.z + 'px';
    stage.style.backgroundPosition = view.x + 'px ' + view.y + 'px';
    positionPill();
    positionEdgePill();
  }

  function screenToWorld(sx, sy) {
    const r = stage.getBoundingClientRect();
    return { x: (sx - r.left - view.x) / view.z, y: (sy - r.top - view.y) / view.z };
  }

  FT.zoomBy = function (factor, cx, cy) {
    const r = stage.getBoundingClientRect();
    const px = cx == null ? r.width / 2 : cx - r.left;
    const py = cy == null ? r.height / 2 : cy - r.top;
    const next = Math.min(2.5, Math.max(0.25, view.z * factor));
    // Keep the point under the cursor fixed while zooming.
    view.x = px - ((px - view.x) / view.z) * next;
    view.y = py - ((py - view.y) / view.z) * next;
    view.z = next;
    applyView();
  };

  FT.fitToScreen = function () {
    const b = FT.contentBounds();
    const r = stage.getBoundingClientRect();
    const pad = 80;
    const z = Math.min(1.2, Math.max(0.25, Math.min(
      (r.width - pad * 2) / Math.max(1, b.w),
      (r.height - pad * 2) / Math.max(1, b.h)
    )));
    view.z = z;
    view.x = (r.width - b.w * z) / 2 - b.x * z;
    view.y = (r.height - b.h * z) / 2 - b.y * z;
    applyView();
  };

  // ------------------------------------------------------------------ render

  function cardHtml(p) {
    const avatar = p.photo
      ? '<div class="avatar has-photo"><img src="' + p.photo + '" alt=""></div>'
      : '<div class="avatar">' + FT.escapeHtml(FT.initials(p.name)) + '</div>';
    return (
      avatar +
      '<div class="meta">' +
        '<div class="name">' + FT.escapeHtml(p.name) + '</div>' +
        '<div class="dates">' + FT.escapeHtml(FT.lifespan(p)) + '</div>' +
      '</div>' +
      '<button class="book-btn" title="Open life book" aria-label="Open life book">' +
        '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">' +
          '<path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H19v16H5.5A1.5 1.5 0 0 0 4 20.5z" ' +
            'fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>' +
          '<path d="M8 7.5h7M8 11h7" stroke="currentColor" stroke-width="1.5" ' +
            'stroke-linecap="round"/>' +
        '</svg>' +
      '</button>' +
      '<span class="entry-count" title="diary entries"></span>'
    );
  }

  FT.render = function () {
    const list = FT.peopleList();
    const live = {};

    list.forEach(function (p) {
      let el = cards[p.id];
      if (!el) {
        el = document.createElement('div');
        el.className = 'card';
        el.dataset.id = p.id;
        el.tabIndex = 0;
        nodes.appendChild(el);
        cards[p.id] = el;
      }
      // Only rebuild the card when its contents actually changed — otherwise
      // every render re-decodes the portrait and the photo visibly flickers.
      const sig = [
        p.name, p.birth, p.death, p.gender, p.entries.length,
        p.photo.length, p.photo.slice(-24),
      ].join('');
      if (el.dataset.sig !== sig) {
        el.innerHTML = cardHtml(p);
        el.dataset.sig = sig;
      }
      el.style.transform = 'translate(' + p.x + 'px,' + p.y + 'px)';
      el.dataset.gender = p.gender;
      el.classList.toggle('selected', FT.selected === p.id);

      const count = el.querySelector('.entry-count');
      if (p.entries.length) {
        count.textContent = p.entries.length;
        count.hidden = false;
      } else {
        count.hidden = true;
      }
      live[p.id] = true;
    });

    // Drop cards for people who no longer exist.
    Object.keys(cards).forEach(function (id) {
      if (!live[id]) {
        cards[id].remove();
        delete cards[id];
      }
    });

    drawEdges();
    positionPill();
    positionEdgePill();
  };

  /* Orthogonal connectors, one path per relationship so each can be clicked.
     Each visible line is shadowed by a fat transparent "hit" path — a 2px line
     is far too thin to aim at. Children each get the whole route from the union
     down to themselves; the shared segments coincide, so it looks like one bus
     but highlights as a single link. */

  let edgeMids = {}; // where to park the pill for each edge

  function edgeKey(kind, unionId, childId) {
    return kind + ':' + unionId + ':' + (childId || '');
  }

  function isEdgeSelected(kind, unionId, childId) {
    const s = FT.selectedEdge;
    return (
      !!s && s.kind === kind && s.unionId === unionId &&
      (s.childId || '') === (childId || '')
    );
  }

  function drawEdges() {
    const visible = [];
    const hits = [];
    const marks = [];
    edgeMids = {};

    const emit = function (kind, unionId, childId, d, extra) {
      const attrs =
        ' data-kind="' + kind + '" data-union="' + unionId + '"' +
        (childId ? ' data-child="' + childId + '"' : '');
      const cls =
        'edge' + (extra ? ' ' + extra : '') +
        (isEdgeSelected(kind, unionId, childId) ? ' selected' : '');
      visible.push('<path class="' + cls + '"' + attrs + ' d="' + d + '"/>');
      hits.push('<path class="edge-hit"' + attrs + ' d="' + d + '"/>');
    };

    FT.unionList().forEach(function (u) {
      const partners = u.partners
        .map(function (id) {
          return FT.state.people[id];
        })
        .filter(Boolean);
      if (!partners.length) return;

      let anchorX, anchorY;
      if (partners.length >= 2) {
        const a = partners[0];
        const b = partners[1];
        const crossGen = FT.isCrossGenerationUnion(u);
        const midY = (a.y + b.y) / 2 + FT.CARD_H / 2;
        const leftP = a.x <= b.x ? a : b;
        const rightP = a.x <= b.x ? b : a;
        const x1 = leftP.x + FT.CARD_W;
        const x2 = rightP.x;
        let d;

        if (crossGen) {
          // These two are rows apart, so the usual squared-off bar would stride
          // across whole generations and read as a mistake. A curve between the
          // facing edges reads as the deliberate, unusual link it is.
          const sx = x1;
          const sy = leftP.y + FT.CARD_H / 2;
          const ex = x2 > x1 ? x2 : rightP.x + FT.CARD_W;
          const ey = rightP.y + FT.CARD_H / 2;
          const bow = Math.max(70, Math.abs(ex - sx) / 2);
          d = 'M' + sx + ' ' + sy +
              'C' + (sx + bow) + ' ' + sy + ',' + (ex - bow) + ' ' + ey + ',' + ex + ' ' + ey;
          // A cubic with horizontal handles passes exactly through the midpoint
          // of its endpoints at t=0.5.
          anchorX = (sx + ex) / 2;
          anchorY = (sy + ey) / 2;
        } else if (x2 > x1) {
          d = 'M' + x1 + ' ' + (leftP.y + FT.CARD_H / 2) +
              'H' + (x1 + x2) / 2 + 'V' + midY +
              'H' + x2 + 'V' + (rightP.y + FT.CARD_H / 2);
          anchorX = (a.x + b.x) / 2 + FT.CARD_W / 2;
          anchorY = midY;
        } else {
          // Cards overlap horizontally — the bar would run backwards, so route
          // it underneath both instead.
          d = 'M' + (leftP.x + FT.CARD_W / 2) + ' ' + (leftP.y + FT.CARD_H) +
              'V' + (Math.max(a.y, b.y) + FT.CARD_H + 24) +
              'H' + (rightP.x + FT.CARD_W / 2) + 'V' + (rightP.y + FT.CARD_H);
          anchorX = (a.x + b.x) / 2 + FT.CARD_W / 2;
          anchorY = midY;
        }
        emit('partner', u.id, null, d, crossGen ? 'cross-gen' : '');
        edgeMids[edgeKey('partner', u.id, null)] = { x: anchorX, y: anchorY };
        marks.push({ x: anchorX, y: anchorY, crossGen: crossGen });
      } else {
        anchorX = partners[0].x + FT.CARD_W / 2;
        anchorY = partners[0].y + FT.CARD_H;
      }

      const children = u.children
        .map(function (id) {
          return FT.state.people[id];
        })
        .filter(Boolean);
      if (!children.length) return;

      const topChildY = Math.min.apply(null, children.map(function (c) { return c.y; }));
      const busY = Math.max(anchorY + 40, topChildY - 40);

      children.forEach(function (c) {
        const cx = c.x + FT.CARD_W / 2;
        const d = 'M' + anchorX + ' ' + anchorY + 'V' + busY + 'H' + cx + 'V' + c.y;
        emit('child', u.id, c.id, d, '');
        edgeMids[edgeKey('child', u.id, c.id)] = { x: (anchorX + cx) / 2, y: busY };
      });
    });

    const markSvg = marks.map(function (m) {
      return (
        '<path class="union-mark' + (m.crossGen ? ' cross-gen' : '') +
        '" d="M' + m.x + ' ' + (m.y - 6) +
        'L' + (m.x + 6) + ' ' + m.y +
        'L' + m.x + ' ' + (m.y + 6) +
        'L' + (m.x - 6) + ' ' + m.y + 'Z"/>'
      );
    });

    // Hit paths last so they sit on top and catch the clicks.
    edges.innerHTML = visible.join('') + markSvg.join('') + hits.join('');
  }

  // ------------------------------------------------------------- action pill

  function positionPill() {
    const p = FT.selected && FT.state.people[FT.selected];
    if (!p || FT.readOnly) {
      pill.hidden = true;
      return;
    }
    pill.hidden = false;
    const r = stage.getBoundingClientRect();
    const sx = view.x + (p.x + FT.CARD_W / 2) * view.z;
    const sy = view.y + p.y * view.z;
    pill.style.left = Math.round(r.left + sx) + 'px';
    pill.style.top = Math.round(r.top + sy - 14) + 'px';
  }

  function positionEdgePill() {
    const s = FT.selectedEdge;
    const mid = s && edgeMids[edgeKey(s.kind, s.unionId, s.childId)];
    if (!s || !mid || FT.readOnly) {
      edgePill.hidden = true;
      return;
    }
    edgePill.hidden = false;
    document.getElementById('edgeLabel').textContent = FT.edgeLabel(s);
    const r = stage.getBoundingClientRect();
    edgePill.style.left = Math.round(r.left + view.x + mid.x * view.z) + 'px';
    edgePill.style.top = Math.round(r.top + view.y + mid.y * view.z - 14) + 'px';
  }

  FT.select = function (id) {
    FT.selected = id;
    FT.selectedEdge = null;
    linkMode = null;
    stage.classList.remove('linking');
    FT.render();
  };

  FT.selectEdge = function (sel) {
    FT.selectedEdge = sel;
    FT.selected = null;
    linkMode = null;
    stage.classList.remove('linking');
    FT.render();
  };

  FT.beginLink = function (kind) {
    if (!FT.selected) return;
    linkMode = kind;
    stage.classList.add('linking');
    FT.emit('hint', {
      text:
        kind === 'partner'
          ? 'Click another person to join them as partners.'
          : 'Click another person to make them a child of this couple.',
    });
  };

  // ------------------------------------------------------------------ drag

  let drag = null;

  function alignmentTargets(exceptId) {
    const xs = [];
    const ys = [];
    FT.peopleList().forEach(function (p) {
      if (p.id === exceptId) return;
      xs.push(p.x);
      ys.push(p.y);
    });
    return { xs: xs, ys: ys };
  }

  /* Snap to the background grid, then let a nearby card's edge win if it is
     closer — that is what makes cards click into a row or column. */
  function snapWithGuides(x, y, targets) {
    let sx = FT.snap(x);
    let sy = FT.snap(y);
    let guideX = null;
    let guideY = null;

    let bestX = SNAP_RANGE;
    targets.xs.forEach(function (tx) {
      const d = Math.abs(x - tx);
      if (d < bestX) {
        bestX = d;
        sx = tx;
        guideX = tx;
      }
    });
    let bestY = SNAP_RANGE;
    targets.ys.forEach(function (ty) {
      const d = Math.abs(y - ty);
      if (d < bestY) {
        bestY = d;
        sy = ty;
        guideY = ty;
      }
    });
    return { x: sx, y: sy, guideX: guideX, guideY: guideY };
  }

  function showGuides(gx, gy) {
    let html = '';
    const b = FT.contentBounds();
    const pad = 400;
    if (gx !== null)
      html +=
        '<line class="guide" x1="' + (gx + FT.CARD_W / 2) + '" y1="' + (b.y - pad) +
        '" x2="' + (gx + FT.CARD_W / 2) + '" y2="' + (b.y + b.h + pad) + '"/>';
    if (gy !== null)
      html +=
        '<line class="guide" x1="' + (b.x - pad) + '" y1="' + (gy + FT.CARD_H / 2) +
        '" x2="' + (b.x + b.w + pad) + '" y2="' + (gy + FT.CARD_H / 2) + '"/>';
    guides.innerHTML = html;
  }

  stage.addEventListener('pointerdown', function (e) {
    // A line is a relationship: clicking one selects it so it can be removed.
    const edgeEl = e.target.closest && e.target.closest('[data-kind]');
    if (edgeEl && !FT.readOnly && !linkMode) {
      FT.selectEdge({
        kind: edgeEl.dataset.kind,
        unionId: edgeEl.dataset.union,
        childId: edgeEl.dataset.child || null,
      });
      return;
    }

    const cardEl = e.target.closest('.card');

    if (cardEl) {
      const id = cardEl.dataset.id;

      if (e.target.closest('.book-btn')) {
        FT.select(id);
        FT.openBook(id);
        return;
      }

      // Second click of a link gesture.
      if (linkMode && FT.selected && id !== FT.selected) {
        FT.checkpoint();
        const ok =
          linkMode === 'partner'
            ? FT.linkAsPartners(FT.selected, id)
            : FT.linkAsChild(FT.selected, id);
        linkMode = null;
        stage.classList.remove('linking');
        FT.emit('hint', {
          text: ok ? 'Linked.' : 'That link would tangle the tree — skipped.',
        });
        FT.save();
        FT.render();
        return;
      }

      FT.select(id);
      if (FT.readOnly) return;

      const p = FT.state.people[id];
      const start = screenToWorld(e.clientX, e.clientY);
      drag = {
        id: id,
        dx: start.x - p.x,
        dy: start.y - p.y,
        targets: alignmentTargets(id),
        moved: false,
      };
      cardEl.setPointerCapture(e.pointerId);
      cardEl.classList.add('dragging');
      return;
    }

    // Empty canvas: deselect and pan.
    if (linkMode) {
      linkMode = null;
      stage.classList.remove('linking');
    }
    FT.selectedEdge = null;
    FT.select(null);
    drag = {
      pan: true,
      sx: e.clientX,
      sy: e.clientY,
      ox: view.x,
      oy: view.y,
    };
    stage.classList.add('panning');
    stage.setPointerCapture(e.pointerId);
  });

  stage.addEventListener('pointermove', function (e) {
    if (!drag) return;

    if (drag.pan) {
      view.x = drag.ox + (e.clientX - drag.sx);
      view.y = drag.oy + (e.clientY - drag.sy);
      applyView();
      return;
    }

    const p = FT.state.people[drag.id];
    if (!p) return;
    const w = screenToWorld(e.clientX, e.clientY);
    const snapped = snapWithGuides(w.x - drag.dx, w.y - drag.dy, drag.targets);

    if (!drag.moved && (snapped.x !== p.x || snapped.y !== p.y)) {
      FT.checkpoint('drag:' + drag.id);
      drag.moved = true;
    }
    p.x = snapped.x;
    p.y = snapped.y;
    cards[p.id].style.transform = 'translate(' + p.x + 'px,' + p.y + 'px)';
    showGuides(snapped.guideX, snapped.guideY);
    drawEdges();
    positionPill();
    positionEdgePill();
  });

  function endDrag(e) {
    if (!drag) return;
    if (drag.pan) {
      stage.classList.remove('panning');
      try { stage.releasePointerCapture(e.pointerId); } catch (err) {}
    } else {
      const el = cards[drag.id];
      if (el) {
        el.classList.remove('dragging');
        try { el.releasePointerCapture(e.pointerId); } catch (err) {}
      }
      guides.innerHTML = '';
      if (drag.moved) FT.save();
    }
    drag = null;
  }

  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  stage.addEventListener('dblclick', function (e) {
    const cardEl = e.target.closest('.card');
    if (cardEl) FT.openBook(cardEl.dataset.id);
  });

  stage.addEventListener(
    'wheel',
    function (e) {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        FT.zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX, e.clientY);
      } else {
        e.preventDefault();
        view.x -= e.deltaX;
        view.y -= e.deltaY;
        applyView();
      }
    },
    { passive: false }
  );

  // ------------------------------------------------- drop a photo on a card

  function draggingFiles(e) {
    const dt = e.dataTransfer;
    if (!dt) return false;
    return Array.prototype.indexOf.call(dt.types || [], 'Files') >= 0;
  }

  let dropTarget = null;

  function markDropTarget(el) {
    if (dropTarget === el) return;
    if (dropTarget) dropTarget.classList.remove('drop-target');
    dropTarget = el;
    if (dropTarget) dropTarget.classList.add('drop-target');
  }

  stage.addEventListener('dragover', function (e) {
    if (FT.readOnly || !draggingFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const el = e.target.closest ? e.target.closest('.card') : null;
    markDropTarget(el);
  });

  stage.addEventListener('dragleave', function (e) {
    if (!e.relatedTarget || !stage.contains(e.relatedTarget)) markDropTarget(null);
  });

  stage.addEventListener('drop', function (e) {
    if (FT.readOnly || !draggingFiles(e)) return;
    e.preventDefault();
    const el = e.target.closest ? e.target.closest('.card') : null;
    markDropTarget(null);
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) return;
    if (!el) {
      FT.emit('hint', { text: 'Drop a photo onto a person’s card to use it as their portrait.' });
      return;
    }
    FT.setPhotoFrom(el.dataset.id, file);
  });

  /* Animate cards to their new homes after a tidy-up. */
  FT.animateArrange = function () {
    nodes.classList.add('settling');
    FT.render();
    setTimeout(function () {
      nodes.classList.remove('settling');
    }, 520);
  };

  FT.resetCards = function () {
    Object.keys(cards).forEach(function (id) {
      cards[id].remove();
    });
    cards = {};
  };

  window.addEventListener('resize', positionPill);
  applyView();
})();
