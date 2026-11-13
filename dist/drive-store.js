import { driveFetch } from './drive-connection.js?v=3';
const API = 'https://www.googleapis.com/drive/v3';
const builtin = (id) => id === 'builtin-water' || id === 'builtin-hydrogen';
const bucket = (kind, id) =>
  kind +
  '-' +
  [...id]
    .reduce((n, c) => (n * 31 + c.charCodeAt(0)) & 255, 0)
    .toString(16)
    .padStart(2, '0');
const clone = (value) => structuredClone(value);
const enc = new TextEncoder();
async function hash(text) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text))), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}
async function encode(value) {
  if(value===undefined)return {$molBenchValue:'undefined'};
  if(typeof value==='number'&&(!Number.isFinite(value)||Object.is(value,-0)))return {$molBenchValue:'number',value:Object.is(value,-0)?'-0':String(value)};
  if(value instanceof Date)return {$molBenchValue:'date',value:value.toISOString()};
  if(value instanceof ArrayBuffer||ArrayBuffer.isView(value)){
    const bytes=value instanceof ArrayBuffer?new Uint8Array(value):new Uint8Array(value.buffer,value.byteOffset,value.byteLength);
    const blob=await encode(new Blob([bytes]));
    return {$molBenchValue:'binary',constructor:value.constructor.name,blob};
  }
  if (value instanceof Blob) {
    const a = new Uint8Array(await value.arrayBuffer());
    let s = '';
    for (let i = 0; i < a.length; i += 8192) s += String.fromCharCode(...a.subarray(i, i + 8192));
    return { $blob: btoa(s), type: value.type };
  }
  if (Array.isArray(value)) return Promise.all(value.map(encode));
  if (value && typeof value === 'object') {
    const out = Object.create(null);
    for (const key of Object.keys(value).sort())
      if (!['_driveFileId', 'startPreview'].includes(key)) out[key] = await encode(value[key]);
    return (Object.hasOwn(value,'$molBenchValue')||Object.hasOwn(value,'$blob')) ? {$molBenchValue:'object',entries:Object.entries(out)} : out;
  }
  return value;
}
// Keep migration receipts compatible with versions published before typed-value support.
async function legacyEncode(value) {
  if (value instanceof Blob) {
    const a = new Uint8Array(await value.arrayBuffer());
    let s = '';
    for (let i = 0; i < a.length; i += 8192) s += String.fromCharCode(...a.subarray(i, i + 8192));
    return { $blob: btoa(s), type: value.type };
  }
  if (Array.isArray(value)) return Promise.all(value.map(legacyEncode));
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort())
      if (!['_driveFileId', 'startPreview'].includes(key)) out[key] = await legacyEncode(value[key]);
    return out;
  }
  return value;
}
function decode(value) {
  if(value&&typeof value.$molBenchValue==='string'){
    switch(value.$molBenchValue){
      case 'undefined':return undefined;
      case 'number':return value.value==='-0'?-0:Number(value.value);
      case 'date':return new Date(value.value);
      case 'object':return Object.fromEntries(value.entries.map(([k,v])=>[k,decode(v)]));
      case 'binary':{
        const blob=value.blob;
        const bytes=Uint8Array.from(atob(blob.$blob),c=>c.charCodeAt(0));
        const types={ArrayBuffer,DataView,Uint8Array,Uint8ClampedArray,Int8Array,Uint16Array,Int16Array,Uint32Array,Int32Array,Float32Array,Float64Array,BigInt64Array,BigUint64Array};
        if(!Object.hasOwn(types,value.constructor))throw Error('未対応のDriveバイナリ型です。');
        return value.constructor==='ArrayBuffer'?bytes.buffer:new types[value.constructor](bytes.buffer);
      }
      default:throw Error('未対応のDriveデータ型です。');
    }
  }

  if (value && typeof value.$blob === 'string')
    return new Blob([Uint8Array.from(atob(value.$blob), (c) => c.charCodeAt(0))], {
      type: value.type,
    });
  if (Array.isArray(value)) return value.map(decode);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, decode(v)]));
  return value;
}
async function parallel(items, fn) {
  const out = Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, items.length) }, async () => {
      while (i < items.length) {
        const index = i++;
        out[index] = await fn(items[index], index);
      }
    }),
  );
  return out;
}
function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onabort = () =>
      reject(tx.error || Error('キャッシュ更新に失敗しました。Driveの保存内容は残っています。'));
  });
}
function readAll(db, stores) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, 'readonly'),
      out = {};
    for (const name of stores) {
      const r = tx.objectStore(name).getAll();
      r.onsuccess = () => (out[name] = r.result);
    }
    tx.oncomplete = () => resolve(out);
    tx.onabort = () => reject(tx.error);
  });
}
function openReactions(name) {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(name, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('reactions', { keyPath: 'id' });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
const safe = (name) =>
  String(name || 'molecule')
    .replace(/[\x00-\x1f/\\]/g, '_')
    .slice(0, 100);
export function createDriveStore(local) {
  let uncertain = false,
    offline = false,
    cacheDirty = false;
  let broadcast;
  let pendingWrites = 0,
    migrating = false;
  let head,
    ids,
    account,
    token,
    lastPull = 0,
    initializing = true,
    queue = Promise.resolve(),
    cacheName,
    reactName;
  const shards = new Map(),
    records = new Map();
  const initialSession =
    typeof localStorage !== 'undefined'
      ? localStorage.getItem('mol-bench-drive-connection-v1')
      : globalThis.MOL_DRIVE_SESSION;
  function checkSession() {
    const current =
      typeof localStorage !== 'undefined'
        ? localStorage.getItem('mol-bench-drive-connection-v1')
        : globalThis.MOL_DRIVE_SESSION;
    if (current !== initialSession)
      throw Error('Googleアカウントの接続が変更されました。保存せず、ページを開き直してください。');
  }
  const status = (text, error = false) => {
    if (typeof document !== 'undefined')
      document.dispatchEvent(new CustomEvent('drive-store-status', { detail: { text, error } }));
    else if (typeof postMessage === 'function') postMessage({ type: 'driveStatus', text, error });
  };
  async function rpc(input) {
    checkSession();
    let response;
    try {
      response = await driveFetch('library', { body: JSON.stringify(input) });
    } catch (error) {
      status(error.message, true);
      throw error;
    }
    const result = await response.json();
    if (!response.ok || result.state) {
      if (response.status === 409 && result.state === 'conflict') return result;
      const messages = {
        connect: 'Driveに接続してください。Colab計算記録から接続できます。',
        library_setup_required: 'Drive保存サーバーの更新が必要です。',
        drive_error: 'Driveへ接続できません。保存は完了していません。',
        invalid_catalogue: 'Driveの管理情報に不整合があります。元のデータは変更していません。',
      };
      const error = Error(
        messages[result.state] ||
          'Drive保存を開始できません（' + (result.state || response.status) + '）。',
      );
      if (response.status === 502) error.code = 'DRIVE_UNAVAILABLE';
      throw error;
    }
    if (!result.account?.sub || !result.head || !result.ids)
      throw Error(
        'Drive保存サーバーの応答を確認できません。サーバーの公開設定を確認してください。',
      );
    if (account && account.sub !== result.account?.sub)
      throw Error('Googleアカウントが変わりました。保存せず、ページを開き直してください。');
    account = result.account;
    return result;
  }
  async function getToken() {
    checkSession();
    const r = await driveFetch('token');
    const value = await r.json();
    if (value.state !== 'connected') throw Error('Driveの接続を更新できませんでした。');
    token = value.access_token;
  }
  async function request(url, init = {}, retry = true, allowed = []) {
    checkSession();
    if (!token) await getToken();
    const r = await fetch(url, {
      ...init,
      headers: { ...init.headers, Authorization: 'Bearer ' + token },
    });
    if (r.status === 401 && retry) {
      await getToken();
      return request(url, init, false, allowed);
    }
    if (!r.ok && !allowed.includes(r.status)) {
      let reason;
      try {
        reason = (await r.clone().json()).error?.errors?.[0]?.reason;
      } catch {}
      const error = Error(
        reason === 'storageQuotaExceeded'
          ? 'Google Driveの保存容量を超えました。保存は完了していません。'
          : 'Driveへの読み書きに失敗しました（HTTP ' + r.status + '）。保存は完了していません。',
      );
      if (reason === 'storageQuotaExceeded') error.name = 'QuotaExceededError';
      throw error;
    }
    return r;
  }
  let indexDBPromise;
  function indexDB() {
    return indexDBPromise ||= new Promise((resolve,reject)=>{
      const request=indexedDB.open('mol-bench-index-cache',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('shards',{keyPath:'key'});
      request.onsuccess=()=>{request.result.onversionchange=()=>request.result.close();resolve(request.result);};
      request.onerror=()=>reject(request.error);
    });
  }
  async function download(id, digest, cacheIndex=false) {
    const key=account.sub+':'+id;
    if(cacheIndex)try{
      const db=await indexDB();
      const saved=await new Promise((resolve,reject)=>{const r=db.transaction('shards').objectStore('shards').get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      if(saved?.hash===digest && await hash(saved.text)===digest)return decode(JSON.parse(saved.text));
    }catch{} // Cache failure must never prevent fetching the canonical Drive file.
    const text = await (
      await request(API + '/files/' + encodeURIComponent(id) + '?alt=media')
    ).text();
    if (digest && (await hash(text)) !== digest)
      throw Error('Driveの保存内容の整合性を確認できません。');
    const value=decode(JSON.parse(text));
    if(cacheIndex)try{
      const db=await indexDB(),tx=db.transaction('shards','readwrite'),done=txDone(tx);
      tx.objectStore('shards').put({key,hash:digest,text});await done;
    }catch{}
    return value;
  }
  async function pruneIndexCache() {
    try{
      const db=await indexDB(),tx=db.transaction('shards','readwrite'),done=txDone(tx);
      const keep=new Set(Object.values(head.shards).map(ref=>account.sub+':'+ref.fileId));
      const r=tx.objectStore('shards').openKeyCursor();
      r.onsuccess=()=>{const cursor=r.result;if(!cursor)return;if(String(cursor.key).startsWith(account.sub+':')&&!keep.has(cursor.key))tx.objectStore('shards').delete(cursor.key);cursor.continue();};
      await done;
    }catch{}
  }
  async function upload(parent, name, blob) {
    const metadata = { name, parents: [parent], mimeType: blob.type || 'application/octet-stream' };
    if (blob.size > 4 * 1024 * 1024) {
      const start = await request(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Upload-Content-Type': metadata.mimeType,
            'X-Upload-Content-Length': String(blob.size),
          },
          body: JSON.stringify(metadata),
        },
      );
      const destination = start.headers.get('Location');
      if (
        !destination ||
        new URL(destination).protocol !== 'https:' ||
        !new URL(destination).hostname.endsWith('.googleapis.com')
      )
        throw Error('Driveの大容量アップロード先を確認できませんでした。');
      let offset = 0;
      while (offset < blob.size) {
        const end = Math.min(blob.size, offset + 4 * 1024 * 1024);
        const r = await request(
          destination,
          {
            method: 'PUT',
            headers: {
              'Content-Type': metadata.mimeType,
              'Content-Range': 'bytes ' + offset + '-' + (end - 1) + '/' + blob.size,
            },
            body: blob.slice(offset, end),
          },
          true,
          [308],
        );
        if (r.status !== 308) return (await r.json()).id;
        const range = r.headers.get('Range')?.match(/bytes=0-(\d+)/);
        if (!range) throw Error('Driveのアップロード進捗を確認できませんでした。');
        const next = Number(range[1]) + 1;
        if (next <= offset) throw Error('Driveのアップロードが進みませんでした。');
        offset = next;
      }
      throw Error('Driveのアップロード完了を確認できませんでした。');
    }
    const boundary = crypto.randomUUID();
    const body = new Blob([
      '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n',
      JSON.stringify(metadata),
      '\r\n--' + boundary + '\r\nContent-Type: ' + metadata.mimeType + '\r\n\r\n',
      blob,
      '\r\n--' + boundary + '--\r\n',
    ]);
    return (
      await (
        await request(
          'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
          {
            method: 'POST',
            headers: { 'Content-Type': 'multipart/related; boundary=' + boundary },
            body,
          },
        )
      ).json()
    ).id;
  }
  async function uploadJSON(parent, name, value) {
    const text = JSON.stringify(await encode(value));
    return {
      fileId: await upload(parent, name, new Blob([text], { type: 'application/json' })),
      hash: await hash(text),
    };
  }
  function entries(kind) {
    return [...records.values()].filter((x) => x.kind === kind);
  }
  async function readRecord(kind, id) {
    let cachedReaction;
    const ref = records.get(kind + ':' + id);
    if (!ref) return undefined;
    if (kind === 'm') {
      const value = await local.get('body', id);
      if (value?._driveFileId === ref.fileId) return { ...value, name: ref.meta.name };
    } else {
      const db = await openReactions(reactName);
      const value = await new Promise((res, rej) => {
        const r = db.transaction('reactions').objectStore('reactions').get(id);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      db.close();
      cachedReaction = value;
      if (value?._driveFileId === ref.fileId) return value;
    }
    const value = await download(ref.fileId, ref.hash);
    let body = kind === 'm' ? value.body : value;
    if (
      kind === 'r' &&
      cachedReaction?.startPreview &&
      cachedReaction.START?.revision === body.START?.revision
    )
      body = { ...body, startPreview: cachedReaction.startPreview };
    const db = kind === 'm' ? await local.db() : await openReactions(reactName);
    const tx = db.transaction(kind === 'm' ? 'body' : 'reactions', 'readwrite');
    const done = txDone(tx);
    try {
      tx.objectStore(kind === 'm' ? 'body' : 'reactions').put({
        ...body,
        _driveFileId: ref.fileId,
      });
      await done;
    } catch {
      try {
        tx.abort();
      } catch {}
      await done.catch(() => {});
      status('Driveから取得済み。端末キャッシュを保存できませんでした。', true);
    }
    if (kind !== 'm') db.close();
    return { ...body, ...(kind === 'm' ? { name: ref.meta.name } : {}) };
  }
  async function hydrateCache() {
    const db = await local.db(),
      old = await readAll(db, ['meta']);
    const current = new Map(old.meta.map((x) => [x.id, x]));
    const tx = db.transaction(['meta', 'body', 'thumb', 'tags'], 'readwrite');
    const done = txDone(tx);
    const remote = new Map(entries('m').map((ref) => [ref.meta.id, ref]));
    const changed = new Set();
    try {
      for (const value of current.values()) {
        const ref = remote.get(value.id);
        if (!ref) {
          for (const store of ['meta', 'body', 'thumb']) tx.objectStore(store).delete(value.id);
          continue;
        }
        if (
          JSON.stringify({ ...value, thumb: false }) !==
          JSON.stringify({ ...ref.meta, thumb: false })
        ) {
          changed.add(value.id);
          tx.objectStore('meta').delete(value.id);
        }
      }
      for (const ref of remote.values()) {
        const old = current.get(ref.meta.id);
        if (!old || changed.has(ref.meta.id)) {
          if (old && old.revision !== ref.meta.revision)
            tx.objectStore('thumb').delete(ref.meta.id);
          tx.objectStore('meta').put({
            ...ref.meta,
            thumb: old?.revision === ref.meta.revision && !!old?.thumb,
          });
        }
      }
      tx.objectStore('tags').clear();
      for (const tag of head.tags) tx.objectStore('tags').put(tag);
      await done;
    } catch (error) {
      try {
        tx.abort();
      } catch {}
      await done.catch(() => {});
      throw error;
    }
    const reactions = await openReactions(reactName);
    const rt = reactions.transaction('reactions', 'readwrite'),
      rd = txDone(rt);
    const cursor=rt.objectStore('reactions').openKeyCursor();
    cursor.onsuccess=()=>{const row=cursor.result;if(!row)return;if(!records.has('r:'+row.key))rt.objectStore('reactions').delete(row.key);row.continue();};
    await rd;
    reactions.close();
  }
  async function rememberScope() {
    if (typeof localStorage !== 'undefined')
      try {
        localStorage.setItem(
          'mol-bench-drive-scope-' + (await hash(initialSession)),
          JSON.stringify({ ...account, reactionCount: entries('r').length }),
        );
      } catch {}
  }
  async function pull(force = false) {
    if (!force && Date.now() - lastPull < 2000) return;
    const result = await rpc({ action: 'head' });
    ids = result.ids;
    const next = result.head;
    if (next.generation === head?.generation) {
      if (cacheName && cacheDirty) {
        await hydrateCache();
        cacheDirty = false;
      }
      lastPull = Date.now();
      return;
    }
    const changed = Object.entries(next.shards).filter(
      ([name, ref]) => shards.get(name)?.fileId !== ref.fileId,
    );
    let indexCount = 0;
    const showIndexProgress = !pendingWrites && !migrating && changed.length > 1;
    const loaded = await parallel(changed, async ([name, ref]) => {
      const data = await download(ref.fileId, ref.hash, true);
      if (showIndexProgress)
        status('Driveの一覧を読み込み中 ' + ++indexCount + ' / ' + changed.length);
      return { name, ref, data };
    });
    for (const name of shards.keys()) if (!next.shards[name]) shards.delete(name);
    for (const item of loaded) {
      if (item.data.format !== 'mol-bench-index' || !Array.isArray(item.data.entries))
        throw Error('Driveの索引が壊れています。');
      shards.set(item.name, { ...item.ref, entries: item.data.entries });
    }
    records.clear();
    for (const shard of shards.values())
      for (const ref of shard.entries) records.set(ref.kind + ':' + ref.meta.id, ref);
    head = next;
    await pruneIndexCache();
    lastPull = Date.now();
    if (cacheName) {
      cacheDirty = true;
      await hydrateCache();
      cacheDirty = false;
      await rememberScope();
    }
    if (showIndexProgress) status('Driveに接続済み：' + account.email);
  }
  async function exclusive(fn) {
    const run = () =>
      navigator.locks ? navigator.locks.request('mol-bench-drive-write-' + account.sub, fn) : fn();
    const next = queue.catch(() => {}).then(run);
    queue = next;
    return next;
  }
  async function commit(targets, build, { expectedTags, expectedVersions } = {}) {
    if (offline)
      throw Error(
        'オフラインのためDriveに保存できません。編集内容は画面に残っています。接続が戻ってから保存してください。',
      );
    if (uncertain)
      throw Error(
        '前の保存結果を確認できていません。重ねて保存せず、通信復旧後にライブラリを開き直して確認してください。',
      );
    const expected =
      expectedVersions || new Map(targets.map((key) => [key, records.get(key)?.version]));
    pendingWrites++;
    return exclusive(async () => {
      status('Driveへ保存中…');
      const operation = crypto.randomUUID(),
        uploaded = new Map();
      for (let attempt = 0; attempt < 4; attempt++) {
        await pull(true);
        for (const [key, version] of expected)
          if (records.get(key)?.version !== version) {
            status('別の画面で更新されています。保存していません。', true);
            throw Error(
              '別のタブ・端末で内容が更新されました。編集内容は画面に残っています。最新の内容を確認してから保存してください。',
            );
          }
        if (expectedTags !== undefined && head.tagsVersion !== expectedTags)
          throw Error('別の画面でタグが更新されました。タグ一覧を開き直してください。');
        const change = await build();
        if (
          !(change.puts || []).length &&
          !(change.deletes || []).some((key) => records.has(key)) &&
          (!change.tags || JSON.stringify(change.tags) === JSON.stringify(head.tags))
        ) {
          status('Driveに保存済み');
          return clone(change.result);
        }
        const nextRecords = new Map(records);
        const changedShards = new Set();
        let completed = 0;
        await parallel(change.puts || [], async (item) => {
          const key = item.kind + ':' + item.meta.id,
            version = crypto.randomUUID();
          let ref;
          if (item.metadataOnly) {
            const old = records.get(key);
            ref = { ...old, meta: item.meta, version };
          } else {
            const value = item.kind === 'm' ? { meta: item.meta, body: item.body } : item.body;
            const identity = await hash(JSON.stringify(await encode(value)));
            const cached = uploaded.get(key + identity);
            let file;
            if (cached) file = cached;
            else {
              const parent = item.kind === 'm' ? ids.molecules : ids.reactions,
                stem = safe(item.meta.name) + '--' + item.meta.id + '--' + operation;
              if (item.kind === 'm')
                await upload(
                  parent,
                  stem + '.xyz',
                  item.body.raw && !item.body.edited
                    ? item.body.raw
                    : Mol.calculationOutput(item.body),
                );
              else
                for (const slot of ['START', 'FINISH'])
                  if (item.body[slot])
                    await upload(
                      parent,
                      stem + '_' + slot + '.xyz',
                      item.body[slot].raw && !item.body[slot].edited
                        ? item.body[slot].raw
                        : Mol.calculationOutput(item.body[slot]),
                    );
              file = await uploadJSON(parent, stem + '.json', value);
              uploaded.set(key + identity, file);
            }
            ref = {
              kind: item.kind,
              meta: item.meta,
              ...file,
              version,
              ...(item.legacySource
                ? { legacySource: item.legacySource }
                : records.get(key)?.legacySource
                  ? { legacySource: records.get(key).legacySource }
                  : {}),
            };
          }
          nextRecords.set(key, ref);
          changedShards.add(bucket(item.kind, item.meta.id));
          status('Driveへ保存中 ' + ++completed + ' / ' + change.puts.length + ' 件');
        });
        for (const key of change.deletes || []) {
          const old = nextRecords.get(key);
          if (old) {
            nextRecords.delete(key);
            changedShards.add(bucket(old.kind, old.meta.id));
          }
        }
        const nextHead = {
          ...head,
          generation: operation,
          shards: { ...head.shards },
          ...(change.tags ? { tags: change.tags, tagsVersion: operation } : {}),
        };
        await parallel([...changedShards], async (name) => {
          const values = [...nextRecords.values()].filter(
            (r) => bucket(r.kind, r.meta.id) === name,
          );
          nextHead.shards[name] = await uploadJSON(ids.indexes, name + '--' + operation + '.json', {
            format: 'mol-bench-index',
            entries: values,
          });
        });
        let result;
        const payload = { action: 'commit', expectedGeneration: head.generation, nextHead };
        try {
          result = await rpc(payload);
        } catch (error) {
          // Reuse the operation ID: the coordinator can acknowledge it even if newer
          // commits have since replaced the head. Never generate a second mutation.
          try {
            result = await rpc(payload);
          } catch {
            uncertain = true;
            throw Error(
              '保存結果を確認できません。重ねて保存せず、通信復旧後にライブラリを開き直して確認してください。',
            );
          }
        }
        if (result.state === 'conflict') continue;
        head = null;
        try {
          await pull(true);
          status('Driveに保存済み');
        } catch {
          // The commit was acknowledged. A cache failure must not turn it into
          // a failed import and invite the caller to add the same records again.
          if (!head && result.head.generation === operation) {
            head = result.head;
            records.clear();
            for (const [key, value] of nextRecords) records.set(key, value);
          }
          cacheDirty = true;
          status('Driveに保存済み。端末の一覧を更新できませんでした。', true);
        }
        try {
          broadcast?.postMessage({ generation: head?.generation || operation });
        } catch {}
        if (typeof document !== 'undefined')
          document.dispatchEvent(new CustomEvent('drive-store-updated'));
        return clone(change.result);
      }
      throw Error('同時更新が続いているため保存を中断しました。編集内容は画面に残っています。');
    })
      .catch((error) => {
        status(error.message, true);
        throw error;
      })
      .finally(() => {
        pendingWrites--;
      });
  }
  function uniqueName(name, used) {
    const base = name;
    let n = 1;
    while (used.has(name)) name = base + ' (' + ++n + ')';
    used.add(name);
    return name;
  }
  const reactionMeta = (r) => ({
    id: r.id,
    name: r.name,
    createdAt: r.createdAt,
    tags: r.tags || [],
  });
  function legacyDatabase(name, version, reaction = false) {
    return new Promise((resolve, reject) => {
      const request = version ? indexedDB.open(name, version) : indexedDB.open(name);
      request.onblocked = () =>
        status('旧版のMol Benchタブを閉じてください。閉じると既存データの移行を続けます。', true);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (reaction) {
          if (!db.objectStoreNames.contains('reactions'))
            db.createObjectStore('reactions', { keyPath: 'id' });
        } else {
          const meta = db.objectStoreNames.contains('meta')
            ? request.transaction.objectStore('meta')
            : db.createObjectStore('meta', { keyPath: 'id' });
          if (!meta.indexNames.contains('name')) meta.createIndex('name', 'name', { unique: true });
          if (!meta.indexNames.contains('tags'))
            meta.createIndex('tags', 'tags', { multiEntry: true });
          for (const store of ['body', 'thumb'])
            if (!db.objectStoreNames.contains(store))
              db.createObjectStore(store, { keyPath: 'id' });
          if (!db.objectStoreNames.contains('tags'))
            db.createObjectStore('tags', { keyPath: 'name' });
        }
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => reject(request.error);
    });
  }
  async function migrate() {
    if (typeof document === 'undefined' || localStorage.getItem('mol-bench-legacy-owner')) return;
    let old = await legacyDatabase('molecular-xyz-library');
    let rdb = await legacyDatabase('molecular-xyz-reactions', undefined, true);
    const libraryVersion = old.version,
      reactionVersion = rdb.version;
    const count = async (db, store) =>
      new Promise((resolve, reject) => {
        const r = db.transaction(store).objectStore(store).count();
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    const moleculeCount = await count(old, 'meta'),
      reactionCount = await count(rdb, 'reactions');
    old.close();
    rdb.close();
    if (
      (moleculeCount || reactionCount) &&
      !confirm(
        'このブラウザの分子 ' +
          moleculeCount +
          ' 件・反応 ' +
          reactionCount +
          ' 件を ' +
          account.email +
          ' のDriveへ移行します。既存機能はそのまま使えます。元の端末データは残します。進めますか？',
      )
    )
      throw Error('Driveへの移行を保留しました。元の端末データは残っています。');
    // Fence old v2/v1 clients before taking a migration snapshot. The records
    // remain untouched, but an already-open old build cannot keep a second master.
    migrating = true;
    try {
      old = await legacyDatabase('molecular-xyz-library', Math.max(3, libraryVersion));
      rdb = await legacyDatabase('molecular-xyz-reactions', Math.max(2, reactionVersion), true);
      const source = await readAll(old, ['meta', 'tags']);
      const reactions = (await readAll(rdb, ['reactions'])).reactions;
      const oldMeta = source.meta.filter((x) => !builtin(x.id));
      for (let start = 0; start < oldMeta.length; start += 200) {
        status('既存の分子をDriveへ移行中 ' + start + ' / ' + oldMeta.length + ' 件');
        const data = await parallel(oldMeta.slice(start, start + 200), async (meta) => ({
          kind: 'm',
          meta: { ...meta, thumb: false },
          body: await new Promise((resolve, reject) => {
            const r = old.transaction('body').objectStore('body').get(meta.id);
            r.onsuccess = () => resolve(r.result);
            r.onerror = () => reject(r.error);
          }),
        }));
        if (data.some((x) => !x.body))
          throw Error('元の分子データが見つからないため移行を停止しました。');
        await migrateBatch(data);
      }
      for (let start = 0; start < reactions.length; start += 100) {
        status('既存の反応をDriveへ移行中 ' + start + ' / ' + reactions.length + ' 件');
        await migrateBatch(
          reactions
            .slice(start, start + 100)
            .map((body) => ({ kind: 'r', meta: reactionMeta(body), body })),
        );
      }
      if (source.tags.length)
        await commit([], async () => ({
          tags: [...new Map([...head.tags, ...source.tags].map((t) => [t.name, t])).values()],
        }));
      try {
        localStorage.setItem('mol-bench-legacy-owner', account.sub);
      } catch {}
    } finally {
      old.close();
      rdb.close();
      migrating = false;
    }
  }
  async function migrateBatch(items) {
    for (const item of items) item.legacySource = await hash(JSON.stringify(await legacyEncode(item)));
    await commit([], async () => {
      const puts = [];
      const used = new Set(entries('m').map((r) => r.meta.name));
      for (const item of items) {
        const old = records.get(item.kind + ':' + item.meta.id);
        if (old) {
          if (old.legacySource === item.legacySource) continue;
          throw Error(
            '既存のDriveデータと端末データに同じIDの異なる内容があります。上書きせず移行を停止しました。',
          );
        }
        if (item.kind === 'm') {
          item.meta.name = uniqueName(item.meta.name, used);
          item.body = { ...item.body, name: item.meta.name };
        }
        puts.push(item);
      }
      return { puts };
    });
  }
  const ready = (async () => {
    // Migration reads the original DB before switching to an account-specific cache.
    await pull(true);
    if (typeof BroadcastChannel !== 'undefined') {
      broadcast = new BroadcastChannel('mol-bench-drive-updates:' + account.sub);
      broadcast.onmessage = () => service.refresh().catch((error) => status(error.message, true));
    }
    await migrate();
    cacheName = 'molecular-xyz-drive-cache-' + account.sub;
    reactName = 'molecular-xyz-drive-reactions-' + account.sub;
    Mol.cloudDatabaseNames = { reactions: reactName, account };
    local.setDatabaseName(cacheName);
    cacheDirty = true;
    await exclusive(() => pull(true));
    await rememberScope();
    initializing = false;
    status('Driveに接続済み：' + account.email);
  })().catch(async (error) => {
    if (
      !initialSession ||
      (!['DRIVE_NETWORK', 'DRIVE_UNAVAILABLE'].includes(error.code) &&
        !(error instanceof TypeError))
    )
      throw error;
    let saved;
    if (typeof localStorage !== 'undefined') {
      try {
        saved = JSON.parse(
          localStorage.getItem('mol-bench-drive-scope-' + (await hash(initialSession))),
        );
      } catch {}
    } else saved = globalThis.MOL_DRIVE_SCOPE;
    if (!saved?.sub) throw error;
    account = saved;
    cacheName = 'molecular-xyz-drive-cache-' + account.sub;
    reactName = 'molecular-xyz-drive-reactions-' + account.sub;
    Mol.cloudDatabaseNames = { reactions: reactName, account };
    local.setDatabaseName(cacheName);
    offline = true;
    initializing = false;
    status('オフライン：取得済みデータのみ表示。保存には接続が必要です。', true);
  });
  ready.catch((error) => status(error.message, true));
  const service = {
    ready,
    get reactionDatabaseName() {
      return reactName;
    },
    get account() {
      return account;
    },
    async metadata() {
      await ready;
      checkSession();
      if (!offline) {
        try {
          await exclusive(() => pull());
        } catch (error) {
          if (!cacheDirty || !head) throw error;
        }
      }
      if (head)
        return [
          ...(await local.metadata()).filter((item) => item.builtin),
          ...entries('m').map((ref) => clone(ref.meta)),
        ];
      return local.metadata();
    },
    async get(store, id) {
      await ready;
      checkSession();
      if (head && store === 'meta' && !builtin(id))
        return records.has('m:' + id) ? clone(records.get('m:' + id).meta) : undefined;
      if (offline) {
        const value = await local.get(store, id);
        if (!value && store === 'body')
          throw Error('この構造は端末に未取得です。オンラインで開いてください。');
        return value;
      }
      if (builtin(id) || store !== 'body') return local.get(store, id);
      if (!records.has('m:' + id)) await exclusive(() => pull(true));
      return readRecord('m', id);
    },
    async db() {
      await ready;
      checkSession();
      if (cacheDirty) await exclusive(() => pull(true));
      return local.db();
    },
    async saveBatch(values) {
      if (!values.length) return [];
      await ready;
      return commit([], async () => {
        const used = new Set(entries('m').map((r) => r.meta.name)),
          puts = [],
          result = [];
        const tags = new Map(head.tags.map((t) => [t.name, t]));
        for (const input of values) {
          const body = {
            ...clone(input),
            id: crypto.randomUUID(),
            name: uniqueName(input.name, used),
          };
          delete body.revision;
          const meta = {
            id: body.id,
            name: body.name,
            count: body.atoms.length,
            mass: Mol.mass.calculate(body.atoms),
            thumb: false,
            addedAt: Date.now(),
            batchPosition: puts.length,
            bytes: body.raw?.size || Mol.standard(body).length,
            ...(body.tags?.length ? { tags: body.tags } : {}),
          };
          for (const name of meta.tags || []) tags.set(name, { name });
          puts.push({ kind: 'm', meta, body });
          result.push(meta);
        }
        return { puts, result, tags: [...tags.values()] };
      });
    },
    async overwrite(record, expectedRevision) {
      if (builtin(record.id)) throw Error('組み込みの分子は上書きできません。');
      await ready;
      return commit(['m:' + record.id], async () => {
        const old = records.get('m:' + record.id);
        if (!old || old.meta.revision !== expectedRevision)
          throw Error('別の画面で上書きされています。最新の構造を確認してください。');
        const revision = crypto.randomUUID(),
          meta = {
            ...old.meta,
            revision,
            count: record.atoms.length,
            mass: Mol.mass.calculate(record.atoms),
            bytes: record.raw.size,
            thumb: false,
          };
        return {
          puts: [{ kind: 'm', meta, body: { ...record, name: meta.name, revision } }],
          result: meta,
        };
      });
    },
    async removeMany(ids) {
      if (!ids.length) return;
      await ready;
      if (ids.some(builtin)) throw Error('組み込みの分子・原子は削除できません');
      return commit(
        ids.map((id) => 'm:' + id),
        async () => ({ deletes: ids.map((id) => 'm:' + id) }),
      );
    },
    async renameMolecule(id, name) {
      await ready;
      return commit(['m:' + id], async () => {
        const old = records.get('m:' + id);
        if (!old) throw Error('対象の分子が見つかりません。');
        if (entries('m').some((r) => r.meta.id !== id && r.meta.name === name))
          throw Error('同じ名前の分子があります。');
        const body = await readRecord('m', id);
        return {
          puts: [{ kind: 'm', meta: { ...old.meta, name }, body: { ...body, name } }],
          result: { type: 'renamed', id, name },
        };
      });
    },
    async reactionList() {
      await ready;checkSession();
      if(offline)return service.reactionRead();
      await exclusive(()=>pull());
      return entries('r').map(ref=>({...clone(ref.meta),_summary:true}));
    },
    async reactionRead(id) {
      await ready;
      checkSession();
      if (offline) {
        const db = await openReactions(reactName);
        const rows = (await readAll(db, ['reactions'])).reactions;
        db.close();
        if (!id && rows.length < (account.reactionCount || 0))
          throw Error('一部の反応構造は端末に未取得です。オンラインで開いてください。');
        return id ? rows.find((r) => r.id === id) : rows;
      }
      await exclusive(() => pull());
      if (id) return readRecord('r', id);
      return parallel(entries('r'), (ref) => readRecord('r', ref.meta.id));
    },
    async reactionCreate(structures, name) {
      await ready;
      const now = new Date(),
        body = {
          ...clone(structures),
          id: crypto.randomUUID(),
          createdAt: Date.now(),
          name:
            name ||
            [now.getHours(), now.getMinutes()].map((n) => String(n).padStart(2, '0')).join(''),
        };
      for (const slot of ['START', 'FINISH'])
        if (body[slot] && !body[slot].revision)
          body[slot] = { ...body[slot], revision: crypto.randomUUID() };
      return commit([], async () => ({
        puts: [{ kind: 'r', meta: reactionMeta(body), body }],
        result: body,
      }));
    },
    async reactionImport(items) {
      await ready;
      const incoming=clone(items), seen=new Set();
      for(const item of incoming){
        if(typeof item?.id!=='string'||!item.id||seen.has(item.id))throw Error('反応IDが欠けているか重複しています。');
        seen.add(item.id);
      }
      const {fingerprint}=globalThis.ReactionArchive || {};
      if(!fingerprint)throw Error('反応ZIPの取り込み機能を読み込めませんでした。再読み込みしてください。');
      return commit([],async()=>{
        const puts=[];let skipped=0;
        // Inspect every conflict before uploading or selecting a new catalogue.
        for(const body of incoming){
          const old=await readRecord('r',body.id);
          if(old){
            if(await fingerprint(old)!==await fingerprint(body))throw Error('同じ反応IDの異なる内容があります。上書きせず停止しました：'+body.name+'（'+body.id+'）');
            skipped++;
          }else puts.push({kind:'r',meta:reactionMeta(body),body});
        }
        return {puts,result:{added:puts.length,skipped}};
      });
    },
    async reactionUpdate(id, fields, check) {
      await ready;
      return commit(['r:' + id], async () => {
        const old = await readRecord('r', id);
        if (!old) throw Error('反応が見つかりません。');
        if (check && !check(old))
          throw Error('別のタブで構造が更新されました。開き直してからもう一度操作してください。');
        const body = { ...old, ...fields };
        for (const slot of ['START', 'FINISH'])
          if (
            Object.hasOwn(fields, slot) &&
            body[slot] &&
            (!body[slot].revision || body[slot].revision === old[slot]?.revision)
          )
            body[slot] = { ...body[slot], revision: crypto.randomUUID() };
        delete body.startPreview;
        return { puts: [{ kind: 'r', meta: reactionMeta(body), body }], result: body };
      });
    },
    async reactionRemove(ids) {
      if (!ids.length) return;
      await ready;
      return commit(
        ids.map((id) => 'r:' + id),
        async () => ({ deletes: ids.map((id) => 'r:' + id) }),
      );
    },
    async reactionTag(ids, name, attach) {
      if (!ids.length) return;
      await ready;
      return commit(
        ids.map((id) => 'r:' + id),
        async () => ({
          puts: await parallel(ids, async (id) => {
            const body = await readRecord('r', id);
            if (!body) return null;
            const tags = new Set(body.tags || []);
            if (attach) tags.add(name);
            else tags.delete(name);
            const value = { ...body, tags: [...tags].sort(Mol.compareTagNames) };
            return { kind: 'r', meta: reactionMeta(value), body: value };
          }).then((items) => items.filter(Boolean)),
        }),
      );
    },
    async tagsTransaction(run) {
      await ready;
      if (offline)
        throw Error('オフラインのためタグを保存できません。接続が戻ってから操作してください。');
      const { before, expectedVersions, expectedTags } = await exclusive(async () => {
        await pull(true);
        const before = await readAll(await local.db(), ['meta', 'tags']);
        return {
          before,
          expectedVersions: new Map(
            before.meta.map((m) => ['m:' + m.id, records.get('m:' + m.id)?.version]),
          ),
          expectedTags: head.tagsVersion,
        };
      });
      const name = 'mol-bench-tag-stage-' + crypto.randomUUID();
      const staging = await new Promise((res, rej) => {
        const r = indexedDB.open(name, 1);
        r.onupgradeneeded = () => {
          const meta = r.result.createObjectStore('meta', { keyPath: 'id' });
          meta.createIndex('name', 'name', { unique: true });
          meta.createIndex('tags', 'tags', { multiEntry: true });
          r.result.createObjectStore('tags', { keyPath: 'name' });
        };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      try {
        let tx = staging.transaction(['meta', 'tags'], 'readwrite'),
          done = txDone(tx);
        for (const m of before.meta) tx.objectStore('meta').put(m);
        for (const t of before.tags) tx.objectStore('tags').put(t);
        await done;
        let result, failure;
        await new Promise((resolve, reject) => {
          const tx = staging.transaction(['meta', 'tags'], 'readwrite');
          tx.oncomplete = resolve;
          tx.onabort = () => reject(failure || tx.error);
          run(
            tx.objectStore('tags'),
            tx.objectStore('meta'),
            (value) => (result = value),
            (message) => {
              failure = Error(message);
              tx.abort();
            },
          );
        });
        const after = await readAll(staging, ['meta', 'tags']),
          previous = new Map(before.meta.map((m) => [m.id, JSON.stringify(m)]));
        const changed = after.meta.filter((m) => previous.get(m.id) !== JSON.stringify(m));
        return commit(
          changed.map((m) => 'm:' + m.id),
          async () => ({
            puts: changed.map((meta) => ({ kind: 'm', meta, metadataOnly: true })),
            tags: after.tags,
            result,
          }),
          {
            expectedTags,
            expectedVersions: new Map(
              changed.map((m) => ['m:' + m.id, expectedVersions.get('m:' + m.id)]),
            ),
          },
        );
      } finally {
        staging.close();
        indexedDB.deleteDatabase(name);
      }
    },
    async refresh() {
      await ready;
      return exclusive(async () => {
        const old = head?.generation;
        await pull(true);
        offline = false;
        status('Driveに接続済み：' + account.email);
        if (head.generation !== old && typeof document !== 'undefined')
          document.dispatchEvent(new CustomEvent('drive-store-updated'));
      });
    },
  };
  if (typeof document !== 'undefined') {
    window.addEventListener('beforeunload', (event) => {
      if (pendingWrites || migrating) {
        event.preventDefault();
        event.returnValue = '';
      }
    });
    setInterval(() => {
      if (!initializing && document.visibilityState === 'visible')
        service.refresh().catch((e) => status(e.message, true));
    }, 30000);
    window.addEventListener('focus', () => {
      if (!initializing) service.refresh().catch((e) => status(e.message, true));
    });
  }
  return service;
}
