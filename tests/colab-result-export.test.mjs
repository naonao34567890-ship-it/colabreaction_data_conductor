import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as zip from '../dist/vendor/fflate.mjs';

const source = readFileSync(new URL('../dist/colab-records.js', import.meta.url), 'utf8');
const exportSource = source.slice(source.indexOf('function colabResultEntries('),
  source.indexOf('function serveVibrationFiles('))
  .replace("await import('./vendor/fflate.mjs')", 'zip');
assert.match(source, /colabArchive\.onclick = .*downloadArchive.*colabResult:true/);

const data = {
  'reactant.xyz': '1\n\nH 0 0 0\n',
  'product.xyz': '1\n\nH 0 0 1\n',
  'DMF_energy.csv': 'Image,Energy\n0,-1\n',
  'DMF_final.xyz': '1\ncharge=0 spin=1\nH 0 0 0\n',
  'source-reaction.zip': Uint8Array.of(80, 75, 0, 255),
};
const job = {
  name: 'Renamed calculation',
  _parentName: '反応名',
  appProperties: {
    method: 'DMF', runNumber: '7', sourceReactionId: 'reaction-id', reactionName: '元の反応名',
    runId: '11111111-1111-4111-8111-111111111111',
  },
};

let downloaded, statusMessage;
const directories = new Map();
const payloads = new Map();
function seed(files) {
  directories.clear();
  payloads.clear();
  directories.set('originals', []);
  for (const [path, bytes] of Object.entries(files)) {
    const parts = path.split('/');
    const name = parts.pop();
    let parent = 'originals';
    for (const part of parts) {
      const id = parent + '/' + part;
      if (!directories.has(id)) {
        directories.get(parent).push({id, name: part, mimeType: 'folder'});
        directories.set(id, []);
      }
      parent = id;
    }
    directories.get(parent).push({id: path, name});
    payloads.set(path, bytes);
  }
}

const Mol = {
  safeName: name => name.replace(/[\\/:*?"<>|]/g, '_'),
  downloadBlob: (blob, filename) => { downloaded = {blob, filename}; },
};
const downloadArchive = new Function('zip', 'Mol', 'list', 'download', 'folderType', 'window',
  'status', exportSource + '\nreturn downloadArchive;')(
  zip, Mol, async query => directories.get(query.split("'")[1]),
  async id => new Response(payloads.get(id)), 'folder', {}, message => { statusMessage = message; });

async function exportFiles(record, compatible = true) {
  downloaded = statusMessage = null;
  const button = {textContent: 'ZIP export', disabled: false};
  await downloadArchive(record, 'originals', button, {colabResult: compatible});
  assert.deepEqual(button, {textContent: 'ZIP export', disabled: false});
  return downloaded && zip.unzipSync(new Uint8Array(await downloaded.blob.arrayBuffer()));
}

seed(data);
const prefix = '反応名/DMF(7)/';
const entries = await exportFiles(job);
assert.equal(downloaded.filename, '反応名_Renamed calculation_ColabReaction.zip');
for (const [name, bytes] of Object.entries(data)) {
  assert.deepEqual(entries[prefix + name], typeof bytes === 'string' ? zip.strToU8(bytes) : bytes);
}
const context = JSON.parse(zip.strFromU8(entries[prefix + 'reaction-context.json']));
assert.equal(context.format, 'mol-bench-reaction-context');
assert.equal(context.version, 2);
assert.equal(context.sourceReactionId, job.appProperties.sourceReactionId);
assert.equal(context.runId, job.appProperties.runId);
assert.equal(context.runNumber, 7);
assert.equal(context.name, '元の反応名');
assert.equal(context.displayPath, '反応名/DMF(7)');

// Exercise the existing importer up to its registration check. It must read
// the nested v2 context and use the run ID to find an existing calculation.
const importSource = source.slice(source.indexOf('async function importRecords('),
  source.indexOf('async function reserveReactionRun('));
const importRecords = new Function('alreadyRegistered', 'status', importSource + '\nreturn importRecords;')(
  async (_name, runId) => {
    assert.equal(runId, job.appProperties.runId);
    return true;
  }, message => { statusMessage = message; });
await importRecords(downloaded.filename, 'ZIP', async () =>
  new Map(Object.entries(entries).map(([path, bytes]) => [path, new Blob([bytes])])));
assert.match(statusMessage, /登録済みの計算をスキップ/);

seed(entries);
const reexport = await exportFiles({...job, _parentName: '改名後'});
assert.deepEqual(Object.keys(reexport).sort(),
  Object.keys(entries).map(path => path.replace(prefix, '改名後/DMF(7)/')).sort());
assert.deepEqual(reexport['改名後/DMF(7)/reaction-context.json'], entries[prefix + 'reaction-context.json']);

seed(data);
assert.deepEqual(Object.keys(await exportFiles({name: 'DMF_output_20261123_123456.zip'})).sort(),
  Object.keys(data).sort());
assert.deepEqual(Object.keys(await exportFiles(job, false)).sort(), Object.keys(data).sort());
seed({'reactant.xyz': data['reactant.xyz']});
assert.equal(await exportFiles(job), null);
assert.match(statusMessage, /product\.xyz/);
seed({...data, 'nested/reactant.xyz': data['reactant.xyz']});
assert.equal(await exportFiles(job), null);
assert.match(statusMessage, /reactant\.xyz.*複数/);
console.log('PASS Colab result export, metadata, file bytes, legacy layout and original download');
