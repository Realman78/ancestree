/* Heirloom — wiring: toolbar, keyboard, document lifecycle. */
(function () {
  const FT = window.FT;

  const titleInput = document.getElementById('treeTitle');
  const hint = document.getElementById('hint');
  const banner = document.getElementById('roBanner');
  const importInput = document.getElementById('importFile');

  const hintText = document.getElementById('hintText');
  const hintUndo = document.getElementById('hintUndo');
  const undoBtn = document.getElementById('undoBtn');
  const redoBtn = document.getElementById('redoBtn');

  let hintTimer = null;
  FT.on('hint', function (payload) {
    hintText.textContent = payload.text;
    // Destructive steps no longer ask first, so the way back has to be offered
    // at the moment of loss, not just in the toolbar.
    hintUndo.hidden = !payload.undo || FT.readOnly;
    hint.classList.add('show');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(function () {
      hint.classList.remove('show');
    }, payload.undo ? 7000 : 3200);
  });

  function syncHistory() {
    undoBtn.disabled = !FT.canUndo();
    redoBtn.disabled = !FT.canRedo();
  }
  FT.on('history', syncHistory);

  FT.on('change', function () {
    FT.resetCards();
    FT.render();
    titleInput.value = FT.state.title;
    FT.save();
  });

  /* Swap in a whole document — from a share link, an import, or "start over". */
  FT.adoptDocument = function (doc, readOnly) {
    FT.silently(function () {
      FT.state = doc;
      FT.readOnly = !!readOnly;
      FT.selected = null;
      FT.selectedEdge = null;
    });
    document.body.classList.toggle('read-only', FT.readOnly);
    banner.hidden = !FT.readOnly;
    titleInput.value = FT.state.title;
    titleInput.disabled = FT.readOnly;
    FT.resetCards();
    FT.render();
    FT.fitToScreen();
    syncHistory();
    if (!FT.readOnly) FT.save();
  };

  // ------------------------------------------------------------- toolbar

  const actions = {
    add: function () {
      FT.checkpoint();
      const b = FT.contentBounds();
      const p = FT.addPerson({ name: 'New person', x: b.x, y: b.y + b.h + FT.ROW_H / 2 });
      FT.save();
      FT.select(p.id);
      FT.openBook(p.id);
    },
    partner: function () {
      if (!FT.selected) return;
      FT.checkpoint();
      const mate = FT.addPartner(FT.selected);
      FT.save();
      if (mate) FT.select(mate.id);
    },
    child: function () {
      if (!FT.selected) return;
      FT.checkpoint();
      const kid = FT.addChild(FT.selected);
      FT.save();
      if (kid) FT.select(kid.id);
    },
    parent: function () {
      if (!FT.selected) return;
      FT.checkpoint();
      const par = FT.addParent(FT.selected);
      FT.save();
      if (par) FT.select(par.id);
      else FT.emit('hint', { text: 'This person already has two parents.' });
    },
    linkPartner: function () {
      FT.beginLink('partner');
    },
    linkChild: function () {
      FT.beginLink('child');
    },
    book: function () {
      if (FT.selected) FT.openBook(FT.selected);
    },
    /* Nothing here asks for confirmation. A browser that suppresses dialogs
       makes confirm() return false, which silently swallowed the action — so
       every destructive step is undoable instead, and says so as it happens. */
    remove: function () {
      if (!FT.selected) return;
      const p = FT.state.people[FT.selected];
      if (!p) return;
      const written = p.entries.length;
      FT.checkpoint();
      FT.removePerson(FT.selected);
      FT.select(null);
      FT.save();
      FT.render();
      FT.emit('hint', {
        text:
          'Removed ' + p.name +
          (written
            ? ' and ' + (written === 1 ? 'their 1 chapter' : 'their ' + written + ' chapters')
            : '') + '.',
        undo: true,
      });
    },
    /* Delete a single relationship line. The consequence is reported after the
       fact rather than asked about first — breaking up a couple who have
       children keeps them with one parent, and people should be told which. */
    removeEdge: function () {
      const sel = FT.selectedEdge;
      if (!sel || FT.readOnly) return;
      const u = FT.state.unions[sel.unionId];
      if (!u) return;
      const nameOf = function (id) {
        return (FT.state.people[id] || {}).name || 'someone';
      };

      let msg;
      if (sel.kind === 'partner') {
        const a = nameOf(u.partners[0]);
        const b = nameOf(u.partners[1]);
        const n = u.children.length;
        msg = n
          ? 'Separated ' + a + ' and ' + b + '. Their ' +
            (n === 1 ? 'child stays' : n + ' children stay') + ' with ' + a + '.'
          : 'Separated ' + a + ' and ' + b + '.';
      } else {
        msg = 'Detached ' + nameOf(sel.childId) + ' from their parents.';
      }

      FT.checkpoint();
      if (sel.kind === 'partner') FT.dissolveUnion(sel.unionId);
      else FT.detachChild(sel.unionId, sel.childId);
      FT.selectedEdge = null;
      FT.save();
      FT.render();
      FT.emit('hint', { text: msg, undo: true });
    },
    undo: function () {
      const done = FT.undo();
      FT.emit('hint', { text: done ? 'Undone.' : 'Nothing to undo.' });
    },
    redo: function () {
      const done = FT.redo();
      FT.emit('hint', { text: done ? 'Redone.' : 'Nothing to redo.' });
    },
    arrange: function () {
      FT.checkpoint();
      FT.autoArrange();
      FT.save();
      FT.animateArrange();
      FT.fitToScreen();
      FT.emit('hint', { text: 'Tidied into generations.' });
    },
    fit: function () {
      FT.fitToScreen();
    },
    zoomIn: function () {
      FT.zoomBy(1.2);
    },
    zoomOut: function () {
      FT.zoomBy(1 / 1.2);
    },
    share: function () {
      FT.openShare();
    },
    export: function () {
      FT.exportFile();
    },
    import: function () {
      importInput.click();
    },
    copyToMine: function () {
      const copy = FT.clone(FT.state);
      copy.id = FT.uid('t');
      copy.title = copy.title + ' (copy)';
      history.replaceState(null, '', location.pathname + location.search);
      FT.adoptDocument(copy, false);
      FT.emit('hint', { text: 'Copied into your own tree — edit away.' });
    },
    // These two replace the whole document, so they take a checkpoint first —
    // without it, losing a tree to a stray click would be unrecoverable.
    reset: function () {
      FT.checkpoint();
      FT.adoptDocument(FT.newTree('Our Family'), false);
      const p = FT.addPerson({ name: 'Me', x: 0, y: 0 });
      FT.save();
      FT.select(p.id);
      FT.fitToScreen();
      FT.emit('hint', { text: 'Started a new tree.', undo: true });
    },
    demo: function () {
      FT.checkpoint();
      const demo = FT.demoTree();
      FT.silently(function () {
        FT.state = demo;
      });
      FT.autoArrange();
      FT.adoptDocument(FT.state, false);
      FT.emit('hint', { text: 'Loaded the sample family.', undo: true });
    },
  };

  document.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const fn = actions[btn.dataset.action];
    if (fn) fn();
  });

  titleInput.addEventListener('input', function () {
    FT.checkpoint('title');
    FT.state.title = titleInput.value;
    FT.save();
  });

  importInput.addEventListener('change', function () {
    if (importInput.files && importInput.files[0]) FT.importFile(importInput.files[0]);
    importInput.value = '';
  });

  // ------------------------------------------------------------ keyboard

  document.addEventListener('keydown', function (e) {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;

    if (e.key === 'Escape') {
      if (FT.isBookOpen()) FT.closeBook();
      else if (!document.getElementById('shareDialog').hidden) FT.closeShare();
      else FT.select(null); // also clears any selected line
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      if (typing) return; // let the browser undo the text field
      e.preventDefault();
      if (e.shiftKey) actions.redo();
      else actions.undo();
      return;
    }

    if (typing || FT.isBookOpen() || FT.readOnly) return;

    if (e.key === 'Enter' && FT.selected) {
      e.preventDefault();
      FT.openBook(FT.selected);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (!FT.selectedEdge && !FT.selected) return;
      e.preventDefault();
      if (FT.selectedEdge) actions.removeEdge();
      else actions.remove();
    } else if (e.key.toLowerCase() === 'a') {
      actions.arrange();
    } else if (e.key.toLowerCase() === 'n') {
      actions.add();
    } else if (e.key.toLowerCase() === 'f') {
      actions.fit();
    }
  });

  // ------------------------------------------------------------- start up

  (async function boot() {
    const shared = await FT.consumeShareLink();
    if (shared === 'loaded') return;

    const saved = FT.loadLocal();
    if (saved && Object.keys(saved.people).length) {
      FT.adoptDocument(saved, false);
    } else {
      // First run: the sample family, already tidied, so there is something to poke at.
      const demo = FT.demoTree();
      FT.silently(function () {
        FT.state = demo;
      });
      FT.autoArrange();
      FT.adoptDocument(FT.state, false);
      if (shared !== 'failed') {
        FT.emit('hint', { text: 'Sample family loaded — drag a card, or open a book to read a life.' });
      }
    }

    // Reported last so it is not buried by whatever we fell back to.
    if (shared === 'failed') {
      FT.emit('hint', {
        text: 'That shared link could not be opened — it may be damaged or expired. Showing your own tree instead.',
      });
    }
  })();
})();
