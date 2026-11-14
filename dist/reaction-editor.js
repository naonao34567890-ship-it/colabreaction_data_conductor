'use strict';

const editorParams = new URLSearchParams(location.search);
const openedReactionId = editorParams.get('reaction');
const openedReactionSlot = editorParams.get('slot');
let reactionId = openedReactionId;

async function loadReactionStructure() {
 const reaction = await ReactionStore.read(openedReactionId);
 const slot = openedReactionSlot;
 if (!reaction || !['START','FINISH'].includes(slot) || !reaction[slot]) {
  throw Error('指定した反応構造は見つかりません。');
 }
 return {...reaction[slot],name:reaction.name+'_'+slot};
}

async function overwriteReactionStructure(record, revision) {
 const slot = openedReactionSlot;
 const structure = {...record,revision:crypto.randomUUID()};
 delete structure.id;
 const target=await ReactionStore.read(openedReactionId);
 if(!target||target[slot]?.revision!==revision)throw Error('別のタブで構造が更新されました。開き直してください。');
 const reviewed=await Mol.reviewReactionSave({...target,[slot]:structure},slot);if(!reviewed)return null;
 const other=slot==='START'?'FINISH':'START';
 const fields={[slot]:structure};if(reviewed[other]!==target[other])fields[other]=reviewed[other];
 const saved = await ReactionStore.update(openedReactionId,fields,current=>
  !!current[slot] && current[slot].revision===revision && current[other]?.revision===target[other]?.revision);
 return {name:saved.name+'_'+slot,revision:structure.revision};
}

let reactionSaving = false;
let saveSlot;
let saveTargets = new Map();
const saveDialog = $('reactionSaveDialog');
const destination = $('reactionSaveDestination');
const existing = $('reactionSaveExisting');
const newName = $('reactionSaveName');
const errorLine = $('reactionSaveError');

function syncReactionSave() {
 for(const id of ['saveReactionStart','saveReactionFinish']) {
  $(id).disabled = reactionSaving || !molecule || !atoms.length;
 }
 if(openedReactionId && molecule) $('overwrite').title = molecule.name+' を上書き';
}

function updateReactionDestination() {
 const type = destination.value;
 $('reactionSaveNameRow').hidden = type!=='new';
 $('reactionSaveExistingRow').hidden = type!=='existing';
 const target = saveTargets.get(type==='current' ? reactionId : existing.value);
 const name = type==='new' ? newName.value.trim() : target?.name;
 $('reactionSavePreview').textContent = name ? name+'_'+saveSlot+(type!=='new'&&target[saveSlot]?'（上書き）':'') : '';
 $('reactionSaveSubmit').disabled = reactionSaving || !name;
}

async function openReactionSave(slot) {
 if(!atoms.length||reactionSaving||saveDialog.open)return;
 reactionSaving=true;
 syncReactionSave();
 try {
  const records=(await ReactionStore.read()).sort((a,b)=>b.createdAt-a.createdAt);
  saveTargets=new Map(records.map(item=>[item.id,item]));
  const current=saveTargets.get(reactionId);
  saveSlot=slot;
  const choices={
   new:new Option('名前を付けて新しい反応を作る','new'),
   current:new Option(current?'この反応に保存：'+current.name:'この反応に保存（未指定）','current'),
   existing:new Option('既存の反応を選ぶ','existing'),
  };
  choices.current.disabled=!current;
  choices.existing.disabled=!records.length;
  const order=slot==='START'?['new','current','existing']:current?['current','existing','new']:['existing','new','current'];
  destination.replaceChildren(...order.map(key=>choices[key]));
  destination.value=order.find(key=>!choices[key].disabled);
  existing.replaceChildren(new Option('反応を選んでください',''),...records.map(item=>
   new Option(item.name+' · '+new Date(item.createdAt).toLocaleString('ja-JP')+
    ' · '+['START','FINISH'].filter(endpoint=>item[endpoint]).join(' / '),item.id)));
  newName.value=molecule.name.replace(/[_＿](?:START|FINISH)$/i,'');
  $('reactionSaveTitle').textContent=slot+'として保存';
  errorLine.textContent='';
  saveDialog.showModal();
 } catch(error) {notice(error.message);}
 finally{reactionSaving=false;syncReactionSave();updateReactionDestination();}
}

$('saveReactionStart').onclick=()=>void openReactionSave('START');
$('saveReactionFinish').onclick=()=>void openReactionSave('FINISH');
destination.onchange=existing.onchange=newName.oninput=updateReactionDestination;
$('reactionSaveCancel').onclick=()=>{if(!reactionSaving)saveDialog.close();};
saveDialog.addEventListener('cancel',event=>{if(reactionSaving)event.preventDefault();});

$('reactionSaveForm').onsubmit=async event=>{
 event.preventDefault();
 if(reactionSaving||$('reactionSaveSubmit').disabled||!atoms.length)return;
 reactionSaving=true;
 errorLine.textContent='';
 updateReactionDestination();
 try {
  const type=destination.value;
  const slot=saveSlot;
  finishKeys();
  finishRotation();
  const structure={...editedRecord(slot),revision:crypto.randomUUID()};
  let saved;
  if(type==='new') {
   const name=Mol.safeName(newName.value.trim());
   structure.name=name+'_'+slot;
   if(!await Mol.confirmElectronicSave({[slot]:structure}))return;
   saved=await ReactionStore.create(slot,structure,name);
   reactionId=saved.id;
  } else {
   const id=type==='current'?reactionId:existing.value;
   const target=await ReactionStore.read(id);
   if(!target)throw Error('保存先の反応が見つかりません。メニューを開き直してください。');
   structure.name=target.name+'_'+slot;
   const previous=target[slot];
   const openedSlot=id===openedReactionId&&slot===openedReactionSlot;
   if(openedSlot && previous?.revision!==molecule.revision) {
    throw Error('別のタブで構造が更新されました。開き直してから保存してください。');
   }
   const reviewed=await Mol.reviewReactionSave({...target,[slot]:structure},slot);if(!reviewed)return;
   const other=slot==='START'?'FINISH':'START',fields={[slot]:structure};if(reviewed[other]!==target[other])fields[other]=reviewed[other];
   if(previous && !await Mol.confirmFileAction('上書き保存','「'+structure.name+'」を上書きします。','上書きする'))return;
   saved=await ReactionStore.update(id,fields,current=>
    current[(slot==='START'?'FINISH':'START')]?.revision===target[(slot==='START'?'FINISH':'START')]?.revision && current.name===target.name && !!current[slot]===!!previous && current[slot]?.revision===previous?.revision);
   if(openedSlot) {
    molecule={...structure};
    $('title').textContent=structure.name;
    document.title=structure.name+' — 分子エディタ';
    for(const state of [...history,...future])state.edited=true;
    edited=structureState.charge!==structure.charge||structureState.multiplicity!==structure.multiplicity||atoms.length!==structure.atoms.length||atoms.some(({el,x,y,z},i)=>{
     const atom=structure.atoms[i];
     return el!==atom.el||x!==atom.x||y!==atom.y||z!==atom.z;
    });
    update();
   }
  }
  saveDialog.close();
  notice(saved.name+'_'+slot+' を反応ライブラリに保存しました。');
 } catch(error) {errorLine.textContent=error.message;}
 finally{reactionSaving=false;syncReactionSave();updateReactionDestination();}
};
