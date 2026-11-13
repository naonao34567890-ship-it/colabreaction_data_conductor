const {chromium}=require('playwright');
const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage(),errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
  await page.route('https://home.test/**',route=>{
   const p=new URL(route.request().url()).pathname;
   if(p.startsWith('/api/'))return route.fulfill({status:401,contentType:'application/json',body:'{"error":"not_connected"}'});
   return route.fulfill({path:path.join(__dirname,'../dist',p==='/'?'index.html':p)});
  });
  await page.route('https://cdn.jsdelivr.net/**',route=>route.abort());
  for(const width of [1440,390]){
   requests.length=0;await page.setViewportSize({width,height:900});await page.goto('https://home.test/');
   assert.equal(await page.locator('h1').innerText(),'分子構造を編集して、\n保存する。');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal overflow');
   assert.ok(!requests.some(url=>/\.wasm|\/api\/|common\.js|drive-store\.js/.test(url)),'home needs no calculation engine or Drive session');
   for(const href of await page.locator('a[href]').evaluateAll(a=>a.map(x=>x.getAttribute('href')))){
    if(href.endsWith('.html'))assert.ok(fs.existsSync(path.join(__dirname,'../dist',href)),'destination exists: '+href);
   }
   await page.screenshot({path:path.join(require('node:os').tmpdir(),'mol-bench-home-'+width+'.png'),fullPage:true});
  }
  await page.getByRole('link',{name:'分子ライブラリを開く'}).first().click();assert.ok(page.url().endsWith('/library.html'));
  await page.goto('https://home.test/?drive=1#test');await page.waitForURL('**/colab.html?drive=1#test');
  assert.deepEqual(errors,[]);
  console.log('PASS home: desktop/mobile layout, lightweight startup, app navigation and Drive callback forwarding');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
