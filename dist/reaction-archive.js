/* Versioned, lossless reaction transfer. Names are display labels, never pairing keys. */
(function(root){
 'use strict';
 const format='mol-bench-reaction-library';
 async function digest(blob) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),n=>n.toString(16).padStart(2,'0')).join('');
 }
 async function build(records,{origin=globalThis.location?.origin||'',progress=()=>{}}={}) {
  const files=[],reactions=[],ids=new Set();
  async function add(path,blob) {
   const entry={path,blob};files.push(entry);
   return {path,sha256:await digest(blob),bytes:blob.size};
  }
  // Tagged values preserve Blob bytes, undefined, non-finite numbers and typed arrays,
  // without confusing user data with internal reference objects.
  async function encode(value,folder) {
   if(value===undefined)return {type:'undefined'};
   if(Object.is(value,-0))return {type:'number',value:'-0'};
   if(typeof value==='number'&&!Number.isFinite(value))return {type:'number',value:String(value)};
   if(value===null||['string','number','boolean'].includes(typeof value))return value;
   if(value instanceof Blob)return {type:'blob',mime:value.type,file:await add(folder+'/blob-'+crypto.randomUUID(),value)};
   if(value instanceof Date)return {type:'date',value:value.toISOString()};
   if(value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    const bytes=value instanceof ArrayBuffer?new Uint8Array(value):new Uint8Array(value.buffer,value.byteOffset,value.byteLength);
    return {type:'binary',constructor:value instanceof ArrayBuffer?'ArrayBuffer':value.constructor.name,file:await add(folder+'/binary-'+crypto.randomUUID(),new Blob([bytes]))};
   }
   if(Array.isArray(value))return {type:'array',items:await Promise.all(value.map(item=>encode(item,folder)))};
   if(Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)throw Error('未対応のデータ型があるため、情報を省略せずに保存できません。');
   return {type:'object',entries:await Promise.all(Object.entries(value).map(async([key,item])=>[key,await encode(item,folder)]))};
  }
  for(const record of records) {
   if(typeof record.id!=='string'||!record.id||ids.has(record.id))throw Error('反応IDが欠けているか重複しています。保存を中止しました。');
   ids.add(record.id);
   const folder='reactions/'+crypto.randomUUID();
   const endpoints={};
   for(const role of ['START','FINISH']) {
    const structure=record[role];
    if(!structure){endpoints[role]=null;continue;}
    endpoints[role]={structureId:record.id+':'+role,revision:structure.revision??null,
     xyz:await add(folder+'/'+role+'.xyz',Mol.calculationOutput(structure))};
   }
   const data=await add(folder+'/record.json',new Blob([JSON.stringify(await encode(record,folder))],{type:'application/json'}));
   reactions.push({reactionId:record.id,name:record.name,record:data,endpoints});
   progress(reactions.length,records.length);
   await Mol.tick();
  }
  const manifest={format,version:1,archiveId:crypto.randomUUID(),createdAt:new Date().toISOString(),source:{origin},count:reactions.length,reactions};
  files.push({path:'reaction-library.json',blob:new Blob([JSON.stringify(manifest,null,2)],{type:'application/json'})});
  files.push({path:'README.txt',blob:new Blob(['Mol Bench 反応ライブラリ / version 1\nreaction-library.json が反応IDとSTART（出発物）・FINISH（生成物）の対応を保持します。\n名前から対応を推測しないでください。nullは未作成です。\nrecord.jsonはタグ・原子順・座標・元XYZなどを保持する型付きデータです。Blobは参照先の原文バイト列です。\n各参照のSHA-256は内容確認用です。ファイルを変更・削除せずZIPのまま保管してください。\nSTART.xyz / FINISH.xyzは計算用XYZです。完全な復元には対応表とrecord.jsonも必要です。\n'])});
  return {manifest,files};
 }
 async function download(records,progress) {
  if(!records.length)throw Error('保存する反応がありません。');
  const {files}=await build(records,{progress});
  const chunks=[];
  await MolJobs.exportFiles(files,bytes=>{chunks.push(bytes);});
  Mol.downloadBlob(new Blob(chunks,{type:'application/zip'}),'reaction-library.zip');
 }
 const maxBytes=512*1024*1024;
 function safePath(path) {
  return typeof path==='string' && path.length>0 && path.length<1024 && !path.includes('\\') && !path.startsWith('/') && !path.split('/').some(x=>!x||x==='.'||x==='..');
 }
 async function read(file,{progress=()=>{}}={}) {
  if(file.size>maxBytes)throw Error('ZIPが大きすぎます。元サイトで選択分を分けて保存してください（上限512 MiB）。');
  const {unzipSync}=await import('./vendor/fflate.mjs');
  let size=0,count=0;
  const names=new Set();
  const content=unzipSync(new Uint8Array(await file.arrayBuffer()),{filter(entry){
   if(!safePath(entry.name)||names.has(entry.name))throw Error('ZIP内のパスが不正、または重複しています。');
   names.add(entry.name);size+=entry.originalSize;
   if(++count>50000||!Number.isSafeInteger(size)||size>maxBytes)throw Error('ZIPの展開サイズが大きすぎます。分けて取り込んでください。');
   return true;
  }});
  const json=bytes=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  if(!Object.hasOwn(content,'reaction-library.json'))throw Error('対応情報がありません。元Sitesの「対応情報付きZIPで保存」で書き出し直してください。名前からペアを推測する取り込みは行いません。');
  const manifest=json(content['reaction-library.json']);
  if(manifest.format!==format||manifest.version!==1||!Array.isArray(manifest.reactions)||manifest.count!==manifest.reactions.length||!manifest.count)throw Error('未対応、または不正な反応ライブラリ形式です。');
  const referenced=new Set(),ids=new Set(),records=[];
  async function load(ref) {
   if(!ref||!safePath(ref.path)||!Object.hasOwn(content,ref.path)||referenced.has(ref.path)||!/^[a-f0-9]{64}$/.test(ref.sha256)||!Number.isSafeInteger(ref.bytes))throw Error('参照先が欠落、重複、または不正です。');
   referenced.add(ref.path);
   const blob=new Blob([content[ref.path]]);
   if(blob.size!==ref.bytes||await digest(blob)!==ref.sha256)throw Error('ZIP内のファイルの整合性を確認できません。元サイトから書き出し直してください。');
   return blob;
  }
  async function decode(value,depth=0) {
   if(depth>100)throw Error('反応データの入れ子が深すぎます。');
   if(value===null||['string','number','boolean'].includes(typeof value))return value;
   if(!value||typeof value!=='object'||Array.isArray(value))throw Error('反応データの値が不正です。');
   switch(value.type) {
    case 'undefined': return undefined;
    case 'number': if(!['NaN','Infinity','-Infinity','-0'].includes(value.value))throw Error('数値の形式が不正です。');return value.value==='-0'?-0:Number(value.value);
    case 'date': {const date=new Date(value.value);if(!Number.isFinite(+date))throw Error('日付が不正です。');return date;}
    case 'blob': return new Blob([await load(value.file)],{type:value.mime});
    case 'binary': {
     const data=await (await load(value.file)).arrayBuffer();
     const types={ArrayBuffer,DataView,Uint8Array,Uint8ClampedArray,Int8Array,Uint16Array,Int16Array,Uint32Array,Int32Array,Float32Array,Float64Array,BigInt64Array,BigUint64Array};
     if(!Object.hasOwn(types,value.constructor))throw Error('バイナリ型が不正です。');
     return value.constructor==='ArrayBuffer'?data:new types[value.constructor](data);
    }
    case 'array': if(!Array.isArray(value.items))throw Error('配列が不正です。');return Promise.all(value.items.map(x=>decode(x,depth+1)));
    case 'object': {
     if(!Array.isArray(value.entries))throw Error('オブジェクトが不正です。');
     const keys=new Set(),entries=[];
     for(const pair of value.entries){if(!Array.isArray(pair)||pair.length!==2||typeof pair[0]!=='string'||keys.has(pair[0]))throw Error('属性が重複、または不正です。');keys.add(pair[0]);entries.push([pair[0],await decode(pair[1],depth+1)]);}
     return Object.fromEntries(entries);
    }
    default: throw Error('未対応のデータ型です。');
   }
  }
  for(const item of manifest.reactions) {
   if(typeof item.reactionId!=='string'||!item.reactionId||ids.has(item.reactionId)||!item.endpoints)throw Error('反応IDが欠落、重複、または不正です。');
   ids.add(item.reactionId);
   const record=await decode(json(new Uint8Array(await (await load(item.record)).arrayBuffer())));
   if(!record||record.id!==item.reactionId||typeof record.name!=='string'||record.name!==item.name||!Number.isFinite(record.createdAt)||record.tags!==undefined&&(!Array.isArray(record.tags)||record.tags.some(t=>typeof t!=='string')))throw Error('反応のID・名前・日時・タグが対応表と一致しないか不正です。');
   for(const role of ['START','FINISH']) {
    const endpoint=item.endpoints[role],structure=record[role];
    if(!structure){if(endpoint!==null)throw Error('未作成の構造と対応表が一致しません。');continue;}
    if(!endpoint||endpoint.structureId!==record.id+':'+role||endpoint.revision!==(structure.revision??null)||!Array.isArray(structure.atoms)||!structure.atoms.length||structure.atoms.some(a=>!a||!Object.hasOwn(Mol.elements,a.el)||!['x','y','z'].every(k=>Number.isFinite(a[k]))))throw Error('出発物・生成物の対応、または原子情報が不正です。');
    const xyz=await load(endpoint.xyz);
    if(await xyz.text()!==await Mol.calculationOutput(structure).text())throw Error('計算用XYZと復元する構造が一致しません。');
    if(structure.raw!==undefined&&!(structure.raw instanceof Blob))throw Error('元XYZデータが不正です。');
   }
   records.push(record);progress(records.length,manifest.count);await Mol.tick();
  }
  return {manifest,records};
 }
 // A semantic fingerprint ignores only runtime caches; names, tags and source bytes
 // remain significant. ZIP paths and the archive's random IDs are irrelevant.
 async function fingerprint(value) {
  async function stable(v) {
   if(v instanceof Blob)return ['blob',v.type,await digest(v)];
   if(v===undefined)return ['undefined'];
   if(typeof v==='number')return ['number',Object.is(v,-0)?'-0':String(v)];
   if(v instanceof Date)return ['date',v.toISOString()];
   if(v instanceof ArrayBuffer||ArrayBuffer.isView(v))return ['binary',v.constructor.name,await digest(new Blob([v instanceof ArrayBuffer?v:new Uint8Array(v.buffer,v.byteOffset,v.byteLength)]))];
   if(Array.isArray(v))return ['array',await Promise.all(v.map(stable))];
   if(v&&typeof v==='object')return ['object',await Promise.all(Object.keys(v).filter(k=>!['_driveFileId','startPreview'].includes(k)).sort().map(async k=>[k,await stable(v[k])]))];
   return [typeof v,v];
  }
  return digest(new Blob([JSON.stringify(await stable(value))]));
 }

 root.ReactionArchive={build,download,read,fingerprint};
 if(typeof module!=='undefined')module.exports=root.ReactionArchive;
})(globalThis);
