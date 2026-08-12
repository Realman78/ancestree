/* Share-link encoding: compression, URL safety, round trips, fallbacks. */
module.exports = async function (t, h) {
  const dom = await h.loadPage();
  const FT = dom.window.FT;

  t.section('payload');
  const doc = FT.demoTree();
  const payload = await FT.encodeDoc(doc);
  t.ok(/^[A-Za-z0-9_-]+$/.test(payload.slice(1)), 'payload is URL-safe — no escaping needed');
  const back = await FT.decodeDoc(payload);
  t.ok(JSON.stringify(back) === JSON.stringify(doc), 'round-trips byte-identically');

  const rawLen = JSON.stringify(doc).length;
  t.note(rawLen + ' B of JSON becomes a ' + payload.length + ' B link');

  t.section('a large tree');
  const big = FT.demoTree();
  for (let i = 0; i < 300; i++) {
    const p = FT.newPerson({ name: 'Person Number ' + i, birth: '19' + (10 + (i % 80)) + '-01-01' });
    p.entries = [{ id: 'e' + i, date: '1970-01-01', end: '', title: 'Chapter ' + i, body: 'x'.repeat(600) }];
    big.people[p.id] = p;
  }
  const bigPayload = await FT.encodeDoc(big);
  const bigBack = await FT.decodeDoc(bigPayload);
  t.ok(
    Object.keys(bigBack.people).length === Object.keys(big.people).length,
    'a 300-person tree round-trips (link is ' + Math.round(bigPayload.length / 1024) + ' KB)'
  );

  t.section('fallback');
  // jsdom has no CompressionStream, so this exercises the uncompressed path that
  // an older browser would take.
  t.ok(payload[0] === 'z' || payload[0] === 'u', 'payload declares its encoding');
  const plain = await FT.decodeDoc('u' + Buffer.from(JSON.stringify(doc), 'utf8').toString('base64url'));
  t.ok(plain.title === doc.title, 'an uncompressed payload decodes too');
};
