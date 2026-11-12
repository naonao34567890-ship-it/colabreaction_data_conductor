import assert from 'node:assert/strict';
import { memoryStorage } from './support/memory-durable-storage.mjs';
import { LibraryCoordinator } from '../standalone-drive/library-coordinator.mjs';
const objects = new Map(),
  storage = new Map();
let n = 0,
  failPatch = false;
const original = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url),
    id = u.pathname.split('/').pop();
  if (init.method === 'POST') {
    const value = JSON.parse(init.body);
    const key = 'file' + ++n;
    objects.set(key, { meta: value, body: '' });
    return Response.json({ id: key });
  }
  if (init.method === 'PATCH') {
    if (failPatch) return new Response('', { status: 500 });
    objects.get(id).body = init.body;
    return Response.json({ id });
  }
  return new Response(objects.get(id)?.body || '', { status: objects.has(id) ? 200 : 404 });
};
try {
  const c = new LibraryCoordinator({
    storage: memoryStorage(storage),
  });
  const call = (body) =>
    c.fetch(
      new Request('https://internal/library', {
        method: 'POST',
        body: JSON.stringify({ accessToken: 'test-only', ...body }),
      }),
    );
  const first = await (await call({ action: 'head' })).json();
  assert.equal(first.head.generation, 'initial');
  const ids = first.ids;
  const value = (g) => ({ ...first.head, generation: g });
  const [a, b] = await Promise.all([
    call({ action: 'commit', expectedGeneration: 'initial', nextHead: value('a') }),
    call({ action: 'commit', expectedGeneration: 'initial', nextHead: value('b') }),
  ]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 409, 'simultaneous stale writes cannot overwrite');
  const later = await call({
    action: 'commit',
    expectedGeneration: 'a',
    nextHead: { ...value('later'), operations: [] },
  });
  assert.equal(later.status, 200);
  let previous = 'later';
  for (let i = 0; i < 130; i++) {
    const generation = 'g' + i;
    assert.equal(
      (await call({ action: 'commit', expectedGeneration: previous, nextHead: value(generation) }))
        .status,
      200,
    );
    previous = generation;
  }
  const again = await (
    await call({ action: 'commit', expectedGeneration: 'initial', nextHead: value('a') })
  ).json();
  assert.equal(again.alreadyCommitted, true);
  failPatch = true;
  assert.equal(
    (await call({ action: 'commit', expectedGeneration: 'g129', nextHead: value('c') })).status,
    502,
  );
  failPatch = false;
  assert.equal(
    (await (await call({ action: 'head' })).json()).head.generation,
    'g129',
    'failed write leaves canonical head unchanged',
  );
  const restarted = new LibraryCoordinator({
    storage: memoryStorage(storage),
  });
  const current = await (
    await restarted.fetch(
      new Request('https://internal/', {
        method: 'POST',
        body: JSON.stringify({ accessToken: 'test-only', action: 'head' }),
      }),
    )
  ).json();
  for (const key of ['root', 'molecules', 'reactions', 'indexes'])
    assert.equal(current.ids[key], ids[key]);
  assert.notEqual(current.ids.head, ids.head);
  assert.equal(
    JSON.parse(objects.get(ids.head).body).generation,
    'initial',
    'old catalogue files are immutable',
  );
  assert.equal(current.head.generation, 'g129');
  console.log(
    'PASS coordinator serializes simultaneous commits, detects stale generations, handles lost-response retries, preserves failed writes, and reuses Drive IDs after restart',
  );
} finally {
  globalThis.fetch = original;
}
