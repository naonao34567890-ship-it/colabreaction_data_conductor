// Large Colab ZIP imports: spool inflated entries to Origin Private File System
// (OPFS) so compressed input and extracted records never coexist in JS heap.
// The caller must invoke cleanup() after uploading or on any processing failure.
export async function spoolColabZip(file, {
  Unzip, UnzipInflate, storage = globalThis.navigator?.storage,
  randomUUID = () => crypto.randomUUID(), onProgress = () => {},
} = {}) {
  if (!storage?.getDirectory) {
    throw Error('大容量ZIPの取り込みにはブラウザの一時ファイル領域（OPFS）が必要です。Chromeの通常ウィンドウで開いてください。');
  }
  const root = await storage.getDirectory();
  const dirName = 'mol-bench-colab-import-' + randomUUID();
  const dir = await root.getDirectoryHandle(dirName, {create: true});
  let cleaned = false;
  async function cleanup() {
    if (cleaned) return;
    cleaned = true;
    await root.removeEntry(dirName, {recursive: true});
  }
  const files = new Map();
  const names = new Set();
  let count = 0, finalized = 0, done = false;
  let writes = Promise.resolve();
  const queue = task => { writes = writes.then(task); };
  const {Unzip: Engine, UnzipInflate: Inflate} = Unzip
    ? {Unzip, UnzipInflate}
    : await import('./vendor/fflate.mjs');
  const unzip = new Engine(entry => {
    const path = entry.name;
    const directory = path.endsWith('/');
    const parts = (directory ? path.slice(0,-1) : path).split('/');
    if (path.startsWith('/') || path.includes('\\') ||
        parts.some(part => !part || part === '.' || part === '..') || names.has(path)) {
      throw Error('ZIP内に無効または重複したファイルパスがあります。');
    }
    names.add(path);
    count++;
    if (directory) {
      entry.ondata = error => { if (error) throw error; };
      entry.start();
      return;
    }
    const fileName = String(count) + '.data';
    let writer;
    queue(async () => {
      writer = await (await dir.getFileHandle(fileName, {create:true})).createWritable();
    });
    entry.ondata = (error, data, final) => {
      if (error) { queue(() => { throw error; }); return; }
      // fflate may reuse output buffers. Copy only a single decompressed chunk.
      if (data?.length) {
        const chunk = data.slice();
        queue(() => writer.write(chunk));
      }
      if (final) queue(async () => {
        await writer.close();
        files.set(path, await (await dir.getFileHandle(fileName)).getFile());
        finalized++;
      });
    };
    entry.start();
  });
  unzip.register(Inflate);
  const reader = file.stream().getReader();
  let read = 0;
  try {
    while (true) {
      const {done: end, value} = await reader.read();
      if (end) break;
      unzip.push(value, false);
      // Backpressure: do not read the next compressed chunk until all
      // decompressed bytes from this chunk have been committed to disk.
      await writes;
      read += value.byteLength;
      onProgress(read, file.size);
    }
    unzip.push(new Uint8Array(0), true);
    await writes;
    if (finalized !== [...names].filter(path => !path.endsWith('/')).length) {
      throw Error('ZIPが途中で切れているか、展開を完了できませんでした。');
    }
    done = true;
    return {files, cleanup};
  } catch (error) {
    try { await reader.cancel(); } catch {}
    // Wait for pending file writes before removing the temporary directory.
    try { await writes; } catch {}
    try { await cleanup(); } catch (cleanError) {
      console.warn('一時ZIPデータの削除に失敗しました:',cleanError);
    }
    if (error?.name === 'QuotaExceededError') {
      throw Error('ZIP展開用の一時ディスク容量が不足しています。ブラウザの保存領域とディスク空き容量を確認してください。');
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
}
