/* End-to-end sharing: generate a link, then open it as a fresh visitor. */
module.exports = async function (t, h) {
  const author = await h.loadPage();
  const FTa = author.window.FT;

  const josip = Object.keys(FTa.state.people).find((id) => FTa.state.people[id].name === 'Josip Kovač');
  FTa.state.people[josip].entries.push({
    id: 'zz', date: '1955-01-01', end: '1957-06-30', title: 'A note for the link', body: 'Secret family recipe.',
  });
  FTa.state.title = 'Kovač — shared copy';
  FTa.save();

  t.section('the short link (server route)');
  await FTa.openShare();
  const link = author.window.document.getElementById('shareLink').value;
  t.ok(/#s=[a-f0-9]{10}$/.test(link), 'the server produced a short link');

  const guest = await h.loadPage(link);
  const FTb = guest.window.FT;
  t.ok(guest.window.document.body.classList.contains('read-only'), 'it opens read-only');
  t.ok(FTb.state.title === 'Kovač — shared copy', 'the shared title came through');
  t.ok(
    guest.window.document.querySelectorAll('.card').length === Object.keys(FTa.state.people).length,
    'every person came through'
  );
  const j2 = Object.keys(FTb.state.people).find((id) => FTb.state.people[id].name === 'Josip Kovač');
  t.ok(FTb.state.people[j2].entries.some((e) => e.body === 'Secret family recipe.'), 'diary entries came through');
  t.ok(FTb.state.people[j2].entries.some((e) => e.end === '1957-06-30'), 'chapter end dates came through');
  FTb.openBook(j2);
  t.ok(guest.window.document.querySelectorAll('#pageLeft .toc-item').length === 3, 'all chapters are readable');
  t.ok(!guest.window.document.querySelector('#pageRight textarea'), 'and cannot be edited');

  t.section('the self-contained link (works from file://)');
  const payload = await FTa.encodeDoc(FTa.state);
  const inline = await h.loadPage(h.BASE + '#d=' + payload);
  t.ok(inline.window.document.body.classList.contains('read-only'), 'it opens read-only');
  t.ok(inline.window.FT.state.title === 'Kovač — shared copy', 'the whole tree decoded from the URL alone');
  const j3 = Object.keys(inline.window.FT.state.people).find(
    (id) => inline.window.FT.state.people[id].name === 'Josip Kovač'
  );
  t.ok(inline.window.FT.state.people[j3].entries.length === 3, 'the diary survived the round trip');

  t.section('a damaged link');
  const broken = await h.loadPage(h.BASE + '#d=zBROKENPAYLOAD');
  t.ok(!!broken.window.document.getElementById('stage'), 'the app still loads');
  t.ok(
    broken.window.document.getElementById('hint').textContent.includes('could not be opened'),
    'and says so plainly rather than showing a blank page'
  );
};
