'use strict';

const control = id=>document.getElementById(id);
const selected = new Set();
let records = [];
let changing = false, duplicating = false;
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
   if(reaction._summary){
    const full=await ReactionStore.read(reaction.id);
    if(!target.isConnected)return;
    if(!full){void renderReactions();continue;}
    const card=cardFor(full);
    target.closest('.reaction-card').replaceWith(card);
    selectionUI();
    continue;
   }
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
 if(reaction._summary){
  preview.textContent='構造を読み込み中…';
  previews.set(preview,reaction);observer.observe(preview);
  card.append(header,preview);
  if(reaction.classification){const cls=document.createElement('p');cls.className='muted';cls.textContent='分類：'+reaction.classification;card.append(cls);}
  if(reaction.tags?.length){const tags=document.createElement('p');tags.className='muted';tags.textContent=reaction.tags.join(' · ');card.append(tags);}
  return card;
 }
 preview.textContent = reaction.START ? 'STARTを描画中…' : 'START未作成';
 if (reaction.START) {
  previews.set(preview,reaction);
  observer.observe(preview);
 }
 card.append(header,preview);
 if(reaction.classification){const cls=document.createElement('p');cls.className='muted';cls.textContent='分類：'+reaction.classification;card.append(cls);}
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

function reactionSort(a,b){
 const order=control('reactionOrder').value;
 if(order==='classification'){
  const ca=a.classification||'',cb=b.classification||'';
  if(Boolean(ca)!==Boolean(cb))return ca?-1:1;
  return Mol.compareTagNames(ca,cb)||b.createdAt-a.createdAt;
 }
 if(order==='added-desc')return b.createdAt-a.createdAt;
 if(order==='added-asc')return a.createdAt-b.createdAt;
 if(order==='name-asc')return Mol.compareTagNames(a.name,b.name);
 if(order==='name-desc')return Mol.compareTagNames(b.name,a.name);
 return a.id.localeCompare(b.id);
}
control('reactionOrder').onchange=()=>void renderReactions();
let renderRevision = 0;
async function renderReactions() {
 const revision = ++renderRevision;
 try {
  const reactions = (await ReactionStore.list()).sort(reactionSort);
  if (revision !== renderRevision) return;
  records = reactions;
  const count=control('reactionCount');if(count)count.textContent=reactions.length.toLocaleString()+' 反応';
  const ids = new Set(records.map(item=>item.id));
  for (const id of selected) if (!ids.has(id)) selected.delete(id);
  observer.disconnect();
  const content = document.createDocumentFragment();
  let previous, grid;
  for (const reaction of reactions) {
   const day=control('reactionOrder').value==='classification'?(reaction.classification||'未分類'):control('reactionOrder').value.startsWith('added-')?dayKey.format(reaction.createdAt):'すべての反応';
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
// A completed account-scoped Drive refresh must redraw the list too.
// Focus can render before that refresh finishes; focus alone misses the new head.
document.addEventListener('drive-store-updated',renderReactions);
window.addEventListener('focus',renderReactions);
void renderReactions();

function selectionUI() {
 control('reactionImport').disabled=changing;
 control('reactionImportFile').disabled=changing;
 control('reactionArchiveAll').disabled=changing||!records.length;
 for(const card of days.querySelectorAll('.reaction-card')) {
  const active=selected.has(card.dataset.id);
  card.classList.toggle('selected',active);
 }
 for(const id of ['reactionTag','reactionDelete','reactionZip','reactionArchive','reactionDuplicate','reactionClassify'])control(id).disabled=changing||!selected.size;
 control('reactionSelection').textContent=selected.size+' 件選択中';
}
function selectCard(id,additive) {
 const remove=additive&&selected.has(id);
 if(!additive)selected.clear();
 if(remove)selected.delete(id);else selected.add(id);
 selectionUI();
}

/* Clipboard: preserve complete reaction records, but allocate new IDs on paste. */
async function copyReactions(){
 if(changing||!selected.size)return;
 const items=(await Promise.all([...selected].map(id=>ReactionStore.read(id)))).filter(Boolean);
 await MolClipboard.copy('reactions',items);
 status.textContent=items.length+' 件の反応をコピーしました。';
}
async function pasteReactions(){
 if(changing)return;
 const items=await MolClipboard.paste('reactions');
 if(!items?.length)return;
 changing=true;selectionUI();
 try{
  let copied=0;
  for(const item of items){
   if(typeof item.name!=='string'||!item.name||
      !['START','FINISH'].some(slot=>Array.isArray(item[slot]?.atoms)&&item[slot].atoms.length))continue;
   // Preserve even scientifically questionable but structurally valid saved metadata.
   const {id,createdAt,name,startPreview,_driveFileId,...rest}=item;
   await ReactionStore.createReaction(rest,name);
   copied++;
  }
  await renderReactions();
  status.textContent=copied+' 件の反応を貼り付けました。';
 }finally{changing=false;selectionUI();}
}
async function duplicateReactions(){
 if(changing||duplicating||!selected.size)return;
 duplicating=true;changing=true;selectionUI();
 try {
  const used=new Set((await ReactionStore.list()).map(r=>r.name));
  const ids=[...selected];
  const originals=await Promise.all(ids.map(id=>ReactionStore.read(id)));
  if(originals.some(record=>!record))throw Error('選択した反応が見つかりません。再読み込みしてください。');
  let copied=0;
  for(const item of originals){
   const {id,createdAt,name,startPreview,_driveFileId,...rest}=structuredClone(item);
   await ReactionStore.createReaction(rest,Mol.nextDuplicateName(name,used));
   copied++;
  }
  await renderReactions();
  status.textContent=copied+' 件の反応を複製しました。';
 }finally{duplicating=false;changing=false;selectionUI();}
}
control('reactionDuplicate').onclick=()=>void duplicateReactions().catch(e=>status.textContent='複製に失敗しました: '+e.message);


window.addEventListener('keydown',event=>{
 if(!(event.ctrlKey||event.metaKey)||event.altKey||event.shiftKey||MolClipboard.editable(event))return;
 const key=event.key.toLowerCase();
 if(key==='c'&&selected.size){event.preventDefault();void copyReactions().catch(e=>status.textContent=e.message);}
 if(key==='v'){event.preventDefault();void pasteReactions().catch(e=>status.textContent=e.message);}
});
/* Classification: assign/remove/rename on the reaction record itself. */
control('reactionClassify').onclick=()=>{
 const names=[...new Set(records.map(x=>x.classification).filter(Boolean))].sort(Mol.compareTagNames);
 control('reactionClassificationNames').replaceChildren(...names.map(n=>new Option(n)));
 control('reactionClassificationName').value='';
 control('reactionClassificationDialog').showModal();
};
control('reactionClassificationCancel').onclick=()=>control('reactionClassificationDialog').close();
async function applyClassification(ids,value){
 await ReactionStore.classify(ids,value);
 await renderReactions();
}
control('reactionClassificationApply').onclick=()=>void changeSelection(async ids=>{
 const value=control('reactionClassificationName').value.trim();
 if(!value||new TextEncoder().encode(value).length>100)throw Error('分類名はUTF-8で100バイト以内にしてください。');
 await applyClassification(ids,value);
 control('reactionClassificationDialog').close();
});
control('reactionClassificationRemove').onclick=()=>void changeSelection(async ids=>{
 await applyClassification(ids,null);
 control('reactionClassificationDialog').close();
});
control('reactionClassificationRename').onclick=async()=>{
 if(changing||!selected.size)return;
 const oldNames=new Set(records.filter(r=>selected.has(r.id)).map(r=>r.classification).filter(Boolean));
 const name=control('reactionClassificationName').value.trim();
 if(oldNames.size!==1){status.textContent='同一分類の反応を選んでください。';return;}
 if(!name||new TextEncoder().encode(name).length>100){status.textContent='分類名はUTF-8で100バイト以内にしてください。';return;}
 const from=[...oldNames][0];
 changing=true;selectionUI();
 try{await applyClassification(records.filter(r=>r.classification===from).map(r=>r.id),name);control('reactionClassificationDialog').close();}
 catch(e){status.textContent=e.message;}finally{changing=false;selectionUI();}
};

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
async function importReactionZip(file) {
 if(changing||!file)return;
 changing=true;selectionUI();
 try{
  const {records:incoming}=await ReactionArchive.read(file,{progress:(done,total)=>{status.textContent=`ZIPの内容を検証中… ${done} / ${total} 件`;}});
  if(!await Mol.confirmFileAction('反応ZIPを取り込む',incoming.length+' 件の反応を現在の保存先へ取り込みます。同じID・同じ内容はスキップし、異なる内容は上書きせず停止します。'+Mol.electronicWarningText(incoming),'取り込む')){status.textContent='取り込みをキャンセルしました。';return;}
  status.textContent='反応を保存中… タブを閉じないでください。';
  const result=await ReactionStore.importRecords(incoming);
  await renderReactions();
  status.textContent=result.added+' 件を取り込みました。同じ内容の '+result.skipped+' 件は登録済みのためスキップしました。';
 }catch(error){status.textContent='取り込みできませんでした：'+error.message;}
 finally{changing=false;selectionUI();control('reactionImportFile').value='';}
}
control('reactionImport').onclick=()=>control('reactionImportFile').click();
control('reactionImportFile').onchange=event=>void importReactionZip(event.target.files[0]);
// The entire catalogue accepts external file drops; the drop hint is not a target boundary.
document.addEventListener('dragover',event=>{
 if(!event.dataTransfer?.types.includes('Files'))return;
 event.preventDefault();
 event.dataTransfer.dropEffect=changing?'none':'copy';
});
document.addEventListener('drop',event=>{
 if(!event.dataTransfer?.types.includes('Files'))return;
 event.preventDefault();
 if(changing)return;
 const files=[...event.dataTransfer.files];
 if(files.length!==1||!/\.zip$/i.test(files[0].name)){
  status.textContent='対応情報付き反応ZIPを1つずつドロップしてください。';return;
 }
 void importReactionZip(files[0]);
});
window.addEventListener('beforeunload',event=>{if(changing){event.preventDefault();event.returnValue='';}});
async function downloadReactionArchive(ids) {
 const chosen=new Set(ids);
 const items=[];
 const keys=[...chosen];
 for(let i=0;i<keys.length;i+=4)items.push(...(await Promise.all(keys.slice(i,i+4).map(id=>ReactionStore.read(id)))).filter(Boolean));
 if(items.length!==chosen.size)throw Error('反応が別のタブで削除されました。再読み込みしてください。');
 await ReactionArchive.download(items,(done,total)=>{status.textContent=`対応情報付きZIPを作成中… ${done} / ${total} 件`;});
 status.textContent=items.length+' 件の反応を対応情報付きZIPで保存しました。';
}
control('reactionArchive').onclick=()=>void changeSelection(downloadReactionArchive);
control('reactionArchiveAll').onclick=async()=>{
 if(changing)return;
 changing=true;selectionUI();
 try{await downloadReactionArchive((await ReactionStore.list()).map(item=>item.id));}
 catch(error){status.textContent=error.message;}
 finally{changing=false;selectionUI();}
};
control('reactionZip').onclick=()=>void changeSelection(async ids=>{
 const chosen=new Set(ids);
 const usedNames=new Set();
 const bodies=[];
 for(const summary of records.filter(item=>chosen.has(item.id))) {
  const reaction=await ReactionStore.read(summary.id);
  if(!reaction)throw Error('反応が削除されました。再読み込みしてください。');
  const base=Mol.safeName(reaction.name);
  let name=base;
  if(usedNames.has(name))name=Mol.nextDuplicateName(name,usedNames);
  else usedNames.add(name);
  for(const slot of ['START','FINISH']) {
   if(reaction[slot])bodies.push({...reaction[slot],name:name+'_'+slot});
  }
 }
 if(!bodies.length)throw Error('ダウンロードできる構造がありません。');
 const chunks=[];
 await MolJobs.exportData(bodies.map((_,index)=>index),'zip',bytes=>chunks.push(bytes),()=>false,()=>{},false,bodies);
 const label=chosen.size===1?Mol.safeName(records.find(item=>chosen.has(item.id))?.name||'reaction'):'reactions ('+chosen.size+')';
  Mol.downloadBlob(new Blob(chunks,{type:'application/zip'}),label+'.zip');
});

/* Marquee coordinates remain anchored to the reaction list during scrolling. */
days.style.position='relative';
const reactionScroll=document.querySelector('.reaction-workspace');
let reactionMarquee=null;
function drawReactionMarquee(){
 const m=reactionMarquee;if(!m?.active)return;
 const bounds=days.getBoundingClientRect();
 const x=m.clientX-bounds.left,y=m.clientY-bounds.top;
 const left=Math.min(m.x,x),top=Math.min(m.y,y);
 const right=Math.max(m.x,x),bottom=Math.max(m.y,y);
 Object.assign(m.box.style,{left:left+'px',top:top+'px',width:right-left+'px',height:bottom-top+'px'});
 selected.clear();
 if(m.add)for(const id of m.original)selected.add(id);
 for(const card of days.querySelectorAll('.reaction-card')){
  const rect=card.getBoundingClientRect(),id=card.dataset.id;
  const l=rect.left-bounds.left,t=rect.top-bounds.top;
  if(l>right||l+rect.width<left||t>bottom||t+rect.height<top)continue;
  if(m.toggle&&m.original.has(id))selected.delete(id);else selected.add(id);
 }
 selectionUI();
}
function autoScrollReactionMarquee(){
 const m=reactionMarquee;if(!m?.active)return;
 const rect=reactionScroll.getBoundingClientRect(),edge=36;
 const dy=m.clientY<rect.top+edge?-Math.min(24,Math.ceil((rect.top+edge-m.clientY)/2)):
          m.clientY>rect.bottom-edge?Math.min(24,Math.ceil((m.clientY-rect.bottom+edge)/2)):0;
 if(dy){reactionScroll.scrollTop+=dy;drawReactionMarquee();}
 m.frame=requestAnimationFrame(autoScrollReactionMarquee);
}
days.addEventListener('pointerdown',event=>{
 if(event.button!==0||event.target.closest('button,input,.structure-name,h3'))return;
 const rect=days.getBoundingClientRect(),box=document.createElement('div');
 box.className='reaction-selection-box';
 reactionMarquee={pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,
  clientX:event.clientX,clientY:event.clientY,x:event.clientX-rect.left,y:event.clientY-rect.top,
  original:new Set(selected),add:event.shiftKey||event.ctrlKey||event.metaKey,
  toggle:event.ctrlKey||event.metaKey,box,active:false};
});
window.addEventListener('pointermove',event=>{
 const m=reactionMarquee;if(!m||m.pointerId!==event.pointerId)return;
 m.clientX=event.clientX;m.clientY=event.clientY;
 if(!m.active){
  if(Math.hypot(event.clientX-m.startX,event.clientY-m.startY)<6)return;
  m.active=true;days.append(m.box);m.frame=requestAnimationFrame(autoScrollReactionMarquee);
 }
 drawReactionMarquee();
});
reactionScroll.addEventListener('scroll',()=>drawReactionMarquee());
function finishReactionMarquee(event){
 const m=reactionMarquee;if(!m||m.pointerId!==event.pointerId)return;
 reactionMarquee=null;
 if(m.frame)cancelAnimationFrame(m.frame);m.box.remove();
 if(event.type==='pointercancel'){selected.clear();for(const id of m.original)selected.add(id);selectionUI();}
 else if(m.active){
  const suppress=e=>e.stopPropagation();
  window.addEventListener('click',suppress,{capture:true,once:true});
  setTimeout(()=>window.removeEventListener('click',suppress,true),0);
 }
}
window.addEventListener('pointerup',finishReactionMarquee);
window.addEventListener('pointercancel',finishReactionMarquee);
