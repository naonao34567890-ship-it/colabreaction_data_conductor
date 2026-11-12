const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const Mol=globalThis.Mol=require('../dist/common.js');
require('../dist/worker.js');
const Archive=require('../dist/reaction-archive.js');
(async()=>{
 const raw=new Blob(['1\r\ncharge=-1\r\nH 0.00000000000001 0 0 extra\r\nfooter\r\n'],{type:'chemical/x-xyz'});
 const endpoint={name:'同名_START',atoms:[{el:'H',x:1e-14,y:-0,z:0,extra:['extra']}],raw,comment:'charge=-1',revision:'rev1',edited:false};
 const input=[{id:'id/a',name:'同名',tags:['日本語','タグ'],createdAt:123,START:endpoint,FINISH:{...endpoint,revision:'rev2',atoms:[{el:'H',x:2,y:3,z:4}]}},
 {id:'id-b',name:'同名',tags:[],START:{...endpoint,name:'改名済みの構造'},note:undefined,other:new Uint8Array([0,255,128]),startPreview:{revision:'rev1',image:'data:image/png;base64,test',generation:3}},
 {id:'id-c',name:'空の反応',FINISH:null}];
 const before=structuredClone(input);
 const {manifest,files}=await Archive.build(input,{origin:'https://original.example'});
 assert.deepEqual(input,before,'export must not mutate source');
 assert.equal(manifest.count,3);
 assert.equal(manifest.format,'mol-bench-reaction-library');
 assert.equal(manifest.reactions[0].reactionId,'id/a');
 assert.notEqual(manifest.reactions[0].record.path,manifest.reactions[1].record.path);
 assert.equal(manifest.reactions[1].endpoints.FINISH,null);
 assert.equal(manifest.reactions[2].endpoints.START,null);
 assert.equal(manifest.reactions[2].endpoints.FINISH,null);
 const map=new Map(files.map(f=>[f.path,f.blob]));
 assert.equal(map.size,files.length);
 async function restore(value) {
  if(!value||typeof value!=='object')return value;
  switch(value.type) {
   case 'object': return Object.fromEntries(await Promise.all(value.entries.map(async([k,v])=>[k,await restore(v)])));
   case 'array': return Promise.all(value.items.map(restore));
   case 'blob': return new Blob([await map.get(value.file.path).arrayBuffer()],{type:value.mime});
   case 'undefined': return undefined;
   case 'number': return value.value==='-0'?-0:Number(value.value);
   case 'binary': return new globalThis[value.constructor](await map.get(value.file.path).arrayBuffer());
   default: throw Error('Unknown encoding');
  }
 }
 for(let i=0;i<input.length;i++) {
  const reference=manifest.reactions[i].record;
  assert.equal(reference.sha256,Buffer.from(await crypto.subtle.digest('SHA-256',await map.get(reference.path).arrayBuffer())).toString('hex'));
  const restored=await restore(JSON.parse(await map.get(reference.path).text()));
  assert.deepEqual(restored,input[i],'full record including exact coordinates and metadata');
  if(restored.START)assert.equal(await restored.START.raw.text(),await raw.text());
 }
 const chunks=[];
 await MolJobs.exportFiles(files,bytes=>chunks.push(Buffer.from(bytes)));
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'reaction-archive-'));
 try {
  const zip=path.join(dir,'test.zip');await fs.writeFile(zip,Buffer.concat(chunks));
  execFileSync('python',['-c',`import sys,zipfile,json,hashlib
with zipfile.ZipFile(sys.argv[1]) as z:
 assert z.testzip() is None
 m=json.loads(z.read('reaction-library.json'))
 assert m['count']==3
 def verify(ref):
  data=z.read(ref['path'])
  assert len(data)==ref['bytes']
  assert hashlib.sha256(data).hexdigest()==ref['sha256']
 def walk(v):
  if isinstance(v,dict):
   if 'path' in v and 'sha256' in v: verify(v)
   for x in v.values(): walk(x)
  elif isinstance(v,list):
   for x in v: walk(x)
 walk(m)
 for r in m['reactions']: walk(json.loads(z.read(r['record']['path'])))
 assert all('同名' not in name and '..' not in name for name in z.namelist())
`,zip]);
 } finally {await fs.rm(dir,{recursive:true,force:true});}
 await assert.rejects(Archive.build([input[0],input[0]]),/重複/);
 await assert.rejects(Archive.build([{name:'missing id'}]),/反応ID/);
 console.log('PASS lossless reaction ZIP, exact raw bytes, role pairing, duplicate names, missing endpoints, hashes and independent Python ZIP validation');
})().catch(e=>{console.error(e);process.exitCode=1;});
