const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {pathToFileURL} = require('node:url');

(async () => {
  const helper = await import(pathToFileURL(path.join(__dirname,'../dist/colab-record-summary.mjs')));
  const config = (suffix='') => [
    'ZIP名: demo.zip','プロット点数: 4','ファイル数: 3',
    '電荷: -2','spin（出力値）: フレーム間で不一致',
    '電荷・spinの取得元: DMF_final.xyz',
    '結果出力日時: 2026-11-14 12:13:14（ZIP名由来・タイムゾーン不明）',
    suffix,
  ].join('\n');
  const ids = i => new Map([
    ['計算結果','originals-'+i],['config.txt','config-'+i],
    ['START.png','start-'+i],['FINAL.png','final-'+i],
    ['Energy.png','energy-'+i],
  ]);
  const long = 'テスト'.repeat(90);
  const partial = config().replace('電荷: -2','電荷: '+long);
  assert.deepEqual(helper.parseConfig(config()).count,'3');
  assert.equal(helper.readSummary(helper.summaryProperties(config(),ids(0))).needsConfig,false);
  assert.equal(helper.readSummary(helper.summaryProperties(partial,ids(0))).needsConfig,true);
  assert.equal(Object.hasOwn(helper.summaryProperties(partial,ids(0)),'summaryCharge'),false);
  assert.equal(helper.readSummary(helper.summaryProperties(config(),ids(0))).needsFiles,false);

  class Element {
    constructor(tag='div') {this.tag=tag;this.children=[];this.dataset={};this.value='';this.textContent='';this.hidden=false;this.disabled=false;this.className='';this.style={};}
    append(...nodes){this.children.push(...nodes);}
    replaceChildren(...nodes){this.children=nodes;}
    setAttribute(k,v){this[k]=v;}
    addEventListener(){}
    querySelector(){return new Element();}
    focus(){}
    select(){}
    closest(){return null;}
    showModal(){this.open=true;}
    close(){this.open=false;}
  }
  const code = fs.readFileSync(path.join(__dirname,'../dist/colab-records.js'),'utf8')
    .replace(/^import .*;\n/gm,'') +
    '\nglobalThis.__test={loadRecords,setRoot:id=>{root=id},getCards:()=>cards,getJobs:()=>jobs};';

  async function scenario(n,mode) {
    const elements = new Map();
    const get = id => {if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
    const drive = new Map();
    const configs = new Map();
    for(let i=0;i<n;i++){
      const f={id:'job-'+i,name:'Record-'+i,createdTime:'2026-11-14T00:00:00Z',
        mimeType:'application/vnd.google-apps.folder',description:i===0?'備考':'',
        appProperties:{classification:i===0?'A':'',importKey:'key-'+i}};
      if(mode==='cached')Object.assign(f.appProperties,helper.summaryProperties(config(),ids(i)));
      if(mode==='partial')Object.assign(f.appProperties,helper.summaryProperties(i===0?partial:config(),ids(i)));
      drive.set(f.id,f);
      configs.set('config-'+i,i===0 && mode==='partial'?partial:config());
    }
    let requests=0, configDownloads=0, patches=0;
    const fetch = async (raw,opts={}) => {
      requests++;
      const url = new URL(raw), q=url.searchParams.get('q')||'';
      const id = decodeURIComponent(url.pathname.split('/').pop());
      let body;
      if(opts.method==='PATCH'){
        patches++;
        const record=drive.get(id);
        assert.ok(record);
        const data=JSON.parse(opts.body);
        if(data.appProperties)record.appProperties={...record.appProperties,...data.appProperties};
        body={id,appProperties:record.appProperties};
      }else if(url.searchParams.get('alt')==='media'){
        configDownloads++;
        assert.ok(configs.has(id));
        return {ok:true,status:200,text:async()=>configs.get(id)};
      }else if(url.pathname.endsWith('/files')){
        const all = q.includes("'root' in parents")
          ? [...drive.values()].map(f=>structuredClone(f))
          : q.includes("'job-")
            ? [...Array(5)].map((_,j)=> {
                const i=Number(q.match(/job-(\\d+)/)[1]);
                const [name,id]=[...ids(i)][j];
                return {name,id,mimeType:name==='計算結果'?'application/vnd.google-apps.folder':'image/png'};
              })
            : [];
        const page=Number(url.searchParams.get('pageToken')||0);
        body={files:all.slice(page,page+100),nextPageToken:page+100<all.length?String(page+100):undefined};
      }else throw Error('Unexpected request '+raw);
      return {ok:true,status:200,json:async()=>body};
    };
    const context={console,fetch,URL,URLSearchParams,Blob,TextEncoder,crypto,
      document:{getElementById:get,createElement:tag=>new Element(tag),
        createDocumentFragment:()=>new Element('fragment'),head:new Element('head')},
      window:{addEventListener(){},top:{location:{}}},location:{search:''},
      IntersectionObserver:class{observe(){}disconnect(){}unobserve(){}},
      Mol:{compareDisplayOrder:(a,b)=>a.id.localeCompare(b.id),
        compareTagNames:(a,b)=>a.localeCompare(b),editName(){},safeName:v=>v},
      readEnergy(){},standaloneDrive:false,beginDriveConnection(){},
      driveFetch:async()=>({json:async()=>({state:'connect'})}),
      ...helper,setTimeout,clearTimeout};
    vm.runInNewContext(code,context,{filename:'colab-records.js'});
    context.__test.setRoot('root');
    await context.__test.loadRecords();
    const first={requests,configDownloads,patches};
    const values=()=>[...context.__test.getCards().values()].map(job => ({
      id:job.id,meta:job.card.children[2].children.map(x=>x.textContent),
      notes:job.description,classification:job.appProperties.classification,
      images:job.card.children[1].children.map(f=>f.children[1]?.dataset.driveFile||null),
    })).sort((a,b)=>a.id.localeCompare(b.id));
    const snapshot=values();
    // A migrated summary must be useful immediately on the next load.
    requests=0;configDownloads=0;patches=0;
    await context.__test.loadRecords();
    const second={requests,configDownloads,patches};
    assert.deepEqual(values(),snapshot);
    return {first,second,snapshot};
  }
  for(const n of [50,200,1000]){
    const cached=await scenario(n,'cached');
    const old=await scenario(n,'legacy');
    const pages=Math.ceil(n/100);
    assert.equal(cached.first.requests,pages);
    assert.equal(cached.first.configDownloads,0);
    assert.equal(old.first.requests,pages+3*n); // child list + config + migration PATCH per record
    assert.equal(old.first.configDownloads,n);
    assert.equal(old.second.requests,pages);
    assert.equal(old.second.configDownloads,0);
    assert.deepEqual(old.snapshot,cached.snapshot);
    console.log('N='+n,'before:',pages+2*n,'requests, cached:',cached.first.requests,
      'legacy first load including PATCH:',old.first.requests,'second:',old.second.requests);
  }
  const standard=await scenario(50,'cached');
  const mix=await scenario(50,'partial');
  assert.equal(mix.first.configDownloads,1);
  assert.equal(mix.first.requests,2); // 1 root page + 1 config fetch, no child listing
  assert.equal(mix.second.configDownloads,1); // oversized property continues to use config
  assert.equal(mix.snapshot[0].meta[2],'⚡ '+long);
  assert.equal(standard.snapshot[1].meta[2],'⚡ -2');
  console.log('PASS Colab summary helpers, compatibility, partial fallback, N=50/200/1000 request counts');
})().catch(error=>{console.error(error);process.exitCode=1;});
