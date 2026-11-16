// Read-through cache for Colab trajectory, energy CSV, and vibrational XYZ files.
// Drive remains authoritative. Cached entries expire 30 days after last access.
// Namespaced by Drive record-root ID and versioned by Drive modifiedTime.
const DB_NAME='mol-bench-colab-file-cache-v1';
const STORE='files';
const MAX_AGE=30*24*60*60*1000;
const inflight=new Map();
let opening;
const openDb=()=>{
  if(!('indexedDB' in globalThis))return Promise.reject(Error('IndexedDB unavailable'));
  return opening??=(new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,1);
    req.onupgradeneeded=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains(STORE)){
        const store=db.createObjectStore(STORE,{keyPath:'key'});
        store.createIndex('lastAccess','lastAccess');
      }
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error||Error('Cannot open cache'));
    req.onblocked=()=>reject(Error('Cache database blocked'));
  }).catch(error=>{opening=null;throw error;}));
};
const keyFor=(scope,file)=>scope+':'+file.id+':'+(file.modifiedTime||'');
async function getEntry(key){
  const db=await openDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE);
    const req=store.get(key);
    let value=null;
    req.onsuccess=()=>{
      const entry=req.result;
      if(!entry)return;
      if(!(entry.blob instanceof Blob)||Date.now()-entry.lastAccess>=MAX_AGE){
        store.delete(key);
        return;
      }
      entry.lastAccess=Date.now();
      store.put(entry);
      value=entry.blob;
    };
    tx.oncomplete=()=>resolve(value);
    tx.onerror=()=>reject(tx.error);
    tx.onabort=()=>reject(tx.error);
  });
}
async function putEntry(key,scope,blob){
  const db=await openDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,'readwrite');
    tx.objectStore(STORE).put({key,scope,blob,lastAccess:Date.now()});
    tx.oncomplete=resolve;
    tx.onerror=()=>reject(tx.error);
    tx.onabort=()=>reject(tx.error);
  });
}
export async function pruneColabFileCache(){
  try{
    const db=await openDb(),cutoff=Date.now()-MAX_AGE;
    await new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite');
      const index=tx.objectStore(STORE).index('lastAccess');
      const req=index.openCursor(IDBKeyRange.upperBound(cutoff));
      req.onsuccess=()=>{
        const cursor=req.result;
        if(cursor){cursor.delete();cursor.continue();}
      };
      tx.oncomplete=resolve;
      tx.onerror=()=>reject(tx.error);
      tx.onabort=()=>reject(tx.error);
    });
  }catch(error){console.warn('Colab file cache cleanup skipped:',error);}
}
export async function readColabFile(scope,file,fetchBlob){
  if(!scope||!file?.id)throw Error('Cache requires Drive scope and file ID');
  const key=keyFor(scope,file);
  if(inflight.has(key))return inflight.get(key);
  const task=(async()=>{
    try{
      const cached=await getEntry(key);
      if(cached)return cached;
    }catch(error){console.warn('Colab file cache read skipped:',error);}
    // A cache miss always fetches from Drive. Cache failure never blocks viewing.
    const blob=await fetchBlob(file.id);
    try{await putEntry(key,scope,blob);}
    catch(error){console.warn('Colab file cache write skipped:',error);}
    return blob;
  })();
  inflight.set(key,task);
  try{return await task;}
  finally{if(inflight.get(key)===task)inflight.delete(key);}
}
