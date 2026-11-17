'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../dist/colab-records.js'),'utf8');
function extract(from,to){const i=source.indexOf(from),j=source.indexOf(to,i+from.length);assert.ok(i>=0&&j>i);return source.slice(i,j);}
const code=extract('async function reserveReactionRun(source){','async function writeRecordSummary(');
const entries=[],ledger=new Map(),aliases=new Map(),counts=new Map();let seq=0,generated=0;
const list=async query=>{
 const parent=query.match(/'([^']+)' in parents/)?.[1],run=query.match(/key='runId' and value='([^']+)'/)?.[1];
 const name=query.match(/name = '([^']+)'/)?.[1];
 return entries.filter(x=>(!parent||x.parent===parent)&&(!run||x.appProperties.runId===run)&&(!name||x.name===name)&&!x.trashed);
};
const request=async (url,opts)=>{
 const value=JSON.parse(opts.body);
 if(opts.method==='PATCH'){
  const id=url.match(/\/files\/([^?]+)/)?.[1],entry=entries.find(x=>x.id===id);
  assert.ok(entry,'Unknown folder');entry.appProperties=value.appProperties;
  return {json:async()=>({id})};
 }
 assert.equal(opts.method,'POST');
 const id='folder-'+(++seq);
 entries.push({id,parent:value.parents[0],name:value.name,appProperties:value.appProperties||{}});
 return {json:async()=>({id,name:value.name,appProperties:value.appProperties})};
};
const driveFetch=async (endpoint,opts)=>{
 assert.equal(endpoint,'runs');
 const value=JSON.parse(opts.body);assert.equal(value.action,'reserveRun');
 let run=ledger.get(value.runId);
 if(!run){
  let name=aliases.get(value.reactionId);
  if(!name){
   const used=new Set([...aliases.values()]);name=value.reactionName;let n=1;
   while(used.has(name))name=value.reactionName+' ('+(n++)+')';
   aliases.set(value.reactionId,name);
  }
  const key=value.reactionId+'/'+value.method;
  const runNumber=Math.max((counts.get(key)||0)+1,value.minimumRunNumber||1);
  counts.set(key,runNumber);
  run={runId:value.runId,reactionId:value.reactionId,method:value.method,
    runNumber,reactionName:name,displayPath:name+'/'+value.method+'('+runNumber+')'};
  ledger.set(value.runId,run);
 }
 return {ok:true,json:async()=>({state:'reserved',run})};
};
const Mol={safeName:x=>String(x).replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').trim()||'molecule',
 nextDuplicateName:(name,used)=>{let n=1,v;do{v=name+' ('+(n++)+')';}while(used.has(v));used.add(v);return v;}};
const crypto={randomUUID:()=> '99999999-9999-4999-8999-'+String(++generated).padStart(12,'0')};
const globalThis={navigator:{locks:{request:async(_key,callback)=>callback()}}};
const allocate=new Function('list','request','driveFetch','Mol','root','folderType','drive','crypto','globalThis','navigator',
 code+';return reserveReactionRun;')(list,request,driveFetch,Mol,'root','application/vnd.google-apps.folder',
 'https://www.googleapis.com/drive/v3',crypto,globalThis,globalThis.navigator);
(async()=>{
 const id1='11111111-1111-4111-8111-111111111111',id2='22222222-2222-4222-8222-222222222222';
 const a=await allocate({sourceReactionId:'reaction-A',name:'Bromination',method:'DMF',runId:id1});
 entries.find(x=>x.id===a.folderId).name='renamed folder';
 const b=await allocate({sourceReactionId:'reaction-A',name:'Bromination changed',method:'DMF',runId:id2});
 const c=await allocate({sourceReactionId:'reaction-B',name:'Bromination',method:'DMF',runId:'33333333-3333-4333-8333-333333333333'});
 assert.deepEqual([a.displayPath,b.displayPath,c.displayPath],[
  'Bromination/DMF(1)','Bromination/DMF(2)','Bromination (1)/DMF(1)']);
 assert.notEqual(a.folderId,b.folderId);
 assert.equal(entries.filter(x=>x.appProperties.xyzStudio==='colabReactionGroup').length,2);
 entries.find(x=>x.id===b.folderId).trashed=true;
 const d=await allocate({sourceReactionId:'reaction-A',name:'Bromination',method:'DMF',runId:'44444444-4444-4444-8444-444444444444'});
 assert.equal(d.runNumber,3);
 assert.equal(entries.find(x=>x.id===d.folderId).appProperties.runId,'44444444-4444-4444-8444-444444444444');
 assert.equal(entries.find(x=>x.id===a.folderId).appProperties.runId,id1);
 assert.match(source,/driveFetch\('runs'/);
 assert.match(source,/sourceReaction\.sourceReactionId!==batchJob\.reaction_id/);
 console.log('PASS shared run ledger, label identity, rename, deletion and run ID preservation');
})().catch(error=>{console.error(error);process.exitCode=1;});
