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
 if(v.__mbType==='Undefined')return undefined;
 if(v.__mbType==='Bytes'){
  const bytes=Uint8Array.from(atob(v.data),c=>c.charCodeAt(0));
  const types={ArrayBuffer,DataView,Uint8Array,Uint8ClampedArray,Int8Array,Uint16Array,Int16Array,Uint32Array,Int32Array,Float32Array,Float64Array};
  if(!Object.hasOwn(types,v.constructor))throw Error('未対応のバイナリ型です。');
  return v.constructor==='ArrayBuffer'?bytes.buffer:new types[v.constructor](bytes.buffer);
 }
 if(v.__mbType!=='Object'||!Array.isArray(v.entries))throw Error('クリップボード形式が不正です。');
 const out=Object.create(null);
 for(const pair of v.entries){if(!Array.isArray(pair)||pair.length!==2||typeof pair[0]!=='string'||Object.hasOwn(out,pair[0]))throw Error('不正な属性です。');out[pair[0]]=decode(pair[1],depth+1);}
 return {...out};
}
async function copy(kind,records){
 if(!records.length)return false;
 const text=JSON.stringify({format:MIME,version:VERSION,kind,items:await Promise.all(records.map(encode))});
 await navigator.clipboard.writeText(text);
 return true;
}
async function paste(kind){
 let text;
 try{text=await navigator.clipboard.readText();}catch(e){if(e.name==='NotAllowedError')throw Error('クリップボードの読み取りが許可されていません。');throw e;}
 if(!text||text.length>32*1024*1024)return null;
 let obj;try{obj=JSON.parse(text);}catch{return null;}
 if(obj?.format!==MIME||obj.version!==VERSION||obj.kind!==kind||!Array.isArray(obj.items)||obj.items.length>10000)return null;
 try{return obj.items.map(v=>decode(v)).filter(v=>v&&typeof v==='object');}catch{return null;}
}
function editable(event){
 const target=event.target;
 return !!(target?.isContentEditable||target?.closest?.('input,textarea,select,[contenteditable="true"],dialog'));
}
root.MolClipboard={copy,paste,editable};
})(globalThis);
