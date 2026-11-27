'use strict';

const ReactionStore = (() => {
 let connectionPromise;
 async function connection(){
  if(Mol.cloud)await Mol.cloud.ready;
  if(!connectionPromise)connectionPromise=new Promise((resolve,reject)=>{
  const request = indexedDB.open(Mol.localReactionDatabaseName||Mol.cloud?.reactionDatabaseName||'molecular-xyz-reactions',1);
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
  fields={...fields};for(const slot of ['START','FINISH'])if(fields[slot])fields[slot]={...fields[slot],...Mol.electronicState(fields[slot])};
  return transaction('readwrite',(store,done,abort)=>{
   const request = store.get(id);
   request.onsuccess = () => {
    if (!request.result) { abort('反応が見つかりません。'); return; }
    if (check && !check(request.result)) { abort("別のタブで構造が更新されました。開き直してからもう一度操作してください。"); return; }
    const {id:_ignoredId,createdAt:_ignoredCreatedAt,...safeFields}=fields;
    const value={...request.result,...safeFields,id:request.result.id,createdAt:request.result.createdAt};
    const apply=()=>{
      if(Object.hasOwn(fields,'START'))delete value.startPreview;
      store.put(value);done(value);
    };
    if(Object.hasOwn(safeFields,'name')){
      const all=store.getAll();
      all.onsuccess=()=>{
        const used=new Set(all.result.filter(item=>item.id!==id).map(item=>item.name));
        if(used.has(value.name))value.name=Mol.nextDuplicateName(value.name,used);
        apply();
      };
    }else apply();
   };
  });
 }
 function createReaction(structures, reactionName) {
  structures={...structures};for(const slot of ['START','FINISH'])if(structures[slot])structures[slot]={...structures[slot],...Mol.electronicState(structures[slot])};
  const {id:_discardId,createdAt:_discardCreatedAt,name:_discardName,...payload}=structures;
  const base=String(reactionName||structures.name||'反応');
  return transaction('readwrite',(store,done)=>{
   const req=store.getAll();
   req.onsuccess=()=>{
    const used=new Set(req.result.map(r=>r.name));
    const name=used.has(base)?Mol.nextDuplicateName(base,used):base;
    const value={...payload,id:crypto.randomUUID(),createdAt:Date.now(),name};
    store.add(value);done(value);
   };
  });
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
 function classify(ids,classification){
  if(!ids.length)return Promise.resolve();
  return transaction('readwrite',(store,done,abort)=>{
   let remaining=ids.length;
   for(const id of ids){
    const request=store.get(id);
    request.onsuccess=()=>{
     if(!request.result){abort('反応が見つかりません。');return;}
     store.put({...request.result,classification});
     if(!--remaining)done();
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
 const api={read,list:()=>read(),update,importRecords,remove,tag,classify,cacheStartPreview,clearStartPreviews,create:(slot,structure,name)=>createReaction({[slot]:structure},name),createReaction};
 if(Mol.cloud){for(const [key,method]of Object.entries({read:'reactionRead',list:'reactionList',update:'reactionUpdate',remove:'reactionRemove',tag:'reactionTag',classify:'reactionClassify',createReaction:'reactionCreate',importRecords:'reactionImport'}))api[key]=(...args)=>Mol.cloud.call(method,...args);api.create=(slot,structure,name)=>Mol.cloud.call('reactionCreate',{[slot]:structure},name);}
 if(Mol.localFast){
  for(const method of ['update','importRecords','remove','tag','classify','create','createReaction']){
   const original=api[method];
   api[method]=async(...args)=>{
    const value=await original(...args);
    const sub=Mol.localFastScope.sub;
    if(method==='remove'){
      for(const id of args[0]||[])
        localStorage.setItem('mol-bench-fast-deleted-'+sub+':r:'+id,String(Date.now()));
    }else if(method==='importRecords'){
      for(const item of args[0]||[])
        if(item?.id)localStorage.removeItem('mol-bench-fast-deleted-'+sub+':r:'+item.id);
    }
    localStorage.setItem('mol-bench-fast-sync-dirty-'+sub,crypto.randomUUID());
    document.dispatchEvent(new Event('mol-bench-local-mutated'));
    return value;
   };
  }
 }
 // Notify other tabs only after successful mutations. Preview cache writes
 // are deliberately excluded to avoid expensive list refresh loops.
 if (typeof BroadcastChannel === 'function') {
  const changes = new BroadcastChannel('molecular-xyz-reaction-list-changed-v1');
  for (const method of ['update','importRecords','remove','tag','classify','create','createReaction']) {
   const original = api[method];
   api[method] = async (...args) => {
    const result = await original(...args);
    try { changes.postMessage({type:'changed',method}); } catch {}
    return result;
   };
  }
  window.addEventListener('pagehide',()=>changes.close(),{once:true});
 }
 return api;
})();
