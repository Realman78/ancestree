/* Heirloom — wiring: toolbar, keyboard, document lifecycle. */
(function () {
  const FT = window.FT;

  const titleInput = document.getElementById('treeTitle');
  const hint = document.getElementById('hint');
  const banner = document.getElementById('roBanner');
  const importInput = document.getElementById('importFile');

  let hintTimer = null;
  FT.on('hint', function (payload) {
    hint.textContent = payload.text;
    hint.classList.add('show');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(function () {
      hint.classList.remove('show');
    }, 3200);
  });

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
    });
    document.body.classList.toggle('read-only', FT.readOnly);
    banner.hidden = !FT.readOnly;
    titleInput.value = FT.state.title;
    titleInput.disabled = FT.readOnly;
    FT.resetCards();
    FT.render();
    FT.fitToScreen();
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
    remove: function () {
      if (!FT.selected) return;
      const p = FT.state.people[FT.selected];
      if (!p) return;
      const written = p.entries.length;
      const msg = written
        ? 'Remove ' + p.name + '? Their book has ' + written +
          (written === 1 ? ' chapter' : ' chapters') + ' and will go with them.'
        : 'Remove ' + p.name + ' from the tree?';
      if (!confirm(msg)) return;
      FT.checkpoint();
      FT.removePerson(FT.selected);
      FT.select(null);
      FT.save();
      FT.render();
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
    reset: function () {
      if (!confirm('Start a new empty tree? Your current one will be replaced.')) return;
      FT.adoptDocument(FT.newTree('Our Family'), false);
      const p = FT.addPerson({ name: 'Me', x: 0, y: 0 });
      FT.save();
      FT.select(p.id);
      FT.fitToScreen();
    },
    demo: function () {
      if (!confirm('Load the sample family? This replaces your current tree.')) return;
      const demo = FT.demoTree();
      FT.silently(function () {
        FT.state = demo;
      });
      FT.autoArrange();
      FT.adoptDocument(FT.state, false);
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
      else FT.select(null);
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      if (typing) return; // let the browser undo the text field
      e.preventDefault();
      const done = e.shiftKey ? FT.redo() : FT.undo();
      FT.emit('hint', { text: done ? (e.shiftKey ? 'Redone.' : 'Undone.') : 'Nothing to undo.' });
      return;
    }

    if (typing || FT.isBookOpen() || FT.readOnly) return;

    if (e.key === 'Enter' && FT.selected) {
      e.preventDefault();
      FT.openBook(FT.selected);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && FT.selected) {
      e.preventDefault();
      actions.remove();
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
