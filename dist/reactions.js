'use strict';

const days = document.getElementById('reactionDays');
const status = document.getElementById('reactionStatus');
const dayKey = new Intl.DateTimeFormat('ja-JP',{dateStyle:'long'});
let renderer;
const previews = new WeakMap();
const observer = new IntersectionObserver(async entries=>{
 for (const {target,isIntersecting} of entries) {
  if (!isIntersecting) continue;
  observer.unobserve(target);
  try {
   const graphics = await Mol.graphics;
   if (!target.isConnected) continue;
   const atoms = previews.get(target);
   const {T} = graphics;
   if (!renderer) {
    renderer = new T.WebGLRenderer({alpha:true,antialias:true});
    renderer.setSize(256,150);
   }
   const scene = new T.Scene();
   const camera = new T.PerspectiveCamera(38,256/150,.01,2000);
   const model = graphics.model(atoms);
   try {
    scene.add(model);
    graphics.light(scene);
    graphics.fit(camera,atoms);
    renderer.render(scene,camera);
    const image = new Image();
    image.alt = 'START構造';
    image.src = renderer.domElement.toDataURL('image/png');
    target.replaceChildren(image);
   } finally { graphics.dispose(model); }
  } catch { target.textContent = 'サムネイルを表示できません'; }
 }
});

function cardFor(reaction) {
 const card = document.createElement('article');
 card.className = 'reaction-card';
 const header = document.createElement('div');
 header.className = 'row';
 const title = document.createElement('h3');
 title.textContent = reaction.name;
 const rename = document.createElement('button');
 rename.textContent = '✎';
 rename.setAttribute('aria-label','反応名を変更');
 rename.onclick = () => title.dispatchEvent(new MouseEvent('dblclick'));
 Mol.editName(title,async name=>{
  const saved = await ReactionStore.update(reaction.id,{name:Mol.safeName(name)});
  await renderReactions();
  return saved.name;
 },message=>{status.textContent=message;});
 header.append(title,rename);
 const preview = document.createElement('div');
 preview.className = 'reaction-preview muted';
 preview.textContent = reaction.START ? 'STARTを描画中…' : 'START未作成';
 if (reaction.START) {
  previews.set(preview,reaction.START.atoms);
  observer.observe(preview);
 }
 card.append(header,preview);
 for (const slot of ['START','FINISH']) {
  const row = document.createElement('div');
  row.className = 'row reaction-slot';
  const name = document.createElement('span');
  const structure = reaction[slot];
  name.textContent = reaction.name+'_'+slot+(structure?'':' · 未作成');
  const download = document.createElement('button');
  download.textContent = '↓';
  download.setAttribute('aria-label',slot+'をダウンロード');
  download.disabled = !structure;
  if (structure) {
   const open = () => window.open('editor.html?'+new URLSearchParams({reaction:reaction.id,slot}),'_blank','noopener');
   name.className = 'structure-name';
   name.tabIndex = 0;
   name.setAttribute('role','button');
   name.title = 'ダブルクリックでエディタを開く';
   name.ondblclick = open;
   name.onkeydown = event => { if (event.key==='Enter') open(); };
   download.onclick = () => Mol.downloadBlob(Mol.calculationOutput(structure),Mol.safeName(reaction.name+'_'+slot)+'.xyz');
  }
  row.append(name,download);
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
  status.textContent = reactions.length ? '' : '分子エディタの「反応に保存」から登録できます。';
 } catch (error) {
  if (revision === renderRevision) status.textContent = error.message;
 }
}
window.addEventListener('focus',renderReactions);
void renderReactions();
