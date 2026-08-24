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
    FT.emit('zoom', { z: view.z });
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

  FT.zoomTo = function (z) {
    const r = stage.getBoundingClientRect();
    const next = Math.min(2.5, Math.max(0.25, z));
    // Keep the centre of the view fixed.
    view.x = r.width / 2 - ((r.width / 2 - view.x) / view.z) * next;
    view.y = r.height / 2 - ((r.height / 2 - view.y) / view.z) * next;
    view.z = next;
    applyView();
  };

  FT.zoomLevel = function () {
    return view.z;
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
      : '<div class="avatar"><span class="initials">' +
        FT.escapeHtml(FT.initials(p.name)) + '</span></div>';
    return (
      avatar +
      '<div class="meta">' +
        '<div class="name">' + FT.escapeHtml(p.name) + '</div>' +
        (FT.bornAs(p)
          ? '<div class="born" title="' + FT.escapeHtml(FT.bornAs(p)) + '">' +
            FT.escapeHtml(FT.bornAs(p)) + '</div>'
          : '') +
        '<div class="dates">' + FT.escapeHtml(FT.lifespan(p)) + '</div>' +
      '</div>' +
      '<button class="book-btn" title="Open life book" aria-label="Open life book">' +
        '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">' +
          '<path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H19v16H5.5A1.5 1.5 0 0 0 4 20.5z" ' +
            'fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>' +
          '<path d="M8 7.5h7M8 11h7" stroke="currentColor" stroke-width="1.5" ' +
            'stroke-linecap="round"/>' +
        '</svg>' +
      '</button>'
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
        p.name, p.birth, p.death, p.gender, p.birthSurname,
        p.photo.length, p.photo.slice(-24),
      ].join('');
      if (el.dataset.sig !== sig) {
        el.innerHTML = cardHtml(p);
        el.dataset.sig = sig;
      }
      el.style.transform = 'translate(' + p.x + 'px,' + p.y + 'px)';
      el.dataset.gender = p.gender;
      el.classList.toggle('selected', FT.selected === p.id);

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

  /* The geometry of every relationship, shared by the canvas renderer and the
     SVG exports so a downloaded drawing matches what is on screen.

     `layout` lets a caller supply its own positions and card size — the
     detailed export draws much larger cards on a scaled-up copy of the same
     arrangement, and needs connectors that match. */
  FT.edgeGeometry = function (layout) {
    const lay = layout || {};
    const people = lay.people || FT.state.people;
    const CARD_W = lay.cardW || FT.CARD_W;
    const CARD_H = lay.cardH || FT.CARD_H;
    const out = [];

    /* Two families from the same parent would otherwise drop onto one bus at
       the same depth and read as a single set of siblings. Give each union its
       own depth, ordered by when it began. */
    const depth = {};
    Object.keys(FT.state.people).forEach(function (pid) {
      FT.sortUnions(FT.unionsOf(pid)).forEach(function (u, i) {
        depth[u.id] = Math.max(depth[u.id] || 0, i);
      });
    });

    /* Is another card parked between these two? Then a straight bar between
       them would pass behind it, and the pair would look unrelated while the
       card in the middle looked married to one of them. */
    const blocked = function (leftP, rightP) {
      const x1 = leftP.x + CARD_W;
      const x2 = rightP.x;
      return Object.keys(people).some(function (id) {
        const q = people[id];
        if (q === leftP || q === rightP) return false;
        if (Math.abs(q.y - leftP.y) >= CARD_H) return false;
        return q.x + CARD_W > x1 && q.x < x2;
      });
    };

    FT.unionList().forEach(function (u) {
      const partners = u.partners
        .map(function (id) {
          return people[id];
        })
        .filter(Boolean);
      if (!partners.length) return;

      let anchorX, anchorY;
      let labelY = 0;
      let crossGen = false;

      if (partners.length >= 2) {
        const a = partners[0];
        const b = partners[1];
        crossGen = FT.isCrossGenerationUnion(u);
        const midY = (a.y + b.y) / 2 + CARD_H / 2;
        const leftP = a.x <= b.x ? a : b;
        const rightP = a.x <= b.x ? b : a;
        const x1 = leftP.x + CARD_W;
        const x2 = rightP.x;
        let d;

        if (crossGen) {
          // Rows apart: a squared-off bar would stride across whole generations
          // and read as a mistake, so curve between the facing edges instead.
          const sx = x1;
          const sy = leftP.y + CARD_H / 2;
          const ex = x2 > x1 ? x2 : rightP.x + CARD_W;
          const ey = rightP.y + CARD_H / 2;
          const bow = Math.max(70, Math.abs(ex - sx) / 2);
          d = 'M' + sx + ' ' + sy +
              'C' + (sx + bow) + ' ' + sy + ',' + (ex - bow) + ' ' + ey + ',' + ex + ' ' + ey;
          // A cubic with horizontal handles passes through the midpoint of its
          // endpoints at t=0.5.
          anchorX = (sx + ex) / 2;
          anchorY = (sy + ey) / 2;
          labelY = anchorY - 12;
        } else if (x2 > x1 && !blocked(leftP, rightP)) {
          d = 'M' + x1 + ' ' + (leftP.y + CARD_H / 2) +
              'H' + (x1 + x2) / 2 + 'V' + midY +
              'H' + x2 + 'V' + (rightP.y + CARD_H / 2);
          anchorX = (a.x + b.x) / 2 + CARD_W / 2;
          anchorY = midY;
          // Beside the line there is only the gap between two cards, and the
          // edges are painted behind them — so anything longer than that gets
          // clipped. Caption it in the open space just below instead.
          labelY = Math.max(a.y, b.y) + CARD_H + 15;
        } else {
          // Either the cards overlap (the bar would run backwards) or somebody
          // is sitting between them. Take the connector under the row so it
          // visibly goes around rather than hiding behind.
          const underY =
            Math.max(a.y, b.y) + CARD_H + 26 + (depth[u.id] || 0) * 14;
          d = 'M' + (leftP.x + CARD_W / 2) + ' ' + (leftP.y + CARD_H) +
              'V' + underY +
              'H' + (rightP.x + CARD_W / 2) + 'V' + (rightP.y + CARD_H);
          anchorX = (leftP.x + rightP.x) / 2 + CARD_W / 2;
          anchorY = underY;
          labelY = underY + 15;
        }

        out.push({
          kind: 'partner', unionId: u.id, childId: null, d: d, crossGen: crossGen,
          status: u.status, label: FT.unionLabel(u),
          labelPos: { x: anchorX, y: labelY },
          mark: { x: anchorX, y: anchorY }, mid: { x: anchorX, y: anchorY },
        });
      } else {
        anchorX = partners[0].x + CARD_W / 2;
        anchorY = partners[0].y + CARD_H;
      }

      const children = u.children
        .map(function (id) {
          return people[id];
        })
        .filter(Boolean);
      if (!children.length) return;

      const topChildY = Math.min.apply(null, children.map(function (c) { return c.y; }));
      // Each union's children ride their own bus, so two families from one
      // parent stay visibly separate.
      const lift = (depth[u.id] || 0) * 18;
      const busY = Math.max(anchorY + 28, topChildY - 40 - lift);

      children.forEach(function (c) {
        const cx = c.x + CARD_W / 2;
        out.push({
          kind: 'child',
          unionId: u.id,
          childId: c.id,
          crossGen: false,
          status: u.status,
          label: '',
          mark: null,
          d: 'M' + anchorX + ' ' + anchorY + 'V' + busY + 'H' + cx + 'V' + c.y,
          mid: { x: (anchorX + cx) / 2, y: busY },
        });
      });
    });

    return out;
  };

  function drawEdges() {
    const visible = [];
    const hits = [];
    const marks = [];
    edgeMids = {};

    const labels = [];

    FT.edgeGeometry().forEach(function (e) {
      const attrs =
        ' data-kind="' + e.kind + '" data-union="' + e.unionId + '"' +
        (e.childId ? ' data-child="' + e.childId + '"' : '');
      const cls =
        'edge' + (e.crossGen ? ' cross-gen' : '') +
        (e.status === 'partners' ? ' unwed' : '') +
        (isEdgeSelected(e.kind, e.unionId, e.childId) ? ' selected' : '');
      visible.push('<path class="' + cls + '"' + attrs + ' d="' + e.d + '"/>');
      hits.push('<path class="edge-hit"' + attrs + ' d="' + e.d + '"/>');
      edgeMids[edgeKey(e.kind, e.unionId, e.childId)] = e.mid;
      if (e.mark) {
        marks.push({
          x: e.mark.x, y: e.mark.y, crossGen: e.crossGen, status: e.status,
        });
      }
      if (e.label && e.labelPos) {
        labels.push(
          '<text class="union-label" x="' + e.labelPos.x + '" y="' + e.labelPos.y +
            '" text-anchor="middle">' + FT.escapeHtml(e.label) + '</text>'
        );
      }
    });

    const markSvg = marks.map(function (m) {
      let svg =
        '<path class="union-mark' + (m.crossGen ? ' cross-gen' : '') +
        '" d="M' + m.x + ' ' + (m.y - 6) +
        'L' + (m.x + 6) + ' ' + m.y +
        'L' + m.x + ' ' + (m.y + 6) +
        'L' + (m.x - 6) + ' ' + m.y + 'Z"/>';
      // The genealogical mark for a relationship that ended: two slashes.
      if (m.status === 'ended') {
        svg +=
          '<path class="union-break" d="M' + (m.x + 9) + ' ' + (m.y - 7) +
            'L' + (m.x + 4) + ' ' + (m.y + 7) +
            'M' + (m.x + 15) + ' ' + (m.y - 7) +
            'L' + (m.x + 10) + ' ' + (m.y + 7) + '"/>';
      }
      return svg;
    });

    // Hit paths last so they sit on top and catch the clicks.
    edges.innerHTML =
      visible.join('') + markSvg.join('') + labels.join('') + hits.join('');
  }

  // ------------------------------------------------------------- action pill

  function positionPill() {
    const p = FT.selected && FT.state.people[FT.selected];
    if (!p) {
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
    if (!s || !mid) {
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
    FT.emit('edgeselect', { sel: null });
    FT.render();
  };

  FT.selectEdge = function (sel) {
    FT.selectedEdge = sel;
    FT.selected = null;
    linkMode = null;
    stage.classList.remove('linking');
    // Once, on selection — not on every render, which would fight the typing.
    FT.emit('edgeselect', { sel: sel });
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
    if (edgeEl && !linkMode) {
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
    if (!draggingFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const el = e.target.closest ? e.target.closest('.card') : null;
    markDropTarget(el);
  });

  stage.addEventListener('dragleave', function (e) {
    if (!e.relatedTarget || !stage.contains(e.relatedTarget)) markDropTarget(null);
  });

  stage.addEventListener('drop', function (e) {
    if (!draggingFiles(e)) return;
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
