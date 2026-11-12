// One Durable Object per verified Google subject. It serializes the catalogue
// commit; molecule/reaction payloads stay in the user's Google Drive.
const API = 'https://www.googleapis.com/drive/v3';
const json = (body, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export class LibraryCoordinator {
  constructor(ctx) {
    this.ctx = ctx;
    this.queue = Promise.resolve();
  }
  fetch(request) {
    const next = this.queue.catch(() => {}).then(() => this.handle(request));
    this.queue = next;
    return next;
  }
  async handle(request) {
    try {
      const { accessToken, action, expectedGeneration, nextHead } = await request.json();
      if (!accessToken) return json({ state: 'connect' }, 401);
      const call = async (path, init = {}) => {
        const response = await fetch(
          (path.includes('uploadType=media') ? 'https://www.googleapis.com/upload/drive/v3' : API) +
            path,
          {
            ...init,
            headers: {
              'Cache-Control': 'no-cache',
              ...init.headers,
              Authorization: 'Bearer ' + accessToken,
            },
          },
        );
        if (!response.ok) throw Error('Drive HTTP ' + response.status);
        return response;
      };
      let ids = await this.ctx.storage.get('drive-ids');
      if (!ids) {
        const folder = async (name, parent) => {
          const r = await call('/files?fields=id', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name,
              mimeType: 'application/vnd.google-apps.folder',
              ...(parent ? { parents: [parent] } : {}),
              appProperties: { molBenchPrimary: '1' },
            }),
          });
          return (await r.json()).id;
        };
        // Persist each provisioning step so an interrupted setup reuses its folders.
        ids = { root: await this.ctx.storage.get('root') };
        if (!ids.root) {
          ids.root = await folder('Mol Bench');
          await this.ctx.storage.put('root', ids.root);
        }
        for (const [key, name] of [
          ['molecules', '分子ライブラリ'],
          ['reactions', '反応ライブラリ'],
          ['indexes', '管理情報'],
        ]) {
          ids[key] = await this.ctx.storage.get(key);
          if (!ids[key]) {
            ids[key] = await folder(name, ids.root);
            await this.ctx.storage.put(key, ids[key]);
          }
        }
        ids.head = await this.ctx.storage.get('head');
        if (!ids.head) {
          const meta = await call('/files?fields=id', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: 'library-catalogue.json',
              parents: [ids.indexes],
              mimeType: 'application/json',
            }),
          });
          ids.head = (await meta.json()).id;
          await this.ctx.storage.put('head', ids.head);
        }
        if (!(await this.ctx.storage.get('head-initialized'))) {
          await call('/files/' + ids.head + '?uploadType=media', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              format: 'mol-bench-primary',
              schema: 1,
              generation: 'initial',
              shards: {},
              tags: [],
              tagsVersion: 'initial',
              operations: [],
            }),
          });
          await this.ctx.storage.put('head-initialized', true);
        }
        await this.ctx.storage.put('drive-ids', ids);
      }
      const current = await (await call('/files/' + ids.head + '?alt=media')).json();
      if (current.format !== 'mol-bench-primary' || current.schema !== 1)
        return json({ state: 'invalid_catalogue' }, 409);
      if (action === 'head') return json({ ids, head: current });
      if (action !== 'commit') return json({ state: 'invalid_action' }, 400);
      if (
        !nextHead ||
        nextHead.format !== 'mol-bench-primary' ||
        nextHead.schema !== 1 ||
        typeof nextHead.generation !== 'string' ||
        !nextHead.shards ||
        !Array.isArray(nextHead.tags)
      )
        return json({ state: 'invalid_catalogue' }, 400);
      if (
        current.generation === nextHead.generation ||
        current.operations?.includes(nextHead.generation) ||
        (await this.ctx.storage.get('operation/' + nextHead.generation))
      )
        return json({ ids, head: current, alreadyCommitted: true });
      if (current.generation !== expectedGeneration)
        return json({ state: 'conflict', head: current, ids }, 409);
      const value = {
        ...nextHead,
        previousHead: ids.head,
        operations: [...(current.operations || []), nextHead.generation].slice(-128),
      };
      const body = JSON.stringify(value);
      const digest = Array.from(
        new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body))),
        (b) => b.toString(16).padStart(2, '0'),
      ).join('');
      // Each candidate gets its own immutable Drive file. A delayed external
      // write can therefore never alter a catalogue that another commit selected.
      let prepared = await this.ctx.storage.get('prepared/' + digest);
      if (!prepared) {
        const response = await call('/files?fields=id', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'library-catalogue--' + nextHead.generation + '.json',
            parents: [ids.indexes],
            mimeType: 'application/json',
          }),
        });
        prepared = (await response.json()).id;
        await this.ctx.storage.put('prepared/' + digest, prepared);
      }
      await call('/files/' + prepared + '?uploadType=media', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      const nextIds = { ...ids, head: prepared };
      const accepted = await this.ctx.storage.transaction(async (storage) => {
        const selected = await storage.get('drive-ids');
        if (selected.head !== ids.head) return false;
        await storage.put({ 'drive-ids': nextIds, ['operation/' + nextHead.generation]: true });
        return true;
      });
      if (!accepted) {
        const selected = await this.ctx.storage.get('drive-ids');
        const latest = await (await call('/files/' + selected.head + '?alt=media')).json();
        return json({ state: 'conflict', ids: selected, head: latest }, 409);
      }
      return json({ ids: nextIds, head: value });
    } catch {
      return json({ state: 'drive_error' }, 502);
    }
  }
}
