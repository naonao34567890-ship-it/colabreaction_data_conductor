import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {zipSync,Unzip,UnzipInflate,unzipSync} from '../dist/vendor/fflate.mjs';

// Execute the actual import routines with a local ZIP and synthetic >1 GiB file.
// No Google Drive connection or large test fixture is required.
const source=readFileSync(new URL('../dist/colab-records.js',import.meta.url),'utf8');
function section(start,end) {
 const first=source.indexOf(start),last=source.indexOf(end,first);
 assert.ok(first>=0&&last>first,'missing '+start);
 return source.slice(first,last);
}
const readZipSource=section('async function readZip(file) {','async function importKey(name) {');
const uploadSource=section('async function uploadResumable(name,parent,blob,mime) {','const download = id =>');
assert.doesNotMatch(readZipSource,/file\.size\s*>\s*50/);
assert.doesNotMatch(readZipSource,/file\.arrayBuffer\(/);
assert.doesNotMatch(readZipSource,/100\s*\*\s*1024/);
assert.doesNotMatch(source,/計算結果が100 MiBを超えています/);

const parseFunctions=new Function('Unzip','UnzipInflate','status',readZipSource
 .replace("await import('./vendor/fflate.mjs')",'Promise.resolve({Unzip,UnzipInflate})')
 +'return {readZip,readFolder};');
const {readZip,readFolder}=parseFunctions(Unzip,UnzipInflate,()=>{});
const zip=zipSync({
 'calculation/':new Uint8Array(0),
 'calculation/reactant.xyz':new TextEncoder().encode('1\n\nH 0 0 0\n'),
 'calculation/product.xyz':new TextEncoder().encode('1\n\nH 0 0 0\n'),
 'calculation/DMF_energy.csv':new TextEncoder().encode('step,energy\n0,-1\n'),
});
const files=await readZip(new Blob([zip]));
assert.deepEqual([...files.keys()].sort(),[
 'calculation/DMF_energy.csv','calculation/product.xyz','calculation/reactant.xyz']);
assert.equal(await files.get('calculation/reactant.xyz').text(),'1\n\nH 0 0 0\n');
assert.deepEqual(Object.keys(unzipSync(zip)).sort(),[
 'calculation/','calculation/DMF_energy.csv','calculation/product.xyz','calculation/reactant.xyz']);
const huge={name:'1GiB-plus.gbw',size:1024**3+120};
assert.equal(readFolder([huge],f=>f.name).get(huge.name),huge);

let offset=0,calls=0;
const mockRequest=async()=>({headers:new Headers({Location:'https://www.googleapis.com/upload/mock-session'})});
const mockFetch=async(url,opts)=>{
 assert.equal(url,'https://www.googleapis.com/upload/mock-session');
 assert.equal(opts.method,'PUT');
 const match=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(opts.headers['Content-Range']);
 assert.ok(match);
 const start=Number(match[1]),end=Number(match[2]),total=Number(match[3]);
 assert.equal(start,offset);
 assert.equal(end-start+1,opts.body.length);
 assert.equal(total,1024**3+120);
 assert.ok(opts.body.length<=8*1024*1024);
 offset=end+1;calls++;
 return offset===total
   ? Response.json({id:'mock-file-id'})
   : new Response(null,{status:308,headers:{Range:'bytes=0-'+(offset-1)}});
};
const upload=new Function('request','fetch','token','setTimeout',uploadSource+'return uploadResumable;')
  (mockRequest,mockFetch,'token-for-test',setTimeout);
const hugeBlob={size:huge.size,slice(start,end){return {length:end-start};}};
assert.equal(await upload('big.gbw','drive-folder',hugeBlob,'application/octet-stream'),'mock-file-id');
assert.equal(offset,huge.size);
assert.ok(calls>100);
console.log('PASS ColabReaction large ZIP/folder import and chunked >1 GiB Drive upload');
