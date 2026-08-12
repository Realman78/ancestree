/* Heirloom — the life book: a two-page spread per person.
   Left page is the profile and table of contents; right page is the open entry. */
(function () {
  const FT = window.FT;

  const overlay = document.getElementById('bookOverlay');
  const leftPage = document.getElementById('pageLeft');
  const rightPage = document.getElementById('pageRight');

  let personId = null;
  let entryId = null;
  let saveTimer = null;

  function person() {
    return FT.state.people[personId] || null;
  }

  function entry() {
    const p = person();
    if (!p) return null;
    return (
      p.entries.find(function (e) {
        return e.id === entryId;
      }) || null
    );
  }

  function today() {
    const d = new Date();
    const pad = function (n) {
      return String(n).padStart(2, '0');
    };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function prettyDate(iso) {
    if (!iso) return 'Undated';
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return iso;
    const months = ['January','February','March','April','May','June','July',
                    'August','September','October','November','December'];
    return Number(m[3]) + ' ' + months[Number(m[2]) - 1] + ' ' + m[1];
  }

  function sortedEntries(p) {
    return p.entries.slice().sort(function (a, b) {
      return String(a.date).localeCompare(String(b.date));
    });
  }

  /* Debounced autosave — the book writes straight into the document as you type. */
  function touch() {
    FT.state.updatedAt = Date.now();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      FT.save();
      FT.render();
    }, 350);
  }

  // ------------------------------------------------------------- left page

  function portraitInner(p) {
    return p.photo
      ? '<img class="portrait-img" src="' + p.photo + '" alt="Portrait of ' +
        FT.escapeHtml(p.name) + '">'
      : '<span class="initials">' + FT.escapeHtml(FT.initials(p.name)) + '</span>';
  }

  function portraitHtml(p, ro) {
    if (ro) {
      return (
        '<div class="portrait-wrap"><div class="portrait" data-gender="' +
        FT.escapeHtml(p.gender) + '">' + portraitInner(p) + '</div></div>'
      );
    }
    return (
      '<div class="portrait-wrap">' +
        '<label class="portrait editable" data-gender="' + FT.escapeHtml(p.gender) +
          '" title="' + (p.photo ? 'Choose a different photo' : 'Add a photo') + '">' +
          portraitInner(p) +
          '<span class="portrait-overlay">' + (p.photo ? 'Change' : 'Add photo') + '</span>' +
          '<input type="file" accept="image/*" class="photo-input" hidden>' +
        '</label>' +
        (p.photo
          ? '<button class="portrait-remove" id="removePhoto">Remove photo</button>'
          : '<span class="portrait-tip">or drop a photo on their card</span>') +
      '</div>'
    );
  }

  function renderLeft() {
    const p = person();
    if (!p) return;
    const ro = FT.readOnly;
    const entries = sortedEntries(p);

    const field = function (label, key, value, placeholder) {
      if (ro) {
        if (!value) return '';
        return (
          '<div class="pf"><span class="pf-label">' + label + '</span>' +
          '<span class="pf-value">' + FT.escapeHtml(value) + '</span></div>'
        );
      }
      return (
        '<label class="pf"><span class="pf-label">' + label + '</span>' +
        '<input class="pf-input" data-field="' + key + '" value="' +
        FT.escapeHtml(value) + '" placeholder="' + placeholder + '"></label>'
      );
    };

    const toc = entries.length
      ? entries
          .map(function (e) {
            return (
              '<li><button class="toc-item' + (e.id === entryId ? ' current' : '') +
              '" data-entry="' + e.id + '">' +
              '<span class="toc-date">' + FT.escapeHtml(e.date || '—') + '</span>' +
              '<span class="toc-title">' +
              FT.escapeHtml(e.title || 'Untitled chapter') + '</span></button></li>'
            );
          })
          .join('')
      : '<li class="toc-empty">No chapters yet.</li>';

    leftPage.innerHTML =
      portraitHtml(p, ro) +
      (ro
        ? '<h2 class="person-name">' + FT.escapeHtml(p.name) + '</h2>'
        : '<input class="person-name" data-field="name" value="' +
          FT.escapeHtml(p.name) + '" placeholder="Name">') +
      '<div class="person-fields">' +
        field('Born', 'birth', p.birth, 'e.g. 1921') +
        field('Died', 'death', p.death, 'blank if living') +
        field('From', 'birthplace', p.birthplace, 'Place') +
        field('Known for', 'knownFor', p.knownFor, 'A line about them') +
      '</div>' +
      '<div class="toc-head"><span>Chapters</span>' +
        (ro ? '' : '<button class="mini-btn" id="addEntry">+ New chapter</button>') +
      '</div>' +
      '<ul class="toc">' + toc + '</ul>';
  }

  // ------------------------------------------------------------ right page

  function renderRight(flip) {
    const p = person();
    if (!p) return;
    const e = entry();
    const ro = FT.readOnly;

    if (!e) {
      rightPage.innerHTML =
        '<div class="page-empty">' +
          '<div class="flourish">&#10086;</div>' +
          '<p>This book is unwritten.</p>' +
          (ro
            ? '<p class="muted">Nothing has been recorded for ' +
              FT.escapeHtml(p.name) + ' yet.</p>'
            : '<button class="mini-btn" id="addEntryEmpty">Write the first chapter</button>') +
        '</div>';
      return;
    }

    rightPage.innerHTML =
      '<div class="entry-head">' +
        (ro
          ? '<div class="entry-date-ro">' + FT.escapeHtml(prettyDate(e.date)) + '</div>'
          : '<input type="date" class="entry-date" value="' +
            FT.escapeHtml(e.date) + '">') +
        (ro
          ? ''
          : '<button class="mini-btn danger" id="deleteEntry" title="Delete this chapter">' +
            'Delete</button>') +
      '</div>' +
      (ro
        ? '<h3 class="entry-title-ro">' +
          FT.escapeHtml(e.title || 'Untitled chapter') + '</h3>'
        : '<input class="entry-title" value="' + FT.escapeHtml(e.title) +
          '" placeholder="Chapter title">') +
      (ro
        ? '<div class="entry-body-ro">' + FT.escapeHtml(e.body).replace(/\n/g, '<br>') + '</div>'
        : '<textarea class="entry-body" placeholder="Write it down before it is lost…">' +
          FT.escapeHtml(e.body) + '</textarea>') +
      '<div class="entry-foot"><span id="wordCount"></span></div>';

    if (!ro) autoGrow(rightPage.querySelector('.entry-body'));
    updateWordCount();

    if (flip) {
      rightPage.classList.remove('flip');
      void rightPage.offsetWidth; // restart the animation
      rightPage.classList.add('flip');
    }
  }

  function autoGrow(ta) {
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.max(220, ta.scrollHeight) + 'px';
  }

  function updateWordCount() {
    const el = document.getElementById('wordCount');
    if (!el) return;
    const e = entry();
    const words = e && e.body.trim() ? e.body.trim().split(/\s+/).length : 0;
    el.textContent = words === 1 ? '1 word' : words + ' words';
  }

  // ---------------------------------------------------------------- public

  FT.openBook = function (id) {
    if (!FT.state.people[id]) return;
    personId = id;
    const entries = sortedEntries(FT.state.people[id]);
    entryId = entries.length ? entries[entries.length - 1].id : null;
    overlay.hidden = false;
    document.body.classList.add('book-open');
    renderLeft();
    renderRight(false);
    requestAnimationFrame(function () {
      overlay.classList.add('open');
    });
  };

  FT.closeBook = function () {
    if (overlay.hidden) return;
    overlay.classList.remove('open');
    clearTimeout(saveTimer);
    FT.save();
    FT.render();
    setTimeout(function () {
      overlay.hidden = true;
      document.body.classList.remove('book-open');
      personId = null;
    }, 220);
  };

  FT.isBookOpen = function () {
    return !overlay.hidden;
  };

  function addEntry() {
    const p = person();
    if (!p || FT.readOnly) return;
    FT.checkpoint();
    const e = { id: FT.uid('e'), date: today(), title: '', body: '' };
    p.entries.push(e);
    entryId = e.id;
    renderLeft();
    renderRight(true);
    const t = rightPage.querySelector('.entry-title');
    if (t) t.focus();
    touch();
  }

  // ---------------------------------------------------------------- events

  overlay.addEventListener('click', function (e) {
    if (e.target === overlay || e.target.closest('#closeBook')) {
      FT.closeBook();
      return;
    }
    if (e.target.closest('#addEntry') || e.target.closest('#addEntryEmpty')) {
      addEntry();
      return;
    }
    const toc = e.target.closest('.toc-item');
    if (toc) {
      entryId = toc.dataset.entry;
      renderLeft();
      renderRight(true);
      return;
    }
    if (e.target.closest('#removePhoto')) {
      FT.clearPhoto(personId);
      return;
    }
    if (e.target.closest('#deleteEntry')) {
      const p = person();
      const cur = entry();
      if (!p || !cur) return;
      FT.checkpoint();
      p.entries = p.entries.filter(function (x) {
        return x.id !== cur.id;
      });
      const left = sortedEntries(p);
      entryId = left.length ? left[left.length - 1].id : null;
      renderLeft();
      renderRight(true);
      touch();
    }
  });

  overlay.addEventListener('change', function (ev) {
    const t = ev.target;
    if (!t.classList || !t.classList.contains('photo-input')) return;
    const file = t.files && t.files[0];
    t.value = ''; // so picking the same file twice still fires
    if (file) FT.setPhotoFrom(personId, file);
  });

  /* The portrait can change from the picker here or from a drop on the canvas. */
  FT.on('photo', function (payload) {
    if (personId && payload.id === personId) renderLeft();
  });

  overlay.addEventListener('input', function (ev) {
    if (FT.readOnly) return;
    const p = person();
    if (!p) return;
    const t = ev.target;

    if (t.dataset && t.dataset.field) {
      FT.checkpoint('field:' + personId + ':' + t.dataset.field);
      p[t.dataset.field] = t.value;
      if (t.dataset.field === 'name') {
        // Only when they have no photo — this element is the <img> otherwise.
        const initials = leftPage.querySelector('.portrait .initials');
        if (initials) initials.textContent = FT.initials(t.value);
      }
      touch();
      return;
    }

    const e = entry();
    if (!e) return;
    if (t.classList.contains('entry-title')) {
      FT.checkpoint('entry-title:' + e.id);
      e.title = t.value;
      const cur = leftPage.querySelector('.toc-item.current .toc-title');
      if (cur) cur.textContent = t.value || 'Untitled chapter';
      touch();
    } else if (t.classList.contains('entry-body')) {
      FT.checkpoint('entry-body:' + e.id);
      e.body = t.value;
      autoGrow(t);
      updateWordCount();
      touch();
    } else if (t.classList.contains('entry-date')) {
      FT.checkpoint('entry-date:' + e.id);
      e.date = t.value;
      renderLeft();
      touch();
    }
  });
})();
