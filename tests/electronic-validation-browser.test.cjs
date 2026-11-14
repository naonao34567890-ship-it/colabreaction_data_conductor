const {chromium}=require('playwright'),assert=require('node:assert/strict'),path=require('node:path');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://check.test/**',r=>{const p=new URL(r.request().url()).pathname;return r.fulfill({path:path.join(__dirname,'../dist',p==='/'?'index.html':p)});});await page.route('https://cdn.jsdelivr.net/**',r=>r.abort());
  await page.goto('https://check.test/editor.html?id=builtin-water');await page.waitForFunction(()=>molecule?.id==='builtin-water');
  await page.fill('#structureMultiplicity','2');await page.locator('#structureMultiplicity').blur();
  assert.match(await page.textContent('#electronicCheck'),/電子数 10.*奇数/);
  await page.evaluate(()=>naming('save'));await page.fill('#name','inconsistent water');await page.click('#confirm');
  await page.getByRole('dialog',{name:'電荷・多重度の確認'}).waitFor();assert.match(await page.getByRole('dialog',{name:'電荷・多重度の確認'}).innerText(),/保存しますか/);
  await page.getByRole('dialog',{name:'電荷・多重度の確認'}).getByRole('button',{name:'キャンセル',exact:true}).click();
  await page.waitForFunction(()=>!newSaving);assert.equal(await page.evaluate(async()=>(await Mol.metadata()).filter(m=>m.name==='inconsistent water').length),0,'cancel does not save');
  await page.click('#confirm');await page.getByRole('button',{name:'そのまま保存する',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#nameDialog').open);
  const saved=await page.evaluate(async()=>{const m=(await Mol.metadata()).find(m=>m.name==='inconsistent water');return Mol.get('body',m.id);});assert.equal(saved.multiplicity,2,'confirm retains requested state without automatic correction');
  await page.fill('#structureMultiplicity','1');await page.locator('#structureMultiplicity').blur();await page.evaluate(()=>naming('save'));await page.fill('#name','consistent water');await page.click('#confirm');await page.waitForFunction(()=>!document.querySelector('#nameDialog').open);assert.equal(await page.getByRole('dialog',{name:'電荷・多重度の確認'}).count(),0);
  const waiting=page.evaluate(()=>Mol.confirmElectronicSave({START:{atoms:[{el:'O',x:0,y:0,z:0}],charge:0,multiplicity:1},FINISH:{atoms:[{el:'O',x:0,y:0,z:0}],charge:1,multiplicity:2}}));
  const d=page.getByRole('dialog',{name:'電荷・多重度の確認'});await d.waitFor();assert.match(await d.innerText(),/反応前後で電荷が異なります/);await d.getByRole('button',{name:'キャンセル',exact:true}).click();assert.equal(await waiting,false);
  await page.click('#saveReactionStart');await page.fill('#reactionSaveName','charge transition');await page.click('#reactionSaveSubmit');await page.waitForFunction(()=>!document.querySelector('#reactionSaveDialog').open);
  const reactionId=await page.evaluate(async()=>(await ReactionStore.read()).find(r=>r.name==='charge transition').id);
  await page.fill('#structureCharge','1');await page.locator('#structureCharge').blur();await page.fill('#structureMultiplicity','2');await page.locator('#structureMultiplicity').blur();
  await page.click('#saveReactionFinish');await page.click('#reactionSaveSubmit');
  const transition=page.getByRole('dialog',{name:'電荷・多重度の確認'});await transition.waitFor();assert.match(await transition.innerText(),/START: 0 \/ FINISH: 1/);
  await transition.getByRole('button',{name:'キャンセル',exact:true}).click();await page.waitForFunction(()=>!reactionSaving);
  assert.equal(await page.evaluate(async id=>!!(await ReactionStore.read(id)).FINISH,reactionId),false,'cancel charge-change save leaves reaction intact');
  await page.click('#reactionSaveSubmit');await page.getByRole('button',{name:'そのまま保存する',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#reactionSaveDialog').open);
  assert.equal(await page.evaluate(async id=>(await ReactionStore.read(id)).FINISH.charge,reactionId),1,'charge-changing reaction can be saved intentionally');
  await page.fill('#structureCharge','0');await page.locator('#structureCharge').blur();await page.fill('#structureMultiplicity','1');await page.locator('#structureMultiplicity').blur();
  // Unsupported optimization states remain blocked before loading an engine.
  await page.evaluate(()=>{$('optimize').click();$('optMultiplicity').value='2';$('optForm').requestSubmit();});assert.match(await page.textContent('#optStatus'),/電子数 10.*奇数/);assert.equal(await page.locator('#optProgress').isVisible(),false);
  assert.deepEqual(errors,[]);console.log('PASS UI: live parity feedback, cancel/confirm inconsistent save, no auto-correction, valid save without warning, reaction charge warning and optimization guard');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
