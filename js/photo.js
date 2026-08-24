/* Ancestree — turning a picked file into a portrait.

   Photos live inside the document itself (they travel in export files), so the
   original is never kept. Everything is cropped square and
   downscaled to a thumbnail first: a 4 MB phone photo comes out around 15 KB. */
(function () {
  const FT = window.FT;

  const SIZE = 256;      // enough for the 76px book portrait on a retina screen
  const QUALITY = 0.78;
  const MAX_INPUT = 40 * 1024 * 1024;

  /* Halve repeatedly before the final draw. One big downscale step aliases
     badly — hair and eyes turn to noise — while successive halving stays smooth. */
  function downscale(img) {
    let src = img;
    let w = img.naturalWidth || img.width;
    let h = img.naturalHeight || img.height;
    if (!w || !h) throw new Error('the image has no size');

    while (w > SIZE * 2 && h > SIZE * 2) {
      const half = document.createElement('canvas');
      half.width = Math.max(1, Math.floor(w / 2));
      half.height = Math.max(1, Math.floor(h / 2));
      const hctx = half.getContext('2d');
      hctx.imageSmoothingEnabled = true;
      hctx.imageSmoothingQuality = 'high';
      hctx.drawImage(src, 0, 0, half.width, half.height);
      src = half;
      w = half.width;
      h = half.height;
    }

    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    // JPEG has no alpha; without this, transparent PNGs come out on black.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Cover-crop to a square, biased upward — faces sit above centre.
    const scale = Math.max(SIZE / w, SIZE / h);
    const dw = w * scale;
    const dh = h * scale;
    const dx = (SIZE - dw) / 2;
    const dy = dh > SIZE ? (SIZE - dh) * 0.38 : (SIZE - dh) / 2;
    ctx.drawImage(src, dx, dy, dw, dh);

    return canvas.toDataURL('image/jpeg', QUALITY);
  }

  /* Resolves to a data: URL ready to store on a person. */
  FT.readPhoto = function (file) {
    return new Promise(function (resolve, reject) {
      if (!file) return reject(new Error('no file'));
      if (!/^image\//.test(file.type || '')) {
        return reject(new Error('that is not an image'));
      }
      if (file.size > MAX_INPUT) {
        return reject(new Error('that image is enormous — try a smaller one'));
      }

      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        let data;
        try {
          data = downscale(img);
        } catch (e) {
          return reject(new Error('that image could not be read'));
        }
        const safe = FT.safePhoto(data);
        if (!safe) return reject(new Error('that image could not be read'));
        resolve(safe);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('that image could not be read'));
      };
      img.src = url;
    });
  };

  /* Shared entry point for the book's picker and drag-and-drop onto a card. */
  FT.setPhotoFrom = function (personId, file) {
    const person = FT.state.people[personId];
    if (!person || FT.readOnly) return Promise.resolve(false);
    return FT.readPhoto(file).then(
      function (data) {
        FT.checkpoint();
        person.photo = data;
        FT.save();
        FT.render();
        FT.emit('photo', { id: personId });
        return true;
      },
      function (err) {
        FT.emit('hint', { text: 'Could not use that file — ' + err.message + '.' });
        return false;
      }
    );
  };

  FT.clearPhoto = function (personId) {
    const person = FT.state.people[personId];
    if (!person || FT.readOnly || !person.photo) return;
    FT.checkpoint();
    person.photo = '';
    FT.save();
    FT.render();
    FT.emit('photo', { id: personId });
  };
})();
