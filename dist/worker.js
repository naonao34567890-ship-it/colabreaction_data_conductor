/* Classic Worker. Also loaded by index.html for cooperative fallback. */
if(typeof importScripts==='function')importScripts('common.js');
(function(root){
'use strict';
class ImportJob{
 constructor(emit){this.emit=emit;this.cancelled=false;this.batch=[];this.batchBytes=0;this.stats={processed:0,registered:0,extra:0,skipped:0,failed:0,reasons:{},examples:[]};this.last=0;}
 reason(reason,name,failed=false){this.stats[failed?'failed':'skipped']++;this.stats.reasons[reason]=(this.stats.reasons[reason]||0)+1;if(this.stats.examples.length<30)this.stats.examples.push(name+': '+reason);}
 async flush(){if(!this.batch.length)return;const batch=this.batch;this.batch=[];this.batchBytes=0;try{const saved=await Mol.saveBatch(batch);this.stats.registered+=saved.length;this.emit({type:'saved',items:saved});Mol.notify({type:'added',items:saved});}catch(e){this.cancelled=true;this.stats.failed+=batch.length;this.stats.fatal=(e.name==='QuotaExceededError'?'保存容量を超えました':e.message);throw e;}}
 async add(block,name){const estimated=block.rawParts.reduce((n,s)=>n+s.length*2,0)+block.atoms.length*160;if(this.batchBytes+estimated>32*1024*1024)await this.flush();this.batchBytes+=estimated;this.batch.push({name,atoms:block.atoms,comment:block.comment,raw:new Blob(block.rawParts,{type:'chemical/x-xyz'}),originalLines:block.originalLines,baseLines:block.baseLines,edited:false});if(this.batch.length>=200||this.batchBytes>=32*1024*1024)await this.flush();}
 async files(files){for(const file of files){if(this.cancelled)break;try{
  if(file.size>50*1024*1024){this.reason('50 MiBの上限超過',file.name);continue;}
  let first=null,count=0,errors=0;const base=file.name.replace(/\.xyz$/i,'');
  for await(const b of Mol.parseFile(file,()=>this.cancelled)){if(b.error){errors++;this.reason(b.error,file.name);continue;}count++;if(count===1)first=b;else{if(first){await this.add(first,base+'(1)');first=null;}await this.add(b,`${base}(${count})`);}}
  if(first&&!this.cancelled)await this.add(first,base);if(!count&&!errors&&!this.cancelled)this.reason('登録可能な分子なし',file.name);this.stats.extra+=Math.max(0,count-1);
 }catch(e){if(this.stats.fatal)break;this.reason(e.message,file.name,true);}finally{this.stats.processed++;if(Date.now()-this.last>80){this.emit({type:'progress',stats:this.stats});this.last=Date.now();}await Mol.tick();}}
 }
 async finish(){try{await this.flush();}catch(_){}this.emit({type:'done',stats:this.stats,cancelled:this.cancelled});}
}
function header(size){const a=new Uint8Array(size);return{a,v:new DataView(a.buffer)};}
async function exportData(ids,format,send,cancelled,progress){
 const central=[],encoder=new TextEncoder(),names=new Set();let offset=0,done=0;
 for(const id of ids){if(cancelled())return;const body=await Mol.get('body',id);if(!body)throw Error('出力対象が削除されました。選択し直してください');const blob=await Mol.output(body);
  if(format==='zip'){
   let name=Mol.safeName(body.name)+'.xyz',n=1;while(names.has(name))name=Mol.safeName(body.name)+` (${++n}).xyz`;names.add(name);
   const filename=encoder.encode(name),bytes=new Uint8Array(await blob.arrayBuffer()),crc=Mol.crc32(bytes);if(filename.length>65535)throw Error('ZIP内のファイル名が長すぎます');
   const h=header(30+filename.length);h.v.setUint32(0,0x04034b50,true);h.v.setUint16(4,20,true);h.v.setUint16(6,0x800,true);h.v.setUint16(12,33,true);h.v.setUint32(14,crc,true);h.v.setUint32(18,bytes.length,true);h.v.setUint32(22,bytes.length,true);h.v.setUint16(26,filename.length,true);h.a.set(filename,30);
   const largeOffset=offset>=0xffffffff,c=header(46+filename.length+(largeOffset?12:0));c.v.setUint32(0,0x02014b50,true);c.v.setUint16(4,20,true);c.v.setUint16(6,largeOffset?45:20,true);c.v.setUint16(8,0x800,true);c.v.setUint16(14,33,true);c.v.setUint32(16,crc,true);c.v.setUint32(20,bytes.length,true);c.v.setUint32(24,bytes.length,true);c.v.setUint16(28,filename.length,true);c.v.setUint32(42,largeOffset?0xffffffff:offset,true);c.a.set(filename,46);if(largeOffset){c.v.setUint16(30,12,true);const x=46+filename.length;c.v.setUint16(x,1,true);c.v.setUint16(x+2,8,true);c.v.setBigUint64(x+4,BigInt(offset),true);}central.push(c.a);
   // The worker transfers ownership of each buffer, detaching it after send.
   offset+=h.a.length+bytes.length;await send(h.a);await send(bytes);
  }else{if(done)await send(encoder.encode('\n'));for(let p=0;p<blob.size;p+=262144){if(cancelled())return;await send(new Uint8Array(await blob.slice(p,p+262144).arrayBuffer()));}}
  done++;progress(done);await Mol.tick();
 }
 if(format==='zip'&&!cancelled()){
  let len=0,parts=[],partBytes=0;async function flush(){if(!partBytes)return;const out=new Uint8Array(partBytes);let p=0;for(const part of parts){out.set(part,p);p+=part.length;}await send(out);parts=[];partBytes=0;}
  for(const c of central){if(cancelled())return;parts.push(c);partBytes+=c.length;len+=c.length;if(partBytes>262144)await flush();}await flush();
  const zip64=done>=65535||offset>=0xffffffff||len>=0xffffffff;
  if(zip64){const e=header(56);e.v.setUint32(0,0x06064b50,true);e.v.setBigUint64(4,44n,true);e.v.setUint16(12,45,true);e.v.setUint16(14,45,true);e.v.setBigUint64(24,BigInt(done),true);e.v.setBigUint64(32,BigInt(done),true);e.v.setBigUint64(40,BigInt(len),true);e.v.setBigUint64(48,BigInt(offset),true);await send(e.a);const locator=header(20);locator.v.setUint32(0,0x07064b50,true);locator.v.setBigUint64(8,BigInt(offset+len),true);locator.v.setUint32(16,1,true);await send(locator.a);}
  const end=header(22);end.v.setUint32(0,0x06054b50,true);end.v.setUint16(8,Math.min(done,65535),true);end.v.setUint16(10,Math.min(done,65535),true);end.v.setUint32(12,Math.min(len,0xffffffff),true);end.v.setUint32(16,Math.min(offset,0xffffffff),true);await send(end.a);
 }
}
root.MolJobs={ImportJob,exportData};
if(typeof WorkerGlobalScope!=='undefined'&&root instanceof WorkerGlobalScope){let job=null,cancel=false,ack=null;
 root.onmessage=async({data:m})=>{if(m.type==='cancel'){cancel=true;if(job)job.cancelled=true;return;}if(m.type==='ack'){if(ack){ack();ack=null;}return;}
  try{if(m.type==='start'){job=new ImportJob(v=>postMessage(v));cancel=false;postMessage({type:'ready'});}
   else if(m.type==='files'){await job.files(m.files);postMessage({type:'ready'});}
   else if(m.type==='finish'){await job.finish();}
   else if(m.type==='export'){cancel=false;await exportData(m.ids,m.format,bytes=>new Promise(r=>{ack=r;postMessage({type:'chunk',bytes},[bytes.buffer]);}),()=>cancel,n=>postMessage({type:'exportProgress',done:n}));postMessage({type:'exportDone',cancelled:cancel});}
  }catch(e){postMessage({type:'error',message:e.message,name:e.name});}
 };
}
})(globalThis);
