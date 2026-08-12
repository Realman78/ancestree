/* Heirloom — generational layout ("tidy up") engine.

   Two passes:
     1. generations()  assigns every person a row, so partners share a row and a
        child always sits one row below the lower of their parents.
     2. measure()/place() walk the family downward, sizing each subtree by the
        width of its descendants and centring parents over their children. */
(function () {
  const FT = window.FT;

  /* Row index per person. Iterative relaxation rather than a topological sort so
     that a malformed (cyclic) document degrades instead of hanging. */
  function generations() {
    const gen = {};
    FT.peopleList().forEach(function (p) {
      gen[p.id] = 0;
    });
    const unions = FT.unionList();
    for (let pass = 0; pass < 40; pass++) {
      let changed = false;
      unions.forEach(function (u) {
        // Partners live on the same row: pull both to the lower one.
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
        // Children sit one row below.
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

  /* Size a subtree rooted at `pid`. `seen` prevents a person being laid out
     twice when they are reachable by more than one path. */
  function measure(pid, seen) {
    if (seen[pid]) return null;
    seen[pid] = true;

    const partnerIds = [];
    const childBlocks = [];

    FT.unionsOf(pid).forEach(function (u) {
      u.partners.forEach(function (q) {
        if (q !== pid && !seen[q]) {
          seen[q] = true;
          partnerIds.push(q);
        }
      });
      u.children.forEach(function (c) {
        const block = measure(c, seen);
        if (block) childBlocks.push(block);
      });
    });

    const selfW = FT.CARD_W + partnerIds.length * (FT.SPOUSE_GAP + FT.CARD_W);
    const childW = childBlocks.reduce(function (sum, b) {
      return sum + b.w;
    }, 0) + Math.max(0, childBlocks.length - 1) * FT.SIB_GAP;

    return {
      pid: pid,
      partnerIds: partnerIds,
      childBlocks: childBlocks,
      selfW: selfW,
      w: Math.max(selfW, childW),
      childW: childW,
    };
  }

  /* Assign x positions: the couple is centred in its own block, and the block's
     children are centred underneath it. */
  function place(block, left, xs) {
    const selfLeft = left + (block.w - block.selfW) / 2;
    xs[block.pid] = selfLeft;
    block.partnerIds.forEach(function (q, i) {
      xs[q] = selfLeft + (i + 1) * (FT.CARD_W + FT.SPOUSE_GAP);
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
      const block = measure(root.id, seen);
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
