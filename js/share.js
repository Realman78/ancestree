/* Heirloom — sharing.

   Two routes, in order of preference:
     1. If the app is served over http (`node server.js`), POST the document and
        get a short link back:  .../#s=ab12cd
     2. Otherwise pack the whole document into the URL fragment itself:  #d=<payload>
        The fragment never leaves the browser, so this works straight from file://.

   Either way the recipient opens a read-only view with a "Make a copy" escape
   hatch. There are no accounts — a link is the permission. */
(function () {
  const FT = window.FT;

  const dialog = document.getElementById('shareDialog');
  const linkBox = document.getElementById('shareLink');
  const shareNote = document.getElementById('shareNote');
  const shareSpinner = document.getElementById('shareSpinner');
  const copyBtn = document.getElementById('copyLink');

  // ------------------------------------------------------ payload encoding

  function bytesToB64url(bytes) {
    let bin = '';
    const CHUNK = 0x8000; // avoid blowing the argument limit on big documents
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function b64urlToBytes(s) {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function encodeDoc(doc) {
    const json = JSON.stringify(doc);
    const bytes = new TextEncoder().encode(json);
    if (typeof CompressionStream === 'function') {
      try {
        const cs = new CompressionStream('deflate-raw');
        const writer = cs.writable.getWriter();
        writer.write(bytes);
        writer.close();
        const buf = await new Response(cs.readable).arrayBuffer();
        return 'z' + bytesToB64url(new Uint8Array(buf));
      } catch (e) {
        /* fall through to the uncompressed form */
      }
    }
    return 'u' + bytesToB64url(bytes);
  }

  async function decodeDoc(payload) {
    const kind = payload[0];
    const bytes = b64urlToBytes(payload.slice(1));
    if (kind === 'z') {
      const ds = new DecompressionStream('deflate-raw');
      const writer = ds.writable.getWriter();
      writer.write(bytes);
      writer.close();
      const buf = await new Response(ds.readable).arrayBuffer();
      return JSON.parse(new TextDecoder().decode(buf));
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  FT.encodeDoc = encodeDoc;
  FT.decodeDoc = decodeDoc;

  // -------------------------------------------------------------- dialogue

  function baseUrl() {
    return location.origin === 'null'
      ? location.href.split('#')[0]
      : location.origin + location.pathname;
  }

  const photoRow = document.getElementById('photoToggleRow');
  const photoToggle = document.getElementById('includePhotos');
  const photoCost = document.getElementById('photoCost');

  let building = false;

  async function buildLink() {
    if (building) return;
    building = true;
    linkBox.value = '';
    shareSpinner.hidden = false;
    shareNote.textContent = 'Packing up the tree…';
    copyBtn.disabled = true;

    const doc = photoToggle.checked ? FT.clone(FT.state) : FT.withoutPhotos(FT.state);
    let url = null;

    // Route 1: short link from the local server, when one is running.
    if (location.protocol === 'http:' || location.protocol === 'https:') {
      try {
        const res = await fetch('api/share', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(doc),
        });
        if (res.ok) {
          const data = await res.json();
          if (data && data.id) url = baseUrl() + '#s=' + data.id;
        }
      } catch (e) {
        /* no server — fall back to the self-contained link */
      }
    }

    let selfContained = false;
    if (!url) {
      url = baseUrl() + '#d=' + (await encodeDoc(doc));
      selfContained = true;
    }

    shareSpinner.hidden = true;
    linkBox.value = url;
    copyBtn.disabled = false;

    if (selfContained) {
      const kb = Math.max(1, Math.round(url.length / 1024));
      shareNote.textContent =
        'This link carries the whole tree inside it (' + kb + ' KB) — no server ' +
        'needed. Anyone with it sees a read-only copy as it is right now.';
      // Links this long survive in a browser but get mangled by mail and chat apps.
      if (url.length > 30000) {
        shareNote.textContent +=
          ' That is too long for most chat and mail apps to carry intact — turn off ' +
          'photos, or run the local server for a short link.';
      }
    } else {
      shareNote.textContent =
        'A snapshot is saved on the server. Anyone with this link sees a read-only ' +
        'copy as it is right now. Share again to publish later changes.';
    }
    linkBox.focus();
    linkBox.select();
    building = false;
  }

  FT.openShare = function () {
    dialog.hidden = false;
    dialog.classList.add('open');

    // Photos dominate the size of a link, so make the cost visible and optional.
    const n = FT.photoCount(FT.state);
    photoRow.hidden = n === 0;
    if (n) {
      const bytes =
        JSON.stringify(FT.state).length - JSON.stringify(FT.withoutPhotos(FT.state)).length;
      photoCost.textContent =
        n + (n === 1 ? ' photo, about ' : ' photos, about ') +
        Math.max(1, Math.round(bytes / 1024)) + ' KB';
      photoToggle.checked = true;
    }
    return buildLink();
  };

  if (photoToggle) photoToggle.addEventListener('change', buildLink);

  FT.closeShare = function () {
    dialog.classList.remove('open');
    setTimeout(function () {
      dialog.hidden = true;
    }, 180);
  };

  dialog.addEventListener('click', function (e) {
    if (e.target === dialog || e.target.closest('#closeShare')) FT.closeShare();
  });

  copyBtn.addEventListener('click', async function () {
    linkBox.select();
    let ok = false;
    try {
      await navigator.clipboard.writeText(linkBox.value);
      ok = true;
    } catch (e) {
      try {
        ok = document.execCommand('copy'); // file:// has no clipboard API
      } catch (e2) {
        ok = false;
      }
    }
    copyBtn.textContent = ok ? 'Copied' : 'Press Ctrl+C';
    setTimeout(function () {
      copyBtn.textContent = 'Copy link';
    }, 1600);
  });

  // --------------------------------------------------------- file exchange

  FT.exportFile = function () {
    const blob = new Blob([JSON.stringify(FT.state, null, 2)], {
      type: 'application/json',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download =
      (FT.state.title || 'family-tree').replace(/[^\w\-]+/g, '-').toLowerCase() + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
    }, 1000);
  };

  FT.importFile = function (file) {
    const reader = new FileReader();
    reader.onload = function () {
      try {
        const doc = FT.normalize(JSON.parse(reader.result));
        FT.adoptDocument(doc, false);
        FT.emit('hint', { text: 'Imported “' + doc.title + '”.' });
      } catch (e) {
        FT.emit('hint', { text: 'That file could not be read as a family tree.' });
      }
    };
    reader.readAsText(file);
  };

  // ------------------------------------------------- opening a shared link

  /* Resolves to 'loaded', 'failed', or 'none'. The caller reports the failure —
     it has to fall back to a local document first, and whatever it says about
     that would otherwise bury the message. */
  FT.consumeShareLink = async function () {
    const hash = location.hash || '';
    const inline = /^#d=(.+)$/.exec(hash);
    const short = /^#s=([\w-]+)$/.exec(hash);
    if (!inline && !short) return 'none';

    try {
      let raw;
      if (inline) {
        raw = await decodeDoc(decodeURIComponent(inline[1]));
      } else {
        const res = await fetch('api/share/' + short[1]);
        if (!res.ok) throw new Error('not found');
        raw = await res.json();
      }
      FT.adoptDocument(FT.normalize(raw), true);
      return 'loaded';
    } catch (e) {
      return 'failed';
    }
  };
})();
