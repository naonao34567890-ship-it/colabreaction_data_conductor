const {chromium}=require('playwright'),assert=require('node:assert/strict'),path=require('node:path');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
  const context=await browser.newContext();const page=await context.newPage(),errors=[];context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));page.on('pageerror',e=>errors.push(e.message));
  await context.route('https://state.test/**',route=>{
   const p=new URL(route.request().url()).pathname;
   if(p==='/seed')return route.fulfill({contentType:'text/html',body:'<meta charset="utf-8"><script src="atomic-weights.js"></script><script src="common.js"></script><script src="worker.js"></script><script src="molecule-archive.js"></script><script src="reaction-store.js"></script>'});
   return route.fulfill({path:path.join(__dirname,'../dist',p==='/'?'index.html':p)});
  });await context.route('https://cdn.jsdelivr.net/**',r=>r.abort());
  await page.goto('https://state.test/seed');
  const legacyId=await page.evaluate(async()=>{
   const [saved]=await Mol.saveBatch([{name:'legacy',atoms:[{el:'O',x:0,y:0,z:0}],raw:new Blob(['1\n\nO 0 0 0\n']),comment:'',edited:false}]);
   // Real old records have no state fields in either store.
   const d=await Mol.db();await new Promise((res,rej)=>{const tx=d.transaction(['meta','body'],'readwrite');tx.oncomplete=res;tx.onabort=()=>rej(tx.error);for(const name of ['meta','body']){const q=tx.objectStore(name).get(saved.id);q.onsuccess=()=>{delete q.result.charge;delete q.result.multiplicity;tx.objectStore(name).put(q.result);};}});return saved.id;
  });
  await page.goto('https://state.test/editor.html?id='+legacyId);await page.waitForFunction(()=>molecule?.name==='legacy');
  assert.equal(await page.inputValue('#structureCharge'),'0');assert.equal(await page.inputValue('#structureMultiplicity'),'1');
  assert.equal(await page.evaluate(async()=>Object.hasOwn(await Mol.get('body',molecule.id),'charge')),false,'opening legacy does not migrate/rewrite');
  await page.fill('#structureCharge','-2');await page.locator('#structureCharge').blur();await page.fill('#structureMultiplicity','3');await page.locator('#structureMultiplicity').blur();
  await page.click('#undo');assert.equal(await page.inputValue('#structureMultiplicity'),'1');await page.click('#redo');assert.equal(await page.inputValue('#structureMultiplicity'),'3');
  await page.evaluate(()=>{Mol.confirmFileAction=async()=>true;});await page.click('#overwrite');await page.waitForFunction(()=>!overwriting&&molecule.charge===-2);
  await page.reload();await page.waitForFunction(()=>molecule?.name==='legacy');assert.equal(await page.inputValue('#structureMultiplicity'),'3');
  await page.click('#saveReactionStart');await page.fill('#reactionSaveName','state reaction');await page.click('#reactionSaveSubmit');await page.waitForFunction(()=>!document.querySelector('#reactionSaveDialog').open);
  const r=await page.evaluate(async()=>{const r=(await ReactionStore.read()).find(r=>r.name==='state reaction');return {id:r.id,state:Mol.electronicState(r.START)};});assert.deepEqual(r.state,{charge:-2,multiplicity:3});
  await page.goto('https://state.test/editor.html?reaction='+r.id+'&slot=START');await page.waitForFunction(()=>molecule?.name==='state reaction_START');assert.equal(await page.inputValue('#structureCharge'),'-2');
  await page.goto('https://state.test/seed');
  const imports=await page.evaluate(async()=>{
   const records=await Mol.metadata();const saved=records.find(m=>m.name==='legacy');const out=[];await MolJobs.exportData([saved.id],'zip',b=>out.push(b),()=>false,()=>{});const zip=new File(out,'roundtrip.zip');
   const read=await MoleculeArchive.read(zip);const same=await Mol.importMolecules(read.records);
   const fresh={...read.records[0],id:'new-id',name:'legacy'};const added=await Mol.importMolecules([fresh]);const duplicateNameRepeat=await Mol.importMolecules([fresh]);
   let error;try{await Mol.importMolecules([{...fresh,id:'would-be-partial'}, {...read.records[0],charge:1}]);}catch(e){error=e.message;}
   return {same,added,duplicateNameRepeat,id:(await Mol.get('body','new-id')).id,name:(await Mol.get('body','new-id')).name,charge:(await Mol.get('body','new-id')).charge,error,partial:!!await Mol.get('body','would-be-partial')};
  });
  assert.deepEqual(imports.same,{added:0,skipped:1});assert.equal(imports.added.added,1);assert.equal(imports.duplicateNameRepeat.skipped,1);assert.equal(imports.id,'new-id');assert.equal(imports.name,'legacy (2)');assert.equal(imports.charge,-2);assert.match(imports.error,/上書き/);assert.equal(imports.partial,false);
  const source=await page.evaluate(()=>URL.createObjectURL(new Blob(['1\nenergy=0 charge=-1 spin=2\nO 0 0 0\n1\nenergy=1 charge=1 spin=3\nO 1 0 0\n'])));
  const viewer=await context.newPage();await viewer.goto('https://state.test/reaction-viewer.html#'+new URLSearchParams({source,name:'colab-state'}));
  await viewer.waitForFunction(()=>!document.querySelector('#importStart').disabled);
  assert.match(await viewer.textContent('#atomCount'),/電荷 -1 · 多重度 2/);
  await viewer.click('#importStart');await viewer.waitForFunction(()=>document.querySelector('#slideStatus').textContent.includes('保存しました'));
  await viewer.click('#next');await viewer.waitForFunction(()=>document.querySelector('#frameCount').textContent==='2 / 2');await viewer.locator('#importFinish').evaluate(button=>button.click());await viewer.waitForFunction(()=>document.querySelector('#slideStatus').textContent.includes('_FINISH'));
  const states=await viewer.evaluate(async()=>{const r=(await ReactionStore.read()).find(r=>r.name==='colab-state');return ['START','FINISH'].map(k=>Mol.electronicState(r[k]));});assert.deepEqual(states,[{charge:-1,multiplicity:2},{charge:1,multiplicity:3}]);
  await viewer.click('#importMany');await viewer.click('#rangesForm button[type=submit]');await viewer.waitForFunction(()=>!document.querySelector('#rangesDialog').open);
  const pair=await viewer.evaluate(async()=>{const r=(await ReactionStore.read()).filter(r=>r.name==='colab-state').at(-1);return ['START','FINISH'].map(k=>Mol.electronicState(r[k]));});assert.deepEqual(pair,states);
  await page.goto('https://state.test/library.html');await page.waitForFunction(()=>typeof meta!=='undefined'&&meta.length>2);
  const zipBytes=await page.evaluate(async()=>{
   const body={id:'ui-zip-id',name:'UI ZIP',atoms:[{el:'O',x:0,y:0,z:0}],charge:-3,multiplicity:4,raw:new Blob(['1\n\nO 0 0 0\n'])};
   const out=[];await MolJobs.exportData([body.id],'zip',b=>out.push(b),()=>false,()=>{},false,{[body.id]:body});return [...new Uint8Array(await new Blob(out).arrayBuffer())];
  });
  await page.setInputFiles('#files',{name:'settings.zip',mimeType:'application/zip',buffer:Buffer.from(zipBytes)});
  await page.getByRole('button',{name:'取り込む',exact:true}).click();
  await page.waitForFunction(()=>metaMap.has('ui-zip-id'));
  assert.deepEqual(await page.evaluate(async()=>Mol.electronicState(await Mol.get('body','ui-zip-id'))),{charge:-3,multiplicity:4});
  assert.deepEqual(errors,[]);console.log('PASS browser: untouched legacy defaults, charge/multiplicity edit-save-reopen/undo, molecule ID import conflicts atomically, and Colab START/FINISH + paired transfer');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
