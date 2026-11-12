// Lossless records for backups; previews can be regenerated and are omitted.
export async function encode(value) {
 if(value instanceof Blob){let binary='';const data=new Uint8Array(await value.arrayBuffer());for(let i=0;i<data.length;i+=8192)binary+=String.fromCharCode(...data.subarray(i,i+8192));return {$molBlob:1,type:value.type,data:btoa(binary)};}
 if(Array.isArray(value))return Promise.all(value.map(encode));
 if(value&&typeof value==='object'){const out={};for(const key of Object.keys(value).sort()){if(['startPreview','_cloudFingerprint','_cloudRestoredSignature'].includes(key))continue;out[key]=await encode(value[key]);}return out;}
 return value;
}
export function decode(value){
 if(value?.$molBlob===1){const binary=atob(value.data);return new Blob([Uint8Array.from(binary,c=>c.charCodeAt(0))],{type:value.type});}
 if(Array.isArray(value))return value.map(decode);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,decode(v)]));
 return value;
}
export async function fingerprint(value){const data=await encode(value);return hash(JSON.stringify(data));}
export async function hash(text){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');}
export function normalizeMolecule(meta,body){const m={...meta},b={...body};for(const k of ['revision','thumb','bytes'])delete m[k];for(const k of ['revision','_cloudFingerprint'])delete b[k];return {meta:m,body:b};}
export function normalizeReaction(record){const r={...record};delete r.startPreview;delete r._cloudFingerprint;for(const slot of ['START','FINISH'])if(r[slot]){r[slot]={...r[slot]};delete r[slot].revision;delete r[slot].id;}return r;}
export function validateManifest(value){
 if(value?.format!=='mol-bench-library'||value.version!==1||!Array.isArray(value.molecules)||!Array.isArray(value.reactions)||!Array.isArray(value.tags))throw Error('Mol Benchの保存履歴ではありません。');
 for(const ref of [...value.molecules,...value.reactions])if(typeof ref.id!=='string'||!/^[a-f0-9]{64}$/.test(ref.hash))throw Error('保存履歴の参照情報が壊れています。');
 return value;
}
