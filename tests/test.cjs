const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');const M=require('../dist/common.js');require('../dist/worker.js');let passed=0;
async function parse(text){const result=[];for await(const b of M.parseFile(new File([text],'test.xyz')))result.push(b);return result;}
async function test(name,fn){await fn();passed++;console.log('PASS',name);}
(async()=>{
const fixture=fs.readFileSync(path.join(__dirname,'qm9_39.xyz'),'utf8');
await test('SDF import converts V2000 and V3000, ignores properties, and recovers across records',async()=>{
 const v2000=['','SDF test','','  2  1  0  0  0  0            999 V2000',
  '    1.2345   -2.5000    0.0000 C   0  0  0  0  0  0',
  '    0.0000    0.0000    3.0000 O   0  0  0  0  0  0',
  '  1  2  1  0','M  CHG  1   2  -1','M  END','>  <PUBCHEM_COMPOUND_CID>','123','',
  '>  <IGNORED>','2','','H 0 0 0','$$$$'].join('\r\n');
 const v3000=['second','','','  0  0  0  0  0  0            999 V3000',
  'M  V30 BEGIN CTAB','M  V30 COUNTS 1 0 0 0 0','M  V30 BEGIN ATOM',
  'M  V30 1 Cl -1.2e-2 2 3 0 -','M  V30 CHG=-1','M  V30 END ATOM','M  V30 END CTAB','M  END'].join('\n');
 const file=new File([v2000+'\ninvalid\n$$$$\n'+v3000],'example.SDF');
 const blocks=[];
 for await(const block of M.parseFile(file))blocks.push(block);
 assert.deepEqual(blocks[0].atoms,[{el:'C',x:1.2345,y:-2.5,z:0},{el:'O',x:0,y:0,z:3}]);
 assert.match(blocks[1].error,/SDF レコード 2/);
 assert.deepEqual(blocks[2].atoms,[{el:'Cl',x:-.012,y:2,z:3}]);
 assert.equal(blocks[0].rawParts[0].split('\n')[1],'');
 assert.equal((await parse(blocks[0].rawParts[0]))[0].atoms.length,2);
 assert.ok(M.acceptsStructure(file.name));
 assert.equal((await M.scanEntries([{isFile:true,name:file.name}])).length,1);

 const saveBatch=M.saveBatch,notify=M.notify;
 const stored=[];
 M.saveBatch=async records=>{stored.push(...records);return records;};
 M.notify=()=>{};
 try {
  const job=new MolJobs.ImportJob(()=>{},async(name,total)=>{
   assert.equal(name,file.name);
   assert.equal(total,2);
   return {action:'import',ranges:[[2,2]]};
  });
  await job.files([file]);
  await job.finish();
  assert.equal(job.stats.registered,1);
  assert.equal(job.stats.skipped,1);
  assert.equal(stored[0].name,'example(2)');
  assert.deepEqual(stored[0].atoms,blocks[2].atoms);
  assert.equal(await stored[0].raw.text(),blocks[2].rawParts[0]);
 } finally {M.saveBatch=saveBatch;M.notify=notify;}
});
await test('QM9 14 atoms / 16 base / 19 total / raw exact',async()=>{const r=await parse(fixture);assert.equal(r.length,1);assert.equal(r[0].atoms.length,14);assert.equal(r[0].baseLines,16);assert.equal(r[0].originalLines,19);assert.equal(r[0].rawParts.join(''),fixture);assert.equal(r[0].atoms[0].extra[0],'-0.377162');assert.equal(r[0].atoms[0].x,-.0300762365);});
await test('Empty comment, whitespace, case, exponents, extra invalid retained',async()=>{const r=await parse('2\n\ncl 1.5*^-6\t2E-3 3e+2 bad\nH 0 0 0\n');assert.equal(r[0].comment,'');assert.equal(r[0].atoms[0].el,'Cl');assert.equal(r[0].atoms[0].x,1.5e-6);assert.equal(r[0].atoms[0].y,.002);assert.equal(r[0].atoms[0].z,300);assert.deepEqual(r[0].atoms[0].extra,['bad']);});
await test('CRLF / CR / LF exact output',async()=>{for(const newline of ['\r\n','\r','\n']){const input=['1','','H 0 0 0',''].join(newline);const r=await parse(input);assert.equal(r.length,1);assert.equal(r[0].rawParts.join(''),input);}});
await test('Integer footer is not false molecule',async()=>{const r=await parse('1\nA\nH 0 0 0\n3\nSMILES\nInChI=123\n1\nB\nC 0 1 0\n');assert.equal(r.length,2);assert.equal(r[0].originalLines,6);assert.equal(r[1].comment,'B');});
await test('Unknown element skipped without losing adjacent molecules',async()=>{const r=await parse('1\nA\nH 0 0 0\n1\nunknown\nXx 0 0 0\n1\nB\nO 0 1 0\n');assert.equal(r.filter(x=>x.atoms).length,2);assert.equal(r.filter(x=>x.error).length,1);});
await test('Malformed leading block recovers',async()=>{const r=await parse('2\nbad\nH nope 0 0\nC 0 0 0\n1\nvalid\nC 1 2 3');assert.equal(r.filter(x=>x.atoms).length,1);assert.ok(r.some(x=>x.error));});
await test('Chunk boundary CRLF and footer larger than chunk',async()=>{const s='1\n\nH 0 0 0\n'+'x'.repeat(262131)+'\r\n'+fixture;const r=await parse(s);assert.equal(r.length,2);assert.equal(r.map(x=>x.rawParts.join('')).join(''),s);});
await test('Edited output drops extra/footer and leaves a blank second line',async()=>{const [r]=await parse(fixture);const out=M.standard(r);assert.equal(out.trimEnd().split('\n').length,16);assert.equal(out.split('\n')[1],'');assert.equal(out.split('\n')[2].trim().split(/\s+/).length,4);});
await test('Exports blank comment for edited and imported records',async()=>{
 for(const newline of ['\n','\r\n','\r']){
  const tail=['H 0 0 0 extra','footer',''].join(newline);
  const [r]=await parse(['1','日本語 comment',tail].join(newline));
  r.raw=new Blob(r.rawParts);
  assert.equal(await (await M.output(r)).text(),['1','',tail].join(newline));
  assert.equal((await (await M.output({...r,edited:true})).text()).split('\n')[1],'');
 }
});
await test('Spatial bonds detect H2 and exclude separated atom',()=>{assert.deepEqual(M.bonds([{el:'H',x:0,y:0,z:0},{el:'H',x:.74,y:0,z:0},{el:'H',x:8,y:0,z:0}]),[[0,1]]);});
await test('Swap anchored, atom ordering invariant',()=>{const a=[{el:'C',x:0,y:0,z:0},{el:'H',x:1,y:0,z:0},{el:'O',x:10,y:0,z:0}];M.swap(a,{ids:[0,1],point:1},{ids:[2],point:2});assert.deepEqual(a.map(v=>v.el),['C','H','O']);assert.deepEqual(a.map(v=>v.x),[9,10,1]);});
await test('Swap centroid fallback + overlap rejection',()=>{const a=[{el:'C',x:0,y:0,z:0},{el:'H',x:2,y:0,z:0},{el:'O',x:10,y:0,z:0}];M.swap(a,{ids:[0,1],point:1},{ids:[2],point:null});assert.deepEqual(a.map(v=>v.x),[9,11,1]);assert.throws(()=>M.swap(a,{ids:[0,1],point:null},{ids:[1],point:null}),/重複/);});
await test('Batching, multi-block names and 50 MiB skip',async()=>{const original=M.saveBatch,notify=M.notify;const batches=[];M.notify=()=>{};M.saveBatch=async r=>{batches.push(r.map(a=>({...a})));return r.map(a=>({name:a.name,id:a.name}));};const job=new MolJobs.ImportJob(()=>{});await job.files(Array.from({length:201},(_,i)=>new File(['1\n\nH 0 0 0\n'],i+'.xyz')));await job.files([new File(['1\n\nH 0 0 0\n1\n\nO 0 0 0\n'],'multi.xyz'),{size:51*1024*1024,name:'large.xyz'}]);await job.finish();assert.deepEqual(batches.map(x=>x.length),[200,3]);assert.equal(job.stats.registered,203);assert.equal(job.stats.extra,1);assert.equal(job.stats.skipped,1);assert.equal(batches[1][0].name,'200');assert.equal(batches[1][1].name,'multi(1)');assert.equal(batches[1][2].name,'multi(2)');M.saveBatch=original;M.notify=notify;});
await test('Cancel preserves completed partial batch',async()=>{const original=M.saveBatch,notify=M.notify;M.notify=()=>{};M.saveBatch=async r=>r;const job=new MolJobs.ImportJob(()=>{});await job.files([new File(['1\n\nH 0 0 0\n'],'one.xyz')]);job.cancelled=true;await job.files([new File(['1\n\nH 0 0 0\n'],'two.xyz')]);await job.finish();assert.equal(job.stats.registered,1);M.saveBatch=original;M.notify=notify;});
await test('ZIP streaming + CRC + unique safe names',async()=>{const old=M.get;M.get=async(s,id)=>({name:id==='2'?'a:b':'a/b',edited:false,atoms:[{el:'H',x:0,y:0,z:0}],raw:new Blob(['1\n日本語\nH 0 0 0\n'])});const chunks=[];await MolJobs.exportData(['1','2'],'zip',async b=>chunks.push(b),()=>false,()=>{});fs.writeFileSync(path.join(__dirname,'output-test.zip'),Buffer.concat(chunks));assert.ok(chunks.length>4);M.get=old;});

await test('Malformed interior block warning and separation',async()=>{const r=await parse('1\nA\nH 0 0 0\n1\nbad\nH nan 0 0\n1\nB\nC 0 1 0\n');assert.equal(r.filter(x=>x.atoms).length,2);assert.ok(r.some(x=>x.error));assert.equal(r[0].originalLines,3);});
await test('Directory readEntries repeats to empty, recursive stack, xyz only',async()=>{let calls=0;function dir(children){return{isDirectory:true,createReader(){let i=0;return{readEntries(cb){calls++;cb(children.slice(i,i+=100));}};}}}const files=Array.from({length:305},(_,i)=>({isFile:true,name:i+'.xyz'}));let deep={isFile:true,name:'deep.XYZ'};for(let i=0;i<40;i++)deep=dir([deep]);const got=await M.scanEntries([dir([...files,{isFile:true,name:'ignore.txt'},deep])]);assert.equal(got.length,306);assert.ok(calls>=85);});
await test('Quota failure stops import without hiding committed count',async()=>{const old=M.saveBatch,notify=M.notify;M.notify=()=>{};let count=0;M.saveBatch=async rows=>{if(count++)throw Object.assign(Error('full'),{name:'QuotaExceededError'});return rows;};const job=new MolJobs.ImportJob(()=>{});await job.files(Array.from({length:401},(_,i)=>new File(['1\n\nH 0 0 0\n'],i+'.xyz')));await job.finish();assert.equal(job.stats.registered,200);assert.equal(job.cancelled,true);assert.match(job.stats.fatal,/容量/);M.saveBatch=old;M.notify=notify;});
await test('ZIP64 entry count 65536 independent extraction fixture',async()=>{const get=M.get,tick=M.tick;M.get=async(s,id)=>({name:'file'+id,edited:false,atoms:[{el:'H',x:0,y:0,z:0}],raw:new Blob(['1\n\nH 0 0 0\n'])});M.tick=async()=>{};const chunks=[];await MolJobs.exportData(Array.from({length:65536},(_,i)=>String(i)),'zip',async b=>chunks.push(b),()=>false,()=>{});fs.writeFileSync(path.join(__dirname,'zip64-test.zip'),Buffer.concat(chunks));M.get=get;M.tick=tick;});
console.log(`${passed} tests passed`);
})().catch(e=>{console.error(e);process.exitCode=1;});
