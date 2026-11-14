/* Molecule ZIP import: ID is identity; names are labels. Validate before writing. */
(function(root){
'use strict';
const limit=512*1024*1024;
const safe=p=>typeof p==='string'&&p.length>0&&p.length<1024&&!p.includes('\\')&&!p.startsWith('/')&&!p.split('/').some(s=>!s||s==='.'||s==='..');
async function read(file){
 if(file.size>limit)throw Error('ZIPは512 MiB以内に分けてください。');
 const {unzipSync}=await import('./vendor/fflate.mjs');let size=0,count=0;const names=new Set();
 const content=unzipSync(new Uint8Array(await file.arrayBuffer()),{filter(e){
  if(e.name.endsWith('/'))return false;
  if(!safe(e.name)||names.has(e.name))throw Error('ZIP内のパスが不正、または重複しています。');names.add(e.name);
  size+=e.originalSize;if(++count>100000||!Number.isSafeInteger(size)||size>limit)throw Error('ZIPの展開サイズが大きすぎます。');return true;
 }});
 if(content['reaction-library.json'])throw Error('反応ZIPは反応ライブラリで取り込んでください。');
 const hasList=Object.hasOwn(content,'lib_list.json');let entries;
 if(hasList){
  const manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(content['lib_list.json']));
  if(manifest.format!=='mol-bench-molecule-library'||manifest.version!==1||!Array.isArray(manifest.molecules)||!manifest.molecules.length)throw Error('未対応、または不正なlib_list.jsonです。');
  entries=manifest.molecules;
 }else{
  entries=Object.keys(content).filter(Mol.acceptsStructure).map(file=>({id:crypto.randomUUID(),name:Mol.structureBaseName(file.split('/').at(-1)),file}));
  if(!entries.length)throw Error('分子ファイルがありません。');
 }
 const ids=new Set(),paths=new Set(),records=[];
 for(const item of entries){
  if(typeof item.id!=='string'||!item.id||ids.has(item.id)||typeof item.name!=='string'||!item.name.trim()||!safe(item.file)||paths.has(item.file)||!Object.hasOwn(content,item.file)||!Mol.acceptsStructure(item.file))throw Error('分子ID・名前・ファイルの対応が不正、または重複しています。');
  ids.add(item.id);paths.add(item.file);Mol.validateElectronicFields(item);
  const bytes=content[item.file];
  if(item.sha256!==undefined){
   const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
   if(item.sha256!==hash)throw Error('分子ファイルの整合性を確認できません。');
  }
  if(item.tags!==undefined&&(!Array.isArray(item.tags)||item.tags.some(t=>typeof t!=='string'||!t.trim())))throw Error('タグが不正です。');
  const blocks=[];for await(const block of Mol.parseFile(new File([bytes],item.file))){if(block.error)throw Error(item.file+'：'+block.error);blocks.push(block);}
  if(hasList&&blocks.length!==1)throw Error('対応表の各ファイルは1分子である必要があります。');
  for(let i=0;i<blocks.length;i++){
   const block=blocks[i],state=Mol.electronicState({...block,...(Object.hasOwn(item,'charge')?{charge:item.charge}:{}),...(Object.hasOwn(item,'multiplicity')?{multiplicity:item.multiplicity}:{})});
   records.push({id:hasList?item.id:crypto.randomUUID(),name:blocks.length===1?item.name:item.name+'('+(i+1)+')',atoms:block.atoms,comment:block.comment,...state,tags:item.tags||Mol.readMemo(block.comment).tags,raw:new Blob(block.rawParts,{type:'chemical/x-xyz'}),baseLines:block.baseLines,originalLines:block.originalLines,edited:false});
  }
  await Mol.tick();
 }
 return {records,hasList};
}
root.MoleculeArchive={read};if(typeof module!=='undefined')module.exports=root.MoleculeArchive;
})(globalThis);
