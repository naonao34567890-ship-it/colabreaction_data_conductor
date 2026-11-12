'use strict';

const ReactionStore = (() => {
 let connectionPromise;
 async function connection(){
  if(Mol.cloud)await Mol.cloud.ready;
  if(!connectionPromise)connectionPromise=new Promise((resolve,reject)=>{
  const request = indexedDB.open(Mol.cloud?.reactionDatabaseName||'molecular-xyz-reactions',1);
  request.onupgradeneeded = () => request.result.createObjectStore('reactions',{keyPath:'id'});
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
 });
  return connectionPromise;
 }
 async function transaction(mode, run) {
  const db = await connection();
  return new Promise((resolve,reject)=>{
   const tx = db.transaction('reactions',mode);
   let result, failure;
   tx.oncomplete = () => resolve(result);
   tx.onabort = () => reject(failure || tx.error);
   run(tx.objectStore('reactions'), value=>{ result=value; }, message=>{failure=Error(message);tx.abort();});
  });
 }
 function read(id) {
  return transaction('readonly',(store,done)=>{
   const request = id ? store.get(id) : store.getAll();
   request.onsuccess = () => done(request.result);
  });
 }
 function update(id, fields, check) {
  return transaction('readwrite',(store,done,abort)=>{
   const request = store.get(id);
   request.onsuccess = () => {
    if (!request.result) { abort('反応が見つかりません。'); return; }
    if (check && !check(request.result)) { abort("別のタブで構造が更新されました。開き直してからもう一度操作してください。"); return; }
    const value = {...request.result,...fields};
    if (Object.hasOwn(fields,'START')) delete value.startPreview;
    store.put(value);
    done(value);
   };
  });
 }
 function createReaction(structures, reactionName) {
  const date = new Date();
  const name = [date.getHours(),date.getMinutes()].map(n=>String(n).padStart(2,'0')).join('');
  const value = {id:crypto.randomUUID(), createdAt:date.getTime(), name:reactionName || name, ...structures};
  return transaction('readwrite',(store,done)=>{ store.add(value); done(value); });
 }
 async function importRecords(items) {
  if(!items.length)return {added:0,skipped:0};
  const existing=await read(),byId=new Map(existing.map(r=>[r.id,r])),expected=new Map(),incoming=new Map();
  for(const item of items){
   if(!item?.id||incoming.has(item.id))throw Error('反応IDが欠けているか重複しています。');
   incoming.set(item.id,item);
   const previous=byId.get(item.id);
   if(previous){
    if(await ReactionArchive.fingerprint(previous)!==await ReactionArchive.fingerprint(item))throw Error('同じ反応IDの異なる内容があります。上書きせず停止しました：'+item.name+'（'+item.id+'）');
    expected.set(item.id,JSON.stringify(previous));
   }
  }
  return transaction('readwrite',(store,done,abort)=>{
   let added=0,skipped=0,left=items.length;
   for(const item of items){
    const request=store.get(item.id);
    request.onsuccess=()=>{
     const previous=request.result;
     if(previous){
      if(!expected.has(item.id)||JSON.stringify(previous)!==expected.get(item.id)){abort('別のタブで反応が更新されました。取り込み直してください。');return;}
      skipped++;
     }else{
      if(expected.has(item.id)){abort('別のタブで反応が削除されました。取り込み直してください。');return;}
      store.add(item);added++;
     }
     if(!--left)done({added,skipped});
    };
   }
  });
 }
 function remove(ids) {
  return transaction('readwrite',store=>{ for(const id of ids) store.delete(id); });
 }
 function tag(ids,name,attach) {
  return transaction('readwrite',store=>{
   for(const id of ids) {
    const request=store.get(id);
    request.onsuccess=()=>{
     const item=request.result;
     if(!item)return;
     const tags=new Set(item.tags||[]);
     if(attach)tags.add(name);else tags.delete(name);
     store.put({...item,tags:[...tags].sort(Mol.compareTagNames)});
    };
   }
  });
 }
 function cacheStartPreview(id,revision,image,generation) {
  return transaction('readwrite',store=>{
   const request=store.get(id);
   request.onsuccess=()=>{
    const item=request.result;
    if(!item?.START || item.START.revision!==revision)return;
    try{store.put({...item,startPreview:{revision,image,generation}});}catch{store.transaction.abort();}
   };
  });
 }
 function clearStartPreviews() {
  return transaction('readwrite',store=>{
   const request=store.openCursor();
   request.onsuccess=()=>{
    const cursor=request.result;
    if(!cursor)return;
    const item=cursor.value;
    try{if(item.startPreview){delete item.startPreview;cursor.update(item);}cursor.continue();}catch{store.transaction.abort();}
   };
  });
 }
 const api={read,update,importRecords,remove,tag,cacheStartPreview,clearStartPreviews,create:(slot,structure,name)=>createReaction({[slot]:structure},name),createReaction};
 if(Mol.cloud){for(const [key,method]of Object.entries({read:'reactionRead',update:'reactionUpdate',remove:'reactionRemove',tag:'reactionTag',createReaction:'reactionCreate',importRecords:'reactionImport'}))api[key]=(...args)=>Mol.cloud.call(method,...args);api.create=(slot,structure,name)=>Mol.cloud.call('reactionCreate',{[slot]:structure},name);}
 return api;
})();
