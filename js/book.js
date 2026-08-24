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
  let dateModes = {}; // per-field override of the picker/free-text choice

  /* Which control to show for Born/Died: whatever the reader last asked for,
     otherwise inferred from the value itself. */
  function dateModeFor(key, value) {
    if (dateModes[key]) return dateModes[key];
    return value && !FT.isIsoDate(value) ? 'text' : 'pick';
  }

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
    return iso ? FT.prettyDate(iso) : 'Undated';
  }

  /* "2 June 1946", or "2 June 1946 – 15 September 1946" for a chapter that spans. */
  function prettyRange(e) {
    const start = prettyDate(e.date);
    return e.end ? start + ' – ' + prettyDate(e.end) : start;
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

  function portraitHtml(p) {
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
    const entries = sortedEntries(p);

    const field = function (label, key, value, placeholder) {
      return (
        '<label class="pf"><span class="pf-label">' + label + '</span>' +
        '<input class="pf-input" data-field="' + key + '" value="' +
        FT.escapeHtml(value) + '" placeholder="' + placeholder + '"></label>'
      );
    };

    /* Born/Died offer a date picker, with a free-text escape hatch for the
       approximate dates genealogy is full of ("c. 1880", "spring 1943"). The
       mode follows the value — anything that is not a full date is shown as
       text — and the toggle overrides that for as long as the book is open. */
    const dateField = function (label, key, value) {
      const iso = FT.isIsoDate(value) ? value : '';
      const legacy = !iso && value ? value : '';
      const mode = dateModeFor(key, value);
      const toggle =
        mode === 'pick'
          ? '<button type="button" class="date-mode" data-key="' + key + '" data-to="text" ' +
            'title="Enter an approximate date instead — c. 1880, spring 1943, before 1920" ' +
            'aria-label="Enter an approximate date instead">≈</button>'
          : '<button type="button" class="date-mode" data-key="' + key + '" data-to="pick" ' +
            'title="Use a date picker instead" aria-label="Use a date picker instead">' +
            '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">' +
              '<rect x="2" y="3.5" width="12" height="10" rx="1.5" fill="none" ' +
                'stroke="currentColor" stroke-width="1.4"/>' +
              '<path d="M2 6.5h12M5.5 2v3M10.5 2v3" stroke="currentColor" ' +
                'stroke-width="1.4" stroke-linecap="round"/>' +
            '</svg></button>';

      const control =
        mode === 'pick'
          ? '<input type="date" class="pf-input pf-datepick" data-field="' + key +
              '" value="' + iso + '" aria-label="' + label + '">' +
            (legacy
              ? '<span class="pf-legacy" title="The approximate date recorded here. ' +
                'Pick a date to replace it, or switch back to text to edit it.">was ' +
                FT.escapeHtml(legacy) + '</span>'
              : '')
          : '<input type="text" class="pf-input pf-datetext" data-field="' + key +
            '" value="' + FT.escapeHtml(value) + '" placeholder="c. 1880" aria-label="' +
            label + ' (approximate)">';

      // A div, not a label: a button inside a label forwards its click to the
      // labelled control, which would pop the date picker open on every toggle.
      return (
        '<div class="pf"><span class="pf-label">' + label + '</span>' +
        '<span class="pf-datewrap">' + control + toggle + '</span></div>'
      );
    };

    const genderField = function (value) {
      const opts = [['f', 'Woman'], ['m', 'Man'], ['x', 'Unspecified']];
      const cur = ['f', 'm', 'x'].indexOf(value) >= 0 ? value : 'x';
      return (
        '<div class="pf"><span class="pf-label">Gender</span>' +
        '<select class="pf-input pf-select" data-field="gender" aria-label="Gender">' +
          opts.map(function (o) {
            return '<option value="' + o[0] + '"' +
              (o[0] === cur ? ' selected' : '') + '>' + o[1] + '</option>';
          }).join('') +
        '</select></div>'
      );
    };

    /* Two lines, ellipsis past that, full text on hover. Editing swaps in a
       textarea on click (see openNoteEditor) — a clamped box cannot be typed in. */
    const clampField = function (label, key, value, placeholder) {
      const text = String(value || '');
      const empty = !text;
      // The clamped span must NOT be a grid item: a grid item's display is
      // blockified, which turns -webkit-box into flow-root and kills the clamp.
      // Hence the wrapper.
      return (
        '<div class="pf pf-tall"><span class="pf-label">' + label + '</span>' +
        '<div class="pf-clampwrap editable' + (empty ? ' empty' : '') + '"' +
          ' data-edit="' + key + '" tabindex="0" role="textbox"' +
          ' data-full="' + FT.escapeHtml(text) + '">' +
          '<span class="pf-clamp">' + FT.escapeHtml(empty ? placeholder : text) + '</span>' +
        '</div></div>'
      );
    };

    const toc = entries.length
      ? entries
          .map(function (e) {
            return (
              '<li><button class="toc-item' + (e.id === entryId ? ' current' : '') +
              '" data-entry="' + e.id + '">' +
              '<span class="toc-date" title="' + FT.escapeHtml(prettyRange(e)) + '">' +
                FT.escapeHtml(e.date || '—') +
                (e.end ? '<span class="toc-span" aria-label="spans to ' +
                  FT.escapeHtml(e.end) + '">→</span>' : '') +
              '</span>' +
              '<span class="toc-title">' +
              FT.escapeHtml(e.title || 'Untitled chapter') + '</span></button></li>'
            );
          })
          .join('')
      : '<li class="toc-empty">No chapters yet.</li>';

    leftPage.innerHTML =
      portraitHtml(p) +
      '<input class="person-name" data-field="name" value="' +
        FT.escapeHtml(p.name) + '" placeholder="Name">' +
      '<div class="person-fields">' +
        dateField('Born', 'birth', p.birth) +
        dateField('Died', 'death', p.death) +
        field('Born as', 'birthSurname', p.birthSurname, 'Surname before marrying') +
        field('From', 'birthplace', p.birthplace, 'Place') +
        genderField(p.gender) +
        clampField('Known for', 'knownFor', p.knownFor, 'A line or two about them') +
      '</div>' +
      '<div class="toc-head"><span>Chapters</span>' +
        '<button class="mini-btn" id="addEntry">+ New chapter</button>' +
      '</div>' +
      '<ul class="toc">' + toc + '</ul>';

    markClipped();
  }

  /* Only carry a tooltip when the text is genuinely cut off — a title on every
     field would just be noise. Measured, because it depends on the rendered width. */
  function markClipped() {
    leftPage.querySelectorAll('.pf-clampwrap').forEach(function (wrap) {
      const inner = wrap.querySelector('.pf-clamp');
      const full = wrap.dataset.full || '';
      const clipped = !!inner && inner.scrollHeight > inner.clientHeight + 1;
      wrap.classList.toggle('is-clipped', clipped);
      if (clipped && full) wrap.title = full;
      else wrap.removeAttribute('title');
    });
  }

  /* Swap the clamped box for a textarea so it can be typed into. The textarea
     carries data-field, so the existing input handler saves it as you type. */
  function openNoteEditor(clamp) {
    const p = person();
    if (!p) return;
    const key = clamp.dataset.edit;
    const ta = document.createElement('textarea');
    ta.className = 'pf-input pf-multiline';
    ta.rows = 2;
    ta.dataset.field = key;
    ta.placeholder = 'A line or two about them';
    ta.value = p[key] || '';
    clamp.replaceWith(ta);
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    ta.addEventListener('blur', function () {
      renderLeft(); // re-clamp and restore the tooltip
    }, { once: true });
  }

  // ------------------------------------------------------------ right page

  function renderRight(flip) {
    const p = person();
    if (!p) return;
    const e = entry();

    if (!e) {
      rightPage.innerHTML =
        '<div class="page-empty">' +
          '<div class="flourish">&#10086;</div>' +
          '<p>This book is unwritten.</p>' +
          '<button class="mini-btn" id="addEntryEmpty">Write the first chapter</button>' +
        '</div>';
      return;
    }

    // A chapter can cover a single day or a stretch of years, so the end date is
    // optional and only appears once asked for.
    const dates =
      '<div class="entry-dates">' +
        '<input type="date" class="entry-date" value="' + FT.escapeHtml(e.date) + '"' +
          (e.end ? ' max="' + FT.escapeHtml(e.end) + '"' : '') +
          ' aria-label="Chapter start date">' +
        (e.end
          ? '<span class="date-dash">–</span>' +
            '<input type="date" class="entry-end" value="' + FT.escapeHtml(e.end) + '"' +
              (e.date ? ' min="' + FT.escapeHtml(e.date) + '"' : '') +
              ' aria-label="Chapter end date">' +
            '<button class="date-clear" id="clearEnd" title="Remove the end date" ' +
              'aria-label="Remove the end date">&times;</button>'
          : '<button class="date-add" id="addEnd">+ end date</button>') +
      '</div>';

    rightPage.innerHTML =
      '<div class="entry-head">' +
        dates +
        '<button class="mini-btn danger" id="deleteEntry" title="Delete this chapter">' +
          'Delete</button>' +
      '</div>' +
      '<div class="entry-warn" id="entryWarn" hidden></div>' +
      '<input class="entry-title" value="' + FT.escapeHtml(e.title) +
        '" placeholder="Chapter title">' +
      '<textarea class="entry-body" placeholder="Write it down before it is lost…">' +
        FT.escapeHtml(e.body) + '</textarea>';

    autoGrow(rightPage.querySelector('.entry-body'));
    checkDates();

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

  /* min/max on the pickers stop most of this, but a typed date can still land
     out of order — say so rather than storing a backwards chapter silently. */
  function checkDates() {
    const warn = document.getElementById('entryWarn');
    const e = entry();
    if (!warn || !e) return;
    const bad = !!(e.end && e.date && e.end < e.date);
    warn.hidden = !bad;
    warn.textContent = bad ? 'This chapter ends before it starts.' : '';
  }

  // ---------------------------------------------------------------- public

  FT.openBook = function (id) {
    if (!FT.state.people[id]) return;
    personId = id;
    dateModes = {}; // each person starts from what their own dates imply
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
    if (!p) return;
    FT.checkpoint();
    const e = { id: FT.uid('e'), date: today(), end: '', title: '', body: '' };
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
    // Give the chapter an end date, starting from the day it began.
    if (e.target.closest('#addEnd')) {
      const cur = entry();
      if (!cur) return;
      FT.checkpoint();
      cur.end = cur.date || today();
      renderRight(false);
      renderLeft();
      const endEl = rightPage.querySelector('.entry-end');
      if (endEl) endEl.focus();
      touch();
      return;
    }
    if (e.target.closest('#clearEnd')) {
      const cur = entry();
      if (!cur) return;
      FT.checkpoint();
      cur.end = '';
      renderRight(false);
      renderLeft();
      touch();
      return;
    }
    const clamp = e.target.closest('.pf-clampwrap.editable');
    if (clamp) {
      openNoteEditor(clamp);
      return;
    }
    // Swap a date field between the picker and free text.
    const mode = e.target.closest('.date-mode');
    if (mode) {
      dateModes[mode.dataset.key] = mode.dataset.to;
      renderLeft();
      const field = leftPage.querySelector('[data-field="' + mode.dataset.key + '"]');
      if (field) field.focus();
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

  /* The clamped box is focusable, so it must open on Enter/Space too. */
  overlay.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const clamp = ev.target.closest && ev.target.closest('.pf-clampwrap.editable');
    if (!clamp) return;
    ev.preventDefault();
    openNoteEditor(clamp);
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
      if (t.dataset.field === 'gender') {
        const portrait = leftPage.querySelector('.portrait');
        if (portrait) portrait.dataset.gender = t.value;
      }
      // A picked date replaces the old free-text value it was shown beside.
      if ((t.dataset.field === 'birth' || t.dataset.field === 'death') && t.value) {
        const legacy = t.parentNode.querySelector('.pf-legacy');
        if (legacy) legacy.remove();
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
      touch();
    } else if (t.classList.contains('entry-date')) {
      FT.checkpoint('entry-date:' + e.id);
      e.date = t.value;
      // Keep the end picker's floor in step without re-rendering (that would
      // yank focus out of the field being edited).
      const endEl = rightPage.querySelector('.entry-end');
      if (endEl) endEl.min = e.date || '';
      renderLeft();
      checkDates();
      touch();
    } else if (t.classList.contains('entry-end')) {
      FT.checkpoint('entry-end:' + e.id);
      e.end = t.value;
      const startEl = rightPage.querySelector('.entry-date');
      if (startEl) startEl.max = e.end || '';
      renderLeft();
      checkDates();
      touch();
    }
  });
})();
