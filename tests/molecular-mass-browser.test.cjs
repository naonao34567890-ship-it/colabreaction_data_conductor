const {chromium}=require('playwright');
const path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:1100,height:800}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://mass.test/**',async route=>{
   const pathname=new URL(route.request().url()).pathname;
   if(pathname==='/seed')return route.fulfill({contentType:'text/html',body:'<script src="atomic-weights.js"></script><script src="common.js"></script>'});
   return route.fulfill({path:path.join(__dirname,'../dist',pathname==='/'?'index.html':pathname)});
  });
  await page.route('https://cdn.jsdelivr.net/**',route=>route.abort());
  await page.goto('https://mass.test/seed');
  const ids=await page.evaluate(async()=>{
   const atoms=els=>els.map(el=>({el,x:0,y:0,z:0}));
   const result=await Mol.saveBatch([{name:'gold',atoms:atoms(['Au']),edited:true},{name:'water',atoms:atoms(['O','H','H']),edited:true},{name:'unknown',atoms:atoms(['Tc']),edited:true}]);
   // Simulate data created before this feature: no mass metadata.
   const db=await Mol.db();await new Promise((resolve,reject)=>{const tx=db.transaction('meta','readwrite');tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);for(const m of result){delete m.mass;tx.objectStore('meta').put(m);}});
   return result.map(r=>r.id);
  });
  await page.goto('https://mass.test/library.html');
  await page.waitForFunction(()=>document.querySelectorAll('.tile-mass').length>=5);
  await page.waitForFunction(()=>[...document.querySelectorAll('.tile-mass')].some(n=>n.textContent==='196.9666'));
  const display=await page.evaluate(()=>[...document.querySelectorAll('.tile')].map(tile=>({name:tile.querySelector('.tile-name').textContent,text:tile.querySelector('.tile-mass').textContent,right:tile.querySelector('.tile-mass').getBoundingClientRect().left,delete:tile.querySelector('.delete')?.getBoundingClientRect().right,font:getComputedStyle(tile.querySelector('.tile-mass')).fontSize,deleteFont:tile.querySelector('.delete')&&getComputedStyle(tile.querySelector('.delete')).fontSize,scroll:tile.scrollWidth,width:tile.clientWidth})));
  assert.equal(display.find(x=>x.name==='gold').text,'196.9666');
  assert.equal(display.find(x=>x.name==='water').text,'18.0147–18.0160');
  assert.equal(display.find(x=>x.name==='unknown').text,'');
  for(const item of display.filter(x=>x.delete!==undefined)){assert.ok(item.right>=item.delete,'mass to the right of delete');assert.equal(item.font,item.deleteFont);assert.ok(item.scroll<=item.width,'no horizontal overflow');}
  await page.screenshot({path:path.join(require('node:os').tmpdir(),'molecular-mass-ui.png')});
  await page.selectOption('#libraryOrder','mass-asc');
  await page.waitForFunction(()=>!document.querySelector('#notice').textContent.includes('準備中'));
  const names=await page.evaluate(()=>grid.data.map(m=>m.name));
  assert.equal(names[0],'水素原子（H）');assert.equal(names.at(-1),'unknown');
  assert.ok(names.indexOf('gold')>names.indexOf('water'));
  await page.selectOption('#libraryOrder','mass-desc');
  assert.equal(await page.evaluate(()=>grid.data[0].name),'gold');
  // Cached masses prevent body rereads when legacy metadata is refreshed.
  await page.reload();await page.waitForFunction(()=>document.querySelectorAll('.tile-mass').length>=5);
  const cached=await page.evaluate(async()=>{const items=await Mol.metadata();const get=Mol.get;Mol.get=()=>{throw Error('body should not be read');};try{await Mol.ensureMasses(items);return items.every(m=>Mol.mass.valid(m.mass));}finally{Mol.get=get;}});
  assert.equal(cached,true);
  assert.deepEqual(errors,[]);
  console.log('PASS mass UI: legacy backfill/cache, numeric-only display, delete placement/font, no overflow and both sort directions');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
