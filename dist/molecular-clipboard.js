/* Cross-page molecular clipboard; versioned text/plain JSON.
 * Unsupported clipboard content is ignored, never guessed as XYZ.
 */
(function(root){
'use strict';
const MIME='mol-bench-clipboard',VERSION=1;
async function encode(value){
 if(value instanceof Blob){
  const bytes=new Uint8Array(await value.arrayBuffer());
  let binary='';
  for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return {__mbType:'Blob',mime:value.type,data:btoa(binary)};
 }
 if(value instanceof Date)return {__mbType:'Date',value:value.toISOString()};
 if(typeof value==='bigint')return {__mbType:'BigInt',value:String(value)};
 if(typeof value==='number'&&(!Number.isFinite(value)||Object.is(value,-0)))
  return {__mbType:'Number',value:Object.is(value,-0)?'-0':String(value)};
 if(value instanceof ArrayBuffer||ArrayBuffer.isView(value)){
  const bytes=value instanceof ArrayBuffer?new Uint8Array(value):new Uint8Array(value.buffer,value.byteOffset,value.byteLength);
  let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return {__mbType:'Bytes',constructor:value instanceof ArrayBuffer?'ArrayBuffer':value.constructor.name,data:btoa(binary)};
 }
 if(Array.isArray(value))return Promise.all(value.map(encode));
 if(value&&typeof value==='object'){
  const entries=await Promise.all(Object.entries(value).filter(([key])=>!['_driveFileId','startPreview'].includes(key)).map(async([k,v])=>[k,await encode(v)]));
  return {__mbType:'Object',entries};
 }
 return value===undefined?{__mbType:'Undefined'}:value;
}
function decode(v,depth=0){
 if(depth>80)throw Error('コピーされたデータが複雑すぎます。');
 if(v===null||['string','boolean','number'].includes(typeof v))return v;
 if(!v||typeof v!=='object'||Array.isArray(v))throw Error('クリップボード形式が不正です。');
 if(v.__mbType==='Blob')return new Blob([Uint8Array.from(atob(v.data),c=>c.charCodeAt(0))],{type:v.mime||''});
 if(v.__mbType==='Date')return new Date(v.value);
 if(v.__mbType==='BigInt')return BigInt(v.value);
 if(v.__mbType==='Number')return v.value==='-0'?-0:Number(v.value);
 if(v.__mbType==='Undefined')return undefined;
 if(v.__mbType==='Bytes'){
  const bytes=Uint8Array.from(atob(v.data),c=>c.charCodeAt(0));
  const types={ArrayBuffer,DataView,Uint8Array,Uint8ClampedArray,Int8Array,Uint16Array,Int16Array,Uint32Array,Int32Array,Float32Array,Float64Array,BigInt64Array,BigUint64Array};
  if(!Object.hasOwn(types,v.constructor))throw Error('未対応のバイナリ型です。');
  return v.constructor==='ArrayBuffer'?bytes.buffer:new types[v.constructor](bytes.buffer);
 }
 if(v.__mbType!=='Object'||!Array.isArray(v.entries))throw Error('クリップボード形式が不正です。');
 const out=Object.create(null);
 for(const pair of v.entries){if(!Array.isArray(pair)||pair.length!==2||typeof pair[0]!=='string'||Object.hasOwn(out,pair[0]))throw Error('不正な属性です。');out[pair[0]]=decode(pair[1],depth+1);}
 return {...out};
}
function clipboardDB(){
 return new Promise((resolve,reject)=>{
  const req=indexedDB.open('mol-bench-shared-clipboard',1);
  req.onupgradeneeded=()=>req.result.createObjectStore('payloads',{keyPath:'key'});
  req.onsuccess=()=>resolve(req.result);
  req.onerror=()=>reject(req.error);
 });
}
async function writeLarge(kind,records){
 const db=await clipboardDB(),key=crypto.randomUUID();
 try{
  await new Promise((resolve,reject)=>{
   const tx=db.transaction('payloads','readwrite'),store=tx.objectStore('payloads');
   store.clear();
   store.put({key,kind,records,copiedAt:Date.now()});
   tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);
  });
 }finally{db.close();}
 await navigator.clipboard.writeText(JSON.stringify({format:MIME,version:VERSION,kind,localReference:key}));
}
async function readLarge(key,kind){
 const db=await clipboardDB();
 try{
  return await new Promise((resolve,reject)=>{
   const tx=db.transaction('payloads','readonly'),request=tx.objectStore('payloads').get(key);
   request.onsuccess=()=>{
    const item=request.result;
    resolve(item?.kind===kind&&Date.now()-item.copiedAt<24*60*60*1000?item.records:null);
   };
   request.onerror=()=>reject(request.error);
  });
 }finally{db.close();}
}
async function copy(kind,records){
 if(!records.length)return false;
 // Use the browser's native structured-clone storage for large multi-item copies.
 const estimate=records.reduce((n,r)=>n+(r.atoms?.length||0)*140+(r.raw?.size||0)+
 (r.START?.atoms?.length||0)*140+(r.FINISH?.atoms?.length||0)*140,0);
 if(records.length>200||estimate>4*1024*1024){
  await writeLarge(kind,records);
  return true;
 }
 const text=JSON.stringify({format:MIME,version:VERSION,kind,items:await Promise.all(records.map(encode))});
 if(text.length>16*1024*1024){await writeLarge(kind,records);return true;}
 await navigator.clipboard.writeText(text);
 return true;
}
async function paste(kind){
 let text;
 try{text=await navigator.clipboard.readText();}catch(e){if(e.name==='NotAllowedError')throw Error('クリップボードの読み取りが許可されていません。');throw e;}
 if(!text||text.length>32*1024*1024)return null;
 let obj;try{obj=JSON.parse(text);}catch{return null;}
 if(obj?.format!==MIME||obj.version!==VERSION||obj.kind!==kind)return null;
 if(typeof obj.localReference==='string')return readLarge(obj.localReference,kind).catch(()=>null);
 if(!Array.isArray(obj.items)||obj.items.length>10000)return null;
 try{return obj.items.map(v=>decode(v)).filter(v=>v&&typeof v==='object');}catch{return null;}
}
function editable(event){
 const target=event.target;
 return !!(target?.isContentEditable||target?.closest?.('input,textarea,select,[contenteditable="true"],dialog'));
}
root.MolClipboard={copy,paste,editable};
})(globalThis);
