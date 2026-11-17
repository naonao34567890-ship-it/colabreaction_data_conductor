'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../dist/colab-records.js'),'utf8');
function extract(from,to){const i=source.indexOf(from),j=source.indexOf(to,i+from.length);assert.ok(i>=0&&j>i);return source.slice(i,j);}
const block=extract('async function reserveReactionRun(source){','async function writeRecordSummary(');
const entries=[];let seq=0;
const list=async query=>{
 const parent=query.match(/'([^']+)' in parents/)?.[1];
 return entries.filter(x=>x.parent===parent&&!x.trashed);
};
const request=async (url,opts)=>{
 const value=JSON.parse(opts.body);
 if(opts.method==='PATCH'){
  const id=url.match(/\/files\/([^?]+)/)?.[1];
  const entry=entries.find(x=>x.id===id);assert.ok(entry,'Unknown folder');
  entry.appProperties=value.appProperties;
  return {json:async()=>({id})};
 }
 assert.equal(opts.method,'POST');
 const id='folder-'+(++seq);
 entries.push({id,parent:value.parents[0],name:value.name,appProperties:value.appProperties||{}});
 return {json:async()=>({id,name:value.name,appProperties:value.appProperties})};
};
const Mol={safeName:x=>String(x).replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').trim()||'molecule',
 nextDuplicateName:(name,used)=>{let n=1,v;do{v=name+' ('+(n++)+')';}while(used.has(v));used.add(v);return v;}};
const navigator={locks:{request:async (_key,callback)=>callback()}};
const allocate=new Function('list','request','Mol','root','folderType','drive','navigator',
 block+';return reserveReactionRun;')(list,request,Mol,'root','application/vnd.google-apps.folder','https://www.googleapis.com/drive/v3',navigator);
(async()=>{
 const id1='11111111-1111-4111-8111-111111111111',id2='22222222-2222-4222-8222-222222222222';
 const a=await allocate({sourceReactionId:'reaction-A',name:'Bromination',method:'DMF',runNumber:1,runId:id1});
 // Rename the existing folder; runNumber must not be recycled.
 entries.find(x=>x.id===a.folderId).name='optimized';
 const b=await allocate({sourceReactionId:'reaction-A',name:'Bromination',method:'DMF',runNumber:1,runId:id2});
 const c=await allocate({sourceReactionId:'reaction-B',name:'Bromination',method:'DMF',runNumber:1});
 assert.deepEqual([a.displayPath,b.displayPath,c.displayPath],['Bromination/DMF(1)','Bromination/DMF(2)','Bromination (1)/DMF(1)']);
 assert.notEqual(a.folderId,b.folderId);assert.notEqual(a.folderId,c.folderId);
 assert.equal(entries.filter(x=>x.appProperties.xyzStudio==='colabReactionGroup').length,2);
 assert.equal(entries.find(x=>x.id===b.folderId).appProperties.runNumber,'2');
 assert.equal(entries.find(x=>x.id===a.folderId).appProperties.runId,id1);
 // Removing a run must not recycle previously allocated runNumber 2.
 entries.find(x=>x.id===b.folderId).trashed=true;
 const d=await allocate({sourceReactionId:'reaction-A',name:'Renamed again',method:'DMF',runNumber:1});
 assert.equal(d.displayPath,'Bromination/DMF(3)');
 assert.equal(entries.find(x=>x.parent===entries.find(g=>g.name==='Bromination').id&&x.id===d.folderId).appProperties.runNumber,'3');
 assert.match(source,/appProperties=\{\.\.\.\(job\.appProperties\|\|\{\}\)\}/);
 assert.match(source,/properties\.runId=runId/);
 console.log('PASS: identity-driven parent, renamed run number never recycled, stored runId preserved');
})().catch(e=>{console.error(e);process.exitCode=1;});
