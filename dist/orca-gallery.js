// ORCA gallery: local-first, independent from the molecular/reaction libraries.
// TS classification is based on the result name suffix "_ts" (before extension), NOT frequencies.
import {unzipSync} from './vendor/fflate.mjs';
const $=id=>document.getElementById(id);
const dbName='mol-bench-orca-gallery-v1';
const MAX=512*1024*1024;
const supported=/\.(?:out|log|xyz|png|jpe?g|json|inp|engrad|hess|gbw|trj)$/i;
const suffix=/\.(?:out|log|xyz|zip|json|inp|png|jpe?g|engrad|hess|gbw|trj)$/i;
const baseName=name=>String(name).split(/[\\/]/).pop().replace(suffix,'');
export const kindFromResultName=name=>/_ts$/i.test(baseName(name))?'ts':'ground';
const textExt=/\.(?:out|log|xyz|json|inp|engrad|trj)$/i;
const statusText={success:'正常終了',failed:'終了異常',unknown:'未確認'};
function openDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open(dbName,1);
 req.onupgradeneeded=()=>{const db=req.result;db.createObjectStore('records',{keyPath:'id'});db.createObjectStore('files',{keyPath:'id'});};
 req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
});}
const done=tx=>new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error||Error('保存に失敗しました'));});
async function records(){const db=await openDB();return new Promise((resolve,reject)=>{const tx=db.transaction('records');const q=tx.objectStore('records').getAll();q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});}
async function getFile(id){const db=await openDB();return new Promise((resolve,reject)=>{const q=db.transaction('files').objectStore('files').get(id);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});}
async function save(rec,files){const db=await openDB(),tx=db.transaction(['records','files'],'readwrite');const wait=done(tx);
 tx.objectStore('records').put(rec);
 for(const file of files)tx.objectStore('files').put({id:rec.id+':'+file.path,path:file.path,blob:file.blob});
 await wait;}
async function remove(id){const db=await openDB(),tx=db.transaction(['records','files'],'readwrite');const wait=done(tx);
 tx.objectStore('records').delete(id);
 const s=tx.objectStore('files'),keys=s.getAllKeys();keys.onsuccess=()=>{for(const key of keys.result)if(key.startsWith(id+':'))s.delete(key);};
 await wait;}
function parseLog(log){
 const energy=[...log.matchAll(/FINAL SINGLE POINT ENERGY\s+(-?\d+(?:\.\d+)?(?:[Ee][+\-]?\d+)?)/g)];
 const charge=[...log.matchAll(/Total Charge\s*[:.]?\s*(-?\d+)\b/gi)];
 const mult=[...log.matchAll(/Multiplicity\s*[:.]?\s*(\d+)\b/gi)];
 const success=/ORCA TERMINATED NORMALLY/i.test(log);
 const failed=/ORCA finished by error termination|ORCA TERMINATED ABNORMALLY|ERROR TERMINATION/i.test(log);
 return {energy:energy.length?Number(energy.at(-1)[1]):null,charge:charge.length?Number(charge.at(-1)[1]):null,
 multiplicity:mult.length?Number(mult.at(-1)[1]):null,status:success?'success':failed?'failed':'unknown'};
}
const decode=bytes=>new TextDecoder('utf-8').decode(bytes);
async function parseZip(file){
 const names=new Set();let size=0,count=0;
 const unpack=unzipSync(new Uint8Array(await file.arrayBuffer()),{filter:item=>{
  if(item.name.startsWith('/')||item.name.includes('\\')||item.name.split('/').some(p=>p==='..')||names.has(item.name))throw Error('ZIPのファイル名が不正です');
  names.add(item.name);size+=item.originalSize;if(++count>15000||size>MAX)throw Error('ZIPの展開容量が上限を超えています');return !item.name.endsWith('/');
 }});
 return Object.entries(unpack).filter(([path])=>supported.test(path)).map(([path,bytes])=>({path,blob:new Blob([bytes])}));
}
async function readInputs(files){
 const batches=[];
 for(const file of files){
  if(file.size>MAX)throw Error('ファイルが512 MiBを超えています: '+file.name);
  if(/\.zip$/i.test(file.name)){
   const entries=await parseZip(file);
   if(!entries.length)continue;
   // One ORCA job per archive; the archive's filename is its canonical result name.
   batches.push({name:baseName(file.name),files:entries});
  }else if(supported.test(file.name)){
   const path=file.webkitRelativePath||file.name;
   const group=path.includes('/')?path.split('/').slice(0,-1).join('/'):baseName(file.name).replace(/(?:_final|_opt|_freq)$/i,'');
   let batch=batches.find(item=>item.key===group);
   if(!batch){batch={name:path.includes('/')?path.split('/').at(-2):group,key:group,files:[]};batches.push(batch);}
   batch.files.push({path,blob:file});
  }
 }
 return batches;
}
async function importFiles(files){
 const batches=await readInputs(files);$('progress').hidden=false;$('progress').max=batches.length;$('progress').value=0;
 let saved=0;
 for(const batch of batches){
  const logFile=batch.files.find(f=>/\.out$/i.test(f.path))||batch.files.find(f=>/\.log$/i.test(f.path));
  const log=logFile?await logFile.blob.text():'';
  const summary=parseLog(log);
  const name=batch.name||'ORCA job';
  const id=crypto.randomUUID();
  const rec={id,name,kind:kindFromResultName(name),createdAt:Date.now(),...summary,
   files:batch.files.map(f=>({path:f.path,size:f.blob.size})),logExcerpt:log?log.slice(0,3000)+(log.length>6000?'\n…\n':'')+log.slice(-3000):''};
  await save(rec,batch.files);saved++;$('progress').value=saved;$('status').textContent='登録中 '+saved+' / '+batches.length;
 }
 $('progress').hidden=true;$('status').textContent=saved+'件のORCA計算結果を保存しました。';
 await refresh();
}
let all=[],shown=[];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function sort(items){
 const mode=$('order').value;
 items.sort((a,b)=>mode==='oldest'?a.createdAt-b.createdAt:mode==='name'?a.name.localeCompare(b.name,'ja'):
 mode==='energy'?(a.energy??Infinity)-(b.energy??Infinity):mode==='status'?a.status.localeCompare(b.status):b.createdAt-a.createdAt);
 return items;
}
function card(rec){const el=document.createElement('article');el.className='card';
 const badge=rec.kind==='ts'?'遷移状態（TS）':'基底状態';
 el.innerHTML='<h2>'+esc(rec.name)+'</h2><span class="status-chip '+(rec.status==='success'?'ok':rec.status==='failed'?'fail':'')+'">'+esc(statusText[rec.status]||statusText.unknown)+'</span><div class="meta"><span>'+badge+'</span><span>最終エネルギー '+(Number.isFinite(rec.energy)?rec.energy.toFixed(9)+' Eh':'不明')+'</span><span>電荷 '+(rec.charge??'不明')+' / 多重度 '+(rec.multiplicity??'不明')+'</span><span>'+new Date(rec.createdAt).toLocaleString('ja-JP')+'</span><span>'+rec.files.length+' ファイル</span></div><div class="card-actions"><button class="view">詳細</button><button class="remove">削除</button></div>';
 el.querySelector('.view').onclick=()=>detail(rec);
 el.querySelector('.remove').onclick=async()=>{if(!confirm('このORCA記録をローカルから削除しますか？ '+rec.name))return;await remove(rec.id);await refresh();};
 return el;
}
async function refresh(){all=await records();const q=$('search').value.toLocaleLowerCase();
 shown=sort(all.filter(rec=>!q||[rec.name,rec.kind,rec.status].some(x=>String(x||'').toLocaleLowerCase().includes(q))));
 const cards=$('cards');cards.replaceChildren();
 for(const kind of ['ground','ts']){
  const section=document.createElement('section');section.className='gallery-section';section.style.gridColumn='1 / -1';
  const count=shown.filter(x=>x.kind===kind).length;
  const heading=document.createElement('h2');heading.textContent=(kind==='ground'?'基底状態':'遷移状態（TS）')+' — '+count+'件';section.append(heading);cards.append(section);
  for(const rec of shown.filter(x=>x.kind===kind))cards.append(card(rec));
 }
 $('count').textContent=shown.length+' / '+all.length+'件';
}
let urls=[];
async function detail(rec){for(const u of urls)URL.revokeObjectURL(u);urls=[];
 $('detailTitle').textContent=rec.name;
 $('detailMeta').textContent=(rec.kind==='ts'?'遷移状態（TS）':'基底状態')+' ／ '+statusText[rec.status]+' ／ E='+(rec.energy??'不明')+' Eh';
 $('detailLog').textContent=rec.logExcerpt||'ログファイルなし';
 const buttons=$('detailFiles'),images=$('detailImages');buttons.replaceChildren();images.replaceChildren();
 for(const f of rec.files){
  const button=document.createElement('button');button.textContent=f.path.split('/').pop();button.onclick=async()=>{
   const item=await getFile(rec.id+':'+f.path);if(!item)return;const url=URL.createObjectURL(item.blob);const a=document.createElement('a');a.href=url;a.download=f.path.split('/').pop();a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
  };buttons.append(button);
  if(/\.(?:png|jpe?g)$/i.test(f.path)){
   const item=await getFile(rec.id+':'+f.path);if(!item)continue;
   const url=URL.createObjectURL(item.blob);urls.push(url);
   const fig=document.createElement('figure'),img=document.createElement('img'),cap=document.createElement('figcaption');
   img.src=url;img.alt=f.path;img.loading='lazy';cap.textContent=f.path;fig.append(img,cap);images.append(fig);
  }
 }
 $('detail').showModal();
}
$('closeDetail').onclick=()=>{$('detail').close();for(const u of urls)URL.revokeObjectURL(u);urls=[];};
$('choose').onclick=e=>{e.stopPropagation();$('upload').click();};
$('chooseFolder').onclick=e=>{e.stopPropagation();$('folder').click();};
$('drop').onclick=e=>{if(e.target.closest('button'))return;$('upload').click();};
$('drop').onkeydown=e=>{if(e.target===$('drop')&&(e.key==='Enter'||e.key===' ')){e.preventDefault();$('upload').click();}};
for(const el of [$('upload'),$('folder')])el.onchange=async e=>{try{await importFiles([...e.target.files]);}catch(err){$('status').textContent=err.message;}finally{e.target.value='';$('progress').hidden=true;}};
$('drop').ondragover=e=>{e.preventDefault();$('drop').classList.add('drag');};
$('drop').ondragleave=e=>{e.preventDefault();$('drop').classList.remove('drag');};
$('drop').ondrop=async e=>{e.preventDefault();$('drop').classList.remove('drag');try{await importFiles([...e.dataTransfer.files]);}catch(err){$('status').textContent=err.message;}finally{$('progress').hidden=true;}};
$('order').onchange=refresh;$('search').oninput=refresh;
$('exportIndex').onclick=()=>{const blob=new Blob([JSON.stringify({format:'mol-bench-orca-gallery-index',version:1,records:all},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='orca-gallery-index.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);};
refresh().catch(e=>$('status').textContent=e.message);
