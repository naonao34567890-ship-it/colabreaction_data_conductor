// Automatic, conflict-aware reconciliation between fast-local IndexedDB and
// the existing canonical Drive catalogue. No ambiguous overwrite or deletion.
// Changes are saved locally first. Never assume a Drive write succeeded.
import {createDriveStore,encodeSyncValue} from './drive-store.js';

const PREFIX='mol-bench-fast-local-v1';
const STATE_DB='mol-bench-fast-sync-state-v1';
const IDLE_MS=5*60*1000;
const $=id=>document.getElementById(id);
const waitTx=tx=>new Promise((resolve,reject)=>{
  tx.oncomplete=resolve;
  tx.onabort=()=>reject(tx.error||Error('IndexedDB transaction aborted'));
  tx.onerror=()=>{};
});
function openDB(name,version,upgrade){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(name,version);
    req.onupgradeneeded=()=>upgrade(req.result,req.transaction);
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
    req.onblocked=()=>reject(Error('古いタブを閉じてください。'));
  });
}
function moleculeDB(sub){
  return openDB(PREFIX+'-molecules-'+sub,2,(db,tx)=>{
    if(!db.objectStoreNames.contains('meta')){
      const store=db.createObjectStore('meta',{keyPath:'id'});
      store.createIndex('name','name',{unique:true});
      store.createIndex('tags','tags',{multiEntry:true});
    }else{
      const meta=tx.objectStore('meta');
      if(!meta.indexNames.contains('name'))meta.createIndex('name','name',{unique:true});
      if(!meta.indexNames.contains('tags'))meta.createIndex('tags','tags',{multiEntry:true});
    }
    for(const name of ['body','thumb','tags'])
      if(!db.objectStoreNames.contains(name))db.createObjectStore(name,{keyPath:name==='tags'?'name':'id'});
  });
}
function reactionDB(sub){return openDB(PREFIX+'-reactions-'+sub,1,db=>{
  if(!db.objectStoreNames.contains('reactions'))db.createObjectStore('reactions',{keyPath:'id'});
});}
async function all(db,store){
  return new Promise((resolve,reject)=>{
    const req=db.transaction(store,'readonly').objectStore(store).getAll();
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  });
}
async function localSnapshot(sub){
  const mdb=await moleculeDB(sub),rdb=await reactionDB(sub);
  try{
    const [metas,bodies,reactions]=await Promise.all([
      all(mdb,'meta'),all(mdb,'body'),all(rdb,'reactions'),
    ]);
    const bodyMap=new Map(bodies.map(b=>[b.id,b]));
    const result=new Map();
    for(const meta of metas){
      if(meta.id.startsWith('builtin-'))continue;
      const body=bodyMap.get(meta.id);
      if(!body)throw Error('ローカル分子の本体がありません: '+meta.id);
      result.set('m:'+meta.id,{kind:'m',id:meta.id,meta,body});
    }
    for(const body of reactions)result.set('r:'+body.id,{kind:'r',id:body.id,meta:{
      id:body.id,name:body.name,createdAt:body.createdAt,
      tags:body.tags||[],classification:body.classification||null,
    },body});
    return result;
  }finally{mdb.close();rdb.close();}
}
function normalizedMeta(meta){
  const {thumb,mass,bytes,batchPosition,_summary,_driveFileId,...rest}=meta;
  return rest;
}
async function fingerprint(item){
  if(!item)return null;
  const obj=item.kind==='m'
    ? {meta:normalizedMeta(item.meta),body:item.body}
    : item.body;
  const encoded=JSON.stringify(await encodeSyncValue(obj));
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(encoded));
  return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function readBaseline(sub){
  const db=await openDB(STATE_DB,1,db=>db.createObjectStore('state',{keyPath:'sub'}));
  try{return await new Promise((resolve,reject)=>{
    const req=db.transaction('state').objectStore('state').get(sub);
    req.onsuccess=()=>resolve(req.result||{sub,entries:{},generation:null,dirtyToken:null});
    req.onerror=()=>reject(req.error);
  });}finally{db.close();}
}
async function writeBaseline(sub,entries,generation=null,dirtyToken=null){
  const db=await openDB(STATE_DB,1,db=>db.createObjectStore('state',{keyPath:'sub'}));
  try{
    const tx=db.transaction('state','readwrite'),done=waitTx(tx);
    tx.objectStore('state').put({sub,entries,generation,dirtyToken,updatedAt:Date.now()});
    await done;
  }finally{db.close();}
}
// Shadow cache for DriveStore. Never switches Mol's live fast-local database.
export const fastSyncFingerprint=fingerprint;
export async function saveFastSyncMigrationBaseline(service,sub,hashes,startVersions){
  const index=await service.syncIndex();
  const versions=new Map(index.records.map(row=>[row.key,row.version]));
  const baseline={};
  for(const [key,hash] of Object.entries(hashes)){
    if(!versions.has(key)||versions.get(key)!==startVersions.get(key))
      throw Error('移行中にDriveの分子・反応データが変更されました。移行を中止します。');
    baseline[key]={version:versions.get(key),hash};
  }
  await writeBaseline(sub,baseline,index.generation,localStorage.getItem('mol-bench-fast-sync-dirty-'+sub));
}
function shadowBackend(){
  let name='mol-bench-sync-shadow-uninitialized',pending;
  const open=()=>pending??=(openDB(name,2,(db,tx)=>{
    if(!db.objectStoreNames.contains('meta')){
      const meta=db.createObjectStore('meta',{keyPath:'id'});
      meta.createIndex('name','name',{unique:true});
      meta.createIndex('tags','tags',{multiEntry:true});
    }else{
      const meta=tx.objectStore('meta');
      if(!meta.indexNames.contains('name'))meta.createIndex('name','name',{unique:true});
      if(!meta.indexNames.contains('tags'))meta.createIndex('tags','tags',{multiEntry:true});
    }
    for(const key of ['body','thumb','tags'])
      if(!db.objectStoreNames.contains(key))db.createObjectStore(key,{keyPath:key==='tags'?'name':'id'});
  }));
  return {
    setDatabaseName(next){if(name===next)return;pending?.then(db=>db.close());pending=null;name=next;},
    db:open,
    async metadata(){return all(await open(),'meta');},
    async get(store,id){return new Promise(async (resolve,reject)=>{
      try{const db=await open(),req=db.transaction(store).objectStore(store).get(id);
        req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
      }catch(error){reject(error);}
    });},
  };
}
async function applyLocalChanges(sub,changes,original){
  if(!changes.length)return;
  const mol=changes.filter(c=>c.kind==='m'),react=changes.filter(c=>c.kind==='r');
  if(mol.length){
    const db=await moleculeDB(sub);
    try{
      const tx=db.transaction(['meta','body','thumb','tags'],'readwrite'),done=waitTx(tx);
      const metas=tx.objectStore('meta'),bodies=tx.objectStore('body');
      for(const change of mol){
        const expected=original.get('m:'+change.id);
        const req=metas.get(change.id);
        req.onsuccess=()=>{
          // Avoid replacing edits made after snapshot collection.
          if(JSON.stringify(req.result||null)!==JSON.stringify(expected?.meta||null)){
            tx.abort();return;
          }
          if(change.action==='delete'){
            metas.delete(change.id);bodies.delete(change.id);
          }else{
            metas.put(change.meta);bodies.put(change.body);
            for(const tag of change.meta.tags||[])tx.objectStore('tags').put({name:tag});
          }
          tx.objectStore('thumb').delete(change.id);
        };
      }
      await done;
    }finally{db.close();}
  }
  if(react.length){
    const db=await reactionDB(sub);
    try{
      const tx=db.transaction('reactions','readwrite'),done=waitTx(tx),store=tx.objectStore('reactions');
      for(const change of react){
        const previous=original.get('r:'+change.id);
        const req=store.get(change.id);
        req.onsuccess=()=>{
          if(JSON.stringify(req.result||null)!==JSON.stringify(previous?.body||null)){
            tx.abort();return;
          }
          if(change.action==='delete')store.delete(change.id);
          else store.put(change.body);
        };
      }
      await done;
    }finally{db.close();}
  }
}
function showConflictDialog(count,destructive){
  return new Promise(resolve=>{
    const dialog=$('fastSyncConflict');
    if(!dialog){resolve(false);return;}
    $('fastSyncConflictText').textContent=count+'件の競合'+
      (destructive?'・削除を含む変更':'')+
      'があります。競合のあるデータは一切上書きしません。競合以外の安全な変更のみ同期しますか？';
    const cancel=$('fastSyncCancel'),continueButton=$('fastSyncContinue');
    const cleanup=()=>{
      cancel.onclick=null;continueButton.onclick=null;
      dialog.oncancel=null;dialog.close();
    };
    cancel.onclick=()=>{cleanup();resolve(false);};
    continueButton.onclick=()=>{cleanup();resolve(true);};
    dialog.oncancel=event=>{event.preventDefault();cleanup();resolve(false);};
    dialog.showModal();
  });
}
export function startFastLocalSync(scope){
  if(!scope?.sub)return;
  const sub=scope.sub;
  let service,running=false,lastStatus='',timer;
  const conflictKey='mol-bench-fast-sync-dismissed-'+sub;
  const dirtyKey='mol-bench-fast-sync-dirty-'+sub;
  let lastConflict=localStorage.getItem(conflictKey)||'';
  const status=(message)=>{
    lastStatus=message;
    const label=$('fastSyncStatus');if(label)label.textContent=message;
    const action=$('fastSyncNow');if(action)action.title=message;
  };
  const serviceReady=async()=>{
    if(!service)service=createDriveStore(shadowBackend(),{
      skipLegacyMigration:true,backgroundRefreshDisabled:true,
    });
    await service.ready;
    if(service.account?.sub!==sub)throw Error('Driveのログインアカウントとローカル保存アカウントが違います。同期を停止しました。');
    return service;
  };
  const check=async(manual=false)=>{
    if(running||document.hidden)return;
    const locks=navigator.locks;
    const perform=async()=>{
      running=true;
      const button=$('fastSyncNow');if(button)button.disabled=true;
      try{
        const drive=await serviceReady();
        status('同期差分を確認中…');
        const [remote,savedState]=await Promise.all([
          drive.syncIndex(),readBaseline(sub),
        ]);
        const dirtyToken=localStorage.getItem(dirtyKey);
        if(!manual&&savedState.generation===remote.generation&&savedState.dirtyToken===dirtyToken){
          if(!lastStatus.startsWith('同期済み'))status('同期済み（変更なし）');
          return;
        }
        const local=await localSnapshot(sub);
        const baseline=savedState.entries;
        const remoteMap=new Map(remote.records.map(r=>[r.key,r]));
        const keys=new Set([...remoteMap.keys(),...local.keys(),...Object.keys(baseline)]);
        const fingerprintCache=new Map();
        const localHash=async key=>{
          if(!fingerprintCache.has(key))
            fingerprintCache.set(key,fingerprint(local.get(key)));
          return fingerprintCache.get(key);
        };
        const push=[],pull=[],conflicts=[],safe=new Set(),computed=new Map();
        for(const key of keys){
          const saved=baseline[key],current=local.get(key),cloud=remoteMap.get(key);
          const hash=await localHash(key);
          let localChanged,remoteChanged;
          if(saved){
            localChanged=hash!==saved.hash;
            remoteChanged=(cloud?.version||null)!==(saved.version||null);
          }else{
            // With no baseline, compare same-ID records rather than overwrite either.
            if(current&&cloud){
              const theirs=await drive.syncRead(key[0],key.slice(2));
              const theirHash=await fingerprint({kind:key[0],id:key.slice(2),meta:cloud.meta,body:theirs});
              if(hash===theirHash){safe.add(key);computed.set(key,hash);continue;}
              conflicts.push({key,hash,version:cloud.version});continue;
            }
            localChanged=!!current;remoteChanged=!!cloud;
          }
          if(!localChanged&&!remoteChanged){safe.add(key);computed.set(key,hash);continue;}
          if(localChanged&&remoteChanged){
            if(current&&cloud){
              const theirs=await drive.syncRead(key[0],key.slice(2));
              const theirHash=await fingerprint({kind:key[0],id:key.slice(2),meta:cloud.meta,body:theirs});
              if(hash===theirHash){safe.add(key);computed.set(key,hash);continue;}
            }
            conflicts.push({key,hash,version:cloud?.version||null});continue;
          }
          const kind=key[0],id=key.slice(2);
          if(localChanged){
            push.push(current?{...current,action:'put'}:{kind,id,action:'delete'});
          }else{
            if(cloud){
              const body=await drive.syncRead(kind,id);
              pull.push({kind,id,meta:cloud.meta,body,action:'put'});
            }else pull.push({kind,id,action:'delete'});
          }
          safe.add(key);computed.set(key,localChanged?hash:undefined);
        }
        const destructive=push.some(c=>c.action==='delete')||pull.some(c=>c.action==='delete');
        const needsReview=conflicts.length>0||destructive;
        const signature=JSON.stringify([
          conflicts.map(c=>[c.key,c.hash,c.version]).sort(),
          push.filter(c=>c.action==='delete').map(c=>c.id),
          pull.filter(c=>c.action==='delete').map(c=>c.id),
        ]);
        if(needsReview){
          status('同期に確認が必要（競合 '+conflicts.length+'件'+(destructive?'・削除あり':'')+'）');
          if(!manual&&signature===lastConflict)return;
          lastConflict=signature;
          localStorage.setItem(conflictKey,signature);
          if(!await showConflictDialog(conflicts.length,destructive)){
            status('同期を保留しました（ローカルのデータは保持）');
            return;
          }
          // Destructive changes are never applied in a partial conflict merge.
        }
        const remoteChanges=needsReview?push.filter(c=>c.action!=='delete'):push;
        const localChanges=needsReview?pull.filter(c=>c.action!=='delete'):pull;
        if(remoteChanges.length){
          status('Driveへバックアップ '+remoteChanges.length+'件…');
          await drive.syncApply(remoteChanges,remoteChanges.map(c=>[
            c.kind+':'+c.id,remoteMap.get(c.kind+':'+c.id)?.version,
          ]));
        }
        if(localChanges.length){
          status('Driveの更新をローカルに反映 '+localChanges.length+'件…');
          await applyLocalChanges(sub,localChanges,local);
        }
        const newRemote=remoteChanges.length?await drive.syncIndex():remote;
        const newRemoteMap=new Map(newRemote.records.map(r=>[r.key,r]));
        const newState={...baseline};
        const pushed=new Set(remoteChanges.map(c=>c.kind+':'+c.id));
        const pulled=new Set(localChanges.map(c=>c.kind+':'+c.id));
        const excluded=new Set(needsReview?
          [...push.filter(c=>c.action==='delete'),...pull.filter(c=>c.action==='delete')]
            .map(c=>c.kind+':'+c.id):[]);
        for(const key of safe){
          if(excluded.has(key))continue;
          const cloud=newRemoteMap.get(key);
          const pushedItem=remoteChanges.find(c=>c.kind+':'+c.id===key);
          const pulledItem=localChanges.find(c=>c.kind+':'+c.id===key);
          const hash=pulled.has(key)
            ?await fingerprint(pulledItem.action==='delete'?null:pulledItem)
            :pushed.has(key)
              ?await fingerprint(pushedItem.action==='delete'?null:pushedItem)
              :computed.get(key);
          if(!cloud&&!hash)delete newState[key];
          else newState[key]={version:cloud?.version||null,hash:hash??null};
        }
        await writeBaseline(sub,newState,newRemote.generation,localStorage.getItem(dirtyKey));
        if(!conflicts.length&&!destructive){
          lastConflict='';
          localStorage.removeItem(conflictKey);
        }
        status('同期済み（Driveへ '+remoteChanges.length+'件・端末へ '+localChanges.length+'件）'+
          (conflicts.length?'／競合 '+conflicts.length+'件は保留':''));
        // Local catalogue pages need a refresh after remote-origin changes.
        if(localChanges.length){
          document.dispatchEvent(new Event('drive-store-updated'));
          document.dispatchEvent(new CustomEvent('fast-local-synced'));
        }
      }catch(error){
        status('同期停止：'+(error.message||error));
        console.error('Fast local sync:',error);
      }finally{
        running=false;
        if(button)button.disabled=false;
      }
    };
    if(locks)await locks.request('mol-bench-fast-sync-'+sub,{ifAvailable:true},lock=>{
      if(lock)return perform();
    });
    else await perform();
  };
  window.Mol.fastSyncNow=()=>check(true);
  window.addEventListener('focus',()=>void check());
  window.addEventListener('storage',event=>{
    if(event.key===dirtyKey||event.key===conflictKey)void check();
  });
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)void check();});
  let editTimer;
  document.addEventListener('mol-bench-local-mutated',()=>{
    clearTimeout(editTimer);
    editTimer=setTimeout(()=>void check(),2500);
  });
  timer=setInterval(()=>void check(),IDLE_MS);
  status('高速ローカル保存・Drive同期を確認します');
  void check();
  return ()=>{clearInterval(timer);clearTimeout(editTimer);};
}
