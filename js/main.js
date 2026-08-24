/* Heirloom — wiring: toolbar, keyboard, document lifecycle. */
(function () {
  const FT = window.FT;

  const titleInput = document.getElementById('treeTitle');
  const hint = document.getElementById('hint');
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
    hintUndo.hidden = !payload.undo;
    hint.classList.add('show');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(function () {
      hint.classList.remove('show');
    }, payload.undo ? 7000 : 3200);
  });

  /* An in-app replacement for confirm(). The native one returns false when a
     browser suppresses dialogs, which silently swallowed whatever it guarded. */
  const askDialog = document.getElementById('askDialog');
  const askTitle = document.getElementById('askTitle');
  const askBody = document.getElementById('askBody');
  const askOk = document.getElementById('askOk');
  const askCancel = document.getElementById('askCancel');
  let askResolve = null;

  function ask(opts) {
    return new Promise(function (resolve) {
      askTitle.textContent = opts.title;
      askBody.textContent = opts.body || '';
      askBody.hidden = !opts.body;
      askOk.textContent = opts.confirmLabel || 'OK';
      askOk.classList.toggle('danger-btn', !!opts.danger);
      askDialog.hidden = false;
      askDialog.classList.add('open');
      askResolve = resolve;
      askOk.focus();
    });
  }

  function closeAsk(answer) {
    if (!askResolve) return;
    const resolve = askResolve;
    askResolve = null;
    askDialog.classList.remove('open');
    setTimeout(function () {
      askDialog.hidden = true;
    }, 160);
    resolve(answer);
  }

  askOk.addEventListener('click', function () {
    closeAsk(true);
  });
  askCancel.addEventListener('click', function () {
    closeAsk(false);
  });
  askDialog.addEventListener('click', function (e) {
    if (e.target === askDialog) closeAsk(false);
  });
  FT.ask = ask;

  const zoomLevel = document.getElementById('zoomLevel');
  FT.on('zoom', function (payload) {
    zoomLevel.textContent = Math.round(payload.z * 100) + '%';
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

  /* Swap in a whole document — a different tree, an import, or the sample. */
  FT.adoptDocument = function (doc) {
    FT.silently(function () {
      FT.state = doc;
      FT.selected = null;
      FT.selectedEdge = null;
    });
    titleInput.value = FT.state.title;
    FT.resetCards();
    FT.render();
    FT.fitToScreen();
    syncHistory();
    FT.rememberLastDoc(doc.id);
    FT.save();
    renderTreeList();
  };

  // --------------------------------------------------------- the tree shelf

  const treeMenu = document.getElementById('treeMenu');
  const treeMenuBtn = document.getElementById('treeMenuBtn');
  const treeList = document.getElementById('treeList');
  const treeCount = document.getElementById('treeCount');

  function whenSaved(row) {
    const when = new Date(row.updatedAt || 0);
    const days = Math.floor((Date.now() - when.getTime()) / 86400000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 30) return days + ' days ago';
    return when.toISOString().slice(0, 10);
  }

  function renderTreeList() {
    const rows = FT.listDocs();
    treeCount.textContent = rows.length || 1;
    treeList.innerHTML = rows.length
      ? rows
          .map(function (row) {
            const current = row.id === FT.state.id;
            return (
              '<li><button class="tree-row' + (current ? ' current' : '') +
                '" data-tree="' + FT.escapeHtml(row.id) + '">' +
                '<span class="tree-row-name">' + FT.escapeHtml(row.title || 'Untitled') + '</span>' +
                '<span class="tree-row-meta">' + row.people +
                  (row.people === 1 ? ' person · ' : ' people · ') + whenSaved(row) + '</span>' +
              '</button>' +
              '<button class="tree-row-del" data-delete-tree="' + FT.escapeHtml(row.id) +
                '" title="Delete this tree" aria-label="Delete ' +
                FT.escapeHtml(row.title || 'Untitled') + '">&times;</button></li>'
            );
          })
          .join('')
      : '<li class="tree-empty">No saved trees yet.</li>';
  }
  FT.renderTreeList = renderTreeList;

  const storageUse = document.getElementById('storageUse');

  async function renderStorage() {
    const est = await FT.storageEstimate();
    if (!est || !est.usage) {
      storageUse.textContent = '';
      return;
    }
    const mb = est.usage / (1024 * 1024);
    storageUse.textContent = (mb < 0.1 ? '<0.1' : mb.toFixed(1)) + ' MB used in this browser';
  }

  function openTreeMenu(open) {
    treeMenu.hidden = !open;
    treeMenuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      renderTreeList();
      renderStorage();
    }
  }

  treeMenuBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    openTreeMenu(treeMenu.hidden);
  });

  treeList.addEventListener('click', async function (e) {
    const del = e.target.closest('[data-delete-tree]');
    if (del) {
      const id = del.dataset.deleteTree;
      const row = FT.listDocs().find(function (r) {
        return r.id === id;
      });
      const yes = await ask({
        title: 'Delete “' + (row ? row.title : 'this tree') + '”?',
        body: 'This tree and every life book in it will be gone. This one cannot be undone.',
        confirmLabel: 'Delete tree',
        danger: true,
      });
      if (!yes) return;
      FT.deleteDoc(id);
      if (id === FT.state.id) {
        const next = FT.pickStartupDoc();
        FT.adoptDocument(next || FT.newTree('Our Family'));
      }
      renderTreeList();
      FT.emit('hint', { text: 'Tree deleted.' });
      return;
    }
    const row = e.target.closest('[data-tree]');
    if (!row) return;
    const doc = FT.loadDoc(row.dataset.tree);
    if (!doc) return;
    FT.save(); // keep the current tree before leaving it
    FT.adoptDocument(doc);
    openTreeMenu(false);
  });

  document.addEventListener('click', function (e) {
    if (!treeMenu.hidden && !e.target.closest('.tree-id')) openTreeMenu(false);
    const exportMenu = document.getElementById('exportMenu');
    if (!exportMenu.hidden && !e.target.closest('.menu-wrap')) exportMenu.hidden = true;
  });

  const exportBtn = document.getElementById('exportBtn');
  exportBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    const menu = document.getElementById('exportMenu');
    menu.hidden = !menu.hidden;
    exportBtn.setAttribute('aria-expanded', menu.hidden ? 'false' : 'true');
  });

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
      if (!sel) return;
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
    zoomReset: function () {
      FT.zoomTo(1);
    },
    zoomIn: function () {
      FT.zoomBy(1.2);
    },
    zoomOut: function () {
      FT.zoomBy(1 / 1.2);
    },
    export: function () {
      FT.exportFile();
      document.getElementById('exportMenu').hidden = true;
    },
    exportSvg: function () {
      FT.exportSvg();
      document.getElementById('exportMenu').hidden = true;
    },
    exportDetailedSvg: function () {
      FT.exportDetailedSvg();
      document.getElementById('exportMenu').hidden = true;
    },
    exportPng: function () {
      FT.exportPng();
      document.getElementById('exportMenu').hidden = true;
    },
    import: function () {
      importInput.click();
    },
    /* A new tree never overwrites anything — that is the point of the shelf. */
    newTree: function () {
      FT.save();
      FT.adoptDocument(FT.newTree('Untitled tree'));
      titleInput.focus();
      titleInput.select();
      FT.emit('hint', { text: 'New tree. Add someone with "+ Person".' });
    },
    /* The sample replaces what is on the board, so it asks first when the board
       has anything on it. */
    demo: async function () {
      if (Object.keys(FT.state.people).length) {
        const yes = await FT.ask({
          title: 'Replace this tree with the sample family?',
          body: '“' + FT.state.title + '” has ' + Object.keys(FT.state.people).length +
            ' people on the board. They will be replaced. You can undo it afterwards.',
          confirmLabel: 'Replace',
          danger: true,
        });
        if (!yes) return;
      }
      FT.checkpoint();
      const demo = FT.demoTree();
      demo.id = FT.state.id; // stay in the same tree on the shelf
      FT.silently(function () {
        FT.state = demo;
      });
      FT.autoArrange();
      FT.adoptDocument(FT.state);
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
    const file = importInput.files && importInput.files[0];
    importInput.value = '';
    if (!file) return;
    // Imports open as their own tree rather than replacing the current one.
    FT.importFile(file, function (trees) {
      FT.save();
      trees.forEach(function (doc) {
        doc.id = FT.uid('t');
        FT.saveDoc(doc);
      });
      FT.adoptDocument(trees[trees.length - 1]);
      FT.emit('hint', {
        text: trees.length === 1
          ? 'Imported “' + trees[0].title + '” as a new tree.'
          : 'Restored ' + trees.length + ' trees from that backup.',
      });
    });
  });

  // ------------------------------------------------------------ keyboard

  document.addEventListener('keydown', function (e) {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;

    if (e.key === 'Escape') {
      if (FT.isBookOpen()) FT.closeBook();
      else if (!askDialog.hidden) closeAsk(false);
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

    if (typing || FT.isBookOpen()) return;

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
    FT.migrateLegacy(); // one-time move from the single-tree era
    // Ask the browser not to treat this as disposable cache.
    FT.requestPersistence();

    const saved = FT.pickStartupDoc();
    if (saved) {
      FT.adoptDocument(saved);
      return;
    }

    // First visit: an empty board, not somebody else's family. The sample is a
    // click away in the status bar for anyone who wants to look around first.
    FT.adoptDocument(FT.newTree('Our Family'));
    FT.emit('hint', {
      text: 'Empty board — add someone with "+ Person", or load the sample family below.',
    });
  })();
})();
