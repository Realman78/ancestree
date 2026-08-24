/* Portraits: downscaling, rejection of hostile image data, and where they show. */
module.exports = async function (t, h) {
  const Canvas = require('canvas');

  // A "photograph" big enough that the downscaler has real work to do.
  const src = Canvas.createCanvas(2400, 1600);
  const g = src.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 2400, 1600);
  grad.addColorStop(0, '#c94f3d');
  grad.addColorStop(1, '#2d4a7a');
  g.fillStyle = grad;
  g.fillRect(0, 0, 2400, 1600);
  g.fillStyle = '#ffd9a0';
  g.beginPath();
  g.arc(1200, 600, 300, 0, Math.PI * 2);
  g.fill();
  const buf = src.toBuffer('image/png');
  const dataUrl = src.toDataURL('image/png');

  const dom = await h.loadPage(h.BASE, {
    beforeParse(w) {
      // jsdom cannot load blob: URLs; hand the <img> the same bytes directly.
      w.URL.createObjectURL = () => dataUrl;
      w.URL.revokeObjectURL = () => {};
    },
  });
  const w = dom.window;
  const d = w.document;
  const FT = w.FT;
  const $ = (s) => d.querySelector(s);
  const $$ = (s) => Array.from(d.querySelectorAll(s));
  d.querySelector('[data-action="demo"]').click();
  await h.wait(200);

  const file = new w.File([new Uint8Array(buf)], 'gran.png', { type: 'image/png' });
  const josip = Object.keys(FT.state.people).find((id) => FT.state.people[id].name === 'Joseph Miller');
  const ana = Object.keys(FT.state.people).find((id) => FT.state.people[id].name === 'Ruth Miller');

  t.section('downscaling');
  const data = await FT.readPhoto(file);
  t.ok(/^data:image\/jpeg;base64,/.test(data), 'produces a jpeg data URL');
  t.ok(FT.safePhoto(data) === data, 'passes its own safety check');
  t.ok(data.length / 1024 < 40, 'thumbnail is small (' + (data.length / 1024).toFixed(1) + ' KB from ' + Math.round(buf.length / 1024) + ' KB)');
  const probe = new Canvas.Image();
  probe.src = data;
  t.ok(probe.width === 256 && probe.height === 256, 'cropped square at 256px');

  t.section('rejections');
  [
    ['javascript:alert(1)', 'a javascript: URL'],
    ['https://evil.example/track.png', 'a remote URL (would phone home)'],
    ['data:image/svg+xml;base64,PHN2Zz4=', 'svg (can carry script)'],
    ['data:image/png;base64,not base64!!', 'malformed base64'],
    [{}, 'a non-string'],
  ].forEach(([v, what]) => t.ok(FT.safePhoto(v) === '', 'rejects ' + what));
  await FT.readPhoto(new w.File(['hello'], 'a.txt', { type: 'text/plain' })).then(
    () => t.ok(false, 'rejects a non-image file'),
    (e) => t.ok(/not an image/.test(e.message), 'rejects a non-image file')
  );

  t.section('on the card');
  await FT.setPhotoFrom(josip, file);
  const card = $$('.card').find((c) => c.dataset.id === josip);
  t.ok(!!card.querySelector('.avatar.has-photo img'), 'the card shows the portrait');
  t.ok(card.querySelector('.avatar img').getAttribute('src') === FT.state.people[josip].photo, 'pointing at the stored photo');
  const imgBefore = card.querySelector('.avatar img');
  FT.render();
  FT.render();
  t.ok(card.querySelector('.avatar img') === imgBefore, 'repeated renders do not rebuild it (no flicker)');
  FT.state.people[josip].name = 'Joseph Miller Sr.';
  FT.render();
  t.ok(card.querySelector('.name').textContent === 'Joseph Miller Sr.', 'but a real change still re-renders');

  t.section('drag onto a card');
  const target = $$('.card').find((c) => c.dataset.id === ana);
  const ev = new w.Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'dataTransfer', { value: { types: ['Files'], files: [file], dropEffect: '' } });
  target.dispatchEvent(ev);
  await h.wait(250);
  t.ok(!!FT.state.people[ana].photo, 'dropping an image on a card sets that portrait');
  t.ok(!!target.querySelector('.avatar.has-photo img'), 'and the card updates');

  t.section('in the book');
  FT.openBook(josip);
  t.ok(!!$('#pageLeft .portrait-img'), 'the book shows the portrait');
  t.ok(!!$('#pageLeft .photo-input'), 'and offers a picker');
  const nameEl = $('#pageLeft .person-name');
  nameEl.value = 'Joseph M.';
  nameEl.dispatchEvent(new w.Event('input', { bubbles: true }));
  t.ok(!!$('#pageLeft .portrait-img'), 'renaming does not wipe the portrait');

  $('#removePhoto').click();
  t.ok(FT.state.people[josip].photo === '', 'remove clears the photo');
  t.ok(!$('#pageLeft .portrait-img') && !!$('#pageLeft .initials'), 'the book falls back to initials');

  const input = $('#pageLeft .photo-input');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new w.Event('change', { bubbles: true }));
  await h.wait(250);
  t.ok(!!FT.state.people[josip].photo, 'picking a file in the book sets the photo');
  FT.undo();
  t.ok(FT.state.people[josip].photo === '', 'undo reverses a photo change');
  FT.redo();
  FT.closeBook();

  t.section('photos in an export');
  t.ok(FT.photoCount(FT.state) === 2, 'two photos in the tree');
  const json = JSON.parse(JSON.stringify(FT.state));
  t.ok(FT.photoCount(json) === 2, 'a JSON export carries them');
  t.ok(/<image /.test(FT.buildSvg()), 'and an SVG export draws them');

  t.section('hostile photo in an imported file');
  const evil = FT.normalize({
    title: 'x',
    people: { e1: { name: 'A', photo: 'javascript:alert(1)' }, e2: { name: 'B', photo: 'https://evil.example/pixel.png' } },
    unions: {},
  });
  t.ok(evil.people.e1.photo === '' && evil.people.e2.photo === '', 'stripped on the way in');
  FT.adoptDocument(evil);
  t.ok(d.querySelectorAll('#nodes img').length === 0, 'nothing is loaded or rendered');
};
