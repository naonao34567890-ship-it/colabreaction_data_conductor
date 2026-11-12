// Integration test: requires Playwright and Chromium. Uses a fake Drive, never real files.
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
 const p=await browser.newPage({ignoreHTTPSErrors:true});const errors=[];p.on('pageerror',e=>errors.push(e.message));
 const files=new Map();let number=0,failUploads=false;
 await p.route('https://mol-bench.web.app/**',async r=>{const pathname=new URL(r.request().url()).pathname;const file=path.join(__dirname,'../dist',pathname==='/'?'index.html':pathname);if(fs.existsSync(file))await r.fulfill({path:file});else await r.fulfill({status:404,body:'missing'});});
 await p.route('https://mol-bench-drive.naonao34567890.workers.dev/token',r=>r.fulfill({json:{state:'connected',access_token:'test-token'},headers:{'Access-Control-Allow-Origin':'https://mol-bench.web.app'}}));
 await p.route('https://openidconnect.googleapis.com/v1/userinfo',r=>r.fulfill({json:{sub:'test-owner',email:'test@example.com',email_verified:true}}));
 await p.route('https://www.googleapis.com/**',async r=>{
  const req=r.request(),url=new URL(req.url());
  if(req.method()==='POST'){
   if(failUploads&&url.pathname.includes('/upload/'))return r.fulfill({status:500,body:'simulated failure'});
   let data,body='';
   if(url.pathname.includes('/upload/')){
    const text=req.postDataBuffer().toString('utf8'),boundary=req.headers()['content-type'].split('boundary=')[1];
    const parts=text.split('--'+boundary);data=JSON.parse(parts[1].split('\r\n\r\n')[1]);body=parts[2].slice(parts[2].indexOf('\r\n\r\n')+4,-2);
   }else data=JSON.parse(req.postData());
   const id='file'+(++number);files.set(id,{...data,id,createdTime:new Date().toISOString(),body});return r.fulfill({json:{id}});
  }
  if(url.searchParams.get('alt')==='media'){const id=url.pathname.split('/').pop();return r.fulfill({body:files.get(id).body,contentType:'application/json'});}
  const q=url.searchParams.get('q')||'',parent=q.match(/'([^']+)' in parents/)?.[1],prop=q.match(/key='([^']+)' and value='([^']+)'/);
  return r.fulfill({json:{files:[...files.values()].filter(f=>(!parent||f.parents?.includes(parent))&&(!q.includes('mimeType =')||f.mimeType==='application/vnd.google-apps.folder')&&(!prop||f.appProperties?.[prop[1]]===prop[2])).map(({body,...f})=>f)}});
 });
 await p.goto('https://mol-bench.web.app/library-cloud.html');
 await p.evaluate(async()=>{
  localStorage.setItem('mol-bench-drive-connection-v1','a'.repeat(64));
  const m={name:'existing molecule',atoms:[{el:'C',x:0,y:1,z:2}],raw:new Blob(['1\r\nkeep memo\r\nC 0 1 2\r\n'],{type:'chemical/x-xyz'}),tags:['keep-tag'],comment:'keep memo'};
  const rows=await Mol.saveBatch([m]);window.testId=rows[0].id;
  const db=await Mol.db();await new Promise((res,rej)=>{const t=db.transaction('tags','readwrite');t.objectStore('tags').put({name:'unused-tag'});t.oncomplete=res;t.onabort=()=>rej(t.error);});
  await new Promise((res,rej)=>{const r=indexedDB.open('molecular-xyz-reactions',1);r.onupgradeneeded=()=>r.result.createObjectStore('reactions',{keyPath:'id'});r.onsuccess=()=>{const db=r.result,t=db.transaction('reactions','readwrite');t.objectStore('reactions').add({id:'old-reaction',name:'reaction A',tags:['reaction tag'],createdAt:1000,START:{...m,revision:'start'},FINISH:{...m,atoms:[{el:'O',x:1,y:2,z:3}],revision:'finish'}});t.oncomplete=()=>{db.close();res();};t.onabort=()=>rej(t.error);};});
  localStorage.setItem('xyz-optimization-logs',JSON.stringify([{id:'log-one',events:[{type:'complete'}]}]));
 });
 const saved=await p.evaluate(async()=>{const m=await import('./library-cloud.js');return m.saveLibraries();});
 assert.equal(saved.molecules.length,1);assert.equal(saved.reactions.length,1);assert.equal(files.size>0,true);
 assert.equal([...files.values()].filter(f=>f.name.endsWith('.xyz')).length,3,'molecule + START + FINISH');
 const manifestFile=[...files.values()].find(f=>f.appProperties?.molBenchSnapshot==='complete');
 assert.ok(manifestFile);
 const noChanges=await p.evaluate(async()=>{const m=await import('./library-cloud.js');return m.saveLibraries({onlyChanged:true});});assert.equal(noChanges,null);
 await p.evaluate(async()=>{
  await Mol.remove(testId);
  const newer=await Mol.saveBatch([{name:'existing molecule',atoms:[{el:'H',x:9,y:9,z:9}],edited:true}]);await Mol.renameMolecule(newer[0].id,'existing molecule');
  await new Promise(res=>{const r=indexedDB.open('molecular-xyz-reactions',1);r.onsuccess=()=>{const db=r.result,t=db.transaction('reactions','readwrite');t.objectStore('reactions').delete('old-reaction');t.objectStore('reactions').add({id:'new-reaction',name:'reaction A',START:{atoms:[{el:'N',x:4,y:4,z:4}]}});t.oncomplete=()=>{db.close();res();};};});
  localStorage.setItem('xyz-optimization-logs',JSON.stringify([{id:'log-two'}]));
 });
 const object=files.get(saved.molecules[0].id),originalBody=object.body;object.body+=' ';
 const rejected=await p.evaluate(async id=>{try{await(await import('./library-cloud.js')).restoreLibraries(id);return false;}catch{return true;}},manifestFile.id);assert.equal(rejected,true);assert.equal(await p.evaluate(async()=>(await Mol.metadata()).filter(m=>!m.builtin).length),1,'integrity failure writes nothing');object.body=originalBody;
 const restored=await p.evaluate(async id=>(await import('./library-cloud.js')).restoreLibraries(id),manifestFile.id);assert.deepEqual(restored,{molecules:1,reactions:1});
 const again=await p.evaluate(async id=>(await import('./library-cloud.js')).restoreLibraries(id),manifestFile.id);assert.deepEqual(again,{molecules:0,reactions:0});
 const content=await p.evaluate(async()=>{const meta=(await Mol.metadata()).filter(m=>!m.builtin);return {names:meta.map(m=>m.name),raw:await(await Promise.all(meta.map(m=>Mol.get('body',m.id)))).find(b=>b.raw).raw.text(),logs:JSON.parse(localStorage.getItem('xyz-optimization-logs')).map(l=>l.id)};});
 assert.equal(content.names.length,2);assert.ok(content.names.includes('existing molecule'));assert.equal(content.raw,'1\r\nkeep memo\r\nC 0 1 2\r\n');assert.deepEqual(content.logs,['log-two','log-one']);
 await p.evaluate(async()=>{const db=await Mol.db();const rows=(await Mol.metadata()).filter(m=>!m.builtin);const bodies=await Promise.all(rows.map(m=>Mol.get('body',m.id)));const restored=bodies.find(b=>b._cloudFingerprint);await new Promise((res,rej)=>{const t=db.transaction('body','readwrite');t.objectStore('body').put({...restored,atoms:[{el:'F',x:5,y:5,z:5}],edited:true});t.oncomplete=res;t.onabort=()=>rej(t.error);});});
 const previousVersion=await p.evaluate(async id=>(await import('./library-cloud.js')).restoreLibraries(id),manifestFile.id);assert.deepEqual(previousVersion,{molecules:1,reactions:0},'restore keeps a later edit and adds the requested older structure');
 failUploads=true;
 const failed=await p.evaluate(async()=>{try{await(await import('./library-cloud.js')).saveLibraries();return false;}catch{return true;}});assert.equal(failed,true);
 assert.equal([...files.values()].filter(f=>f.appProperties?.molBenchSnapshot==='complete').length,1,'failed backup never publishes a complete manifest');
 assert.equal(await p.evaluate(async()=>(await Mol.metadata()).filter(m=>!m.builtin).length),3,'failed upload never deletes local records');
 const accountGuard=await p.evaluate(async()=>{localStorage.setItem('mol-bench-library-auto-account','another-account');return(await import('./library-cloud.js')).saveLibraries({automatic:true});});assert.equal(accountGuard,null,'auto-save does not send data to a different account');
 assert.deepEqual(errors,[]);
 console.log('PASS cloud snapshot with actual XYZs, reaction START/FINISH, exact Blob roundtrip, unchanged save, additive conflicting restore, repeated restore, logs merge, interrupted upload preserves data');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
