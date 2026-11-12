'use strict';

const control = id=>document.getElementById(id);
const selected = new Set();
let records = [];
let changing = false;
const days = document.getElementById('reactionDays');
const status = document.getElementById('reactionStatus');
const dayKey = new Intl.DateTimeFormat('ja-JP',{dateStyle:'long'});
let renderer;
const thumbnailSettings=Mol.thumbnailMode(control('thumbnailMode'),'reactions',ReactionStore.clearStartPreviews,()=>void renderReactions());
const previews = new WeakMap();
function showPreview(target,source) {
 const image = new Image();
 image.alt = 'START構造';
 image.src = source;
 target.replaceChildren(image);
}
const observer = new IntersectionObserver(async entries=>{
 for (const {target,isIntersecting} of entries) {
  if (!isIntersecting) continue;
  observer.unobserve(target);
  try {
   const reaction = previews.get(target);
   const {mode,generation}=thumbnailSettings();
   const cached = reaction.startPreview;
   if (cached && cached.revision === reaction.START.revision && cached.generation===generation) {
    showPreview(target,cached.image);
    continue;
   }
   const graphics = await Mol.graphics;
   if (!target.isConnected || thumbnailSettings().generation!==generation) continue;
   const atoms = reaction.START.atoms;
   const {T} = graphics;
   if (!renderer) {
    renderer = new T.WebGLRenderer({alpha:true,antialias:true});
    renderer.setSize(256,150);
   }
   const scene = new T.Scene();
   const camera = new T.PerspectiveCamera(38,256/150,.01,2000);
   const model = graphics.model(atoms,undefined,undefined,undefined,mode);
   try {
    scene.add(model);
    graphics.light(scene);
    graphics.fit(camera,atoms);
    renderer.render(scene,camera);
    const image = renderer.domElement.toDataURL('image/png');
    showPreview(target,image);
    reaction.startPreview = {revision:reaction.START.revision,image,generation};
    void ReactionStore.cacheStartPreview(reaction.id,reaction.START.revision,image,generation).catch(()=>{});
   } finally { graphics.dispose(model); }
  } catch { target.textContent = 'サムネイルを表示できません'; }
 }
});

function cardFor(reaction) {
 const card = document.createElement('article');
 card.className = 'reaction-card';
 card.dataset.id = reaction.id;
 card.tabIndex = 0;
 card.setAttribute('aria-label',reaction.name);
 card.onclick = event=>{
  if(event.target.closest('button,input,.structure-name,h3'))return;
  selectCard(reaction.id,event.ctrlKey||event.metaKey);
 };
 card.onkeydown = event=>{
  if(event.target!==card||!['Enter',' '].includes(event.key))return;
  event.preventDefault();
  selectCard(reaction.id,event.ctrlKey||event.metaKey);
 };
 const header = document.createElement('div');
 header.className = 'row';
 const title = document.createElement('h3');
 title.textContent = reaction.name;
 const rename = document.createElement('button');
 rename.textContent = '✎';
 rename.setAttribute('aria-label','反応名を変更');
 rename.onclick = () => title.dispatchEvent(new MouseEvent('dblclick'));
 async function renameReaction(name){
  const saved = await ReactionStore.update(reaction.id,{name:Mol.safeName(name)});
  await renderReactions();
  return saved.name;
 }
 const showRenameError=message=>{status.textContent=message;};
 Mol.editName(title,renameReaction,showRenameError);
 header.append(title,rename);
 const preview = document.createElement('div');
 preview.className = 'reaction-preview muted';
 preview.textContent = reaction.START ? 'STARTを描画中…' : 'START未作成';
 if (reaction.START) {
  previews.set(preview,reaction);
  observer.observe(preview);
 }
 card.append(header,preview);
 if(reaction.tags?.length) {
  const tags=document.createElement('p');
  tags.className='muted';
  tags.textContent=reaction.tags.join(' · ');
  card.append(tags);
 }
 for (const slot of ['START','FINISH']) {
  const row = document.createElement('div');
  row.className = 'row reaction-slot';
  const name = document.createElement('span');
  const structure = reaction[slot];
  name.className = 'structure-name';
  name.textContent = reaction.name+'_'+slot;
  Mol.editName(name,async value=>{
   const base = value.replace(new RegExp('[_＿]'+slot+'$','i'),'').trim();
   if (!base) throw Error('反応名を入力してください。');
   return (await renameReaction(base))+'_'+slot;
  },showRenameError);
  const action = document.createElement('button');
  action.textContent = structure ? '開く' : '未作成';
  action.disabled = !structure;
  const download = document.createElement('button');
  download.textContent = '↓';
  download.setAttribute('aria-label',slot+'をダウンロード');
  download.disabled = !structure;
  if (structure) {
   const open = () => window.open('editor.html?'+new URLSearchParams({reaction:reaction.id,slot}),'_blank','noopener');
   row.classList.add('openable');
   row.title = '行の余白をダブルクリックでエディタを開く';
   row.ondblclick = event => {
    if (!event.target.closest('button,input,.structure-name')) open();
   };
   action.onclick = open;
   download.onclick = () => Mol.downloadBlob(Mol.calculationOutput(structure),Mol.safeName(reaction.name+'_'+slot)+'.xyz');
  }
  row.append(name,action,download);
  card.append(row);
 }
 return card;
}

let renderRevision = 0;
async function renderReactions() {
 const revision = ++renderRevision;
 try {
  const reactions = (await ReactionStore.read()).sort((a,b)=>b.createdAt-a.createdAt);
  if (revision !== renderRevision) return;
  records = reactions;
  const ids = new Set(records.map(item=>item.id));
  for (const id of selected) if (!ids.has(id)) selected.delete(id);
  observer.disconnect();
  const content = document.createDocumentFragment();
  let previous, grid;
  for (const reaction of reactions) {
   const day = dayKey.format(reaction.createdAt);
   if (day!==previous) {
    const section = document.createElement('section');
    section.className = 'reaction-day';
    const heading = document.createElement('h2');
    heading.textContent = day;
    grid = document.createElement('div');
    grid.className = 'reaction-grid';
    section.append(heading,grid);
    content.append(section);
    previous = day;
   }
   grid.append(cardFor(reaction));
  }
  days.replaceChildren(content);
  selectionUI();
  status.textContent = reactions.length ? '' : '分子エディタの「反応に保存」から登録できます。';
 } catch (error) {
  if (revision === renderRevision) status.textContent = error.message;
 }
}
window.addEventListener('focus',renderReactions);
void renderReactions();

function selectionUI() {
 control('reactionArchiveAll').disabled=changing||!records.length;
 for(const card of days.querySelectorAll('.reaction-card')) {
  const active=selected.has(card.dataset.id);
  card.classList.toggle('selected',active);
 }
 for(const id of ['reactionTag','reactionDelete','reactionZip','reactionArchive'])control(id).disabled=changing||!selected.size;
 control('reactionSelection').textContent=selected.size+' 件選択中';
}
function selectCard(id,additive) {
 const remove=additive&&selected.has(id);
 if(!additive)selected.clear();
 if(remove)selected.delete(id);else selected.add(id);
 selectionUI();
}
control('reactionAll').onclick=()=>{for(const item of records)selected.add(item.id);selectionUI();};
control('reactionNone').onclick=()=>{selected.clear();selectionUI();};
async function changeSelection(action) {
 if(changing||!selected.size)return;
 changing=true;
 selectionUI();
 try{await action([...selected]);}catch(error){status.textContent=error.message;}
 finally{changing=false;selectionUI();}
}
control('reactionDelete').onclick=()=>void changeSelection(async ids=>{
 if(!await Mol.confirmFileAction('反応を削除',ids.length+' 件の反応とそのSTART・FINISHを削除します。','反応を削除する'))return;
 await ReactionStore.remove(ids);
 await renderReactions();
 status.textContent=ids.length+' 件の反応を削除しました。';
});
window.addEventListener('keydown',event=>{
 if(event.ctrlKey&&event.shiftKey&&event.key==='Backspace'&&!event.target.closest?.('input,textarea,select,dialog')&&selected.size) {
  event.preventDefault();
  control('reactionDelete').click();
 }
});
control('reactionTag').onclick=()=>{
 const names=[...new Set(records.flatMap(item=>item.tags||[]))].sort(Mol.compareTagNames);
 control('reactionTagNames').replaceChildren(...names.map(name=>new Option(name)));
 control('reactionTagName').value='';
 control('reactionTagError').textContent='';
 control('reactionTagDialog').showModal();
};
control('reactionTagClose').onclick=()=>control('reactionTagDialog').close();
control('reactionTagForm').onsubmit=event=>{
 event.preventDefault();
 const value=control('reactionTagName').value;
 if(!value.trim()||value.includes('\t')) {
  control('reactionTagError').textContent='タブを含まないタグ名を入力してください。';
  return;
 }
 void changeSelection(async ids=>{
  await ReactionStore.tag(ids,value.trim(),event.submitter?.value!=='remove');
  control('reactionTagDialog').close();
  await renderReactions();
 });
};
async function downloadReactionArchive(ids) {
 const saved=await ReactionStore.read();
 const chosen=new Set(ids);
 const items=saved.filter(item=>chosen.has(item.id));
 if(items.length!==chosen.size)throw Error('反応が別のタブで削除されました。再読み込みしてください。');
 await ReactionArchive.download(items,(done,total)=>{status.textContent=`対応情報付きZIPを作成中… ${done} / ${total} 件`;});
 status.textContent=items.length+' 件の反応を対応情報付きZIPで保存しました。';
}
control('reactionArchive').onclick=()=>void changeSelection(downloadReactionArchive);
control('reactionArchiveAll').onclick=async()=>{
 if(changing)return;
 changing=true;selectionUI();
 try{await downloadReactionArchive((await ReactionStore.read()).map(item=>item.id));}
 catch(error){status.textContent=error.message;}
 finally{changing=false;selectionUI();}
};
control('reactionZip').onclick=()=>void changeSelection(async ids=>{
 const chosen=new Set(ids);
 const usedNames=new Set();
 const bodies=[];
 for(const reaction of records.filter(item=>chosen.has(item.id))) {
  const base=Mol.safeName(reaction.name);
  let name=base, number=1;
  while(usedNames.has(name))name=base+' ('+(++number)+')';
  usedNames.add(name);
  for(const slot of ['START','FINISH']) {
   if(reaction[slot])bodies.push({...reaction[slot],name:name+'_'+slot});
  }
 }
 if(!bodies.length)throw Error('ダウンロードできる構造がありません。');
 const chunks=[];
 await MolJobs.exportData(bodies.map((_,index)=>index),'zip',bytes=>chunks.push(bytes),()=>false,()=>{},false,bodies);
 Mol.downloadBlob(new Blob(chunks,{type:'application/zip'}),'reactions.zip');
});

days.addEventListener('pointerdown',event=>{
 if(event.button!==0||event.target.closest('button,input,.structure-name,h3'))return;
 const x=event.clientX,y=event.clientY;
 const before=new Set(selected);
 const box=document.createElement('div');
 box.className='reaction-selection-box';
 const move=pointer=>{
  if(!box.isConnected&&Math.hypot(pointer.clientX-x,pointer.clientY-y)<6)return;
  if(!box.isConnected)document.body.append(box);
  const left=Math.min(x,pointer.clientX),right=Math.max(x,pointer.clientX);
  const top=Math.min(y,pointer.clientY),bottom=Math.max(y,pointer.clientY);
  Object.assign(box.style,{left:left+'px',top:top+'px',width:right-left+'px',height:bottom-top+'px'});
  selected.clear();
  if(pointer.shiftKey||pointer.ctrlKey||pointer.metaKey)for(const id of before)selected.add(id);
  for(const card of days.querySelectorAll('.reaction-card')) {
   const rect=card.getBoundingClientRect(), id=card.dataset.id;
   if(rect.right<left||rect.left>right||rect.bottom<top||rect.top>bottom)continue;
   if(pointer.shiftKey&&before.has(id))selected.delete(id);else selected.add(id);
  }
  selectionUI();
 };
 const stop=pointer=>{
  window.removeEventListener('pointermove',move);
  window.removeEventListener('pointerup',stop);
  window.removeEventListener('pointercancel',stop);
  if(!box.isConnected)return;
  box.remove();
  if(pointer.type==='pointerup'){
   const suppress=click=>click.stopPropagation();
   window.addEventListener('click',suppress,{capture:true,once:true});
   setTimeout(()=>window.removeEventListener('click',suppress,true),0);
  }
 };
 window.addEventListener('pointermove',move);
 window.addEventListener('pointerup',stop);
 window.addEventListener('pointercancel',stop);
});
