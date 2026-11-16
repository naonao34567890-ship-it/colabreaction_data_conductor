// One-time, opt-in migration from the Drive-authoritative library to independent
// browser-local IndexedDB databases. Never deletes or modifies Drive data.
// Do not enable local mode until both complete datasets are verified.
import {fastSyncFingerprint,saveFastSyncMigrationBaseline} from './fast-local-sync.js';
const PREFIX='mol-bench-fast-local-v1';
export const localMoleculeDB=sub=>PREFIX+'-molecules-'+sub;
export const localReactionDB=sub=>PREFIX+'-reactions-'+sub;
export const fastModeKey='mol-bench-fast-local-v1';

function openDB(name,version,upgrade){
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(name,version);
    request.onupgradeneeded=()=>upgrade(request.result,request.transaction);
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
    request.onblocked=()=>reject(Error('同じサイトの古いタブを閉じて再試行してください。'));
  });
}
function txComplete(tx){
  return new Promise((resolve,reject)=>{
    tx.oncomplete=resolve;
    tx.onabort=()=>reject(tx.error||Error('IndexedDBの保存に失敗しました。'));
    tx.onerror=()=>{};
  });
}
async function initializeMolecules(){
  const db=await openDB(localMoleculeDB(activeSub),2,(db,tx)=>{
    if(!db.objectStoreNames.contains('meta')){
      const meta=db.createObjectStore('meta',{keyPath:'id'});
      meta.createIndex('name','name',{unique:true});
      meta.createIndex('tags','tags',{multiEntry:true});
    }else{
      const meta=tx.objectStore('meta');
      if(!meta.indexNames.contains('name'))meta.createIndex('name','name',{unique:true});
      if(!meta.indexNames.contains('tags'))meta.createIndex('tags','tags',{multiEntry:true});
    }
    for(const name of ['body','thumb','tags'])
      if(!db.objectStoreNames.contains(name))db.createObjectStore(name,{keyPath:name==='tags'?'name':'id'});
  });
  const tx=db.transaction(['meta','body','thumb','tags'],'readwrite');
  for(const name of ['meta','body','thumb','tags'])tx.objectStore(name).clear();
  await txComplete(tx);
  return db;
}
let activeSub='';
async function initializeReactions(){
  const db=await openDB(localReactionDB(activeSub),1,db=>{
    if(!db.objectStoreNames.contains('reactions'))db.createObjectStore('reactions',{keyPath:'id'});
  });
  const tx=db.transaction('reactions','readwrite');
  tx.objectStore('reactions').clear();
  await txComplete(tx);
  return db;
}
async function count(db,store){
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(store,'readonly'),r=tx.objectStore(store).count();
    r.onsuccess=()=>resolve(r.result);
    r.onerror=()=>reject(r.error);
  });
}
export async function migrateToFastLocal(service,progress=()=>{}){
  await service.ready;
  const account=service.account;
  if(!account?.sub)throw Error('Drive接続のアカウントを確認できません。');
  if(localStorage.getItem(fastModeKey))
    throw Error('高速ローカルモードは既に有効です。');
  activeSub=account.sub;
  progress('Google Driveから分子・反応を読み込みます。最初の一度だけ時間がかかります。');
  await service.refresh();
  const startVersions=new Map((await service.syncIndex()).records.map(row=>[row.key,row.version]));
  const fingerprints={};
  const metas=(await service.metadata()).filter(m=>!String(m.id).startsWith('builtin-'));
  const reactions=await service.reactionRead();
  const molDB=await initializeMolecules(),reactionDB=await initializeReactions();
  let saved=0;
  try{
    for(let offset=0;offset<metas.length;offset+=30){
      const batch=metas.slice(offset,offset+30);
      const contents=[];
      // Fetch before opening a write transaction (network awaits terminate IndexedDB transactions).
      for(const meta of batch){
        const body=await service.get('body',meta.id);
        if(!body?.atoms||body.id!==meta.id)
          throw Error('Driveの分子データが不足しています: '+meta.name);
        contents.push({meta,body});
        fingerprints['m:'+meta.id]=await fastSyncFingerprint({kind:'m',meta,body});
      }
      const tx=molDB.transaction(['meta','body','tags'],'readwrite');
      for(const {meta,body}of contents){
        tx.objectStore('meta').put(meta);
        tx.objectStore('body').put(body);
        for(const name of meta.tags||[])tx.objectStore('tags').put({name});
      }
      await txComplete(tx);
      saved+=contents.length;
      progress('分子をローカルへ移行 '+saved.toLocaleString()+' / '+metas.length.toLocaleString());
    }
    let copied=0;
    for(let i=0;i<reactions.length;i+=30){
      const batch=reactions.slice(i,i+30);
      for(const reaction of batch)
        fingerprints['r:'+reaction.id]=await fastSyncFingerprint({kind:'r',body:reaction});
      const tx=reactionDB.transaction('reactions','readwrite');
      for(const reaction of batch)tx.objectStore('reactions').put(reaction);
      await txComplete(tx);
      copied=Math.min(i+30,reactions.length);
      progress('反応をローカルへ移行 '+copied.toLocaleString()+' / '+reactions.length.toLocaleString());
    }
    const [mCount,rCount]=await Promise.all([count(molDB,'meta'),count(reactionDB,'reactions')]);
    if(mCount!==metas.length||rCount!==reactions.length)
      throw Error('移行件数が一致しません。モードの切替を中止しました。');
    // Detect edits to catalogue metadata during the migration; do not silently adopt stale data.
    await service.refresh();
    const latest=(await service.metadata()).filter(m=>!String(m.id).startsWith('builtin-'));
    const key=m=>JSON.stringify([m.id,m.name,m.revision,m.charge,m.multiplicity,m.tags]);
    if(latest.length!==metas.length||latest.some((m,i)=>key(m)!==key(metas[i])))
      throw Error('移行中にDrive上の分子が変更されました。切替せず再実行してください。');
    await saveFastSyncMigrationBaseline(service,account.sub,fingerprints,startVersions);
    if(navigator.storage?.persist)await navigator.storage.persist().catch(()=>false);
    // This flag is committed ONLY after complete local data validation.
    localStorage.setItem(fastModeKey,JSON.stringify({sub:account.sub,email:account.email,migratedAt:new Date().toISOString()}));
    progress('移行完了。高速ローカルモードに切り替えます。');
    return {molecules:mCount,reactions:rCount};
  }finally{
    molDB.close();
    reactionDB.close();
  }
}
