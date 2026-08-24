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
  let renamingId = null; // a card whose name is being typed straight on the canvas

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
    const nameEl =
      renamingId === p.id
        ? '<input class="name name-edit" value="' + FT.escapeHtml(p.name) +
          '" aria-label="Name" spellcheck="false">'
        : '<div class="name">' + FT.escapeHtml(p.name) + '</div>';
    return (
      avatar +
      '<div class="meta">' +
        nameEl +
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
        renamingId === p.id ? 'edit' : '',
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

  /* Where two connectors cross, the one running horizontally arcs over the
     other — the drafting convention, which reads as "these do not meet" without
     needing a legend the way a second colour would.

     Only genuine crossings count: segments belonging to one union share their
     route by design, and two lines merely meeting end-to-end are a junction,
     not a crossing. */
  const HOP_R = 5;
  const HOP_EPS = 1.5;

  function addHops(edges) {
    // Every pair of segments is compared, so stop before that gets expensive on
    // a very large tree; the drawing is unreadable at that size regardless.
    if (edges.length > 500) return;

    const routes = edges.map(function (e) {
      if (!e.pts) return null;
      const segs = [];
      for (let i = 0; i + 1 < e.pts.length; i++) segs.push([e.pts[i], e.pts[i + 1]]);
      return segs;
    });
    const hops = edges.map(function () {
      return {};
    });

    const isFlat = function (seg) {
      return Math.abs(seg[0][1] - seg[1][1]) < 0.01;
    };
    const isUpright = function (seg) {
      return Math.abs(seg[0][0] - seg[1][0]) < 0.01;
    };

    edges.forEach(function (a, i) {
      if (!routes[i]) return;
      routes[i].forEach(function (seg, si) {
        if (!isFlat(seg)) return;
        const y = seg[0][1];
        const lo = Math.min(seg[0][0], seg[1][0]);
        const hi = Math.max(seg[0][0], seg[1][0]);
        edges.forEach(function (b, j) {
          if (i === j || !routes[j] || a.unionId === b.unionId) return;
          routes[j].forEach(function (other) {
            if (!isUpright(other)) return;
            const x = other[0][0];
            const top = Math.min(other[0][1], other[1][1]);
            const bot = Math.max(other[0][1], other[1][1]);
            // Leave room for the arc, and ignore lines that only touch.
            if (x <= lo + HOP_R + 1 || x >= hi - HOP_R - 1) return;
            if (y <= top + HOP_EPS || y >= bot - HOP_EPS) return;
            const list = (hops[i][si] = hops[i][si] || []);
            if (!list.some(function (v) {
              return Math.abs(v - x) < 2;
            })) list.push(x);
          });
        });
      });
    });

    edges.forEach(function (e, i) {
      if (e.pts) e.d = routeToPath(e.pts, hops[i]);
    });
  }

  function routeToPath(pts, hops) {
    let d = 'M' + pts[0][0] + ' ' + pts[0][1];
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const list = hops && hops[i];
      if (list && list.length) {
        const dir = b[0] > a[0] ? 1 : -1;
        list
          .slice()
          .sort(function (p, q) {
            return dir * (p - q);
          })
          .forEach(function (x) {
            d += 'L' + (x - HOP_R * dir) + ' ' + a[1];
            // Sweep chosen so the bump always rises, whichever way the line runs.
            d += 'A' + HOP_R + ' ' + HOP_R + ' 0 0 ' + (dir > 0 ? 1 : 0) +
              ' ' + (x + HOP_R * dir) + ' ' + a[1];
          });
      }
      d += 'L' + b[0] + ' ' + b[1];
    }
    return d;
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

    // --- pass 1: where each union hangs from, and how wide its bus must be ---
    const plan = [];
    FT.unionList().forEach(function (u) {
      const partners = u.partners
        .map(function (id) {
          return people[id];
        })
        .filter(Boolean);
      if (!partners.length) return;

      const children = u.children
        .map(function (id) {
          return people[id];
        })
        .filter(Boolean);

      const e = { u: u, partners: partners, children: children };

      if (partners.length >= 2) {
        const a = partners[0];
        const b = partners[1];
        e.crossGen = FT.isCrossGenerationUnion(u);
        const midY = (a.y + b.y) / 2 + CARD_H / 2;
        const leftP = a.x <= b.x ? a : b;
        const rightP = a.x <= b.x ? b : a;
        const x1 = leftP.x + CARD_W;
        const x2 = rightP.x;

        if (e.crossGen) {
          // Rows apart: a squared-off bar would stride across whole generations
          // and read as a mistake, so curve between the facing edges instead.
          const sx = x1;
          const sy = leftP.y + CARD_H / 2;
          const ex = x2 > x1 ? x2 : rightP.x + CARD_W;
          const ey = rightP.y + CARD_H / 2;
          const bow = Math.max(70, Math.abs(ex - sx) / 2);
          e.curve =
            'M' + sx + ' ' + sy +
            'C' + (sx + bow) + ' ' + sy + ',' + (ex - bow) + ' ' + ey + ',' + ex + ' ' + ey;
          // A cubic with horizontal handles passes through the midpoint of its
          // endpoints at t=0.5.
          e.anchorX = (sx + ex) / 2;
          e.anchorY = (sy + ey) / 2;
          e.labelY = e.anchorY - 12;
        } else if (x2 > x1 && !blocked(leftP, rightP)) {
          e.pts = [
            [x1, leftP.y + CARD_H / 2],
            [(x1 + x2) / 2, leftP.y + CARD_H / 2],
            [(x1 + x2) / 2, midY],
            [x2, midY],
            [x2, rightP.y + CARD_H / 2],
          ];
          e.anchorX = (a.x + b.x) / 2 + CARD_W / 2;
          e.anchorY = midY;
          // Beside the line there is only the gap between two cards, and the
          // edges are painted behind them — so anything longer than that gets
          // clipped. Caption it in the open space just below instead.
          e.labelY = Math.max(a.y, b.y) + CARD_H + 15;
        } else {
          // Either the cards overlap (the bar would run backwards) or somebody
          // is sitting between them. Take the connector under the row so it
          // visibly goes around rather than hiding behind.
          const underY = Math.max(a.y, b.y) + CARD_H + 26;
          e.pts = [
            [leftP.x + CARD_W / 2, leftP.y + CARD_H],
            [leftP.x + CARD_W / 2, underY],
            [rightP.x + CARD_W / 2, underY],
            [rightP.x + CARD_W / 2, rightP.y + CARD_H],
          ];
          e.anchorX = (leftP.x + rightP.x) / 2 + CARD_W / 2;
          e.anchorY = underY;
          e.labelY = underY + 15;
        }
      } else {
        e.anchorX = partners[0].x + CARD_W / 2;
        e.anchorY = partners[0].y + CARD_H;
      }

      if (children.length) {
        const centres = children.map(function (c) {
          return c.x + CARD_W / 2;
        });
        e.topChildY = Math.min.apply(null, children.map(function (c) {
          return c.y;
        }));
        e.busMin = Math.min.apply(null, centres.concat([e.anchorX]));
        e.busMax = Math.max.apply(null, centres.concat([e.anchorX]));
      }
      plan.push(e);
    });

    // --- pass 2: give overlapping buses their own depth ---------------------
    /* Two couples whose children sit on the same row will otherwise drop onto
       buses at exactly the same height. Where those buses also overlap left to
       right they merge into one line, and every child hanging off either of
       them looks like it belongs to whichever couple you happen to trace back
       to. A married-in child makes this routine: their parents' bus has to
       reach across the whole chart to collect them.

       So pack the buses into lanes per row, like non-overlapping intervals. */
    const CLEAR = 10;
    const LANE_H = 22;
    const byRow = {};
    plan.forEach(function (e) {
      if (e.topChildY === undefined) return;
      (byRow[e.topChildY] = byRow[e.topChildY] || []).push(e);
    });
    Object.keys(byRow).forEach(function (row) {
      const laneEnd = [];
      byRow[row]
        .slice()
        .sort(function (a, b) {
          return a.busMin - b.busMin || a.busMax - b.busMax;
        })
        .forEach(function (e) {
          let lane = 0;
          while (lane < laneEnd.length && laneEnd[lane] > e.busMin - CLEAR) lane++;
          laneEnd[lane] = e.busMax;
          e.lane = lane;
        });
    });

    // --- pass 3: emit -------------------------------------------------------
    const out = [];
    plan.forEach(function (e) {
      const u = e.u;
      let busY = 0;
      if (e.topChildY !== undefined) {
        busY = Math.max(e.anchorY + 28, e.topChildY - 40 - (e.lane || 0) * LANE_H);
      }
      // The drop from the couple down to their bus belongs to the union, so it
      // is part of what you grab when you click the relationship.
      const trunk =
        e.children.length && e.partners.length >= 2
          ? 'M' + e.anchorX + ' ' + e.anchorY + 'V' + busY
          : '';

      if (e.partners.length >= 2) {
        const d = e.curve || routeToPath(e.pts, null);
        out.push({
          kind: 'partner',
          unionId: u.id,
          childId: null,
          d: d,
          pts: e.pts || null,
          hitExtra: trunk,
          crossGen: !!e.crossGen,
          status: u.status,
          label: FT.unionLabel(u),
          labelPos: { x: e.anchorX, y: e.labelY },
          mark: { x: e.anchorX, y: e.anchorY },
          mid: { x: e.anchorX, y: e.anchorY },
        });
      }

      e.children.forEach(function (c) {
        const cx = c.x + CARD_W / 2;
        // Only the part of the route unique to this child can be clicked: every
        // child of a union shares the trunk and part of the bus, so hit targets
        // built from the whole route sat on top of one another and the same
        // child answered for all of them.
        const towards = cx >= e.anchorX ? -1 : 1;
        const stub = Math.min(18, Math.abs(cx - e.anchorX));
        out.push({
          kind: 'child',
          unionId: u.id,
          childId: c.id,
          crossGen: false,
          status: u.status,
          label: '',
          mark: null,
          pts: [[e.anchorX, e.anchorY], [e.anchorX, busY], [cx, busY], [cx, c.y]],
          hitD: 'M' + (cx + towards * stub) + ' ' + busY + 'H' + cx + 'V' + c.y,
          mid: { x: (e.anchorX + cx) / 2, y: busY },
        });
      });
    });

    addHops(out);
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
      hits.push(
        '<path class="edge-hit"' + attrs + ' d="' +
          (e.hitD || e.d) + (e.hitExtra || '') + '"/>'
      );
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

  /* Name a card in place. New people arrive called "Child" or "New person", and
     making that immediately typeable beats sending everyone into the book. */
  FT.beginRename = function (id) {
    if (!FT.state.people[id]) return;
    renamingId = id;
    FT.render();
    const el = cards[id] && cards[id].querySelector('.name-edit');
    if (!el) return;
    el.focus();
    el.select();
  };

  FT.endRename = function () {
    if (!renamingId) return;
    renamingId = null;
    FT.render();
  };

  FT.isRenaming = function () {
    return renamingId;
  };

  // Typing must not start a drag, and clicking into the field must not deselect.
  nodes.addEventListener('pointerdown', function (e) {
    if (e.target.classList && e.target.classList.contains('name-edit')) e.stopPropagation();
  });

  nodes.addEventListener('input', function (e) {
    if (!e.target.classList || !e.target.classList.contains('name-edit')) return;
    const p = FT.state.people[renamingId];
    if (!p) return;
    FT.checkpoint('rename:' + renamingId);
    p.name = e.target.value;
    // Update what depends on the name without rebuilding the field underneath it.
    const card = cards[renamingId];
    const initials = card && card.querySelector('.initials');
    if (initials) initials.textContent = FT.initials(p.name);
    FT.save();
  });

  nodes.addEventListener('keydown', function (e) {
    if (!e.target.classList || !e.target.classList.contains('name-edit')) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      FT.endRename();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      FT.undo();
      FT.endRename();
    }
    e.stopPropagation(); // Del and the single-key shortcuts are for the canvas
  });

  nodes.addEventListener('focusout', function (e) {
    if (!e.target.classList || !e.target.classList.contains('name-edit')) return;
    // Rebuilding the card inside the blur handler pulls the node out from under
    // the browser mid-event, so let the event finish first.
    setTimeout(function () {
      const el = cards[renamingId] && cards[renamingId].querySelector('.name-edit');
      if (!el || document.activeElement !== el) FT.endRename();
    }, 0);
  });

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
