// One-time, opt-in migration from the Drive-authoritative library to independent
// browser-local IndexedDB databases. Never deletes or modifies Drive data.
// Enable local mode only after validating the staged data and reporting missing records.
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
async function initializeMolecules(sub){
  const db=await openDB(localMoleculeDB(sub),2,(db,tx)=>{
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
async function initializeReactions(sub){
  const db=await openDB(localReactionDB(sub),1,db=>{
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
// Evaluate coverage for each library so a large molecule library cannot mask
// a mostly unavailable reaction library.
const MIN_COVERAGE=0.9;

export async function migrateToFastLocal(service,progress=()=>{},acceptPartial=()=>false){
  const migrate=()=>stageMigration(service,progress,acceptPartial);
  return navigator.locks
    ?navigator.locks.request(fastModeKey,migrate)
    :migrate();
}

async function stageMigration(service,progress,acceptPartial){
  await service.ready;
  const account=service.account;
  if(!account?.sub)throw Error('Drive接続のアカウントを確認できません。');
  if(localStorage.getItem(fastModeKey))throw Error('高速ローカルモードは既に有効です。');
  progress('Google Driveから分子・反応を読み込みます。最初の一度だけ時間がかかります。');
  await service.refresh();
  const firstIndex=await service.syncIndex();
  const startVersions=new Map(firstIndex.records.map(row=>[row.key,row.version]));
  const fingerprints={};
  const missing=new Map();
  const datasets=[
    {kind:'m',label:'分子',rows:firstIndex.records.filter(row=>row.key.startsWith('m:')),saved:0},
    {kind:'r',label:'反応',rows:firstIndex.records.filter(row=>row.key.startsWith('r:')),saved:0},
  ];
  let molDB,reactionDB;
  try{
    molDB=await initializeMolecules(account.sub);
    reactionDB=await initializeReactions(account.sub);
    for(const dataset of datasets){
      const {kind,label,rows}=dataset;
      const db=kind==='m'?molDB:reactionDB;
      const stores=kind==='m'?['meta','body']:['reactions'];
      for(let offset=0;offset<rows.length;offset+=30){
        const batch=rows.slice(offset,offset+30),contents=[];
        for(const row of batch){
          const id=row.key.slice(2);
          let body;
          try{
            body=kind==='m'?await service.get('body',id):await service.syncRead(kind,id);
          }catch(error){
            if(error.status!==404)throw error;
            missing.set(row.key,row.meta?.name||id);
            continue;
          }
          if(body?.id!==id||(kind==='m'&&!Array.isArray(body.atoms)))
            throw Error(label+'データが不完全です。 '+(row.meta?.name||id));
          contents.push({meta:row.meta,body});
          fingerprints[row.key]=await fastSyncFingerprint({kind,meta:row.meta,body});
        }
        const tx=db.transaction(stores,'readwrite'),done=txComplete(tx);
        for(const {meta,body} of contents){
          if(kind==='m'){
            tx.objectStore('meta').put(meta);
            tx.objectStore('body').put(body);
          }else tx.objectStore('reactions').put(body);
        }
        await done;
        dataset.saved+=contents.length;
        progress(label+'を確認 '+(offset+batch.length).toLocaleString()+' / '+rows.length.toLocaleString()+
          '（取得 '+dataset.saved.toLocaleString()+'件）');
      }
    }
    const tagsTx=molDB.transaction('tags','readwrite'),tagsDone=txComplete(tagsTx);
    for(const tag of firstIndex.tags||[])tagsTx.objectStore('tags').put(tag);
    await tagsDone;
    const [mCount,bodyCount,rCount]=await Promise.all([
      count(molDB,'meta'),count(molDB,'body'),count(reactionDB,'reactions'),
    ]);
    if(mCount!==datasets[0].saved||bodyCount!==mCount||rCount!==datasets[1].saved)
      throw Error('移行件数が一致しません。モードの切替を中止しました。');
    if(missing.size){
      const totals=datasets.map(({label,saved,rows})=>label+' '+saved+' / '+rows.length+'件取得').join('\n');
      const names=[...missing].slice(0,20).map(([key,name])=>(key.startsWith('m:')?'分子':'反応')+' '+name);
      if(missing.size>names.length)names.push('ほか '+(missing.size-names.length)+'件');
      const report=totals+'\n\nDriveで取得できなかった項目（404）\n'+names.join('\n');
      if(datasets.some(({rows,saved})=>saved<rows.length*MIN_COVERAGE))
        throw Error('取得率が90%未満のライブラリがあります。\n'+report);
      if(!await acceptPartial(report))return null;
    }
    await saveFastSyncMigrationBaseline(service,account.sub,fingerprints,startVersions,firstIndex.tagsVersion,
      missing,firstIndex.generation);
    if(navigator.storage?.persist)await navigator.storage.persist().catch(()=>false);
    localStorage.setItem(fastModeKey,JSON.stringify({sub:account.sub,email:account.email,migratedAt:new Date().toISOString()}));
    progress('移行完了。高速ローカルモードに切り替えます。');
    return {molecules:mCount,reactions:rCount,missing:missing.size};
  }finally{
    molDB?.close();
    reactionDB?.close();
  }
}
