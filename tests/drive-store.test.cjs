// Requires Playwright and Chromium; all Google/Worker traffic is a local fake.
const { chromium } = require('playwright'),
  fs = require('fs'),
  path = require('path'),
  assert = require('node:assert/strict');
(async () => {
  const { LibraryCoordinator } = await import('../standalone-drive/library-coordinator.mjs');
  const { memoryStorage } = await import('./support/memory-durable-storage.mjs');
  const files = new Map(),
    coordinators = new Map();
  let number = 0,
    failCommit = false,
    resumableCount = 0,
    loseAck = false;
  async function google(url, init = {}) {
    const u = new URL(url),
      headers = new Headers(init.headers),
      owner = headers.get('Authorization')?.replace('Bearer access-', '');
    const id = u.pathname.split('/').pop();
    if (init.method === 'POST' && u.searchParams.get('uploadType') === 'resumable') {
      const key = 'file' + ++number;
      files.set(key, {
        owner,
        meta: JSON.parse(init.body),
        body: '',
        total: Number(headers.get('X-Upload-Content-Length')),
      });
      resumableCount++;
      return new Response(null, {
        status: 200,
        headers: { Location: 'https://www.googleapis.com/upload/resume/' + key },
      });
    }
    if (init.method === 'PUT') {
      const entry = files.get(id);
      if (!entry || entry.owner !== owner) return new Response('', { status: 404 });
      const range = headers.get('Content-Range').match(/bytes (\d+)-(\d+)\/(\d+)/);
      assert.equal(Number(range[1]), Buffer.byteLength(entry.body));
      entry.body += String(init.body);
      if (Buffer.byteLength(entry.body) < entry.total)
        return new Response(null, {
          status: 308,
          headers: { Range: 'bytes=0-' + (Buffer.byteLength(entry.body) - 1) },
        });
      return Response.json({ id });
    }
    if (init.method === 'POST') {
      let meta,
        body = '';
      const type = headers.get('Content-Type') || '';
      if (type.includes('multipart/related')) {
        const boundary = type.split('boundary=')[1],
          parts = String(init.body).split('--' + boundary);
        meta = JSON.parse(parts[1].split('\r\n\r\n')[1]);
        body = parts[2].slice(parts[2].indexOf('\r\n\r\n') + 4, -2);
      } else meta = JSON.parse(init.body);
      const key = 'file' + ++number;
      files.set(key, { owner, meta, body });
      return Response.json({ id: key });
    }
    const entry = files.get(id);
    if (!entry || entry.owner !== owner)
      return Response.json({ error: 'missing' }, { status: 404 });
    if (init.method === 'PATCH') {
      if (failCommit && entry.meta.name.startsWith('library-catalogue'))
        return new Response('', { status: 500 });
      entry.body = String(init.body);
      return Response.json({ id });
    }
    return new Response(entry.body, { headers: { 'Content-Type': 'application/json' } });
  }
  const originalFetch = global.fetch;
  global.fetch = google;
  function coordinator(owner) {
    if (!coordinators.has(owner)) {
      const values = new Map();
      coordinators.set(
        owner,
        new LibraryCoordinator({
          storage: memoryStorage(values),
        }),
      );
    }
    return coordinators.get(owner);
  }
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    headless: true,
    args: ['--no-sandbox'],
  });
  const errors = [];
  async function context() {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
    await ctx.route('https://mol-bench.web.app/**', async (r) => {
      const pathname = new URL(r.request().url()).pathname;
      if (pathname === '/seed.html')
        return r.fulfill({ body: '<!doctype html><body>seed</body>', contentType: 'text/html' });
      const file = path.join(__dirname, '../dist', pathname === '/' ? 'index.html' : pathname);
      if (fs.existsSync(file)) await r.fulfill({ path: file });
      else await r.fulfill({ status: 404, body: 'missing' });
    });
    await ctx.route('https://mol-bench-drive.naonao34567890.workers.dev/**', async (r) => {
      const req = r.request(),
        owner = req.headers().authorization?.includes('b'.repeat(64)) ? 'second' : 'owner';
      if (req.url().endsWith('/token'))
        return r.fulfill({
          json: { state: 'connected', access_token: 'access-' + owner },
          headers: { 'Access-Control-Allow-Origin': 'https://mol-bench.web.app' },
        });
      const result = await coordinator(owner).fetch(
        new Request('https://internal/', {
          method: 'POST',
          body: JSON.stringify({ ...JSON.parse(req.postData()), accessToken: 'access-' + owner }),
        }),
      );
      const value = await result.json();
      if (loseAck && JSON.parse(req.postData()).action === 'commit' && result.status === 200) {
        loseAck = false;
        return r.fulfill({
          status: 502,
          json: { state: 'drive_error' },
          headers: { 'Access-Control-Allow-Origin': 'https://mol-bench.web.app' },
        });
      }
      await r.fulfill({
        status: result.status,
        json: { ...value, account: { sub: owner, email: owner + '@example.com' } },
        headers: { 'Access-Control-Allow-Origin': 'https://mol-bench.web.app' },
      });
    });
    await ctx.route('https://www.googleapis.com/**', async (r) => {
      const req = r.request(),
        response = await google(req.url(), {
          method: req.method(),
          headers: req.headers(),
          body: req.postData(),
        });
      await r.fulfill({
        status: response.status,
        body: await response.text(),
        headers: {
          ...Object.fromEntries(response.headers),
          'Access-Control-Allow-Origin': 'https://mol-bench.web.app',
          'Access-Control-Expose-Headers': 'Location, Range',
        },
      });
    });
    ctx.on('page', (p) => {
      p.on('pageerror', (e) => errors.push(e.message));
      p.on('dialog', (d) => d.accept());
    });
    return ctx;
  }
  try {
    const disconnectedContext = await context(),
      disconnected = await disconnectedContext.newPage();
    await disconnected.goto('https://mol-bench.web.app/');
    const message = await disconnected.evaluate(async () => {
      try {
        await Mol.cloud.ready;
        return '';
      } catch (error) {
        return error.message;
      }
    });
    assert.ok(
      message.includes('Driveに接続'),
      'disconnected startup asks for Drive instead of failing with a TypeError',
    );
    await disconnectedContext.close();
    const ctx = await context(),
      p = await ctx.newPage();
    await p.goto('https://mol-bench.web.app/seed.html');
    await p.evaluate(async () => {
      localStorage.setItem('mol-bench-drive-connection-v1', 'a'.repeat(64));
      await new Promise((res, rej) => {
        const r = indexedDB.open('molecular-xyz-library', 2);
        r.onupgradeneeded = () => {
          const db = r.result,
            s = db.createObjectStore('meta', { keyPath: 'id' });
          s.createIndex('name', 'name', { unique: true });
          s.createIndex('tags', 'tags', { multiEntry: true });
          db.createObjectStore('body', { keyPath: 'id' });
          db.createObjectStore('thumb', { keyPath: 'id' });
          db.createObjectStore('tags', { keyPath: 'name' });
        };
        r.onsuccess = () => {
          const db = r.result,
            tx = db.transaction(['meta', 'body', 'tags'], 'readwrite');
          tx.objectStore('meta').put({
            id: 'legacy-id',
            name: 'legacy',
            count: 1,
            addedAt: 123,
            bytes: 25,
            tags: ['old-tag'],
          });
          tx.objectStore('body').put({
            id: 'legacy-id',
            name: 'legacy',
            atoms: [{ el: 'C', x: 0, y: 0, z: 0 }],
            raw: new Blob(['1\r\nkeep comment\r\nC 0 0 0\r\n']),
            comment: 'keep comment',
            edited: false,
          });
          tx.objectStore('tags').put({ name: 'old-tag' });
          tx.oncomplete = () => {
            db.close();
            res();
          };
          tx.onabort = () => rej(tx.error);
        };
      });
      await new Promise((res) => {
        const r = indexedDB.open('molecular-xyz-reactions', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('reactions', { keyPath: 'id' });
        r.onsuccess = () => {
          const db = r.result,
            t = db.transaction('reactions', 'readwrite');
          t.objectStore('reactions').add({
            id: 'legacy-reaction',
            name: 'old reaction',
            createdAt: 12,
            START: { atoms: [{ el: 'O', x: 1, y: 2, z: 3 }], edited: true, revision: 'old-start' },
            tags: ['keep'],
          });
          t.oncomplete = () => {
            db.close();
            res();
          };
        };
      });
    });
    await p.goto('https://mol-bench.web.app/');
    await p.evaluate(() => Mol.cloud.ready);
    const initial = await p.evaluate(async () => ({
      ids: (await Mol.metadata()).map((m) => m.id),
      raw: await (await Mol.get('body', 'legacy-id')).raw.text(),
      oldCount: await new Promise((res) => {
        const r = indexedDB.open('molecular-xyz-library');
        r.onsuccess = () => {
          const db = r.result,
            q = db.transaction('meta').objectStore('meta').count();
          q.onsuccess = () => {
            db.close();
            res(q.result);
          };
        };
      }),
    }));
    assert.ok(initial.ids.includes('legacy-id'));
    assert.equal(initial.raw, '1\r\nkeep comment\r\nC 0 0 0\r\n');
    assert.equal(initial.oldCount, 1, 'migration keeps original local data');
    const fenced = await p.evaluate(
      () =>
        new Promise((resolve) => {
          const request = indexedDB.open('molecular-xyz-library', 2);
          request.onerror = (event) => {
            event.preventDefault();
            resolve(request.error.name);
          };
          request.onsuccess = () => {
            request.result.close();
            resolve('unexpected success');
          };
        }),
    );
    assert.equal(fenced, 'VersionError', 'old local writers cannot reopen the migrated source');
    await p.evaluate(() => localStorage.removeItem('mol-bench-legacy-owner'));
    await p.reload();
    await p.evaluate(() => Mol.cloud.ready);
    assert.equal(
      await p.evaluate(async () => (await Mol.metadata()).filter((m) => !m.builtin).length),
      1,
      'resuming migration reuses canonical IDs',
    );
    const created = await p.evaluate(async () => {
      const rows = await Mol.saveBatch([
        { name: 'new molecule', atoms: [{ el: 'H', x: 0, y: 0, z: 1 }], edited: true },
      ]);
      await Mol.renameMolecule(rows[0].id, 'renamed');
      return rows[0].id;
    });
    await p.evaluate(async (id) => {
      await Mol.cloud.call('tagsTransaction', (catalog, meta, done) => {
        catalog.add({ name: 'new tag' });
        const q = meta.get(id);
        q.onsuccess = () => {
          const m = { ...q.result, tags: ['new tag'] };
          meta.put(m);
          done([m]);
        };
      });
    }, created);
    assert.deepEqual(await p.evaluate(async (id) => (await Mol.get('meta', id)).tags, created), [
      'new tag',
    ]);
    await p.goto('https://mol-bench.web.app/reactions.html');
    await p.evaluate(() => Mol.cloud.ready);
    const reaction = await p.evaluate(async () => {
      const saved = await ReactionStore.create(
        'START',
        { atoms: [{ el: 'H', x: 0, y: 0, z: 0 }], edited: true, revision: 's' },
        'new reaction',
      );
      await ReactionStore.update(saved.id, {
        FINISH: { atoms: [{ el: 'O', x: 1, y: 1, z: 1 }], edited: true, revision: 'f' },
      });
      await ReactionStore.tag([saved.id], 'react-tag', true);
      const result = await ReactionStore.read(saved.id);
      return { id: saved.id, tags: result.tags, START: result.START, FINISH: result.FINISH };
    });
    assert.ok(reaction.START && reaction.FINISH);
    assert.deepEqual(reaction.tags, ['react-tag']);
    const reactionCheck = await p.evaluate(async (id) => {
      let rejected = false;
      try {
        await ReactionStore.update(
          id,
          { START: { atoms: [{ el: 'F', x: 8, y: 8, z: 8 }], revision: 'bad' } },
          (r) => r.START.revision === 'stale',
        );
      } catch {
        rejected = true;
      }
      const record = await ReactionStore.read(id);
      await ReactionStore.cacheStartPreview(id, 's', 'data:image/png;base64,AA', 'test');
      const cached = await ReactionStore.read(id);
      await ReactionStore.clearStartPreviews();
      return { rejected, finish: record.FINISH.revision, cached: !!cached.startPreview };
    }, reaction.id);
    assert.deepEqual(reactionCheck, { rejected: true, finish: 'f', cached: true });
    // A second browser has no local dataset. It reads exactly the same canonical IDs.
    const ctx2 = await context(),
      q = await ctx2.newPage();
    await q.goto('https://mol-bench.web.app/seed.html');
    await q.evaluate(() => localStorage.setItem('mol-bench-drive-connection-v1', 'a'.repeat(64)));
    await q.goto('https://mol-bench.web.app/');
    await q.evaluate(() => Mol.cloud.ready);
    assert.ok(
      await q.evaluate(async (id) => (await Mol.metadata()).some((m) => m.id === id), created),
    );
    await p.goto('https://mol-bench.web.app/');
    await p.evaluate(() => Mol.cloud.ready);
    const stale = await p.evaluate(async (id) => Mol.get('body', id), created);
    await q.evaluate(async (id) => {
      const body = await Mol.get('body', id);
      await Mol.overwrite(
        {
          ...body,
          atoms: [{ el: 'N', x: 9, y: 0, z: 0 }],
          raw: new Blob(['1\n\nN 9 0 0\n']),
          edited: true,
        },
        body.revision,
      );
    }, created);
    const conflict = await p.evaluate(
      async ({ id, revision }) => {
        try {
          await Mol.overwrite(
            {
              id,
              name: 'stale',
              atoms: [{ el: 'F', x: 0, y: 0, z: 0 }],
              raw: new Blob(['1\n\nF 0 0 0\n']),
              edited: true,
            },
            revision,
          );
          return false;
        } catch (e) {
          return /更新|上書き/.test(e.message);
        }
      },
      { id: created, revision: stale.revision },
    );
    assert.equal(conflict, true, 'stale editor cannot overwrite another browser');
    await p.evaluate(() => Mol.cloud.call('refresh'));
    assert.equal(
      await p.evaluate(async (id) => (await Mol.get('body', id)).atoms[0].el, created),
      'N',
    );
    const [first, second] = await Promise.all([
      p.evaluate(() =>
        Mol.saveBatch([
          { name: 'parallel A', atoms: [{ el: 'H', x: 0, y: 0, z: 0 }], edited: true },
        ]),
      ),
      q.evaluate(() =>
        Mol.saveBatch([
          { name: 'parallel B', atoms: [{ el: 'H', x: 0, y: 0, z: 0 }], edited: true },
        ]),
      ),
    ]);
    await p.evaluate(() => Mol.cloud.call('refresh'));
    const names = await p.evaluate(async () => (await Mol.metadata()).map((m) => m.name));
    assert.ok(
      names.includes('parallel A') && names.includes('parallel B'),
      'nonoverlapping concurrent commits both survive',
    );
    loseAck = true;
    const beforeLost = await p.evaluate(
      async () => (await Mol.metadata()).filter((m) => !m.builtin).length,
    );
    const recovered = await p.evaluate(() =>
      Mol.saveBatch([{ name: 'lost ack', atoms: [{ el: 'He', x: 0, y: 0, z: 0 }], edited: true }]),
    );
    assert.equal(recovered.length, 1);
    assert.equal(
      await p.evaluate(async () => (await Mol.metadata()).filter((m) => !m.builtin).length),
      beforeLost + 1,
      'lost response retry never duplicates a committed import',
    );
    failCommit = true;
    const count = await p.evaluate(async () => (await Mol.metadata()).length);
    const failed = await p.evaluate(async () => {
      try {
        await Mol.saveBatch([
          { name: 'not committed', atoms: [{ el: 'H', x: 0, y: 0, z: 0 }], edited: true },
        ]);
        return false;
      } catch {
        return true;
      }
    });
    failCommit = false;
    assert.equal(failed, true);
    assert.equal(
      await p.evaluate(async () => (await Mol.metadata()).length),
      count,
      'failed cloud save never becomes a second local master',
    );
    await q.evaluate(() => Mol.cloud.call('refresh'));
    await q.evaluate(async (id) => Mol.removeMany([id]), first[0].id);
    await p.evaluate(() => Mol.cloud.call('refresh'));
    assert.equal(
      await p.evaluate(async (id) => !!(await Mol.get('body', id)), first[0].id),
      false,
      'deletion is canonical on another browser',
    );
    // The dedicated Worker uses the same primary store and returns saved only after commit.
    const imported = await p.evaluate(
      () =>
        new Promise((res, rej) => {
          const worker = new Worker('worker.js');
          let phase = 0;
          worker.onerror = (e) => rej(Error(e.message));
          worker.onmessage = ({ data: m }) => {
            if (m.type === 'error') {
              worker.terminate();
              rej(Error(m.message));
            } else if (m.type === 'ready') {
              if (phase++ === 0)
                worker.postMessage({
                  type: 'files',
                  files: [new File(['1\n\nO 1 2 3\n'], 'worker.xyz')],
                });
              else worker.postMessage({ type: 'finish' });
            } else if (m.type === 'done') {
              worker.terminate();
              res(m.stats.registered);
            }
          };
          worker.postMessage({
            type: 'start',
            cloudSession: localStorage.getItem('mol-bench-drive-connection-v1'),
          });
        }),
    );
    assert.equal(imported, 1);
    await q.evaluate(() => Mol.cloud.call('refresh'));
    assert.ok(
      await q.evaluate(async () => (await Mol.metadata()).some((m) => m.name === 'worker')),
    );
    const exported = await q.evaluate(
      (id) =>
        new Promise((res, rej) => {
          const worker = new Worker('worker.js');
          const chunks = [];
          worker.onerror = (e) => rej(Error(e.message));
          worker.onmessage = async ({ data: m }) => {
            if (m.type === 'ready')
              worker.postMessage({ type: 'export', ids: [id], format: 'xyz', withMemo: true });
            else if (m.type === 'chunk') {
              chunks.push(m.bytes);
              worker.postMessage({ type: 'ack' });
            } else if (m.type === 'exportDone') {
              worker.terminate();
              res(await new Blob(chunks).text());
            } else if (m.type === 'error') {
              worker.terminate();
              rej(Error(m.message));
            }
          };
          worker.postMessage({
            type: 'start',
            cloudSession: localStorage.getItem('mol-bench-drive-connection-v1'),
          });
        }),
      created,
    );
    assert.ok(exported.includes('N 9'));
    assert.ok(exported.includes('new tag'));
    // A cold tab must refresh again under the shared cache lock before hydration.
    const cold = await ctx2.newPage();
    let headCalls = 0,
      release;
    let signal;
    const paused = new Promise((resolve) => (signal = resolve));
    await ctx2.route('https://mol-bench-drive.naonao34567890.workers.dev/**', async (route) => {
      let frame;
      try {
        frame = route.request().frame();
      } catch {
        return route.fallback();
      }
      const request = route.request();
      if (
        frame !== cold.mainFrame() ||
        !request.url().endsWith('/library') ||
        JSON.parse(request.postData()).action !== 'head'
      )
        return route.fallback();
      if (++headCalls !== 1) return route.fallback();
      const response = await coordinator('owner').fetch(
        new Request('https://internal/', {
          method: 'POST',
          body: JSON.stringify({ action: 'head', accessToken: 'access-owner' }),
        }),
      );
      const value = await response.json();
      signal();
      await new Promise((resolve) => (release = resolve));
      await route.fulfill({
        json: { ...value, account: { sub: 'owner', email: 'owner@example.com' } },
        headers: { 'Access-Control-Allow-Origin': 'https://mol-bench.web.app' },
      });
    });
    await cold.goto('https://mol-bench.web.app/', { waitUntil: 'domcontentloaded' });
    await paused;
    const duringBootstrap = await q.evaluate(() =>
      Mol.saveBatch([
        {
          name: 'created during cold bootstrap',
          atoms: [{ el: 'He', x: 0, y: 0, z: 0 }],
          edited: true,
        },
      ]),
    );
    release();
    await cold.evaluate(() => Mol.cloud.ready);
    assert.ok(
      await q.evaluate(
        async (id) => (await Mol.metadata()).some((m) => m.id === id),
        duringBootstrap[0].id,
      ),
      'cold tab never downgrades a shared cache',
    );
    await cold.close();
    assert.ok(
      await q.evaluate(async (id) => {
        const db = await Mol.db();
        return new Promise((resolve) => {
          const request = db.transaction('meta').objectStore('meta').get(id);
          request.onsuccess = () => resolve(!!request.result);
        });
      }, duringBootstrap[0].id),
      'shared cache also keeps the newest row after cold bootstrap',
    );
    const editor = await ctx2.newPage();
    await editor.goto('https://mol-bench.web.app/editor.html?id=' + created);
    await editor.waitForFunction(
      (id) => typeof molecule !== 'undefined' && molecule?.id === id,
      created,
    );
    await editor.evaluate(() => {
      naming('save');
      document.getElementById('name').value = 'double click guarded';
      const button = document.getElementById('confirm');
      button.click();
      button.click();
    });
    await editor.waitForFunction(() => !document.getElementById('nameDialog').open);
    assert.equal(
      await editor.evaluate(
        async () =>
          (await Mol.metadata()).filter((m) => m.name.startsWith('double click guarded')).length,
      ),
      1,
      'long cloud saves cannot be double-clicked into duplicate molecules',
    );
    await editor.close();
    const large = await q.evaluate(async () => {
      const raw = new Blob(['1\n' + 'a'.repeat(5 * 1024 * 1024) + '\nH 0 0 0\n']);
      const saved = await Mol.saveBatch([
        { name: 'large raw', atoms: [{ el: 'H', x: 0, y: 0, z: 0 }], raw, edited: false },
      ]);
      return { id: saved[0].id, size: (await Mol.get('body', saved[0].id)).raw.size };
    });
    assert.ok(large.size > 5 * 1024 * 1024);
    assert.ok(resumableCount >= 2, 'large XYZ and record JSON use chunked uploads');
    const cacheRecovered = await q.evaluate(async () => {
      const original = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) {
        if (
          this.transaction.db.name.startsWith('molecular-xyz-drive-cache-') &&
          this.name === 'meta' &&
          args[0]?.name === 'committed despite cache failure'
        ) {
          this.transaction.abort();
          throw new DOMException('simulated cache quota', 'QuotaExceededError');
        }
        return original.apply(this, args);
      };
      try {
        return await Mol.saveBatch([
          {
            name: 'committed despite cache failure',
            atoms: [{ el: 'H', x: 0, y: 0, z: 0 }],
            edited: true,
          },
        ]);
      } finally {
        IDBObjectStore.prototype.put = original;
      }
    });
    assert.equal(
      cacheRecovered.length,
      1,
      'confirmed cloud save is not reported as failed when only cache fails',
    );
    await q.evaluate(() => Mol.cloud.call('refresh'));
    assert.ok(
      await q.evaluate(
        async (id) => (await Mol.metadata()).some((m) => m.id === id),
        cacheRecovered[0].id,
      ),
    );
    await ctx2.route('https://mol-bench-drive.naonao34567890.workers.dev/**', (r) =>
      r.abort('internetdisconnected'),
    );
    await q.reload();
    await q.evaluate(() => Mol.cloud.ready);
    assert.equal(
      await q.evaluate(async (id) => (await Mol.get('body', id)).atoms[0].el, created),
      'N',
      'offline reads use account cache',
    );
    const offlineWrite = await q.evaluate(async () => {
      try {
        await Mol.saveBatch([
          { name: 'offline must not save', atoms: [{ el: 'H', x: 0, y: 0, z: 0 }], edited: true },
        ]);
        return false;
      } catch (e) {
        return e.message.includes('オフライン');
      }
    });
    assert.equal(offlineWrite, true);
    // Switching accounts uses a different catalogue and cache, not this machine's old DB.
    await p.goto('https://mol-bench.web.app/seed.html');
    await p.evaluate(() => localStorage.setItem('mol-bench-drive-connection-v1', 'b'.repeat(64)));
    await p.goto('https://mol-bench.web.app/');
    await p.evaluate(() => Mol.cloud.ready);
    assert.equal(
      await p.evaluate(async () => (await Mol.metadata()).filter((m) => !m.builtin).length),
      0,
    );
    assert.deepEqual(errors, []);
    console.log(
      'PASS original data migration keeps IDs/raw/local source; primary molecule + reaction CRUD/tags; shared IDs across browsers; stale and concurrent writes; cloud failure; canonical deletion; actual Worker import; account isolation',
    );
  } finally {
    await browser.close();
    global.fetch = originalFetch;
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
