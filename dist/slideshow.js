import {readFrameEnergy} from './frame-energy.js';

const $ = id => document.getElementById(id);
const frames = [];
let current = 0;
let currentBlock = null;
let busy = true;
let showNumbers = false;
let drawStructure = () => {};
let baseName = 'trajectory';
let reference = -1;

function status(message) {
  $('slideStatus').textContent = message;
}

function syncButtons() {
  const unavailable = busy || !currentBlock;
  $('prev').disabled = unavailable || current === 0;
  $('next').disabled = unavailable || current === frames.length - 1;
  for (const id of ['numbers','importFrame','downloadFrame','importAll','importMany']) {
    $(id).disabled = unavailable;
  }
}

async function readBlock(index) {
  for await (const block of Mol.parseFile(frames[index].raw)) {
    if (!block.error) return block;
  }
  throw Error('フレーム '+(index+1)+' を読み込めません。');
}

function drawPlot() {
  const canvas = $('energyPlot'), ctx = canvas.getContext('2d');
  const points = [];
  const referenceEnergy = frames[reference]?.energy;
  let min = 0, max = 0;
  frames.forEach(({energy}, index) => {
    if (energy === null) return;
    const delta = energy - referenceEnergy;
    if (!Number.isFinite(delta)) return;
    min = Math.min(min, delta);
    max = Math.max(max, delta);
    points.push({index, delta});
  });
  if (min === max) {min -= 1; max += 1;}
  const left = 90, top = 24, right = 552, bottom = 348;
  const x = index => left+(right-left)*index/Math.max(1,frames.length-1);
  const y = energy => bottom-(bottom-top)*(energy-min)/(max-min);
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.font = '23px system-ui';
  ctx.fillStyle = '#a8b6b2';
  ctx.strokeStyle = '#34413f';
  ctx.textAlign = 'right';
  for (let i=0;i<=4;i++) {
    const value = min+(max-min)*i/4, py = y(value);
    ctx.beginPath();ctx.moveTo(left,py);ctx.lineTo(right,py);ctx.stroke();
    ctx.fillText(Number(value.toPrecision(3)).toString(),left-9,py+7);
  }
  ctx.textAlign = 'center';
  ctx.fillText('フレーム', (left+right)/2, 408);
  ctx.textAlign = 'left';
  ctx.fillText('1',left,378);
  if (frames.length>1) {
    ctx.textAlign = 'right';
    ctx.fillText(String(frames.length),right,378);
  }
  ctx.save();ctx.translate(21,(top+bottom)/2);ctx.rotate(-Math.PI/2);
  ctx.textAlign = 'center';ctx.fillText('ΔE (kJ/mol)',0,0);ctx.restore();
  ctx.fillStyle = '#62d6bf';
  ctx.beginPath();
  for (const point of points) {
    const px=x(point.index),py=y(point.delta);
    ctx.moveTo(px+3,py);ctx.arc(px,py,3,0,Math.PI*2);
  }
  ctx.fill();
  const selected = points.find(point => point.index === current);
  if (selected) {
    ctx.strokeStyle = '#ffd98f';ctx.lineWidth = 3;
    ctx.beginPath();ctx.arc(x(current),y(selected.delta),8,0,Math.PI*2);ctx.stroke();
    ctx.lineWidth = 1;
  }
}

async function showFrame(index) {
  busy = true;
  syncButtons();
  try {
    currentBlock = await readBlock(index);
    current = index;
    $('frameCount').textContent = (current+1)+' / '+frames.length;
    $('atomCount').textContent = '原子数 '+currentBlock.atoms.length;
    const energy = frames[current].energy;
    $('frameEnergy').textContent = energy === null
      ? '2行目に読み取れるエネルギーがありません。'
      : '基準から '+(energy-frames[reference].energy).toFixed(3)+' kJ/mol';
    drawPlot();
    drawStructure(true);
    status('');
  } catch (error) {
    status(error.message);
  } finally {
    busy = false;
    syncButtons();
  }
}

async function setupView() {
  const graphics = await Mol.graphics, {T, OrbitControls} = graphics;
  const view = $('view'), labels = $('frameNumbers'), ctx = labels.getContext('2d');
  const scene = new T.Scene(), camera = new T.PerspectiveCamera(40,1,.01,2000);
  const renderer = new T.WebGLRenderer({antialias:true});
  scene.background = new T.Color(0x101515);
  graphics.light(scene);
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  view.prepend(renderer.domElement);
  const controls = new OrbitControls(camera,renderer.domElement);
  controls.mouseButtons = {LEFT:T.MOUSE.ROTATE,MIDDLE:T.MOUSE.PAN,RIGHT:null};
  const projected = new T.Vector3();
  let model;
  drawStructure = rebuild => {
    if (rebuild && currentBlock) {
      if (model) {scene.remove(model);graphics.dispose(model);}
      model = graphics.model(currentBlock.atoms);
      scene.add(model);
    }
    renderer.render(scene,camera);
    if (!showNumbers || !currentBlock) return;
    const {width,height} = labels;
    ctx.clearRect(0,0,width,height);
    ctx.font = 'bold 12px system-ui';
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#fff';
    ctx.fillStyle = '#183438';
    currentBlock.atoms.forEach((atom,index) => {
      projected.set(atom.x,atom.y,atom.z).project(camera);
      if (Math.abs(projected.x)>1 || Math.abs(projected.y)>1 || Math.abs(projected.z)>1) return;
      const x=(projected.x+1)*width/2,y=(1-projected.y)*height/2-9;
      ctx.strokeText(String(index+1),x,y);
      ctx.fillText(String(index+1),x,y);
    });
  };
  const resize = () => {
    const w = Math.max(1,view.clientWidth), h = Math.max(1,view.clientHeight);
    renderer.setSize(w,h);
    labels.width=w;labels.height=h;
    camera.aspect=w/h;
    camera.updateProjectionMatrix();
    drawStructure(false);
  };
  graphics.fit(camera,currentBlock.atoms,controls.target);
  controls.update();
  controls.addEventListener('change',()=>drawStructure(false));
  new ResizeObserver(resize).observe(view);
  resize();
  drawStructure(true);
}

async function registerFrames(ranges) {
  if (busy) return;
  busy = true;
  syncButtons();
  const job = new MolJobs.ImportJob(() => status('取り込み中 · '+job.stats.registered+' 件登録済み'));
  try {
    for (let i=0;i<frames.length;i++) {
      if (ranges && !ranges.some(([first,last]) => i+1>=first && i+1<=last)) continue;
      const block = i===current ? currentBlock : await readBlock(i);
      await job.add(block,baseName+'('+(i+1)+')');
    }
    await job.flush();
    status(job.stats.registered+' 件をライブラリに取り込みました。');
  } catch (error) {
    status('取り込みを中断しました。登録済み '+job.stats.registered+' 件。'+(job.stats.fatal || error.message));
  } finally {
    busy = false;
    syncButtons();
  }
}

$('prev').onclick = () => showFrame(current-1);
$('next').onclick = () => showFrame(current+1);
$('numbers').onclick = () => {
  showNumbers = !showNumbers;
  $('frameNumbers').hidden = !showNumbers;
  $('numbers').setAttribute('aria-pressed',String(showNumbers));
  $('numbers').textContent = showNumbers ? '原子番号を非表示' : '原子番号を表示';
  drawStructure(false);
};
$('downloadFrame').onclick = async () => {
  const index = current;
  try {
    Mol.downloadBlob(await Mol.output({raw:frames[index].raw}),Mol.safeName(baseName+'('+(index+1)+')')+'.xyz');
  } catch (error) {status(error.message);}
};
$('importFrame').onclick = () => registerFrames([[current+1,current+1]]);
$('importAll').onclick = () => registerFrames();
$('importMany').onclick = () => {
  $('ranges').value = '';
  $('rangeError').textContent = '';
  $('rangesDialog').showModal();
};
$('rangeClose').onclick = () => $('rangesDialog').close();
$('rangesForm').onsubmit = event => {
  event.preventDefault();
  try {
    const ranges = Mol.parseFrameRanges($('ranges').value,frames.length);
    $('rangesDialog').close();
    void registerFrames(ranges);
  } catch (error) {$('rangeError').textContent = error.message;}
};

async function init() {
  const params = new URLSearchParams(location.hash.slice(1)), source = params.get('source');
  if (!source || !source.startsWith('blob:'+location.origin+'/')) {
    throw Error('ライブラリで複数構造入りのXYZを開き、スライドショーを選んでください。');
  }
  const name = params.get('name') || 'trajectory.xyz';
  baseName = name.replace(/\.xyz$/i,'');
  $('title').textContent = name;
  document.title = name+' — 構造のスライドショー';
  const response = await fetch(source);
  if (!response.ok) throw Error('元のXYZを読み込めません。ライブラリから開き直してください。');
  const file = await response.blob();
  URL.revokeObjectURL(source);
  let skipped = 0;
  for await (const block of Mol.parseFile(file)) {
    if (block.error) {skipped++;continue;}
    frames.push({raw:new Blob(block.rawParts),energy:readFrameEnergy(block.comment)});
  }
  if (!frames.length) throw Error('表示できる構造がありません。');
  reference = frames.findIndex(frame => frame.energy !== null);
  $('energyHint').textContent = reference < 0 ? '2行目に読み取れるエネルギーがありません。'
    : '基準はフレーム '+(reference+1)+'。単位のないエネルギーは Eh として換算します。'
      +(reference>0?' フレーム1にはエネルギーがありません。':'');
  await showFrame(0);
  try {await setupView();}
  catch (error) {
    $('view').querySelector('.view-label').textContent = '3D表示を開始できません · '+error.message;
  }
  if (skipped) status('解析できない行・ブロック '+skipped+' 件をスキップしました。');
}

init().catch(error => status(error.message));
