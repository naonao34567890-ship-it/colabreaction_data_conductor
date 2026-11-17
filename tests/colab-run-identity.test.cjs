'use strict';
const fs=require('node:fs');
const assert=require('node:assert/strict');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../dist/colab-records.js'),'utf8');
function body(from,to) {
 const start=source.indexOf(from),end=source.indexOf(to,start+from.length);
 assert.ok(start>=0&&end>start,'Missing '+from);
 return source.slice(start,end);
}
const fixture=body('async function reserveReactionRun(source){','async function writeRecordSummary(');
const folderType='application/vnd.google-apps.folder',root='root';
const entries=[];
let seq=0;
const list=async query=>{
 const parent=query.match(/'([^']+)' in parents/)?.[1];
 return entries.filter(x=>x.parent===parent);
};
const folder=async(name,parent)=>{
 const id='folder-'+(++seq);entries.push({id,name,parent,mimeType:folderType,appProperties:{}});
 return id;
};
const request=async(url,options)=>{
 const id=url.match(/\/files\/([^?]+)/)?.[1];assert.ok(id);
 const entry=entries.find(x=>x.id===id);assert.ok(entry);
 entry.appProperties=JSON.parse(options.body).appProperties;
 return {ok:true};
};
const Mol={
 safeName:x=>String(x).replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').trim()||'molecule',
 nextDuplicateName:(name,used)=>{
  let i=1,candidate;do{candidate=name+' ('+(i++)+')';}while(used.has(candidate));
  return candidate;
 }
};
const reserve=new Function('list','folder','request','Mol','root','folderType','drive','encodeURIComponent',
 fixture+';return reserveReactionRun;')(list,folder,request,Mol,root,folderType,'https://www.googleapis.com/drive/v3',encodeURIComponent);
(async()=>{
 const a=await reserve({sourceReactionId:'reaction-A',name:'V12 Br2',method:'DMF',runNumber:1});
 const b=await reserve({sourceReactionId:'reaction-A',name:'V12 Br2',method:'DMF',runNumber:1});
 const c=await reserve({sourceReactionId:'reaction-B',name:'V12 Br2',method:'DMF',runNumber:1});
 assert.deepEqual([a.displayPath,b.displayPath,c.displayPath],['V12 Br2/DMF(1)','V12 Br2/DMF(2)','V12 Br2 (1)/DMF(1)']);
 assert.notEqual(a.folderId,b.folderId);
 assert.notEqual(a.folderId,c.folderId);
 assert.equal(entries.filter(x=>x.appProperties?.xyzStudio==='colabReactionGroup').length,2);
 assert.match(source,/properties\.runId=runId/);
 assert.match(source,/sourceReaction\?\.sourceReactionId/);
 assert.match(source,/runInfo\.displayPath/);
 assert.match(source,/job\._parentName\?job\._parentName\+'\/'\+job\.name/);
 console.log('PASS Colab run identity is independent of display folder and uses numbered hierarchical paths');
})().catch(error=>{console.error(error);process.exitCode=1;});
