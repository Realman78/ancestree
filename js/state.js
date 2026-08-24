/* Ancestree — shared state, persistence, undo.
   Everything hangs off window.FT so the app runs from file:// with no build step. */
(function () {
  const FT = (window.FT = window.FT || {});

  // --- geometry constants, shared by the tree renderer and the layout engine ---
  FT.GRID = 20;
  FT.CARD_W = 180;
  FT.CARD_H = 92;
  FT.ROW_H = 200;      // vertical distance between generations
  FT.SPOUSE_GAP = 60;  // horizontal gap between partners in a union
  FT.SIB_GAP = 40;     // horizontal gap between sibling subtrees
  FT.ROOT_GAP = 100;   // gap between unrelated root families

  FT.uid = function (prefix) {
    return prefix + Math.random().toString(36).slice(2, 9);
  };

  FT.snap = function (n) {
    return Math.round(n / FT.GRID) * FT.GRID;
  };

  FT.clone = function (o) {
    return JSON.parse(JSON.stringify(o));
  };

  FT.escapeHtml = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  FT.initials = function (name) {
    const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  FT.isIsoDate = function (v) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
  };

  /* Cards only have room for years. Handles both a picked date and any free
     text left over from before Born/Died were date pickers. */
  FT.yearOf = function (v) {
    const s = String(v == null ? '' : v).trim();
    if (!s) return '';
    const iso = /^(\d{4})-\d{2}-\d{2}$/.exec(s);
    if (iso) return iso[1];
    const loose = /(\d{4})/.exec(s);
    return loose ? loose[1] : s;
  };

  /* Relationship years are typed into small boxes, so keep them to digits and
     a plausible range rather than accepting anything at all. Returns '' for
     nothing usable, so a half-typed "19" simply reads as no date yet. */
  FT.MIN_YEAR = 1;
  FT.MAX_YEAR = 2999;

  FT.cleanYear = function (v) {
    const digits = String(v == null ? '' : v).replace(/[^0-9]/g, '').slice(0, 4);
    return digits;
  };

  FT.isUsableYear = function (v) {
    const n = Number(v);
    return /^[0-9]{3,4}$/.test(String(v)) && n >= FT.MIN_YEAR && n <= FT.MAX_YEAR;
  };

  /* "14 March 1921". Free text is passed through untouched. */
  FT.prettyDate = function (iso) {
    if (!iso) return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
    if (!m) return String(iso);
    const months = ['January','February','March','April','May','June','July',
                    'August','September','October','November','December'];
    return Number(m[3]) + ' ' + months[Number(m[2]) - 1] + ' ' + m[1];
  };

  /* "born Marić" — shown when someone took a different surname on marrying.
     Deliberately not "née": that is feminine, and this happens either way. */
  FT.bornAs = function (p) {
    const v = String((p && p.birthSurname) || '').trim();
    return v ? 'born ' + v : '';
  };

  FT.lifespan = function (p) {
    const b = FT.yearOf(p.birth);
    const d = FT.yearOf(p.death);
    if (!b && !d) return '';
    if (b && d) return b + ' – ' + d;
    if (b) return b + ' –';
    return '– ' + d;
  };

  // --- model constructors -------------------------------------------------

  FT.newPerson = function (attrs) {
    return Object.assign(
      {
        id: FT.uid('p'),
        name: 'New person',
        gender: 'x', // 'f' | 'm' | 'x' — used only for card tint
        birth: '',
        death: '',
        birthplace: '',
        birthSurname: '', // the surname they were born with, if it changed
        knownFor: '',
        photo: '', // a downscaled data: URL, or '' for initials
        x: 0,
        y: 0,
        entries: [],
      },
      attrs || {}
    );
  };

  /* Photos arrive from imported files, so they are untrusted. Only raster
     data: URLs are allowed through — this rejects `javascript:`, remote URLs
     (which would phone home when a tree is opened), and SVG (which can carry
     script). Anything else degrades to initials. */
  const PHOTO_RE = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
  FT.MAX_PHOTO_BYTES = 3 * 1024 * 1024;

  FT.safePhoto = function (v) {
    if (typeof v !== 'string') return '';
    const s = v.trim();
    if (!s || s.length > FT.MAX_PHOTO_BYTES) return '';
    return PHOTO_RE.test(s) ? s : '';
  };

  FT.photoCount = function (doc) {
    const people = (doc || FT.state).people;
    return Object.keys(people).filter(function (id) {
      return people[id].photo;
    }).length;
  };

  FT.UNION_STATUS = ['married', 'partners', 'ended'];

  FT.newUnion = function (attrs) {
    return Object.assign(
      {
        id: FT.uid('u'),
        partners: [],
        children: [],
        status: 'married',
        date: '',    // when it began
        endDate: '', // when it ended, if it did
      },
      attrs || {}
    );
  };

  /* "m. 1948", "m. 1948 – 1952", "partners since 1970". Empty when nothing is
     recorded, so the drawing stays clean for trees that do not track it. */
  FT.unionLabel = function (u) {
    if (!u) return '';
    const from = FT.yearOf(u.date);
    const to = FT.yearOf(u.endDate);
    if (u.status === 'partners') {
      if (from && to) return from + ' – ' + to;
      return from ? 'since ' + from : '';
    }
    if (from && to) return 'm. ' + from + ' – ' + to;
    if (from) return 'm. ' + from;
    if (to) return 'until ' + to;
    return u.status === 'ended' ? 'ended' : '';
  };

  /* Chronological where dates allow it, so remarriages read left to right. */
  FT.sortUnions = function (list) {
    return list.slice().sort(function (a, b) {
      const av = String(a.date || '');
      const bv = String(b.date || '');
      if (av && bv) return av.localeCompare(bv);
      if (av) return -1; // dated unions come before undated ones
      if (bv) return 1;
      return 0;
    });
  };

  FT.newTree = function (title) {
    return {
      id: FT.uid('t'),
      title: title || 'Our Family',
      people: {},
      unions: {},
      updatedAt: Date.now(),
    };
  };

  // --- the live document --------------------------------------------------

  FT.state = FT.newTree();

  const undoStack = [];
  const redoStack = [];
  let suspended = false;

  /* Snapshot before a mutation. Call this at the start of any user edit that
     should be undoable; consecutive drags coalesce via the `tag` argument. */
  function historyChanged() {
    FT.emit('history', { undo: undoStack.length, redo: redoStack.length });
  }

  FT.canUndo = function () {
    return undoStack.length > 0;
  };

  FT.canRedo = function () {
    return redoStack.length > 0;
  };

  FT.checkpoint = function (tag) {
    if (suspended) return;
    const top = undoStack[undoStack.length - 1];
    if (tag && top && top.tag === tag) return; // coalesce a run of same-kind edits
    undoStack.push({ tag: tag || null, snap: FT.clone(FT.state) });
    if (undoStack.length > 60) undoStack.shift();
    redoStack.length = 0;
    historyChanged();
  };

  FT.undo = function () {
    if (!undoStack.length) return false;
    redoStack.push({ tag: null, snap: FT.clone(FT.state) });
    FT.state = undoStack.pop().snap;
    FT.emit('change', { reason: 'undo' });
    historyChanged();
    return true;
  };

  FT.redo = function () {
    if (!redoStack.length) return false;
    undoStack.push({ tag: null, snap: FT.clone(FT.state) });
    FT.state = redoStack.pop().snap;
    FT.emit('change', { reason: 'redo' });
    historyChanged();
    return true;
  };

  /* Run a function without recording undo steps (used when loading a document). */
  FT.silently = function (fn) {
    suspended = true;
    try {
      fn();
    } finally {
      suspended = false;
    }
  };

  // --- tiny event bus -----------------------------------------------------

  const listeners = {};
  FT.on = function (evt, fn) {
    (listeners[evt] = listeners[evt] || []).push(fn);
  };
  FT.emit = function (evt, payload) {
    (listeners[evt] || []).forEach(function (fn) {
      fn(payload);
    });
  };

  // --- persistence --------------------------------------------------------

  let storageWarned = false;

  FT.save = function () {
    FT.state.updatedAt = Date.now();
    const ok = FT.saveDoc(FT.state);
    if (ok) {
      storageWarned = false;
      FT.emit('saved', { id: FT.state.id });
    } else if (!storageWarned) {
      // Usually the quota, now that photos live in the document. Say so once —
      // silently dropping saves would lose someone's writing.
      storageWarned = true;
      FT.emit('hint', {
        text:
          'Out of browser storage — changes are no longer being saved here. ' +
          'Use Export to keep this tree safe.',
      });
    }
  };

  /* Defensive load: shared/imported documents come from outside, so fill in
     anything missing rather than trusting the shape. */
  FT.normalize = function (raw) {
    const t = FT.newTree();
    if (!raw || typeof raw !== 'object') return t;
    if (typeof raw.id === 'string') t.id = raw.id;
    if (typeof raw.title === 'string' && raw.title.trim()) t.title = raw.title;
    const people = raw.people && typeof raw.people === 'object' ? raw.people : {};
    Object.keys(people).forEach(function (id) {
      const p = people[id] || {};
      t.people[id] = FT.newPerson({
        id: id,
        name: typeof p.name === 'string' ? p.name : 'Unknown',
        gender: ['f', 'm', 'x'].indexOf(p.gender) >= 0 ? p.gender : 'x',
        birth: String(p.birth || ''),
        death: String(p.death || ''),
        birthplace: String(p.birthplace || ''),
        birthSurname: String(p.birthSurname || ''),
        knownFor: String(p.knownFor || ''),
        photo: FT.safePhoto(p.photo),
        x: Number.isFinite(p.x) ? p.x : 0,
        y: Number.isFinite(p.y) ? p.y : 0,
        entries: Array.isArray(p.entries)
          ? p.entries.map(function (e) {
              const start = String((e && e.date) || '');
              let end = String((e && e.end) || '');
              // A chapter that ends before it starts is meaningless; drop the end.
              if (end && start && end < start) end = '';
              return {
                id: (e && e.id) || FT.uid('e'),
                date: start,
                end: end,
                title: String((e && e.title) || ''),
                body: String((e && e.body) || ''),
              };
            })
          : [],
      });
    });
    const unions = raw.unions && typeof raw.unions === 'object' ? raw.unions : {};
    Object.keys(unions).forEach(function (id) {
      const u = unions[id] || {};
      const partners = (Array.isArray(u.partners) ? u.partners : []).filter(function (pid) {
        return t.people[pid];
      });
      const children = (Array.isArray(u.children) ? u.children : []).filter(function (pid) {
        return t.people[pid];
      });
      if (!partners.length && !children.length) return;
      // The fields are year-only, so an ISO date from an older file becomes its
      // year. Nothing is lost on screen: only the year was ever displayed.
      let endDate = FT.cleanYear(u.endDate);
      const date = FT.cleanYear(u.date);
      // An end before the beginning is meaningless; drop it rather than store it.
      if (endDate && date && endDate < date) endDate = '';
      t.unions[id] = FT.newUnion({
        id: id,
        partners: partners.slice(0, 2),
        children: children,
        status: FT.UNION_STATUS.indexOf(u.status) >= 0 ? u.status : 'married',
        date: date,
        endDate: endDate,
      });
    });
    return t;
  };

  // --- graph queries ------------------------------------------------------

  FT.unionList = function () {
    return Object.keys(FT.state.unions).map(function (id) {
      return FT.state.unions[id];
    });
  };

  FT.peopleList = function () {
    return Object.keys(FT.state.people).map(function (id) {
      return FT.state.people[id];
    });
  };

  /* The union a person was born into (at most one). */
  FT.parentUnionOf = function (pid) {
    return (
      FT.unionList().find(function (u) {
        return u.children.indexOf(pid) >= 0;
      }) || null
    );
  };

  /* Unions a person is a partner in. */
  FT.unionsOf = function (pid) {
    return FT.unionList().filter(function (u) {
      return u.partners.indexOf(pid) >= 0;
    });
  };

  FT.partnersOf = function (pid) {
    const out = [];
    FT.unionsOf(pid).forEach(function (u) {
      u.partners.forEach(function (q) {
        if (q !== pid) out.push(q);
      });
    });
    return out;
  };

  FT.parentsOf = function (pid) {
    const u = FT.parentUnionOf(pid);
    return u ? u.partners.slice() : [];
  };

  FT.childrenOf = function (pid) {
    const out = [];
    FT.unionsOf(pid).forEach(function (u) {
      u.children.forEach(function (c) {
        if (out.indexOf(c) < 0) out.push(c);
      });
    });
    return out;
  };

  // --- graph mutations ----------------------------------------------------

  FT.addPerson = function (attrs) {
    const p = FT.newPerson(attrs);
    p.x = FT.snap(p.x);
    p.y = FT.snap(p.y);
    FT.state.people[p.id] = p;
    return p;
  };

  FT.addPartner = function (pid) {
    const anchor = FT.state.people[pid];
    if (!anchor) return null;
    // Reuse an existing union that still has an open seat, otherwise open one.
    let u = FT.unionsOf(pid).find(function (u) {
      return u.partners.length < 2;
    });
    const mate = FT.addPerson({
      name: 'Partner',
      x: anchor.x + FT.CARD_W + FT.SPOUSE_GAP,
      y: anchor.y,
    });
    if (!u) {
      u = FT.newUnion({ partners: [pid] });
      FT.state.unions[u.id] = u;
    }
    u.partners.push(mate.id);
    return mate;
  };

  FT.addChild = function (pid) {
    const anchor = FT.state.people[pid];
    if (!anchor) return null;
    let u = FT.unionsOf(pid)[0];
    if (!u) {
      u = FT.newUnion({ partners: [pid] });
      FT.state.unions[u.id] = u;
    }
    const sibCount = u.children.length;
    const child = FT.addPerson({
      name: 'Child',
      x: anchor.x + sibCount * (FT.CARD_W + FT.SIB_GAP),
      y: anchor.y + FT.ROW_H,
    });
    u.children.push(child.id);
    return child;
  };

  FT.addParent = function (pid) {
    const anchor = FT.state.people[pid];
    if (!anchor) return null;
    let u = FT.parentUnionOf(pid);
    if (u) {
      // Already has one parent — fill the empty seat instead of stacking a second union.
      if (u.partners.length >= 2) return null;
      const known = FT.state.people[u.partners[0]];
      const mate = FT.addPerson({
        name: 'Parent',
        x: (known ? known.x : anchor.x) + FT.CARD_W + FT.SPOUSE_GAP,
        y: known ? known.y : anchor.y - FT.ROW_H,
      });
      u.partners.push(mate.id);
      return mate;
    }
    const parent = FT.addPerson({
      name: 'Parent',
      x: anchor.x,
      y: anchor.y - FT.ROW_H,
    });
    u = FT.newUnion({ partners: [parent.id], children: [pid] });
    FT.state.unions[u.id] = u;
    return parent;
  };

  /* Remove a person and any now-meaningless unions they leave behind. */
  FT.removePerson = function (pid) {
    delete FT.state.people[pid];
    FT.unionList().forEach(function (u) {
      u.partners = u.partners.filter(function (q) {
        return q !== pid;
      });
      u.children = u.children.filter(function (q) {
        return q !== pid;
      });
      // A union with nobody left, or one that no longer joins anything, is dropped.
      if (!u.partners.length || (!u.children.length && u.partners.length < 2)) {
        if (!u.partners.length || !u.children.length) {
          if (u.partners.length < 2) delete FT.state.unions[u.id];
        }
      }
    });
  };

  // --- removing a single relationship (the lines on the canvas) -----------

  /* Break up a couple. If they had children the union survives with the first
     partner, so the children keep a parent rather than being orphaned. */
  FT.dissolveUnion = function (unionId) {
    const u = FT.state.unions[unionId];
    if (!u) return false;
    if (u.children.length && u.partners.length >= 2) {
      // Keep whoever is drawn on the left, so the outcome matches what you see
      // rather than the order the union happens to be stored in.
      const keeper = u.partners
        .slice()
        .sort(function (a, b) {
          return (FT.state.people[a].x || 0) - (FT.state.people[b].x || 0);
        })[0];
      u.partners = [keeper];
    } else delete FT.state.unions[unionId];
    return true;
  };

  /* Detach one child from its parents. The person stays on the canvas. */
  FT.detachChild = function (unionId, childId) {
    const u = FT.state.unions[unionId];
    if (!u) return false;
    u.children = u.children.filter(function (c) {
      return c !== childId;
    });
    if (!u.children.length && u.partners.length < 2) delete FT.state.unions[unionId];
    return true;
  };

  FT.edgeLabel = function (sel) {
    const u = sel && FT.state.unions[sel.unionId];
    if (!u) return '';
    const name = function (id) {
      return (FT.state.people[id] || {}).name || 'someone';
    };
    if (sel.kind === 'partner') return name(u.partners[0]) + ' & ' + name(u.partners[1]);
    return name(sel.childId) + ' · child';
  };

  /* Could this person stand as a parent to all of these children? No, if they
     are one of them or descend from one — that would make someone their own
     ancestor. */
  function couldParent(pid, children) {
    return children.every(function (c) {
      return c !== pid && !FT.isDescendant(pid, c);
    });
  }

  FT.linkAsPartners = function (aId, bId) {
    if (aId === bId || !FT.state.people[aId] || !FT.state.people[bId]) return false;
    const already = FT.unionsOf(aId).some(function (u) {
      return u.partners.indexOf(bId) >= 0;
    });
    if (already) return false;

    // Joining a union with a free seat also makes this person a parent of its
    // children — right for a single parent gaining a partner, wrong when those
    // children are the new partner's own ancestors. In that case record the
    // partnership on its own instead of rewriting anyone's parentage.
    const open = FT.unionsOf(aId).find(function (u) {
      return u.partners.length < 2 && couldParent(bId, u.children);
    });
    if (open) open.partners.push(bId);
    else {
      const u = FT.newUnion({ partners: [aId, bId] });
      FT.state.unions[u.id] = u;
    }
    return true;
  };

  /* Make `childId` a child of `parentId`'s (first) union. A person can only be
     born into one union, so any previous parentage is replaced. */
  FT.linkAsChild = function (parentId, childId) {
    if (parentId === childId) return false;
    if (!FT.state.people[parentId] || !FT.state.people[childId]) return false;
    if (FT.isDescendant(parentId, childId)) return false; // would create a loop
    const prev = FT.parentUnionOf(childId);
    if (prev)
      prev.children = prev.children.filter(function (c) {
        return c !== childId;
      });
    let u = FT.unionsOf(parentId)[0];
    if (!u) {
      u = FT.newUnion({ partners: [parentId] });
      FT.state.unions[u.id] = u;
    }
    if (u.children.indexOf(childId) < 0) u.children.push(childId);
    return true;
  };

  /* Is `maybeDescendant` somewhere below `pid`? Guards against cyclic links. */
  FT.isDescendant = function (maybeDescendant, pid) {
    if (maybeDescendant === pid) return false;
    const seen = {};
    const queue = FT.childrenOf(pid);
    while (queue.length) {
      const cur = queue.shift();
      if (seen[cur]) continue;
      seen[cur] = true;
      if (cur === maybeDescendant) return true;
      FT.childrenOf(cur).forEach(function (c) {
        queue.push(c);
      });
    }
    return false;
  };

  /* True when one of these two is an ancestor of the other. Such a couple can
     never share a generation row, which the layout has to know about. */
  FT.ancestrallyRelated = function (a, b) {
    return a === b || FT.isDescendant(a, b) || FT.isDescendant(b, a);
  };

  // --- demo document ------------------------------------------------------

  FT.demoTree = function () {
    const t = FT.newTree('The Miller Family');
    const mk = function (name, gender, birth, death, extra) {
      const p = FT.newPerson(
        Object.assign({ name: name, gender: gender, birth: birth, death: death }, extra || {})
      );
      t.people[p.id] = p;
      return p;
    };
    const union = function (partners, children, attrs) {
      const u = FT.newUnion(
        Object.assign(
          {
            partners: partners.map(function (p) {
              return p.id;
            }),
            children: children.map(function (p) {
              return p.id;
            }),
          },
          attrs || {}
        )
      );
      t.unions[u.id] = u;
      return u;
    };

    const joseph = mk('Joseph Miller', 'm', '1921-03-14', '1998-11-02', {
      birthplace: 'Cedar Falls, Iowa',
      knownFor: 'Ran the machine shop on Water Street for forty years',
    });
    joseph.entries = [
      {
        id: FT.uid('e'),
        date: '1946-06-02',
        end: '',
        title: 'The shop reopens',
        body:
          'The war took four years and the roof of the shop with it. Today I lit the ' +
          'forge again.\n\n' +
          'Ruth brought sandwiches at noon and stayed until the light went. She said the ' +
          'sound of the hammer made the street feel alive again. I told her I would make ' +
          'her anything she asked for. She asked for a gate.',
      },
      {
        id: FT.uid('e'),
        date: '1948-04-11',
        end: '',
        title: 'A gate, and a promise',
        body:
          'Finished the gate. Iron oak leaves along the top rail, because she likes the ' +
          'big oak on the courthouse lawn. Her father looked at it a long while and shook ' +
          'my hand without saying anything.\n\n' +
          'We are to be married in September.',
      },
    ];

    const ruth = mk('Ruth Miller', 'f', '1925-07-21', '2004-02-16', {
      birthplace: 'Waterloo, Iowa',
      birthSurname: 'Calloway',
      knownFor: 'Kept the county school open through two hard winters',
    });
    ruth.entries = [
      {
        id: FT.uid('e'),
        date: '1953-09-19',
        end: '',
        title: 'Robert',
        body:
          'Our son arrived before dawn, furious about it. Joseph has not put the hammer ' +
          'down all week, but he put it down today.',
      },
    ];

    const robert = mk('Robert Miller', 'm', '1953-09-19', '', {
      birthplace: 'Cedar Falls, Iowa',
      knownFor: 'First in the family to finish college',
    });
    robert.entries = [
      {
        id: FT.uid('e'),
        date: '1971-10-04',
        end: '',
        title: 'Ames',
        body:
          'A room with one window and three other boys in it. Mother packed more food ' +
          'than I can eat in a month. Dad said nothing at the bus station, then gripped ' +
          'my shoulder hard enough to bruise.\n\nI will not waste this.',
      },
    ];

    const carol = mk('Carol Miller', 'f', '1956-05-08', '', {
      birthplace: 'Des Moines, Iowa',
      birthSurname: 'Brennan',
    });
    const nancy = mk('Nancy Weaver', 'f', '1958-01-30', '', {
      birthplace: 'Cedar Falls, Iowa',
      birthSurname: 'Miller',
      knownFor: 'Rode a motorcycle to Alaska and back at nineteen',
    });
    const frank = mk('Frank Weaver', 'm', '1955-10-12', '', {
      birthplace: 'Dubuque, Iowa',
    });
    const emily = mk('Emily Miller', 'f', '1982-04-03', '', {
      birthplace: 'Chicago, Illinois',
    });
    const thomas = mk('Thomas Miller', 'm', '1985-08-27', '', {
      birthplace: 'Chicago, Illinois',
    });
    const grace = mk('Grace Weaver', 'f', '1984-06-15', '', {
      birthplace: 'Madison, Wisconsin',
    });

    union([joseph, ruth], [robert, nancy], { date: '1948' });
    union([robert, carol], [emily, thomas], { date: '1980' });
    union([nancy, frank], [grace], { date: '1982', status: 'partners' });
    return t;
  };
})();
