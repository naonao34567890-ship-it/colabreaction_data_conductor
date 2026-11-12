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
 root.ReactionArchive={build,download};
 if(typeof module!=='undefined')module.exports=root.ReactionArchive;
})(globalThis);
