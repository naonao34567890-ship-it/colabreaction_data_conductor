import {readFrameEnergy} from './frame-energy.js';

import {readEnergy} from './dmf-energy.js';
import {energyAxis, clampEnergy} from './energy-axis.js';

const reaction = document.body.dataset.viewer === 'reaction';
let sourceReactionContext=null;
if(reaction){
 try{
  const raw=new URLSearchParams(location.hash.slice(1)).get('reactionContext');
  if(raw && raw.length<100000){
   const context=JSON.parse(raw);
   if(context?.format==='mol-bench-reaction-context'&&context.version===2
    &&typeof context.name==='string'&&context.name.length<=200
    &&(context.classification==null||typeof context.classification==='string')
    &&Array.isArray(context.tags)&&context.tags.every(t=>typeof t==='string'))
      sourceReactionContext=context;
  }
 }catch(error){console.warn('反応メタデータを復元できません:',error);}
}
const $ = id => document.getElementById(id);
let fullSourceReactionPromise;
async function loadFullSourceReaction(){
 if(!reaction)return null;
 const url=new URLSearchParams(location.hash.slice(1)).get('sourceReactionArchive');
 if(!url)return null;
 if(!globalThis.ReactionArchive)throw Error('元反応データを読む機能がありません。');
 if(!fullSourceReactionPromise)fullSourceReactionPromise=(async()=>{
  const response=await fetch(url);
  if(!response.ok)throw Error('元反応ZIPを取得できませんでした。');
  const file=await response.blob();
  const result=await ReactionArchive.read(file);
  if(result.records.length!==1)throw Error('元反応の数が不正です。');
  return result.records[0];
 })();
 return fullSourceReactionPromise;
}
const frames = [];
let current = 0;
let currentBlock = null;
let busy = true;
let showNumbers = false;
let drawStructure = () => {};
let playing = false;
let playbackTimer = null;
let vibrationActive = false;
let reactionFrames;
let reactionIndex = 0;
let vibrationFile = '';
let vibrationNames;
let vibrationChannel;
const vibrationPending = new Map();
const vibrationChannelId = reaction && new URLSearchParams(location.hash.slice(1)).get('vibrationChannel');
if (vibrationChannelId) {
  vibrationChannel = new BroadcastChannel('reaction-vibrations:' + vibrationChannelId);
  vibrationChannel.onmessage = ({data}) => {
    const pending = vibrationPending.get(data?.requestId);
    if (!pending) return;
    vibrationPending.delete(data.requestId);
    clearTimeout(pending.timer);
    if (data.type === 'error') pending.reject(Error(data.message));
    else pending.resolve(data);
  };
  window.addEventListener('pagehide', () => {
    vibrationChannel.postMessage({type:'close'});
    vibrationChannel.close();
    for (const pending of vibrationPending.values()) {
      clearTimeout(pending.timer);
      pending.reject(Error('ビューアーを閉じました。'));
    }
    vibrationPending.clear();
  });
}
function requestVibration(type, name) {
  if (!vibrationChannel) return Promise.reject(Error('振動ファイルの通信先がありません。計算記録から開き直してください。'));
  const requestId = crypto.randomUUID();
  return new Promise((resolve,reject) => {
    const timer = setTimeout(() => {
      vibrationPending.delete(requestId);
      reject(Error('振動ファイルの取得がタイムアウトしました。元の計算記録タブを確認してください。'));
    },60000);
    vibrationPending.set(requestId,{resolve,reject,timer});
    vibrationChannel.postMessage({type,requestId,name});
  });
}
async function loadVibrationIndex() {
  if (vibrationNames) return vibrationNames;
  const response = await requestVibration('list');
  const names = response.names.filter(name=>/^local_maxima_\d+_vib_\d+\.xyz$/i.test(name));
  if (!names.length) throw Error('この計算記録に振動アニメーションXYZがありません。');
  vibrationNames = names;
  const peaks = [...new Set(vibrationNames.map(name=>Number(name.match(/maxima_(\d+)/i)[1])))].sort((a,b)=>a-b);
  const peakSelect = $('vibrationPeak');
  peakSelect.replaceChildren(...peaks.map(peak=>new Option('極大点 '+peak,String(peak))));
  updateVibrationModes();
  return vibrationNames;
}
function updateVibrationModes() {
  const peak = Number($('vibrationPeak').value);
  const modes = vibrationNames.filter(name=>Number(name.match(/maxima_(\d+)/i)[1])===peak)
    .map(name=>Number(name.match(/_vib_(\d+)\.xyz$/i)[1])).sort((a,b)=>a-b);
  $('vibrationMode').replaceChildren(...modes.map(mode=>new Option('Mode '+mode,String(mode))));
}
function currentVibrationName() {
  return 'local_maxima_'+$('vibrationPeak').value+'_vib_'+$('vibrationMode').value+'.xyz';
}
async function selectVibration() {
  stopPlayback();
  const fileName = currentVibrationName();
  $('vibrationPeak').disabled = $('vibrationMode').disabled = true;
  try {
    status('振動XYZを読み込み中… '+fileName);
    const response = await requestVibration('file',fileName);
    const file = new File([response.blob],fileName);
    const loaded = [];
    for await (const block of Mol.parseFile(file)) {
      if (block.error) throw Error('振動XYZに解析できないフレームがあります。');
      loaded.push({
        raw:new Blob(block.rawParts),energy:null,parsed:block,
        electronic:Mol.electronicState({...reactionFrames[0].electronic,...Mol.electronicComment(block.comment)}),
      });
    }
    if (!loaded.length) throw Error('振動XYZに有効なフレームがありません。');
    frames.splice(0,frames.length,...loaded);
    current = 0;
    vibrationFile = fileName;
    vibrationActive = true;
    setVibrationLayout(true);
    await showFrame(0);
    status(fileName+' · '+loaded.length+'フレーム。自動でループ再生します。');
    startPlayback();
  } catch(error) {
    status('振動アニメーションを読み込めません。'+error.message);
    if (!vibrationActive) {
      $('viewerMode').value='reaction';
      setVibrationLayout(false);
    }
  } finally {
    $('vibrationPeak').disabled = $('vibrationMode').disabled = false;
    $('viewerMode').disabled = false;
  }
}
function setVibrationLayout(active) {
  for (const id of ['vibrationPeakControl','vibrationModeControl']) $(id).hidden = !active;
  $('energyPlot').closest('.panel').style.display = active?'none':'';
  const reactionsOnly = ['saveStartImage','saveFinalImage','importStart','importFinish','importFrameEdit','importFrame','importAll','importMany'];
  for (const id of reactionsOnly) if ($(id)) $(id).style.display = active?'none':'';
  $('frameEnergy').textContent = active?'振動の変位構造を表示しています。':'';
}
async function changeViewerMode() {
  if (!reaction || !reactionFrames) return;
  stopPlayback();
  $('viewerMode').disabled=true;
  if ($('viewerMode').value==='vibration') {
    try {await loadVibrationIndex();await selectVibration();}
    catch(error){$('viewerMode').value='reaction';status(error.message);setVibrationLayout(false);$('viewerMode').disabled=false;}
  } else {
    vibrationActive=false;
    vibrationFile='';
    frames.splice(0,frames.length,...reactionFrames);
    current=reactionIndex;
    setVibrationLayout(false);
    await showFrame(current);
    $('viewerMode').disabled=false;
  }
}
if (reaction) {
  $('viewerMode').onchange = () => void changeViewerMode();
  $('vibrationPeak').onchange = () => {updateVibrationModes();void selectVibration();};
  $('vibrationMode').onchange = () => void selectVibration();
}
function stopPlayback() {
  playing = false;
  if (playbackTimer !== null) clearTimeout(playbackTimer);
  playbackTimer = null;
  $('autoPlay').setAttribute('aria-pressed','false');
  $('autoPlay').textContent = '▶ 自動送り';
}
async function playbackTick() {
  playbackTimer = null;
  if (!playing || document.hidden) {stopPlayback();return;}
  const atEnd = current >= frames.length-1;
  if (atEnd && !vibrationActive) {stopPlayback();return;}
  const ok = await showFrame(atEnd ? 0 : current+1, true);
  if (!ok || !playing) {stopPlayback();return;}
  playbackTimer = setTimeout(playbackTick, 1000/Number($('playbackSpeed').value));
}
function startPlayback() {
  if (busy || frames.length<2) return;
  playing = true;
  $('autoPlay').setAttribute('aria-pressed','true');
  $('autoPlay').textContent = 'Ⅱ 一時停止';
  if (!vibrationActive && current === frames.length-1) {
    void showFrame(0, true).then(ok => {
      if (ok && playing) playbackTimer = setTimeout(playbackTick,1000/Number($('playbackSpeed').value));
    });
  } else playbackTimer = setTimeout(playbackTick,1000/Number($('playbackSpeed').value));
}
$('autoPlay').onclick = () => playing ? stopPlayback() : startPlayback();
$('playbackSpeed').onchange = () => {
  if (!playing) return;
  if (playbackTimer === null) return; // Current frame is still rendering; use the new speed for the next tick.
  clearTimeout(playbackTimer);
  playbackTimer = setTimeout(playbackTick,1000/Number($('playbackSpeed').value));
};
document.addEventListener('visibilitychange',() => {if (document.hidden) stopPlayback();});
window.addEventListener('pagehide', stopPlayback);
Mol.displayMode($('displayMode'));
$('displayMode').onchange = () => { if (currentBlock) drawStructure(true); };
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
  $('autoPlay').disabled = unavailable || frames.length < 2;
  $('prev').disabled = unavailable || current === 0;
  $('next').disabled = unavailable || current === frames.length - 1;
  $('prevTen').disabled = $('prev').disabled;
  $('nextTen').disabled = $('next').disabled;
  if (reaction) {
    $('saveStartImage').disabled = $('saveFinalImage').disabled = unavailable || !imageSavingEnabled || !imageChannel || !captureImage || imageSaving;
    $('saveGroundSpxyz').disabled = $('saveTsSpxyz').disabled = unavailable || vibrationActive;
  }
  for (const id of ['importStart','importFinish','importFrameEdit']) $(id).disabled = unavailable;
  for (const id of ['numbers','importFrame','downloadFrame','importAll','importMany']) {
    $(id).disabled = unavailable;
  }
  if (vibrationActive) for (const id of ['importStart','importFinish','importFrameEdit','importFrame','importAll','importMany']) $(id).disabled = true;
}

async function readBlock(index) {
  const frame=frames[index];
  if (frame.parsed) return {...frame.parsed,...frame.electronic};
  for await (const block of Mol.parseFile(frame.raw)) {
    if (!block.error) return {...block,...frames[index].electronic};
  }
  throw Error('フレーム '+(index+1)+' を読み込めません。');
}

function drawPlot() {
  const canvas = $('energyPlot'), ctx = canvas.getContext('2d');
  const points = [];
  const referenceEnergy = frames[reference]?.energy;
  frames.forEach(({energy}, index) => {
    if (energy === null) return;
    const delta = energy - referenceEnergy;
    if (Number.isFinite(delta)) points.push({index, delta});
  });
  const axis = energyAxis(points.map(point => point.delta));
  const {step, low, high, negative, positive} = axis;
  const left = 90, top = 24, right = 552, bottom = 348;
  const x = index => left + (right-left)*index/Math.max(1,frames.length-1);
  const y = energy => bottom - (bottom-top)*(clampEnergy(energy,axis)-low)/(high-low);
  plottedPoints = points.map(point => ({index:point.index,x:x(point.index),y:y(point.delta)}));
  ctx.clearRect(0,0,canvas.width,canvas.height);
  const totalTicks=negative+positive+1;
  const fontSize=Math.min(23,Math.max(12,Math.floor((bottom-top)/totalTicks*.72)));
  ctx.font = fontSize+'px system-ui';
  ctx.fillStyle = '#a8b6b2';
  ctx.textAlign = 'right';
  for (let tick=-negative; tick<=positive; tick++) {
    const value=tick*step, py=y(value);
    ctx.beginPath();
    ctx.strokeStyle=value===0?'#5c7770':'#34413f';
    ctx.lineWidth=value===0?2:1;
    ctx.moveTo(left,py);ctx.lineTo(right,py);ctx.stroke();
    ctx.fillText(value===0?'0':String(value),left-9,py+fontSize*.3);
  }
  ctx.lineWidth=1;
  ctx.font='23px system-ui';
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
  if (nearest) {stopPlayback();void showFrame(nearest.index);}
});

async function showFrame(index, playbackFrame = false) {
  busy = true;
  if (!playbackFrame) syncButtons();
  try {
    currentBlock = await readBlock(index);
    current = index;
    $('frameCount').textContent = (current+1)+' / '+frames.length;
    $('atomCount').textContent = '原子数 '+currentBlock.atoms.length+' · 電荷 '+currentBlock.charge+' · 多重度 '+currentBlock.multiplicity;
    if (reaction && !vibrationActive) reactionIndex=current;
    const energy = frames[current].energy;
    $('frameEnergy').textContent = vibrationActive ? vibrationFile+' · Frame '+(current+1)
      : energy === null
      ? '2行目に読み取れるエネルギーがありません。'
      : '基準から '+(energy-frames[reference].energy).toFixed(3)+' kJ/mol';
    if (!vibrationActive) drawPlot();
    drawStructure(true);
    if (!playbackFrame) status('');
    return true;
  } catch (error) {
    status(error.message);
    return false;
  } finally {
    busy = false;
    if (!playbackFrame) syncButtons();
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
  // Vibration has the same atoms in every frame. Reuse InstancedMeshes instead of
  // disposing / rebuilding the whole scene up to 48 times each second.
  const atomMatrix = new T.Matrix4(), atomPosition = new T.Vector3(),
    atomRotation = new T.Quaternion(), atomScale = new T.Vector3();
  const dummy = new T.Object3D(), up = new T.Vector3(0,1,0),
    bondA = new T.Vector3(), bondB = new T.Vector3(), bondDirection = new T.Vector3();
  let model;
  function updateVibrationModel(atoms, mode) {
    if (!vibrationActive || !model?.userData.vibrationReusable || mode==='polyhedra'
        || model.userData.vibrationMode!==mode
        || model.userData.vibrationElements!==atoms.map(atom=>atom.el).join(',')) return false;
    const spheres = model.userData.spheres, sticks = model.userData.sticks;
    if (!spheres || spheres.count!==atoms.length) return false;
    const pairs = model.userData.bondPairs || [];
    if (mode!=='space' && (!sticks || sticks.count!==pairs.length*2)) return false;
    for (let i=0;i<atoms.length;i++) {
      const atom=atoms[i];
      spheres.getMatrixAt(i,atomMatrix);
      atomMatrix.decompose(atomPosition,atomRotation,atomScale);
      atomPosition.set(atom.x,atom.y,atom.z);
      atomMatrix.compose(atomPosition,atomRotation,atomScale);
      spheres.setMatrixAt(i,atomMatrix);
    }
    spheres.instanceMatrix.needsUpdate=true;
    spheres.computeBoundingSphere();
    if (sticks) {
      pairs.forEach(([i,j],k)=>{
        const a=atoms[i], b=atoms[j];
        bondA.set(a.x,a.y,a.z);bondB.set(b.x,b.y,b.z);
        bondDirection.subVectors(bondB,bondA);
        const length=bondDirection.length();
        if (length>1e-8) dummy.quaternion.setFromUnitVectors(up,bondDirection.multiplyScalar(1/length));
        else dummy.quaternion.identity();
        dummy.scale.set(1,length/2,1);
        for (let half=0;half<2;half++) {
          dummy.position.copy(bondA).lerp(bondB,half?.75:.25);
          dummy.updateMatrix();
          sticks.setMatrixAt(k*2+half,dummy.matrix);
        }
      });
      sticks.instanceMatrix.needsUpdate=true;
      sticks.computeBoundingSphere();
    }
    return true;
  }
  drawStructure = rebuild => {
    if (rebuild && currentBlock) {
      const atoms=currentBlock.atoms, mode=$('displayMode').value;
      if (!updateVibrationModel(atoms,mode)) {
        const nextModel=graphics.model(atoms,undefined,undefined,undefined,mode);
        if (vibrationActive && mode!=='polyhedra') {
          nextModel.userData.vibrationReusable=true;
          nextModel.userData.vibrationElements=atoms.map(atom=>atom.el).join(',');
          nextModel.userData.vibrationMode=mode;
        }
        scene.add(nextModel);
        if (model) {scene.remove(model);graphics.dispose(model);}
        model=nextModel;
      }
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
      await job.add(block,baseName+' ('+(i+1)+')');
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

$('prevTen').onclick = () => {stopPlayback();void showFrame(Math.max(0,current-10));};
$('nextTen').onclick = () => {stopPlayback();void showFrame(Math.min(frames.length-1,current+10));};
$('prev').onclick = () => {stopPlayback();void showFrame(current-1);};
$('next').onclick = () => {stopPlayback();void showFrame(current+1);};
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
    const stem = vibrationActive ? vibrationFile.replace(/\.xyz$/i,'') : baseName;
    Mol.downloadBlob(Mol.calculationOutput(currentBlock),Mol.safeName(stem+' ('+(index+1)+')')+'.xyz');
  } catch (error) {status(error.message);}
};
if (reaction) {
  let frameToSave = null;
  let saveAsTs = false;
  const dialog = $('frameSpxyzDialog');
  function saveFrameAsSpxyz(asTs) {
    if (busy || !currentBlock || vibrationActive) return;
    stopPlayback();
    frameToSave = currentBlock;
    saveAsTs = asTs;
    const state = Mol.electronicState(frameToSave);
    const position = current + 1;
    $('frameSpxyzTitle').textContent = (asTs ? 'TS' : '基底状態') + 'のSPXYZを保存（フレーム ' + position + '）';
    $('frameSpxyzName').value = spxyzName(baseName + ' (' + position + ')', asTs);
    $('frameSpxyzCharge').value = state.charge;
    $('frameSpxyzMultiplicity').value = state.multiplicity;
    $('frameSpxyzError').textContent = '';
    dialog.showModal();
  }
  function spxyzName(value, asTs) {
    const stem = Mol.safeName(value).replace(/\.(?:spxyz|xyz)$/i, '')
      .replace(/_ts(?=[_.\s]|$)/gi, '').trim();
    if (!stem) throw Error('ファイル名を入力してください。');
    return stem + (asTs ? '_ts' : '') + '.spxyz';
  }
  $('saveGroundSpxyz').onclick = () => saveFrameAsSpxyz(false);
  $('saveTsSpxyz').onclick = () => saveFrameAsSpxyz(true);
  $('frameSpxyzBack').onclick = () => dialog.close();
  dialog.addEventListener('close', () => { frameToSave = null; });
  $('frameSpxyzForm').onsubmit = event => {
    event.preventDefault();
    if (!frameToSave) return;
    try {
      const charge = $('frameSpxyzCharge').valueAsNumber;
      const multiplicity = $('frameSpxyzMultiplicity').valueAsNumber;
      const solvent = $('frameSpxyzSolvent').value;
      const filename = spxyzName($('frameSpxyzName').value, saveAsTs);
      const text = Mol.spxyzText({...frameToSave, charge, multiplicity}, solvent);
      Mol.downloadBlob(new Blob([text], {type:'text/plain;charset=utf-8'}), filename);
      dialog.close();
      status(filename + ' を保存しました。');
    } catch (error) {
      $('frameSpxyzError').textContent = error.message;
    }
  };
}
$('importFrame').onclick = () => registerFrames([[current+1,current+1]]);
let lastReactionId;
function endpointRecord(block,name,slot) {
  return {
    name:name+'_'+slot, atoms:block.atoms,...Mol.electronicState(block),
    raw:Mol.calculationOutput(block), comment:block.comment||'', edited:true,
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
    const name = Mol.safeName((sourceReactionContext?.name||baseName).replace(/[_＿](?:START|FINISH)$/i,''));
    const slot = finish ? 'FINISH' : 'START';
    const structure = endpointRecord(currentBlock,name,slot);
    let saved;
    if (finish) {
      let target = lastReactionId && await ReactionStore.read(lastReactionId);
      if (!target) {
        const reactions=await ReactionStore.read();
        const sourceId=sourceReactionContext?.sourceReactionId||null;
        // Never infer a reaction pairing from its display name when an origin ID exists.
        const candidates=sourceId
          ? reactions.filter(item=>item.sourceReactionId===sourceId&&item.START)
          : reactions.filter(item=>item.name===name&&item.START);
        if(candidates.length!==1)
          throw Error(candidates.length
            ? '同じ元反応に複数のSTARTがあります。対応するSTARTを保存した同じ画面からFINISHを保存してください。'
            : '対応するSTARTが見つかりません。先にSTARTを保存してください。');
        target=candidates[0];
      }
      if (target.FINISH && !await Mol.confirmFileAction('生成物の上書き',target.name+'_FINISH を上書きしますか？','生成物を上書きする')) return;
      structure.name = target.name+'_FINISH';
      const reviewed=await Mol.reviewReactionSave({...target,FINISH:structure},'FINISH');if(!reviewed)return;
      const fields={FINISH:structure};if(reviewed.START!==target.START)fields.START=reviewed.START;
      saved = await ReactionStore.update(target.id,fields,current=>
        !!current.FINISH===!!target.FINISH && current.FINISH?.revision===target.FINISH?.revision && current.START?.revision===target.START?.revision);
    } else {
      if(!await Mol.confirmElectronicSave({START:structure})){tab?.close();return;}
      // Restore every custom record property from the original typed archive.
      // Endpoints and ID must NOT be copied: this is a new saved reaction path.
      const source=await loadFullSourceReaction();
      const {id:_id,createdAt:_created,name:_name,START:_start,FINISH:_finish,
       startPreview:_preview,_driveFileId:_drive,_summary:_summary,...rest}=source||{};
      const provenance=sourceReactionContext||source?{
        ...rest,
        classification:sourceReactionContext?.classification??source?.classification??null,
        tags:sourceReactionContext?.tags??source?.tags??[],
        sourceReactionId:source?.id??sourceReactionContext?.sourceReactionId??null,
        sourceCreatedAt:source?.createdAt??sourceReactionContext?.createdAt??null,
        sourceArchiveSHA256:sourceReactionContext?.sourceArchiveSHA256??null,
        sourceManifestEntry:sourceReactionContext?.sourceEntry??null,
      }:{};
      saved = await ReactionStore.createReaction({...provenance,START:structure},name);
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
      const structures={START:endpointRecord(start,name,'START'),FINISH:endpointRecord(finish,name,'FINISH')};
      const reviewed=await Mol.reviewReactionSave(structures,'START');if(!reviewed)return;
      const saved = await ReactionStore.createReaction(reviewed,name);
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
  baseName = Mol.structureBaseName(name);
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
    baseName = Mol.structureBaseName(renamed);
    document.title = renamed + suffix;
    return renamed;
  },status);
  const response = await fetch(source);
  if (!response.ok) throw Error('元のXYZを読み込めません。ライブラリから開き直してください。');
  const file = new File([await response.blob()],name);
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
    frames.push({electronic:reaction?Mol.electronicComment(block.comment,true):Mol.electronicComment(block.comment),raw:new Blob(block.rawParts),energy:csvPoints ? csvPoints.get(frames.length+skipped) ?? null :
      readFrameEnergy(reaction && /(?:^|\s)energy=/.test(block.comment)
        ? (block.comment.match(/(?:^|\s)energy=([^\s]+)/)?.[1] ?? '')+' eV' : block.comment)});
  }
  if (!frames.length) throw Error('表示できる構造がありません。');
  if (reaction) reactionFrames = frames.slice();
  for(const key of ['charge','multiplicity']){const known=new Set(frames.map(f=>f.electronic[key]).filter(v=>v!==undefined));if(known.size===1){const value=[...known][0];for(const frame of frames)if(frame.electronic[key]===undefined)frame.electronic[key]=value;}}
  for(const frame of frames)frame.electronic=Mol.electronicState(frame.electronic);
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
