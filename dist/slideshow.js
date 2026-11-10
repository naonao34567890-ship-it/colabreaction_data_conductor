import {readFrameEnergy} from './frame-energy.js';

import {readEnergy} from './dmf-energy.js';

const reaction = document.body.dataset.viewer === 'reaction';
const $ = id => document.getElementById(id);
const frames = [];
let current = 0;
let currentBlock = null;
let busy = true;
let showNumbers = false;
let drawStructure = () => {};
let baseName = 'trajectory';
let reference = -1;
let plottedPoints = [];
let captureImage, imageSaving = false;
const imageChannelId = reaction && new URLSearchParams(location.hash.slice(1)).get('images');
const imageSavingEnabled = new URLSearchParams(location.hash.slice(1)).get('imageSaving') === '1';
const imageChannel = imageChannelId && new BroadcastChannel('reaction-images:' + imageChannelId);

if (imageChannel) {
  window.addEventListener('pagehide', () => {
    imageChannel.postMessage({close:true});
    imageChannel.close();
  });
  for (const target of ['START','FINAL']) {
    const button = $(target === 'START' ? 'saveStartImage' : 'saveFinalImage');
    button.onclick = async () => {
      imageSaving = true;
      syncButtons();
      try {
        const image = await captureImage();
        const id = crypto.randomUUID();
        await new Promise((resolve,reject) => {
          function finish(event) {
            if (event && event.data?.id !== id) return;
            clearTimeout(timer);
            imageChannel.removeEventListener('message',finish);
            if (!event) reject(Error('保存結果を確認できません。Colab計算記録のタブが開いているか確認してください。'));
            else if (event.data.error) reject(Error(event.data.error));
            else resolve();
          }
          const timer = setTimeout(finish,30000);
          imageChannel.addEventListener('message',finish);
          imageChannel.postMessage({id,target,image});
        });
        status(target+'画像を更新しました。');
      } catch (error) { status(error.message); }
      finally { imageSaving = false; syncButtons(); }
    };
  }
}

function status(message) {
  $('slideStatus').textContent = message;
}

function syncButtons() {
  const unavailable = busy || !currentBlock;
  $('prev').disabled = unavailable || current === 0;
  $('next').disabled = unavailable || current === frames.length - 1;
  $('prevTen').disabled = $('prev').disabled;
  $('nextTen').disabled = $('next').disabled;
  if (reaction) {
    $('saveStartImage').disabled = $('saveFinalImage').disabled = unavailable || !imageSavingEnabled || !imageChannel || !captureImage || imageSaving;
  }
  for (const id of ['importStart','importFinish','importFrameEdit']) $(id).disabled = unavailable;
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
  plottedPoints = points.map(point => ({index:point.index,x:x(point.index),y:y(point.delta)}));
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

if (reaction) $('energyPlot').addEventListener('click',event => {
  if (busy) return;
  const canvas = event.currentTarget;
  const rect = canvas.getBoundingClientRect();
  let nearest, distance = 14;
  for (const point of plottedPoints) {
    const d = Math.hypot(event.clientX - rect.left - point.x * rect.width / canvas.width,
      event.clientY - rect.top - point.y * rect.height / canvas.height);
    if (d < distance) { nearest = point; distance = d; }
  }
  if (nearest) void showFrame(nearest.index);
});

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
  if (imageChannel) {
    captureImage = () => {
      drawStructure(false);
      const canvas = document.createElement('canvas');
      canvas.width = renderer.domElement.width;
      canvas.height = renderer.domElement.height;
      const context = canvas.getContext('2d');
      context.drawImage(renderer.domElement,0,0);
      if (showNumbers) context.drawImage(labels,0,0,canvas.width,canvas.height);
      return new Promise((resolve,reject) => canvas.toBlob(blob =>
        blob ? resolve(blob) : reject(Error('画像を作成できませんでした。')), 'image/png'));
    };
    syncButtons();
  }
}

async function registerFrames(ranges) {
  if (busy) return;
  busy = true;
  syncButtons();
  let firstSaved;
  const job = new MolJobs.ImportJob(event => {
    if (event.type === 'saved') firstSaved ??= event.items[0];
    status('取り込み中 · '+job.stats.registered+' 件登録済み');
  });
  try {
    for (let i=0;i<frames.length;i++) {
      if (ranges && !ranges.some(([first,last]) => i+1>=first && i+1<=last)) continue;
      const block = i===current ? currentBlock : await readBlock(i);
      await job.add(block,baseName+'('+(i+1)+')');
    }
    await job.flush();
    status(job.stats.registered+' 件をライブラリに取り込みました。');
    return firstSaved;
  } catch (error) {
    status('取り込みを中断しました。登録済み '+job.stats.registered+' 件。'+(job.stats.fatal || error.message));
  } finally {
    busy = false;
    syncButtons();
  }
}

$('prevTen').onclick = () => showFrame(Math.max(0,current-10));
$('nextTen').onclick = () => showFrame(Math.min(frames.length-1,current+10));
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
    Mol.downloadBlob(Mol.calculationOutput(currentBlock),Mol.safeName(baseName+'('+(index+1)+')')+'.xyz');
  } catch (error) {status(error.message);}
};
$('importFrame').onclick = () => registerFrames([[current+1,current+1]]);
let lastReactionId;
function endpointRecord(block,name,slot) {
  return {
    name:name+'_'+slot, atoms:block.atoms,
    raw:Mol.calculationOutput(block), comment:'', edited:true,
    revision:crypto.randomUUID(),
  };
}

async function saveEndpoint(finish, openEditor = false) {
  if (busy || !currentBlock) return;
  const tab = openEditor ? window.open('about:blank','_blank') : null;
  if (openEditor && !tab) { status('エディタのタブを開けませんでした。'); return; }
  if (tab) tab.opener = null;
  busy = true;
  syncButtons();
  try {
    const name = Mol.safeName(baseName.replace(/[_＿](?:START|FINISH)$/i,''));
    const slot = finish ? 'FINISH' : 'START';
    const structure = endpointRecord(currentBlock,name,slot);
    let saved;
    if (finish) {
      let target = lastReactionId && await ReactionStore.read(lastReactionId);
      if (!target) {
        const candidates = (await ReactionStore.read()).filter(item=>item.name===name && item.START);
        if (candidates.length!==1) throw Error(candidates.length ? '同名の反応が複数あります。' : '同名の出発物が見つかりません。');
        target = candidates[0];
      }
      if (target.FINISH && !await Mol.confirmFileAction('生成物の上書き',target.name+'_FINISH を上書きしますか？','生成物を上書きする')) return;
      structure.name = target.name+'_FINISH';
      saved = await ReactionStore.update(target.id,{FINISH:structure},current=>
        !!current.FINISH===!!target.FINISH && current.FINISH?.revision===target.FINISH?.revision);
    } else {
      saved = await ReactionStore.create('START',structure,name);
    }
    lastReactionId = saved.id;
    status(saved.name+'_'+slot+' を反応ライブラリに保存しました。');
    if (tab && !tab.closed) tab.location.replace(new URL('editor.html?'+new URLSearchParams({reaction:saved.id,slot}),location.href));
  } catch (error) {
    tab?.close();
    status(error.message);
  } finally {
    busy = false;
    syncButtons();
  }
}
$('importStart').onclick = () => void saveEndpoint(false);
$('importFinish').onclick = () => void saveEndpoint(true);
$('importFrameEdit').onclick = () => void saveEndpoint(false,true);
$('importAll').onclick = () => registerFrames();
$('importMany').onclick = () => {
  if (reaction) {
    $('startFrame').max = $('finishFrame').max = frames.length;
    $('startFrame').value = 1;
    $('finishFrame').value = frames.length;
  } else $('ranges').value = '';
  $('rangeError').textContent = '';
  $('rangesDialog').showModal();
};
$('rangeClose').onclick = () => $('rangesDialog').close();
$('rangesForm').onsubmit = async event => {
  event.preventDefault();
  if (reaction) {
    if (busy) return;
    const first = $('startFrame').valueAsNumber, last = $('finishFrame').valueAsNumber;
    if (![first,last].every(n=>Number.isInteger(n)&&n>=1&&n<=frames.length) || first===last) {
      $('rangeError').textContent = '範囲内の異なるフレーム番号を指定してください。';
      return;
    }
    busy = true;
    syncButtons();
    const submit = event.currentTarget.querySelector('[type=submit]');
    submit.disabled = true;
    $('rangeError').textContent = '';
    try {
      const start = await readBlock(first-1), finish = await readBlock(last-1);
      if (start.atoms.length!==finish.atoms.length || start.atoms.some((atom,i)=>atom.el!==finish.atoms[i].el)) {
        throw Error('出発物と生成物の原子数または元素の並びが一致しません。');
      }
      const name = Mol.safeName(baseName.replace(/[_＿](?:START|FINISH)$/i,''));
      const saved = await ReactionStore.createReaction({
        START:endpointRecord(start,name,'START'),
        FINISH:endpointRecord(finish,name,'FINISH'),
      },name);
      lastReactionId = saved.id;
      $('rangesDialog').close();
      status(saved.name+' を反応ライブラリに保存しました（#'+first+' → #'+last+'）。');
    } catch (error) {
      $('rangeError').textContent = error.message;
    } finally {
      submit.disabled = false;
      busy = false;
      syncButtons();
    }
    return;
  }
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
  baseName = name.replace(/\.(?:py)?xyz$/i,'');
  $('title').textContent = name;
  const suffix = ' — ' + (reaction?'反応経路ビューア':'構造のスライドショー');
  document.title = name + suffix;
  if (!reaction || imageChannel) Mol.editName($('title'),async value=>{
    let renamed = Mol.safeName(value);
    if (reaction) renamed = await new Promise((resolve,reject)=>{
      const id = crypto.randomUUID();
      const cleanup = () => imageChannel.removeEventListener('message',reply);
      const timeout = setTimeout(()=>{
        cleanup();
        reject(Error('計算記録の一覧を開いた状態で再試行してください。'));
      },20000);
      function reply({data}) {
        if (data?.id !== id) return;
        clearTimeout(timeout);
        cleanup();
        if (data.error) reject(Error(data.error));
        else resolve(data.name);
      }
      imageChannel.addEventListener('message',reply);
      imageChannel.postMessage({id,name:renamed});
    });
    baseName = renamed.replace(/\.(?:py)?xyz$/i,'');
    document.title = renamed + suffix;
    return renamed;
  },status);
  const response = await fetch(source);
  if (!response.ok) throw Error('元のXYZを読み込めません。ライブラリから開き直してください。');
  const file = await response.blob();
  URL.revokeObjectURL(source);
  let csvPoints;
  const energySource = params.get('energy');
  if (reaction && energySource?.startsWith('blob:'+location.origin+'/')) {
    try {
      const csv = await fetch(energySource);
      if (csv.ok) csvPoints = new Map(readEnergy(await csv.text()));
    } catch { /* Fall back to the trajectory comments. */ }
    finally { URL.revokeObjectURL(energySource); }
  }
  let skipped = 0;
  for await (const block of Mol.parseFile(file)) {
    if (block.error) {skipped++;continue;}
    frames.push({raw:new Blob(block.rawParts),energy:csvPoints ? csvPoints.get(frames.length+skipped) ?? null :
      readFrameEnergy(reaction && /(?:^|\s)energy=/.test(block.comment)
        ? (block.comment.match(/(?:^|\s)energy=([^\s]+)/)?.[1] ?? '')+' eV' : block.comment)});
  }
  if (!frames.length) throw Error('表示できる構造がありません。');
  reference = frames.findIndex(frame => frame.energy !== null);
  $('energyHint').textContent = reference < 0 ? '2行目に読み取れるエネルギーがありません。'
    : '基準はフレーム '+(reference+1)+'。単位のないエネルギーは Eh として換算します。'
      +(reference>0?' フレーム1にはエネルギーがありません。':'');
  if (csvPoints) $('energyHint').textContent = 'DMF_energy.csv · 点をクリックすると対応する構造へ移動します。';
  await showFrame(0);
  try {await setupView();}
  catch (error) {
    $('view').querySelector('.view-label').textContent = '3D表示を開始できません · '+error.message;
  }
  if (skipped) status('解析できない行・ブロック '+skipped+' 件をスキップしました。');
}

init().catch(error => status(error.message));
