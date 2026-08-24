/* Ancestree — generational layout ("tidy up") engine.

   Two passes:
     1. generations()  assigns every person a row, so partners share a row and a
        child always sits one row below the lower of their parents.
     2. measure()/place() walk the family downward, sizing each subtree by the
        width of its descendants and centring parents over their children. */
(function () {
  const FT = window.FT;

  const MAX_PASSES = 200;

  /* Rows from ancestry alone: a child always sits below every parent. The
     parent-child graph is acyclic (linkAsChild refuses loops), so this settles. */
  function ancestryRows() {
    const gen = {};
    FT.peopleList().forEach(function (p) {
      gen[p.id] = 0;
    });
    const unions = FT.unionList();
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      let changed = false;
      unions.forEach(function (u) {
        let top = 0;
        u.partners.forEach(function (pid) {
          top = Math.max(top, gen[pid] || 0);
        });
        u.children.forEach(function (cid) {
          if ((gen[cid] || 0) < top + 1) {
            gen[cid] = top + 1;
            changed = true;
          }
        });
      });
      if (!changed) break;
    }
    return gen;
  }

  /* Then pull couples onto a shared row where that is possible.

     It is not always possible. If a couple are also ancestor and descendant of
     one another — someone partnered with a grandchild, say — then levelling
     them pushes the descendant down, which pushes the ancestor down to match,
     forever. The old single-pass version did exactly that and drove the whole
     tree thousands of pixels down the canvas before the pass cap stopped it.

     So: skip alignment for an ancestrally-related couple, and if the pass still
     fails to settle (possible for longer loops through several unions), give up
     on alignment altogether rather than return a runaway layout. */
  function alignPartners(gen) {
    const unions = FT.unionList();
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      let changed = false;
      unions.forEach(function (u) {
        if (u.partners.length >= 2 && !FT.ancestrallyRelated(u.partners[0], u.partners[1])) {
          let top = 0;
          u.partners.forEach(function (pid) {
            top = Math.max(top, gen[pid] || 0);
          });
          u.partners.forEach(function (pid) {
            if (gen[pid] !== top) {
              gen[pid] = top;
              changed = true;
            }
          });
        }
        let top = 0;
        u.partners.forEach(function (pid) {
          top = Math.max(top, gen[pid] || 0);
        });
        u.children.forEach(function (cid) {
          if ((gen[cid] || 0) < top + 1) {
            gen[cid] = top + 1;
            changed = true;
          }
        });
      });
      if (!changed) return gen;
    }
    return null; // did not settle
  }

  function generations() {
    const base = ancestryRows();
    return alignPartners(Object.assign({}, base)) || base;
  }

  /* Partners who could not be levelled onto one row. The renderer draws these
     differently so they read as a deliberate cross-generation link. */
  FT.isCrossGenerationUnion = function (u) {
    return u.partners.length >= 2 && FT.ancestrallyRelated(u.partners[0], u.partners[1]);
  };

  /* Everyone joined to `pid` by partnership, on the same row.

     Laying out one union at a time was not enough: a person absorbed as
     somebody's partner took their *other* spouses with them nowhere, so those
     spouses were placed as separate blocks and an unrelated card could end up
     sitting between a couple. Two people side by side read as married, so that
     was not merely untidy — the drawing said something untrue.

     Take the whole partnership component instead, and order it as a path so
     each couple lands adjacent wherever the shape allows. A chain (A–B, B–C)
     orders A, B, C exactly; a star (one person, three spouses) can only seat
     two of them adjacent, and the renderer routes the reaching one around. */
  function spouseCluster(pid, seen, gen) {
    const inSet = {};
    const members = [];
    const queue = [pid];
    while (queue.length) {
      const cur = queue.shift();
      if (inSet[cur] || seen[cur]) continue;
      inSet[cur] = true;
      members.push(cur);
      FT.partnersOf(cur).forEach(function (q) {
        if (!inSet[q] && !seen[q] && gen[q] === gen[cur]) queue.push(q);
      });
    }
    if (members.length < 3) return members;

    const nbr = {};
    members.forEach(function (m) {
      nbr[m] = FT.partnersOf(m).filter(function (q) {
        return inSet[q];
      });
    });

    // Start at an end of the chain if there is one, then always step to the
    // most constrained neighbour so leaves are consumed before hubs.
    const used = {};
    const order = [];
    let cur =
      members.find(function (m) {
        return nbr[m].length === 1;
      }) || members[0];

    while (cur) {
      order.push(cur);
      used[cur] = true;
      let next = null;
      let bestDeg = Infinity;
      nbr[cur].forEach(function (q) {
        if (used[q]) return;
        const deg = nbr[q].filter(function (x) {
          return !used[x];
        }).length;
        if (deg < bestDeg) {
          bestDeg = deg;
          next = q;
        }
      });
      if (!next) {
        next =
          members.find(function (m) {
            return !used[m];
          }) || null;
      }
      cur = next;
    }
    return order;
  }

  /* Size a subtree rooted at the spouse cluster containing `pid`. `seen`
     prevents a person being laid out twice when reachable by more than one
     path. */
  function measure(pid, seen, gen) {
    if (seen[pid]) return null;

    const cluster = spouseCluster(pid, seen, gen);
    if (!cluster.length) return null;
    // Mark the whole cluster before recursing, so a descendant cannot claim one
    // of these people as part of its own block.
    cluster.forEach(function (id) {
      seen[id] = true;
    });

    const pos = {};
    cluster.forEach(function (id, i) {
      pos[id] = i;
    });

    // Every union among these people, ordered to follow them left to right so
    // each family's children sit under the right parents.
    const taken = {};
    const unions = [];
    cluster.forEach(function (id) {
      FT.unionsOf(id).forEach(function (u) {
        if (taken[u.id]) return;
        taken[u.id] = true;
        unions.push(u);
      });
    });
    const seat = function (u) {
      const seats = u.partners
        .map(function (p) {
          return pos[p];
        })
        .filter(function (n) {
          return n !== undefined;
        });
      if (!seats.length) return 0;
      return seats.reduce(function (a, b) {
        return a + b;
      }, 0) / seats.length;
    };
    unions.sort(function (a, b) {
      return seat(a) - seat(b);
    });

    const childBlocks = [];
    unions.forEach(function (u) {
      u.children.forEach(function (c) {
        const block = measure(c, seen, gen);
        if (block) childBlocks.push(block);
      });
    });

    const selfW =
      cluster.length * FT.CARD_W + (cluster.length - 1) * FT.SPOUSE_GAP;
    const childW =
      childBlocks.reduce(function (sum, b) {
        return sum + b.w;
      }, 0) + Math.max(0, childBlocks.length - 1) * FT.SIB_GAP;

    return {
      cluster: cluster,
      childBlocks: childBlocks,
      selfW: selfW,
      w: Math.max(selfW, childW),
      childW: childW,
    };
  }

  /* Assign x positions: the cluster is centred in its own block, and the
     block's children are centred underneath it. */
  function place(block, left, xs) {
    const selfLeft = left + (block.w - block.selfW) / 2;
    block.cluster.forEach(function (id, i) {
      xs[id] = selfLeft + i * (FT.CARD_W + FT.SPOUSE_GAP);
    });

    let cx = left + (block.w - block.childW) / 2;
    block.childBlocks.forEach(function (cb) {
      place(cb, cx, xs);
      cx += cb.w + FT.SIB_GAP;
    });
  }

  /* Recompute every card position. Mutates the document. */
  FT.autoArrange = function () {
    const gen = generations();
    const people = FT.peopleList();
    if (!people.length) return;

    // Roots first (nobody above them), each root family placed left to right.
    // Keeping the existing left-to-right order makes tidying feel stable rather
    // than shuffling the whole tree every time.
    const roots = people
      .filter(function (p) {
        return !FT.parentUnionOf(p.id);
      })
      .sort(function (a, b) {
        return (gen[a.id] - gen[b.id]) || (a.x - b.x) || a.name.localeCompare(b.name);
      });

    const seen = {};
    const xs = {};
    let cursor = 0;

    roots.forEach(function (root) {
      const block = measure(root.id, seen, gen);
      if (!block) return;
      place(block, cursor, xs);
      cursor += block.w + FT.ROOT_GAP;
    });

    // Anyone unreachable from a root (only possible in a cyclic document) gets
    // parked in a row underneath rather than being silently left overlapping.
    let maxGen = 0;
    Object.keys(gen).forEach(function (id) {
      maxGen = Math.max(maxGen, gen[id]);
    });
    let strayX = 0;
    people.forEach(function (p) {
      if (xs[p.id] === undefined) {
        xs[p.id] = strayX;
        gen[p.id] = maxGen + 1;
        strayX += FT.CARD_W + FT.SIB_GAP;
      }
    });

    people.forEach(function (p) {
      p.x = FT.snap(xs[p.id]);
      p.y = FT.snap(gen[p.id] * FT.ROW_H);
    });
  };

  /* Bounding box of all cards, in world coordinates. */
  FT.contentBounds = function () {
    const people = FT.peopleList();
    if (!people.length) return { x: 0, y: 0, w: FT.CARD_W, h: FT.CARD_H };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    people.forEach(function (p) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + FT.CARD_W);
      maxY = Math.max(maxY, p.y + FT.CARD_H);
    });
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  };
})();
