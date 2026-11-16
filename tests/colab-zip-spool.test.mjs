import assert from 'node:assert/strict';
import {zipSync, Unzip, UnzipInflate} from '../dist/vendor/fflate.mjs';
import {spoolColabZip} from '../dist/colab-zip-spool.mjs';

// OPFS mock preserves file handles, writable streams, and deletion lifecycle.
function makeStorage({quotaAt=Infinity}={}) {
  const dirs=new Map(),removed=[];
  const storage={
    async getDirectory(){return {
      async getDirectoryHandle(name){
        const entries=new Map();dirs.set(name,entries);
        return {
          async getFileHandle(filename){
            if(!entries.has(filename))entries.set(filename,[]);
            return {
              async createWritable(){
                const chunks=entries.get(filename);
                return {
                  async write(chunk){
                    if(chunks.reduce((n,x)=>n+x.length,0)+chunk.length>quotaAt){
                      const err=new Error('Quota exceeded');err.name='QuotaExceededError';throw err;
                    }
                    chunks.push(chunk);
                  },
                  async close(){},
                };
              },
              async getFile(){return new Blob(entries.get(filename));},
            };
          },
        };
      },
      async removeEntry(name){removed.push(name);dirs.delete(name);},
    };},
  };
  return {storage,dirs,removed};
}
const encode = str => new TextEncoder().encode(str);
const archive = zipSync({
  'records/reactant.xyz':encode('1\nreactant\nH 0 0 0\n'),
  'records/product.xyz':encode('1\nproduct\nH 0 0 1\n'),
  'records/DMF_energy.csv':encode('0,0\n1,-4\n'),
  'records/originals/binary.dat':new Uint8Array(4*1024*1024).fill(7),
}, {level:3});
let bytes=0,progress=0;
const mocks=makeStorage();
const result=await spoolColabZip(new Blob([archive]),{
  ...mocks, Unzip, UnzipInflate,
  randomUUID:()=> 'unit-test',
  onProgress:(read,total)=>{bytes=read;progress++;assert.ok(read<=total);},
});
assert.equal(bytes,archive.length);
assert.ok(progress>0);
assert.deepEqual([...result.files.keys()].sort(),[
  'records/DMF_energy.csv','records/originals/binary.dat','records/product.xyz','records/reactant.xyz',
]);
assert.equal(await result.files.get('records/DMF_energy.csv').text(),'0,0\n1,-4\n');
assert.equal(result.files.get('records/originals/binary.dat').size,4*1024*1024);
assert.equal(mocks.dirs.size,1);
await result.cleanup();
await result.cleanup();
assert.equal(mocks.dirs.size,0);
assert.equal(mocks.removed.length,1);

// Invalid ZIP paths must be rejected before uploading, without leaving temp files.
const traversal=zipSync({'../escape.xyz':encode('bad')});
const invalid=makeStorage();
await assert.rejects(
  spoolColabZip(new Blob([traversal]),{...invalid,Unzip,UnzipInflate,randomUUID:()=> 'bad-path'}),
  /無効または重複/
);
assert.equal(invalid.dirs.size,0);

// A failed disk write must produce an actionable error and clean up the workspace.
const full=makeStorage({quotaAt:128});
await assert.rejects(
  spoolColabZip(new Blob([archive]),{...full,Unzip,UnzipInflate,randomUUID:()=> 'disk-full'}),
  /一時ディスク容量が不足/
);
assert.equal(full.dirs.size,0);
assert.equal(full.removed.length,1);

// Integration contract: the Colab importer releases OPFS only after upload.
import {readFileSync} from 'node:fs';
const app=readFileSync(new URL('../dist/colab-records.js',import.meta.url),'utf8');
assert.match(app,/import\('\.\/colab-zip-spool\.mjs'\)/);
assert.match(app,/temporary = source\?\.cleanup \? source : null/);
assert.match(app,/await temporary\.cleanup\(\)/);
assert.match(app,/blob\.slice\(position,end\)/); // Drive upload remains chunked.
console.log('PASS Colab ZIP disk spool, content integrity, cleanup, quota failure, and Drive upload integration');
