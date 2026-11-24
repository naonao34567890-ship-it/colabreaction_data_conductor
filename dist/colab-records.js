import {readEnergy} from './dmf-energy.js';
import {energyAxis, clampEnergy} from './energy-axis.js';
import {readColabFile, pruneColabFileCache} from './colab-file-cache.js';
import {parseConfig, summaryProperties, readSummary, displayLines, resultDate as summaryResultDate} from './colab-record-summary.mjs';
import {standaloneDrive, beginDriveConnection, driveFetch} from './drive-connection.js?v=2';

const get = id => document.getElementById(id);
const connect = get('driveConnect');
const input = get('colabZip');
const folderInput = get('colabFolder');
const fileButton = get('colabFileButton');
const folderButton = get('colabFolderButton');
fileButton.onclick = () => {if (!input.disabled) input.click();};
folderButton.onclick = () => {if (!folderInput.disabled) folderInput.click();};
function updateImportButtons(){
  fileButton.disabled = input.disabled;
  folderButton.disabled = folderInput.disabled;
}

const jobs = get('colabJobs');
const order = get('colabOrder');
const replotButton = get('replotExisting');
let replotRunning = false;
const cards = new Map();
const selectedJobIds = new Set();
const selectionToolbar = get('colabSelectionToolbar');
const selectionCount = get('colabSelectionCount');
function updateSelected() {
  for (const [id, entry] of cards) {
    const on = selectedJobIds.has(id);
    entry.card.classList.toggle('is-selected', on);
    entry.card.setAttribute('aria-selected', String(on));
    if (entry.selectionCheckbox) entry.selectionCheckbox.checked = on;
  }
  selectionToolbar.hidden = selectedJobIds.size === 0;
  selectionCount.textContent = selectedJobIds.size + '件選択中';
}
function toggleSelected(id) {
  if (selectedJobIds.has(id)) selectedJobIds.delete(id);
  else selectedJobIds.add(id);
  updateSelected();
}
function clearSelected() {
  if (!selectedJobIds.size) return;
  selectedJobIds.clear();
  updateSelected();
}
get('colabSelectionClear').onclick = clearSelected;
get('colabSelectionClassify').onclick = () => {
  if (selectedJobIds.size) openClassification(null);
};
document.addEventListener('click', event => {
  if (event.target.closest('.colab-job, #classificationDialog, #colabSelectionToolbar')) return;
  clearSelected();
});
order.value = 'classification';
order.onchange = sortCards;
const status = message => { get('colabStatus').textContent = message; };
const folderType = 'application/vnd.google-apps.folder';
const drive = 'https://www.googleapis.com/drive/v3';
let token, root, renderer, persistent = false;
const imageUrls = new Set();
const pending = [];
let active = null, connecting = false;

function showQueue() {
  get('colabQueue').textContent = (active ? '処理中 ' + active.name + ' ／ ' : '')
    + '待機中 ' + pending.length + '件';
}

function enqueue(records) {
  pending.push(...records);
  showQueue();
  void runQueue();
}

async function runQueue() {
  if (active || connecting || !token || !root) return;
  while (pending.length && token) {
    active = pending.shift();
    showQueue();
    connect.disabled = true;
    await importRecords(active.name, active.sourceLabel, active.readFiles);
    active = null;
    showQueue();
  }
  connect.disabled = false;
}


async function request(url, options = {}, retry = true) {
  const response = await fetch(url, {
    ...options, headers: { ...options.headers, Authorization: 'Bearer ' + token },
  });
  if (response.status === 401) {
    if (retry && persistent) {
      const renewed = await driveFetch('token', {cache: 'no-store'});
      const result = await renewed.json();
      if (result.state === 'connected' && result.access_token) {
        token = result.access_token;
        return request(url, options, false);
      }
    }
    connect.hidden = false;
    connect.textContent = '接続を再確認';
    connectionState = null;
    token = null;
    input.disabled = folderInput.disabled = true;
    updateImportButtons();
    throw Error('接続の有効期限が切れました。Google Driveに再接続してください。');
  }
  if (!response.ok) throw Error('Google Driveへのアクセスに失敗しました（' + response.status + '）。');
  return response;
}

async function list(query) {
  const files = [];
  let pageToken;
  do {
    const params = new URLSearchParams({q: query + ' and trashed = false',
      fields: 'nextPageToken,files(id,name,description,appProperties,createdTime,mimeType,modifiedTime)', pageSize: '100'});
    if (pageToken) params.set('pageToken', pageToken);
    const page = await (await request(drive + '/files?' + params)).json();
    files.push(...page.files);
    pageToken = page.nextPageToken;
  } while (pageToken);
  return files;
}

async function folder(name, parent, kind) {
  const metadata = {name, mimeType: folderType};
  if (parent) metadata.parents = [parent];
  if (kind) metadata.appProperties = {xyzStudio: kind};
  return (await (await request(drive + '/files?fields=id', {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(metadata),
  })).json()).id;
}

async function upload(name, parent, blob) {
  // Google Drive resumable uploads transfer large files in bounded 8 MiB pieces.
  // This avoids a single >1 GiB request and permits recovery after transient errors.
  const mime = blob.type || 'application/octet-stream';
  if (blob.size > 8 * 1024 ** 2) return uploadResumable(name,parent,blob,mime);
  const boundary = crypto.randomUUID();
  const body = new Blob([
    '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n',
    JSON.stringify({name, parents: [parent]}),
    '\r\n--' + boundary + '\r\nContent-Type: ' + mime + '\r\n\r\n',
    blob, '\r\n--' + boundary + '--\r\n',
  ]);
  return (await (await request('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST', headers: {'Content-Type': 'multipart/related; boundary=' + boundary}, body,
  })).json()).id;
}

async function uploadResumable(name,parent,blob,mime) {
  const session = await request('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id',{
    method:'POST',
    headers:{'Content-Type':'application/json; charset=UTF-8','X-Upload-Content-Type':mime,
      'X-Upload-Content-Length':String(blob.size)},
    body:JSON.stringify({name,parents:[parent]}),
  });
  const url=session.headers.get('Location');
  if(!url || !url.startsWith('https://www.googleapis.com/'))throw Error('Driveの分割アップロードURLを取得できませんでした。');
  const chunk=8*1024*1024;
  let position=0,failures=0;
  while(position<blob.size){
    const end=Math.min(position+chunk,blob.size);
    let response;
    try{
      response=await fetch(url,{
        method:'PUT',
        headers:{Authorization:'Bearer '+token,'Content-Type':mime,
          'Content-Range':'bytes '+position+'-'+(end-1)+'/'+blob.size},
        body:blob.slice(position,end),
      });
    }catch(error){ response=null; }
    if(response?.ok){
      const result=await response.json();
      if(!result.id)throw Error('Driveはアップロードを受理しましたがファイルIDを返しませんでした。');
      return result.id;
    }
    if(response?.status===308){
      const range=response.headers.get('Range')?.match(/bytes=0-(\d+)/);
      position=range?Number(range[1])+1:end;
      failures=0;
      continue;
    }
    if(response && ![408,429,500,502,503,504].includes(response.status)){
      throw Error('Driveへの分割アップロードに失敗しました（HTTP '+response.status+'）。');
    }
    if(++failures>5)throw Error('Driveへの分割アップロードを再開できませんでした。');
    await new Promise(resolve=>setTimeout(resolve,Math.min(1000*2**failures,12000)));
    // Query acknowledged bytes so retries never overwrite or skip an accepted chunk.
    const check=await fetch(url,{
      method:'PUT',
      headers:{Authorization:'Bearer '+token,'Content-Range':'bytes */'+blob.size,'Content-Length':'0'},
    });
    if(check.ok){const result=await check.json();if(result.id)return result.id;}
    else if(check.status===308){
      const range=check.headers.get('Range')?.match(/bytes=0-(\d+)/);
      position=range?Number(range[1])+1:0;
    }else if(![408,429,500,502,503,504].includes(check.status)){
      throw Error('Driveへの分割アップロード状態を確認できません（HTTP '+check.status+'）。');
    }
  }
  throw Error('Driveからアップロード完了を確認できませんでした。');
}

const download = id => request(drive + '/files/' + encodeURIComponent(id) + '?alt=media');
const downloadCached = file => readColabFile(root,file,
  async id => (await download(id)).blob());
const canvasPng = canvas => new Promise((resolve, reject) =>
  canvas.toBlob(blob => blob ? resolve(blob) : reject(Error('画像を生成できませんでした。')), 'image/png'));

async function thumbnail(blob) {
  for await (const block of Mol.parseFile(blob)) {
    if (block.error) continue;
    const g = await Mol.graphics;
    if (!renderer) {
      renderer = new g.T.WebGLRenderer({alpha: true, antialias: true, preserveDrawingBuffer: true});
      renderer.setSize(320, 240);
    }
    const scene = new g.T.Scene();
    const camera = new g.T.PerspectiveCamera(38, 4/3, .01, 2000);
    g.light(scene);
    const model = g.model(block.atoms);
    scene.add(model);
    try {
      g.fit(camera, block.atoms);
      renderer.render(scene, camera);
      return await canvasPng(renderer.domElement);
    } finally { g.dispose(model); }
  }
  throw Error('端点のXYZを読み込めませんでした。');
}

async function energyPlot(points) {
  const canvas = document.createElement('canvas');
  canvas.width = 960;
  canvas.height = 650;
  const ctx = canvas.getContext('2d');
  const xmin = points[0][0], xmax = points.at(-1)[0];
  const axis = energyAxis(points.map(([, energy]) => energy));
  const {step, low, high, negative, positive} = axis;
  const left = 190, right = 920, top = 100, bottom = 540;
  const x = value => xmin === xmax ? (left + right) / 2 :
    left + (right - left) * (value - xmin) / (xmax - xmin);
  const y = value => bottom - (bottom - top) *
    (clampEnergy(value, axis) - low) / (high - low);
  ctx.fillStyle = '#101313';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#e8efed';
  // Half-size title and labels (roughly one quarter the original glyph area).
  ctx.font = 'bold 45px sans-serif';
  ctx.fillText('ΔE (kJ/mol)', 14, 62);
  const tickCount = negative + positive + 1;
  const labelSize = Math.max(23, Math.min(50, Math.floor((bottom - top) / tickCount * 0.8)));
  ctx.font = 'bold ' + labelSize + 'px sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let tick = -negative; tick <= positive; tick++) {
    const energy = tick * step, yy = y(energy);
    const text = energy === 0 ? '0' : String(energy);
    ctx.fillStyle = '#e8efed';
    ctx.fillText(text, left - 12, yy, left - 30);
    ctx.fillStyle = energy === 0 ? '#5c7770' : '#34413f';
    ctx.fillRect(left, yy, right - left, energy === 0 ? 3 : 2);
  }
  ctx.font = 'bold 42px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#e8efed';
  ctx.fillText(String(xmin), left, 617, 105);
  if (xmax !== xmin) ctx.fillText(String(xmax), right - 28, 617, 105);
  ctx.fillText('フレーム', (left + right) / 2, 617, 180);
  ctx.fillStyle = '#62d6bf';
  for (const [frame, energy] of points) {
    if (!Number.isFinite(energy)) continue;
    // Values outside [-500, 500], or outside the selected rounded axis,
    // are shown at the nearest vertical boundary rather than disappearing.
    ctx.beginPath();
    ctx.arc(x(frame), y(energy), 4, 0, 2 * Math.PI);
    ctx.fill();
  }
  return canvasPng(canvas);
}

async function outputValue(trajectory, field) {
  if (!trajectory) return '不明';
  const values = new Set();
  const pattern = new RegExp('(?:^|\\s)' + field + '=(-?\\d+)(?=\\s|$)');
  for await (const block of Mol.parseFile(trajectory)) {
    if (!block.error) values.add(block.comment.match(pattern)?.[1] ?? '不明');
  }
  if (values.size > 1) return 'フレーム間で不一致';
  return [...values][0] ?? '不明';
}

async function readZip(file) {
  status('ZIPを一時ディスクに展開しています…');
  const {spoolColabZip} = await import('./colab-zip-spool.mjs');
  return spoolColabZip(file, {onProgress: (read, total) => {
    const percent=total ? Math.floor(read / total * 100) : 100;
    status('ZIPを一時ディスクに展開しています… '+percent+'%');
  }});
}

function readFolder(files, relativePath) {
  const result = new Map();
  for (const file of files) {

    const path = relativePath(file), parts = path.split('/');
    if (!path || path.startsWith('/') || path.includes('\\') ||
        parts.some(part => !part || part === '.' || part === '..') || result.has(path)) {
      throw Error('フォルダー内に無効または重複したファイルパスがあります。');
    }
    result.set(path,file);
  }
  return result;
}

async function importKey(name) {
  const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(name));
  return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
}

async function alreadyRegistered(name,runId=null) {
  if(runId){
    if(typeof runId!=='string'||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(runId))throw Error('計算runIdが不正です。');
    const found=await list("mimeType = '"+folderType+"' and appProperties has { key='runId' and value='"+runId+"' }");
    for(const job of found)if((await list("'"+job.id+"' in parents and name = 'config.txt'")).length)return true;
    return false;
  }
  const key = await importKey(name);
  const escaped = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const [original,named]=await Promise.all([
    list("'"+root+"' in parents and mimeType = '"+folderType+"' and name = '"+escaped+"'"),
    list("mimeType = '"+folderType+"' and appProperties has { key='importKey' and value='"+key+"' }"),
  ]);
  const matches=[...new Map([...original,...named].map(item=>[item.id,item])).values()];
  for (const match of matches) {
    if (match.appProperties?.importKey && match.appProperties.importKey !== key) continue;
    const completed = await list("'" + match.id + "' in parents and name = 'config.txt'");
    if (completed.length) return true;
  }
  return false;
}

async function importRecords(name, sourceLabel, readFiles, batchJob = null) {
  let parent, temporary;
  try {
    const source = await readFiles();
    temporary = source?.cleanup ? source : null;
    const files = temporary ? source.files : source;
    function find(name) {
      const matches = [...files].filter(([path]) => path.split('/').at(-1) === name);
      if (matches.length > 1) throw Error(name + ' が複数あります。計算結果を1件ずつ取り込んでください。');
      return matches[0]?.[1];
    }
    // Batch-mode ColabReaction exports are an outer ZIP containing one ZIP per
    // reaction plus batch_status.json. The outer archive is NOT a single DMF job.
    // Expand each member independently, preserving its reaction-context.json.
    const entries=[...files];
    const baseName=path=>path.split('/').at(-1);
    const resultZipEntries=entries.filter(([path]) =>
      /\.zip$/i.test(baseName(path)) && !/^source-reaction\.zip$/i.test(baseName(path)));
    const batchManifestEntry=entries.find(([path])=>baseName(path)==='batch_status.json');
    const hasDirectResultFiles=['reactant.xyz','product.xyz','DMF_energy.csv']
      .every(name=>entries.some(([path])=>baseName(path)===name));
    // A batch may have a nested manifest, a different format value, or
    // per-reaction archives stored in subfolders. Do not misidentify the
    // portable source-reaction.zip contained by an ordinary result ZIP.
    if (!hasDirectResultFiles && resultZipEntries.length &&
        (batchManifestEntry || resultZipEntries.length>1 ||
         resultZipEntries.some(([path]) => /(?:result|output|job|reaction|calc)/i.test(path)))) {
      let manifest=null;
      if(batchManifestEntry) {
        try {
          if(batchManifestEntry[1].size<=5*1024*1024)
            manifest=JSON.parse(await batchManifestEntry[1].text());
        }catch(error){
          console.warn('一括結果の一覧JSONを解析できませんでした:',error);
        }
      }
      const jobs=Array.isArray(manifest?.jobs)?manifest.jobs:[];
      let index=0;
      for (const [memberPath, memberFile] of resultZipEntries) {
        const basename=baseName(memberPath);
        const explicit=jobs.filter(item=>item.result_zip===basename);
        if(explicit.length>1)throw Error('結果ZIP名がバッチ一覧で重複しています: '+basename);
        const indexMatch=basename.match(/^(\d+)_/);
        const jobNumber=indexMatch?Number(indexMatch[1]):null;
        const job=explicit[0] ?? jobs.find(item=>Number(item.number)===jobNumber && jobNumber!==null) ??
          jobs.find(item=>item.reaction_id && basename.includes(String(item.reaction_id).slice(0,8))) ?? null;
        status('一括計算結果を取り込み中 '+(++index)+'/'+resultZipEntries.length+': '+memberPath);
        await importRecords(basename,'ZIP',()=>readZip(memberFile),job);
      }
      status('一括計算結果ZIPの処理が完了しました（'+resultZipEntries.length+
        '件）。失敗した項目はエラー欄を確認してください。');
      return;
    }
    if(!hasDirectResultFiles && batchManifestEntry && !resultZipEntries.length) {
      throw Error('batch_status.json は見つかりましたが、個別結果ZIPが見つかりません。ZIP内のファイル構成を確認してください。');
    }
    let sourceReaction=null;
    const sourceMetadata=find('reaction-context.json');
    if(sourceMetadata){
      try{
        const text=await sourceMetadata.text();
        if(text.length<100000){
          const context=JSON.parse(text);
          if(context?.format==='mol-bench-reaction-context'&&context.version===2)sourceReaction=context;
        }
      }catch(error){console.warn('反応の引継ぎJSONを読めませんでした:',error);}
    }
    // The source Colab bundle can omit reaction-context.json. Recover known
    // identity fields from batch_status.json without inventing classification.
    if (batchJob) {
      // Prefer the per-job context where present; fill missing fields from
      // the authoritative batch_status.json entry for the same numbered job.
      sourceReaction = {
        ...(sourceReaction || {}),
        name: sourceReaction?.name ?? (typeof batchJob.name==='string'?batchJob.name:null),
        sourceReactionId: sourceReaction?.sourceReactionId ??
          (typeof batchJob.reaction_id==='string'?batchJob.reaction_id:null),
        classification: sourceReaction?.classification ??
          (typeof batchJob.classification==='string'?batchJob.classification:null),
        tags: sourceReaction?.tags ?? (Array.isArray(batchJob.tags)?batchJob.tags:[]),
        runId: sourceReaction?.runId ?? batchJob.run_id ?? null,
        runOwnerSub: sourceReaction?.runOwnerSub ?? batchJob.run_owner_sub ?? null,
        runNumber: sourceReaction?.runNumber ?? batchJob.run_number ?? null,
        method: sourceReaction?.method ?? batchJob.method ?? 'DMF',
        displayPath: sourceReaction?.displayPath ?? batchJob.display_path ?? null,
      };
    }
    if(sourceReaction?.runId&&batchJob?.run_id&&sourceReaction.runId!==batchJob.run_id)
      throw Error('個別ZIPとバッチ一覧のrunIdが一致しません。');
    if(sourceReaction?.sourceReactionId&&batchJob?.reaction_id&&
       sourceReaction.sourceReactionId!==batchJob.reaction_id)
      throw Error('個別ZIPとバッチ一覧の反応IDが一致しません。');
    const runId=sourceReaction?.runId||null;
    if(await alreadyRegistered(name,runId)){status('登録済みの計算をスキップ: '+name);return;}
    const reactant = find('reactant.xyz'), product = find('product.xyz');
    const csv = find('DMF_energy.csv'), trajectory = find('DMF_final.xyz');
    if (!reactant || !product || !csv) throw Error('reactant.xyz、product.xyz、DMF_energy.csv が必要です。');
    const points = readEnergy(await csv.text());
    const charge = await outputValue(trajectory, 'charge');
    const spin = await outputValue(trajectory, 'spin');
    const match = name.match(/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/);
    const date = match ? match.slice(1,4).join('-') + ' ' + match.slice(4).join(':') : '不明';
    const start = await thumbnail(reactant), final = await thumbnail(product), plot = await energyPlot(points);
    let runInfo=null;
    if(sourceReaction?.name&&sourceReaction?.sourceReactionId){
      runInfo=await reserveReactionRun(sourceReaction);
      parent=runInfo.folderId;
    }
    const config = [
      sourceLabel + '名: ' + name.replace(/[\r\n]/g, ' '), 'プロット点数: ' + points.length,
      'ファイル数: ' + files.size,
      '電荷: ' + charge, 'spin（出力値）: ' + spin, '電荷・spinの取得元: DMF_final.xyz',
      '結果出力日時: ' + date + (match ? '（' + sourceLabel + '名由来・タイムゾーン不明）' : ''),
      ...(sourceReaction?.name?['元の反応名: '+sourceReaction.name]:[]),
      ...(sourceReaction?.sourceReactionId?['元の反応ID: '+sourceReaction.sourceReactionId]:[]),
      ...(sourceReaction?.classification?['元の分類: '+sourceReaction.classification]:[]),
      ...(runId?['計算runId: '+runId]:[]),
      ...((runInfo?.displayPath||sourceReaction?.displayPath)?['表示パス: '+(runInfo?.displayPath||sourceReaction.displayPath)]:[]),
    ].join('\n');
    status('Google Driveに保存しています…');
    if(!parent)parent=await folder(name,root);
    const originals = await folder('計算結果', parent);
    const directories = new Map([['', originals]]);
    let saved = 0;
    for (const [path, blob] of files) {
      const parts = path.split('/');
      const name = parts.pop();
      let prefix = '', dir = originals;
      for (const part of parts) {
        prefix += '/' + part;
        if (!directories.has(prefix)) directories.set(prefix, await folder(part, dir));
        dir = directories.get(prefix);
      }
      await upload(name, dir, blob);
      status('Google Driveに保存しています… ' + (++saved) + '/' + files.size);
    }
    const images = new Map([['計算結果',originals]]);
    images.set('START.png', await upload('START.png', parent, start));
    images.set('FINAL.png', await upload('FINAL.png', parent, final));
    images.set('Energy.png', await upload('Energy.png', parent, plot));
    images.set('config.txt', await upload('config.txt', parent, new Blob([config], {type:'text/plain'})));
    // The completion marker (config.txt) remains the last upload.
    // A metadata write failure must not invalidate a successfully uploaded record.
    const properties=summaryProperties(config,images);
    properties.energyPlotVersion='2';
    if(sourceReaction?.classification&&new TextEncoder().encode(sourceReaction.classification).length<=100)
      properties.classification=sourceReaction.classification;
    if(sourceReaction?.name&&new TextEncoder().encode(sourceReaction.name).length<=100)
      properties.reactionName=sourceReaction.name;
    if(sourceReaction?.sourceReactionId&&new TextEncoder().encode(sourceReaction.sourceReactionId).length<=100)
      properties.sourceReactionId=sourceReaction.sourceReactionId;
    if(runId)properties.runId=runId;
    if(runInfo){properties.runId=runInfo.runId;properties.runNumber=String(runInfo.runNumber);properties.method=runInfo.method;}
    if(!runId)properties.importKey=await importKey(name);
    await writeRecordSummary(parent,properties,{required:true});
    parent = null;
    await refresh();
    status('計算記録を保存しました。');
  } catch (error) {
    let partial = '';
    if (parent) {
      try {
        await request(drive + '/files/' + parent, {method:'PATCH',
          headers:{'Content-Type':'application/json'}, body:JSON.stringify({trashed:true})});
      } catch { partial = ' 未完了のフォルダがDriveに残っている可能性があります。'; }
    }
    const message = document.createElement('div');
    message.textContent = name + ' — ' + error.message + partial;
    get('colabErrors').append(message);
    status(error.message + partial);
  } finally {
    if (temporary) {
      try { await temporary.cleanup(); }
      catch (error) { console.warn('ZIP一時ファイルの削除に失敗しました:',error); }
    }
  }
}

async function reserveReactionRun(source){
  const reactionId=String(source.sourceReactionId||'');
  const runId=source.runId||crypto.randomUUID();
  const method=/^[A-Za-z0-9_-]{1,24}$/.test(source.method||'DMF')?source.method||'DMF':'DMF';
  if(!reactionId)throw Error('元反応IDがありません。');
  if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(runId))
    throw Error('計算runIdが不正です。');
  const perform=async()=>{
    const rootFolders=await list("'"+root+"' in parents and mimeType = '"+folderType+"'");
    let group=rootFolders.find(item=>item.appProperties?.xyzStudio==='colabReactionGroup'
      && item.appProperties?.sourceReactionId===reactionId);
    const usedNames=new Set(rootFolders.map(item=>item.name));
    const base=Mol.safeName(source.name).slice(0,120);
    const proposedName=group?.name||(usedNames.has(base)?Mol.nextDuplicateName(base,usedNames):base);
    const children=group?await list("'"+group.id+"' in parents and mimeType = '"+folderType+"'"):[];
    const occupied=new Set();
    for(const item of children){
      const props=item.appProperties||{};
      if(props.method===method&&Number.isSafeInteger(Number(props.runNumber))&&Number(props.runNumber)>0)
        occupied.add(Number(props.runNumber));
      const match=item.name.match(new RegExp('^'+method+'\\((\\d+)\\)$'));
      if(match)occupied.add(Number(match[1]));
    }
    const hint=Number(source.runNumber),legacyNext=Number(group?.appProperties?.nextRunNumber);
    const minimum=Math.max(
      Number.isSafeInteger(hint)&&hint>0?hint:1,
      Number.isSafeInteger(legacyNext)&&legacyNext>0?legacyNext:1,
      occupied.size?Math.max(...occupied)+1:1);
    const reserved=await driveFetch('runs',{body:JSON.stringify({
      action:'reserveRun',runId,reactionId,method,reactionName:proposedName,
      expectedAccountSub:source.runOwnerSub||null,
      minimumRunNumber:minimum,
    })});
    const payload=await reserved.json();
    if(!reserved.ok||payload.state!=='reserved'||!payload.run)
      throw Error('共通の実行番号台帳から番号を取得できませんでした（'+(payload.state||reserved.status)+'）。計算を別番号で保存せず中止します。');
    const official=payload.run;
    if(source.runOwnerSub&&payload.account?.sub!==source.runOwnerSub)
      throw Error('ColabとMol BenchでGoogleアカウントが異なります。正しいアカウントで接続してください。');
    if(official.reactionId!==reactionId||official.runId.toLowerCase()!==runId.toLowerCase()||official.method!==method)
      throw Error('実行番号台帳が異なる計算IDを返しました。');
    const number=official.runNumber,leaf=method+'('+number+')';
    if(!Number.isSafeInteger(number)||number<1)throw Error('共通台帳の実行番号が不正です。');
    if(occupied.has(number)&&!children.some(item=>item.name===leaf&&item.appProperties?.runId===runId))
      throw Error('旧記録と共通台帳のDMF番号が衝突しました。既存履歴を台帳へ移行してから再実行してください。');
    if(!group){
      const created=await (await request(drive+'/files?fields=id,name,appProperties',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({name:official.reactionName,mimeType:folderType,parents:[root],
          appProperties:{xyzStudio:'colabReactionGroup',sourceReactionId:reactionId,
            nextRunNumber:String(number+1)}}),
      })).json();
      group=created;
    }
    const previous=children.find(item=>item.appProperties?.runId===runId||item.name===leaf);
    if(previous) {
      if(previous.appProperties?.runId!==runId)throw Error('同名の実行フォルダが別IDで存在します。');
      const completed=await list("'"+previous.id+"' in parents and name = 'config.txt'");
      if(completed.length)throw Error('同じ計算IDは登録済みです。');
      // Recover an interrupted import without changing its identity or number.
      return {folderId:previous.id,runId,runNumber:number,method,
        displayPath:group.name+'/'+leaf};
    }
    const props={method,runNumber:String(number),sourceReactionId:reactionId,runId};
    const created=await (await request(drive+'/files?fields=id,name,appProperties',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({name:leaf,mimeType:folderType,parents:[group.id],appProperties:props}),
    })).json();
    // The Durable Object assigns numbers across devices; this cache is for legacy readers.
    await request(drive+'/files/'+encodeURIComponent(group.id)+'?fields=id',{
      method:'PATCH',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({appProperties:{...(group.appProperties||{}),
        xyzStudio:'colabReactionGroup',sourceReactionId:reactionId,
        nextRunNumber:String(Math.max(number+1,Number(group.appProperties?.nextRunNumber)||1))}}),
    });
    return {folderId:created.id,runId,runNumber:number,method,
      displayPath:group.name+'/'+leaf};
  };
  if(globalThis.navigator?.locks)return navigator.locks.request('mol-bench-colab-run-allocation',perform);
  return perform();
}

async function writeRecordSummary(id, properties, {required=false}={}) {
  try {
    const existing=cards.get(id)?.appProperties||{};
    const merged={...existing,...properties};
    const response=await request(drive+'/files/'+encodeURIComponent(id)+'?fields=id,appProperties',{
      method:'PATCH',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({appProperties:merged}),
    });
    const applied=(await response.json()).appProperties||{};
    if(required && ['runId','importKey','sourceReactionId'].some(key=>merged[key]&&applied[key]!==merged[key]))
      throw Error('計算IDのDriveへの保存を確認できませんでした。');
    if(cards.has(id))cards.get(id).appProperties=applied;
  }catch(error){
    if(required)throw error;
    console.warn('Colab記録の一覧要約を保存できませんでした:',id,error);
  }
}

function compareClassifications(a,b) {
  const first = a.appProperties?.classification;
  const second = b.appProperties?.classification;
  if (Boolean(first) !== Boolean(second)) return first ? -1 : 1;
  const byName = Mol.compareTagNames(first || '',second || '');
  if (byName) return byName;
  if (first !== second) return first < second ? -1 : 1;
  const byDate = (b.resultDate || '').localeCompare(a.resultDate || '');
  return byDate || Mol.compareDisplayOrder(a,b,'id');
}

function sortCards() {
  const entries = [...cards.values()].sort((a,b) => order.value === 'classification'
    ? compareClassifications(a,b) :
    (order.value==='name-asc'||order.value==='name-desc')
      ? Mol.compareTagNames(a._parentName?a._parentName+'/'+a.name:a.name,b._parentName?b._parentName+'/'+b.name:b.name)*(order.value==='name-desc'?-1:1)
      : Mol.compareDisplayOrder(a,b,order.value));
  const content = document.createDocumentFragment();
  let previous;
  for (const entry of entries) {
    const name = entry.appProperties?.classification || '';
    if (order.value === 'classification' && name !== previous) {
      const heading = document.createElement('h2');
      heading.className = 'colab-group-heading';
      heading.textContent = name || '未分類';
      content.append(heading);
    }
    previous = name;
    content.append(entry.card);
  }
  jobs.replaceChildren(content);
  const count=get('colabCount');if(count)count.textContent=entries.length.toLocaleString()+' 記録';
}

async function countOriginalFiles(id) {
  const pendingFolders = [id];
  let count = 0;
  while (pendingFolders.length) {
    const files = await list("'" + pendingFolders.pop() + "' in parents");
    for (const file of files) {
      if (file.mimeType === folderType) pendingFolders.push(file.id);
      else count++;
    }
  }
  return count;
}

async function renameRecord(jobId, name) {
  const job = cards.get(jobId);
  if (!job) throw Error('計算記録を一覧から開き直してください。');
  // Renaming a run must retain runId, runNumber, method and original source identity.
  const siblings=await list("'"+(job._parentId||root)+"' in parents and mimeType = '"+folderType+"'");
  if(siblings.some(item=>item.id!==jobId&&item.name===name))
    throw Error('同じフォルダ内に同名の計算記録があります。');
  const appProperties={...(job.appProperties||{})};
  if(!appProperties.runId&&!appProperties.importKey)
    appProperties.importKey=await importKey(job.name);
  const response = await request(drive + '/files/' + encodeURIComponent(jobId) + '?fields=name,appProperties',{
    method:'PATCH',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({name,appProperties}),
  });
  Object.assign(job,await response.json());
  job.title.textContent = job._parentName?job._parentName+'/'+job.name:job.name;
  sortCards();
  return job.name;
}

function connectImageSaver(params, jobId, images) {
  const channelId = crypto.randomUUID();
  params.set('images', channelId);
  const channel = new BroadcastChannel('reaction-images:' + channelId);
  channel.onmessage = async ({data}) => {
    if (data?.close) { channel.close(); return; }
    const {target, image, id, name} = data ?? {};
    if (typeof name === 'string' && name.trim()) {
      try { channel.postMessage({id,name:await renameRecord(jobId,Mol.safeName(name))}); }
      catch (error) { channel.postMessage({id,error:error.message}); }
      return;
    }
    if (!['START','FINAL'].includes(target) || !(image instanceof Blob) || image.type !== 'image/png') return;
    try {
      await request('https://www.googleapis.com/upload/drive/v3/files/' +
        encodeURIComponent(images.get(target+'.png')) + '?uploadType=media', {
        method:'PATCH', headers:{'Content-Type':'image/png'}, body:image,
      });
      const preview = cards.get(jobId)?.card.querySelector('img[alt="'+target+'"]');
      if (preview) {
        URL.revokeObjectURL(preview.src);
        imageUrls.delete(preview.src);
        preview.src = URL.createObjectURL(image);
        imageUrls.add(preview.src);
      }
      channel.postMessage({id});
    } catch (error) {
      channel.postMessage({id,error:error.message});
    }
  };
}

function colabResultEntries(job, files) {
  const required = ['reactant.xyz', 'product.xyz', 'DMF_energy.csv'];
  const byName = new Map();
  for (const file of files) {
    const name = file.path.split('/').at(-1);
    byName.set(name, (byName.get(name) || 0) + 1);
  }
  for (const name of [...required, 'DMF_final.xyz', 'reaction-context.json']) {
    if (byName.get(name) > 1) throw Error(name + ' が複数あります。');
    if (required.includes(name) && !byName.has(name)) throw Error(name + ' がありません。');
  }

  const {method, runId, runNumber: storedNumber, sourceReactionId, reactionName, classification} =
    job.appProperties || {};
  const runNumber = Number(storedNumber);
  if (!job._parentName || !/^[A-Za-z0-9_-]{1,24}$/.test(method || '') ||
      !Number.isSafeInteger(runNumber) || runNumber < 1) return files;

  const runLabel = method + '(' + runNumber + ')';
  const folderName = Mol.safeName(job._parentName).replace(/^\.+$/, '_');
  const displayPath = folderName + '/' + runLabel;
  const prefix = displayPath + '/';
  // Recognize an earlier export even if the reaction folder has been renamed.
  const [reactionFolder, runFolder] = files[0].path.split('/');
  const oldPrefix = reactionFolder + '/' + runLabel + '/';
  const alreadyWrapped = runFolder === runLabel && files.every(file => file.path.startsWith(oldPrefix));
  const entries = files.map(file => ({
    ...file, path: prefix + (alreadyWrapped ? file.path.slice(oldPrefix.length) : file.path),
  }));
  // Batch imports can have identity in Drive even when the member ZIP had no context.
  if (!byName.has('reaction-context.json') && runId && sourceReactionId) {
    const context = {
      format: 'mol-bench-reaction-context', version: 2, sourceReactionId,
      name: reactionName || job._parentName, classification: classification ?? null,
      runId, runNumber, method, displayPath,
    };
    entries.push({path: prefix + 'reaction-context.json',
      bytes: new TextEncoder().encode(JSON.stringify(context, null, 2) + '\n')});
  }
  return entries;
}

async function downloadArchive(job, originals, button, {colabResult = false} = {}) {
  button.disabled = true;
  const label = button.textContent;
  let output;
  try {
    const basename=Mol.safeName((job._parentName?job._parentName+'_':'')+job.name).replace(/\.zip$/i,'');
    const filename=basename+(colabResult?'_ColabReaction':'')+'.zip';
    // Chrome/Chromebook: stream directly to disk, rather than allocating a 1GB ZIP in RAM.
    if(typeof window.showSaveFilePicker==='function'){
      try{
        const handle=await window.showSaveFilePicker({
          suggestedName:filename,
          types:[{description:'ZIP archive',accept:{'application/zip':['.zip']}}],
        });
        output=await handle.createWritable();
      }catch(error){
        if(error.name==='AbortError')return;
        // Fallback when file-system access is unavailable to this origin.
        if(error.name!=='SecurityError'&&error.name!=='NotAllowedError')throw error;
      }
    }
    button.textContent = 'ファイルを確認中…';
    const pending = [{id:originals,path:''}];
    const files = [];
    while (pending.length) {
      const {id,path} = pending.pop();
      for (const file of await list("'" + id + "' in parents")) {
        const name = colabResult ? file.name : Mol.safeName(file.name);
        if (colabResult && (!name || name === '.' || name === '..' || /[\\/\x00-\x1f]/.test(name) ||
            (!path && /^[A-Za-z]:/.test(name)))) throw Error('無効なファイル名: ' + name);
        if (file.mimeType === folderType) pending.push({id:file.id,path:path+name+'/'});
        else files.push({id:file.id,path:path+name});
      }
    }
    if (!files.length) throw Error('ダウンロードできる計算結果がありません。');
    const {Zip,ZipPassThrough} = await import('./vendor/fflate.mjs');
    const entries = colabResult ? colabResultEntries(job, files) : files;
    const pieces=[],paths=new Set();
    let write=Promise.resolve(),failure=null,finished=false;
    const archive=new Zip((error,chunk,final)=>{
      if(error){failure=error;return;}
      if(output)write=write.then(()=>output.write(chunk));
      else pieces.push(chunk);
      if(final)finished=true;
    });
    for(let i=0;i<entries.length;i++){
      const file=entries[i];
      if(paths.has(file.path))throw Error('ZIP内のファイル名が重複しています。');
      paths.add(file.path);
      button.textContent='取得中 '+(i+1)+'/'+entries.length;
      const response=file.bytes ? new Response(file.bytes) : await download(file.id);
      const item=new ZipPassThrough(file.path);
      archive.add(item);
      if(response.body){
        const reader=response.body.getReader();
        try{
          while(true){
            const {done,value}=await reader.read();
            if(done)break;
            item.push(value,false);
            // Backpressure: do not buffer gigabytes of pending writes.
            if(output)await write;
            if(failure)throw failure;
          }
        }finally{reader.releaseLock();}
      }else{
        item.push(new Uint8Array(await response.arrayBuffer()),false);
        if(output)await write;
      }
      item.push(new Uint8Array(0),true);
      if(output)await write;
      if(failure)throw failure;
    }
    button.textContent='ZIPを完成中…';
    archive.end();
    await write;
    if(failure||!finished)throw failure||Error('ZIPの生成が完了しませんでした。');
    if(output){await output.close();output=null;}
    else Mol.downloadBlob(new Blob(pieces,{type:'application/zip'}),filename);
  } catch (error) {
    if(output)await output.abort().catch(()=>{});
    status('ZIPのダウンロードに失敗しました。' + error.message);
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}
function serveVibrationFiles(tab, originals, channelId) {
  const channel = new BroadcastChannel('reaction-vibrations:' + channelId);
  let catalogPromise;
  const catalog = async () => {
    if (!catalogPromise) catalogPromise = (async () => {
      const directoryIds = [originals], found = new Map();
      while (directoryIds.length) {
        for (const entry of await list("'" + directoryIds.pop() + "' in parents")) {
          if (entry.mimeType === folderType) directoryIds.push(entry.id);
          else if (/^local_maxima_\d+_vib_\d+\.xyz$/i.test(entry.name)) found.set(entry.name,entry);
        }
      }
      return found;
    })().catch(error=>{catalogPromise=null;throw error;});
    return catalogPromise;
  };
  channel.onmessage = async ({data}) => {
    if (data?.type === 'close') {channel.close();return;}
    if (!data?.requestId || !['list','file'].includes(data.type)) return;
    try {
      if (tab.closed) {channel.close();return;}
      const found = await catalog();
      if (data.type === 'list') channel.postMessage({
        requestId:data.requestId,type:'list',names:[...found.keys()].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}))
      });
      else {
        if (!found.has(data.name)) throw Error('指定された振動ファイルが見つかりません。');
        const blob = await downloadCached(found.get(data.name));
        channel.postMessage({requestId:data.requestId,type:'file',name:data.name,blob});
      }
    } catch (error) {channel.postMessage({requestId:data.requestId,type:'error',message:error.message});}
  };
  return channel;
}

async function openReaction(jobId, name, originals, images) {
  const tab = window.open('about:blank', '_blank');
  if (!tab) { status('反応経路ビューアのタブを開けませんでした。'); return; }
  tab.opener = null;
  tab.document.body.textContent = '反応経路を読み込み中…';
  const urls = [];
  let vibrationChannel;
  try {
    if (!originals) throw Error('計算結果フォルダーがありません。');
    const directories = [originals];
    const found = new Map();
    while (directories.length && found.size < 2) {
      for (const file of await list("'" + directories.pop() + "' in parents")) {
        if (file.mimeType === folderType) directories.push(file.id);
        else if (['DMF_final.xyz','DMF_energy.csv'].includes(file.name)) found.set(file.name,file);
      }
    }
    if (!found.has('DMF_final.xyz')) throw Error('DMF_final.xyz が見つかりません。');
    const params = new URLSearchParams({name, job:jobId});
    for (const [file, key] of [['DMF_final.xyz','source'], ['DMF_energy.csv','energy']]) {
      if (!found.has(file)) continue;
      const blob = await downloadCached(found.get(file));
      const url = URL.createObjectURL(blob);
      urls.push(url);
      params.set(key,url);
    }
    // A v2 ColabReaction output includes a portable source-reaction context.
    // It is metadata, not a computational input; preserve classification/tags on return.
    const contextFiles=await list("'" + originals + "' in parents and name = 'reaction-context.json'");
    if(contextFiles.length===1){
      try{
       const payload=await (await download(contextFiles[0].id)).text();
       if(payload.length<100000){
        const context=JSON.parse(payload);
        if(context?.format==='mol-bench-reaction-context'&&context.version===2)
          params.set('reactionContext',JSON.stringify(context));
       }
      }catch(error){console.warn('反応の引継ぎ情報を読み込めませんでした:',error);}
    }
    const archiveFiles=await list("'" + originals + "' in parents and name = 'source-reaction.zip'");
    if(archiveFiles.length===1){
      try{
        const archiveBlob=await (await download(archiveFiles[0].id)).blob();
        const archiveURL=URL.createObjectURL(archiveBlob);
        urls.push(archiveURL);
        params.set('sourceReactionArchive',archiveURL);
      }catch(error){console.warn('元反応の完全データを取得できませんでした:',error);}
    }
    if (tab.closed) throw Error('反応経路ビューアを閉じました。');
    const vibrationChannelId = crypto.randomUUID();
    vibrationChannel = serveVibrationFiles(tab, originals, vibrationChannelId);
    params.set('vibrationChannel',vibrationChannelId);
    if (images.has('START.png') && images.has('FINAL.png')) params.set('imageSaving','1');
    connectImageSaver(params,jobId,images);
    tab.location.replace('reaction-viewer.html#' + params);
  } catch (error) {
    vibrationChannel?.close();
    for (const url of urls) URL.revokeObjectURL(url);
    if (!tab.closed) tab.document.body.textContent = error.message;
    status(error.message);
  }
}

const classificationDialog = get('classificationDialog');
const classificationForm = get('classificationForm');
const classificationName = get('classificationName');
const classificationCreate = get('classificationCreate');
let classificationJob;
let classificationTargets = [];
let classificationSaving = false;
let classificationRenaming = false, classificationFrom = null;

function openClassification(jobId) {
  classificationTargets = jobId ? [jobId] : [...selectedJobIds].filter(id => cards.has(id));
  classificationJob = cards.get(classificationTargets[0]);
  if (!classificationJob || classificationDialog.open) return;
  const current = classificationJob.appProperties?.classification;
  get('classificationCurrent').textContent = classificationTargets.length > 1
    ? classificationTargets.length + '件の分類を一括変更'
    : '現在の分類：' + (current || 'なし');
  get('classificationStatus').textContent = '';
  classificationName.value = '';
  classificationForm.hidden = classificationCreate.disabled = true;
  get('classificationRemove').disabled = !classificationTargets.some(id => cards.get(id)?.appProperties?.classification);
  get('classificationRename').disabled = classificationTargets.length > 1;
  classificationRenaming = false;
  classificationFrom = null;
  classificationCreate.textContent = '作成して設定';
  renderClassifications();
  classificationDialog.showModal();
}

function renderClassifications() {
  const choices = get('classificationChoices');
  choices.replaceChildren();
  const names = new Set([...cards.values()].map(job => job.appProperties?.classification).filter(Boolean));
  for (const name of [...names].sort(Mol.compareTagNames)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = name;
    button.onclick = () => {
      if (classificationSaving) return;
      if (!classificationRenaming) { void saveClassification(name); return; }
      classificationFrom = name;
      classificationName.value = name;
      classificationForm.hidden = classificationCreate.disabled = false;
      classificationName.focus();
      classificationName.select();
    };
    choices.append(button);
  }
}

async function saveClassification(name) {
  if (classificationSaving) return;
  const feedback = get('classificationStatus');
  if (new TextEncoder().encode(name).length > 100) {
    feedback.textContent = '分類名が長すぎます。短くしてください。';
    return;
  }
  classificationSaving = true;
  const targets = [...classificationTargets];
  feedback.textContent = targets.length + '件を保存中…';
  const failed = [];
  let updated = 0;
  try {
    for (const jobId of targets) {
      const job = cards.get(jobId);
      if (!job) { failed.push(jobId + ': 一覧から消えました'); continue; }
      try {
        const response = await request(drive + '/files/' + encodeURIComponent(jobId) + '?fields=appProperties', {
          method:'PATCH', headers:{'Content-Type':'application/json'},
          body:JSON.stringify({appProperties:{...(job.appProperties||{}),classification:name || null}}),
        });
        const {appProperties} = await response.json();
        job.appProperties = appProperties;
        job.classificationButton.textContent = name ? '分類：' + name : '分類を設定';
        updated++;
      } catch (error) {
        failed.push((job._parentName ? job._parentName+'/' : '') + job.name + ': ' + error.message);
      }
    }
    if (order.value === 'classification') sortCards();
    if (failed.length) {
      feedback.textContent = updated + '件更新、' + failed.length + '件失敗：' + failed.slice(0,3).join(' / ');
      // Keep selection and dialog open so failed items can be retried.
    } else {
      classificationDialog.close();
      if (targets.length > 1) clearSelected();
    }
  } finally {
    classificationSaving = false;
  }
}
classificationDialog.addEventListener('cancel',event => {
  if (classificationSaving) event.preventDefault();
});
get('classificationCancel').onclick = () => { if (!classificationSaving) classificationDialog.close(); };
get('classificationRemove').onclick = () => void saveClassification('');
get('classificationNew').onclick = () => {
  if (classificationSaving) return;
  classificationRenaming = false;
  classificationFrom = null;
  classificationName.value = '';
  classificationCreate.textContent = '作成して設定';
  classificationCreate.disabled = true;
  classificationForm.hidden = false;
  classificationName.focus();
};
get('classificationRename').onclick = () => {
  if (classificationSaving) return;
  classificationRenaming = true;
  classificationFrom = null;
  classificationForm.hidden = true;
  classificationCreate.textContent = '更新';
  get('classificationStatus').textContent = '名前を変更する分類を選んでください。';
};

async function renameClassification(name) {
  if (classificationSaving) return;
  const feedback = get('classificationStatus');
  if (new TextEncoder().encode(name).length > 100) {
    feedback.textContent = '分類名が長すぎます。短くしてください。';
    return;
  }
  const from = classificationFrom;
  classificationFrom = null;
  classificationForm.hidden = true;
  classificationSaving = true;
  feedback.textContent = '更新中…';
  let count = 0;
  try {
    if (name === from) throw Error('同じ名前の分類があります。');
    const folders=[...cards.values()];
    if (folders.some(job=>job.appProperties?.classification===name)) throw Error('同じ名前の分類があります。');
    for (const job of folders.filter(job=>job.appProperties?.classification===from)) {
      const response = await request(drive + '/files/' + encodeURIComponent(job.id) + '?fields=appProperties',{
        method:'PATCH',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({appProperties:{...(cards.get(job.id)?.appProperties||{}),classification:name}}),
      });
      const {appProperties} = await response.json();
      const entry = cards.get(job.id);
      if (entry) {
        entry.appProperties = appProperties;
        entry.classificationButton.textContent = '分類：' + name;
      }
      count++;
    }
    feedback.textContent = count + ' 件の分類名を更新しました。';
  } catch (error) {
    feedback.textContent = (count ? count + ' 件更新したところで中断しました。' : '') + error.message;
  } finally {
    get('classificationCurrent').textContent = '現在の分類：' + (classificationJob.appProperties?.classification || 'なし');
    renderClassifications();
    sortCards();
    classificationSaving = false;
  }
}

classificationName.oninput = () => { classificationCreate.disabled = !classificationName.value.trim(); };
classificationForm.onsubmit = event => {
  event.preventDefault();
  const name = classificationName.value.trim();
  if (name) void (classificationFrom ? renameClassification(name) : saveClassification(name));
};

const imageObserver = new IntersectionObserver(entries => {
  for (const {target, isIntersecting} of entries) {
    if (!isIntersecting) continue;
    imageObserver.unobserve(target);
    void loadCardImage(target);
  }
}, {rootMargin:'100px'});

async function loadCardImage(img) {
  try {
    const blob = await (await download(img.dataset.driveFile)).blob();
    if (!img.isConnected || img.hasAttribute('src')) return;
    const url = URL.createObjectURL(blob);
    imageUrls.add(url);
    img.src = url;
  } catch {
    if (img.isConnected) img.alt += '（読み込み失敗）';
  }
}

let recordLoads = 0;
async function withRecordLoading(load) {
  const indicator = get('colabLoading');
  recordLoads++;
  indicator.hidden = false;
  try {
    return await load();
  } finally {
    recordLoads--;
    indicator.hidden = recordLoads === 0;
  }
}

function refresh() {
  return withRecordLoading(loadRecords);
}

async function loadRecords() {
  imageObserver.disconnect();
  for (const url of imageUrls) URL.revokeObjectURL(url);
  imageUrls.clear();
  jobs.replaceChildren();
  cards.clear();
  selectedJobIds.clear();
  updateSelected();
  const rootFolders=await list("'"+root+"' in parents and mimeType = '"+folderType+"'");
  const folders=[];
  for(const entry of rootFolders){
    if(entry.appProperties?.xyzStudio==='colabReactionGroup'){
      const children=await list("'"+entry.id+"' in parents and mimeType = '"+folderType+"'");
      for(const job of children){job._parentName=entry.name;job._parentId=entry.id;folders.push(job);}
    }else folders.push(entry);
  }
  folders.forEach(job => { job.addedAt = Date.parse(job.createdTime); });
  folders.sort((a,b) => Mol.compareDisplayOrder(a,b,order.value));
  for (let offset=0; offset<folders.length; offset+=4) {
    const group = folders.slice(offset,offset+4);
    const results = await Promise.allSettled(group.map(renderRecord));
    if (results.some(result => result.status === 'rejected')) {
      get('colabErrors').textContent = '一部の計算記録を読み込めませんでした。';
    }
  }
  sortCards();
}

async function renderRecord(job) {
  const summary = readSummary(job.appProperties);
  let files = summary?.files ?? new Map();
  if (!summary || summary.needsFiles) {
    const listed = new Map((await list("'" + job.id + "' in parents")).map(file => [file.name,file.id]));
    // Preserve the cached IDs when the child list is only a fallback.
    files = new Map([...listed,...files]);
  }
  if (!files.has('config.txt')) return;
  let config;
  let parsed;
  if (!summary || summary.needsConfig) {
    config = await (await download(files.get('config.txt'))).text();
    parsed = parseConfig(config);
  } else {
    parsed = {count:summary.count,lines:summary.lines};
  }
  const card = document.createElement('article');
  card.className = 'colab-job';
  const images = document.createElement('div');
  images.className = 'colab-images';
  for (const [name, label] of [['START.png','START'], ['FINAL.png','FINAL'], ['Energy.png','エネルギープロファイル']]) {
    const figure = document.createElement('figure'), caption = document.createElement('figcaption');
    caption.textContent = label;
    figure.append(caption);
    if (files.has(name)) {
      const img = document.createElement('img');
      img.alt = label;
      img.dataset.driveFile = files.get(name);
      imageObserver.observe(img);
      figure.append(img);
    }
    images.append(figure);
  }
  const info = document.createElement('div');
  info.className = 'colab-meta';
  const savedCount = parsed.count === '?' ? undefined : parsed.count;
  const count = document.createElement('span');
  count.textContent = savedCount !== undefined ? savedCount + 'ファイル'
    : files.has('計算結果') ? 'ファイル数を確認中…'
    : 'ファイル数不明';
  info.append(count);
  for (const line of displayLines(parsed)) {
    const field = document.createElement('span');
    field.textContent = line;
    info.append(field);
  }
  const open = document.createElement('button');
  open.type = 'button';
  open.textContent = '反応経路を開く';
  open.onclick = () => void openReaction(job.id,job._parentName?job._parentName+'/'+job.name:job.name,files.get('計算結果'),files);
  const title = document.createElement('h3');
  title.textContent = job._parentName?job._parentName+'/'+job.name:job.name;
  title.className = 'colab-record-name';
  Mol.editName(title,name=>renameRecord(job.id,Mol.safeName(name.split('/').at(-1))),status);
  const notes = document.createElement('div');
  notes.className = 'colab-notes';
  const notesLabel = document.createElement('strong');
  notesLabel.textContent = '備考';
  const note = document.createElement('div');
  note.className = 'colab-note-text';
  note.textContent = job.description || '';
  const noteError = document.createElement('p');
  noteError.className = 'colab-note-error';
  noteError.setAttribute('role','status');
  Mol.editName(note,async value=>{
    noteError.textContent = '';
    await request(drive + '/files/' + encodeURIComponent(job.id) + '?fields=id',{
      method:'PATCH', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({description:value}),
    });
    job.description = value;
    return value;
  },message=>{ noteError.textContent = '備考を保存できませんでした。' + message; },
  {label:'備考',multiline:true,allowEmpty:true});
  notes.append(notesLabel,note,noteError);
  const selectionCheckbox = document.createElement('input');
  selectionCheckbox.type = 'checkbox';
  selectionCheckbox.className = 'colab-select-toggle';
  selectionCheckbox.setAttribute('aria-label', 'この計算記録を選択');
  selectionCheckbox.onclick = event => {
    event.stopPropagation();
    toggleSelected(job.id);
  };
  // Ctrl+left-click anywhere on the record changes only selection. It must
  // run in capture phase to prevent nested buttons from opening/downloading.
  card.addEventListener('click', event => {
    if (!(event.ctrlKey || event.metaKey) || event.target === selectionCheckbox) return;
    if (event.target.closest('input,textarea,[contenteditable="true"]')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    toggleSelected(job.id);
  }, true);
  card.addEventListener('contextmenu', event => {
    if (!event.shiftKey) return;
    event.preventDefault();
    toggleSelected(job.id);
  });
  card.onclick = event => {
    if (event.target.closest('button,input,.colab-record-name,.colab-notes')) return;
    clearSelected();
    open.click();
  };
  card.append(selectionCheckbox);
  const classificationButton = document.createElement('button');
  classificationButton.type = 'button';
  classificationButton.textContent = job.appProperties?.classification
    ? '分類：' + job.appProperties.classification : '分類を設定';
  classificationButton.onclick = () => openClassification(job.id);
  const archive = document.createElement('button');
  archive.type = 'button';
  archive.textContent = '結果ZIPをダウンロード';
  archive.disabled = !files.has('計算結果');
  archive.onclick = () => void downloadArchive(job,files.get('計算結果'),archive);
  const colabArchive = document.createElement('button');
  colabArchive.type = 'button';
  colabArchive.textContent = 'ColabReaction互換ZIPを書き出す';
  colabArchive.disabled = archive.disabled;
  colabArchive.onclick = () => void downloadArchive(job,files.get('計算結果'),colabArchive,{colabResult:true});
  if(job.appProperties?.reactionName){
    const originalName=document.createElement('p');
    originalName.className='muted';
    originalName.textContent='元の反応：'+job.appProperties.reactionName;
    card.append(originalName);
  }
  card.append(title, images, info, notes, open, classificationButton, archive, colabArchive);
  const resultDate = summaryResultDate(parsed);
  cards.set(job.id,Object.assign(job,{card,title,classificationButton,selectionCheckbox,resultDate,recordFiles:files}));
  jobs.append(card);
  let counted;
  if (savedCount === undefined && files.has('計算結果') && (!summary || summary.count !== '?')) {
    try {
      counted = await countOriginalFiles(files.get('計算結果'));
      count.textContent = counted + 'ファイル';
    } catch { count.textContent = 'ファイル数不明'; }
  }
  if (!summary || summary.needsFiles || summary.needsConfig || counted !== undefined) {
    // Do not overwrite an out-of-limit field with a shortened value.
    const source = config ?? [
      'ファイル数: ' + (savedCount ?? counted ?? ''),
      ...Object.values(parsed.lines).flat(),
    ].join('\n');
    const props = summaryProperties(source,files,counted,job.appProperties);
    // No need to repeat a failed write every time an oversized field is encountered.
    if (!summary || Object.entries(props).some(([key,value]) => job.appProperties?.[key] !== value)) {
      await writeRecordSummary(job.id,props);
    }
  }
}


async function locateEnergyCSV(originalsId) {
  const folders = [originalsId];
  while (folders.length) {
    const children = await list("'" + folders.pop() + "' in parents");
    const csv = children.find(file => file.name === 'DMF_energy.csv' && file.mimeType !== folderType);
    if (csv) return csv.id;
    for (const file of children) if (file.mimeType === folderType) folders.push(file.id);
  }
  return null;
}

async function updateEnergyImage(job) {
  const files = job.recordFiles;
  const current = files?.get('Energy.png');
  const originals = files?.get('計算結果');
  if (!current || !originals) return 'skipped';
  if (job.appProperties?.energyPlotVersion === '2') return 'unchanged';
  const csvId = await locateEnergyCSV(originals);
  if (!csvId) return 'skipped';
  const csvText = await (await download(csvId)).text();
  const points = readEnergy(csvText);
  if (!points?.length) throw Error('DMF_energy.csvにプロット可能な点がありません。');
  const plot = await energyPlot(points);
  // Replace the same Drive file ID so all existing references keep working.
  await request('https://www.googleapis.com/upload/drive/v3/files/' +
    encodeURIComponent(current) + '?uploadType=media', {
      method:'PATCH', headers:{'Content-Type':'image/png'}, body:plot,
    });
  // Mark only after a confirmed media update. An unsuccessful marker patch will
  // merely allow a harmless retry on the next bulk run.
  await request(drive + '/files/' + encodeURIComponent(job.id) + '?fields=id', {
    method:'PATCH', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({appProperties:{energyPlotVersion:'2'}}),
  });
  job.appProperties = {...job.appProperties,energyPlotVersion:'2'};
  const preview = job.card?.querySelector('img[alt="エネルギープロファイル"]');
  if (preview?.isConnected) {
    const url = URL.createObjectURL(plot);
    imageUrls.add(url);
    if (preview.src?.startsWith('blob:')) {
      URL.revokeObjectURL(preview.src);
      imageUrls.delete(preview.src);
    }
    imageObserver.unobserve(preview);
    preview.src=url;
  }
  return 'updated';
}

replotButton.onclick = async () => {
  if (replotRunning || active || pending.length || connecting || !token || !root) return;
  replotRunning=true;
  replotButton.disabled=true;
  let updated=0,unchanged=0,skipped=0,failed=0;
  const records=[...cards.values()];
  try {
    for (let i=0;i<records.length;i++) {
      const job=records[i];
      status('既存のEnergy.pngを再生成中 ' + (i+1) + '/' + records.length +
        '（更新 ' + updated + '・対象外 ' + skipped + '・失敗 ' + failed + '）');
      try {
        const outcome=await updateEnergyImage(job);
        if (outcome==='updated') updated++;
        else if (outcome==='unchanged') unchanged++;
        else skipped++;
      } catch (error) {
        failed++;
        const message=document.createElement('p');
        message.textContent=job.name+': Energy.pngの再生成に失敗しました。'+error.message;
        get('colabErrors').append(message);
      }
    }
    status('Energy.pngの更新完了：更新 '+updated+'件・既に新版 '+unchanged+
      '件・対象外 '+skipped+'件・失敗 '+failed+'件');
  } finally {
    replotRunning=false;
    replotButton.disabled=!token || !root;
  }
};


// Manual one-time migration. Never runs during normal page load or refresh.
// In colab.html DevTools: await molBenchLegacyMigration('preview')
//                         await molBenchLegacyMigration('run')
let manualLegacyMigrationRunning = false;
const legacyUUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const legacyNumber = (name, method) => {
  const match=String(name||'').match(new RegExp('^'+method+'\\((\\d+)\\)$'));
  const number=match?Number(match[1]):0;
  return Number.isSafeInteger(number)&&number>0?number:0;
};
const legacyField=(source,field)=>source.split(/\r?\n/)
  .find(line=>line.startsWith(field+':'))?.slice(field.length+1).trim()||'';
const legacyPositive=value=>{
  const number=Number(value);
  return Number.isSafeInteger(number)&&number>0?number:0;
};
const legacySafeName=value=>Mol.safeName(String(value).trim()).slice(0,105);
const legacyRecordComplete=(job,group)=>{
  const p=job.appProperties||{};
  return !!group && legacyUUID.test(p.runId||'') &&
    legacyPositive(p.runNumber)===legacyNumber(job.name,p.method||'DMF') &&
    legacyPositive(p.runNumber)>0;
};
async function legacyInventory(){
  const top=await list("'"+root+"' in parents and mimeType = '"+folderType+"'");
  const groups=top.filter(item=>item.appProperties?.xyzStudio==='colabReactionGroup');
  const entries=top.filter(item=>item.appProperties?.xyzStudio!=='colabReactionGroup')
    .map(job=>({job,group:null}));
  const siblings=new Map();
  for(const group of groups){
    const children=await list("'"+group.id+"' in parents and mimeType = '"+folderType+"'");
    siblings.set(group.id,children);
    for(const job of children)if(!legacyRecordComplete(job,group))
      entries.push({job,group});
  }
  return {top,groups,entries,siblings};
}
async function molBenchLegacyMigration(mode='preview'){
  if(mode!=='preview'&&mode!=='run')throw Error("mode は 'preview' または 'run' です。");
  if(!token||!root)throw Error('Colab計算記録ページでGoogle Driveに接続してください。');
  if(manualLegacyMigrationRunning||active||pending.length||connecting||replotRunning)
    throw Error('取り込み・再生成・移行の終了後に実行してください。');
  manualLegacyMigrationRunning=true;
  const disabled={input:input.disabled,folder:folderInput.disabled,replot:replotButton.disabled};
  input.disabled=folderInput.disabled=replotButton.disabled=true;
  updateImportButtons();
  try {
    const inventory=await legacyInventory();
    const {top,groups,entries,siblings}=inventory;
    const prepared=[];
    for(const {job,group} of entries){
      const children=await list("'"+job.id+"' in parents");
      const configFile=children.find(f=>f.name==='config.txt'&&f.mimeType!==folderType);
      if(!configFile){
        prepared.push({job,group,skip:'config.txtがない未完了記録'});
        continue;
      }
      let config;
      try {config=await(await download(configFile.id)).text();}
      catch(error){
        prepared.push({job,group,skip:'config.txtを取得できない: '+error.message});
        continue;
      }
      const p=job.appProperties||{};
      const reactionId=p.sourceReactionId||legacyField(config,'元の反応ID')||
        group?.appProperties?.sourceReactionId||'';
      const reactionName=p.reactionName||legacyField(config,'元の反応名')||'';
      const runId=legacyUUID.test(p.runId||'')?p.runId:
        legacyUUID.test(legacyField(config,'計算runId'))?legacyField(config,'計算runId'):
        legacyUUID.test(job.name)?job.name:null;
      const method=/^[A-Za-z0-9_-]{1,24}$/.test(p.method||'DMF')?p.method||'DMF':'DMF';
      prepared.push({job,group,reactionId,reactionName,runId,method,
        oldNumber:legacyPositive(p.runNumber)||legacyNumber(job.name,method)});
    }
    const report=prepared.map(item=>({
      original:item.group?item.group.name+'/'+item.job.name:item.job.name,
      proposedReaction:item.reactionName||item.runId||'(新しいUUIDを発行)',
      reactionId:item.reactionId||'(不明・独立管理)',
      existingNumber:item.oldNumber||'(なし)',
      action:item.skip||'移行対象',
    }));
    console.table(report);
    if(mode==='preview'){
      console.info('プレビューのみ。変更はありません。実行: await molBenchLegacyMigration("run")');
      return {mode,total:entries.length,report};
    }
    if(!prepared.length)return {mode,converted:0,skipped:0,failed:0,errors:[]};
    if(!confirm('旧Colab計算記録 '+prepared.length+' 件を移行します。'
      +'元の計算ファイルは変更せず、記録フォルダの名前・親フォルダ・内部情報だけ変更します。続行しますか？'))
      return {mode,cancelled:true};
    const usedNames=new Set(top.map(item=>item.name));
    const byReaction=new Map(groups.filter(g=>g.appProperties?.sourceReactionId)
      .map(g=>[g.appProperties.sourceReactionId,g]));
    const byLegacyFile=new Map(groups.filter(g=>g.appProperties?.legacySourceFileId)
      .map(g=>[g.appProperties.legacySourceFileId,g]));
    const usedRunIds=new Set();
    for(const group of groups)for(const other of siblings.get(group.id)||[])
      if(legacyRecordComplete(other,group))usedRunIds.add(other.appProperties.runId.toLowerCase());
    let converted=0,skipped=0;
    const errors=[];
    for(let index=0;index<prepared.length;index++){
      const item=prepared[index];
      const {job,method}=item;
      status('旧計算記録を移行中 '+(index+1)+'/'+prepared.length);
      if(item.skip){skipped++;continue;}
      try{
        let group=item.group;
        if(!group&&item.reactionId)group=byReaction.get(item.reactionId)||null;
        if(!group)group=byLegacyFile.get(job.id)||null;
        const runId=item.runId&&!usedRunIds.has(item.runId.toLowerCase())
          ?item.runId:crypto.randomUUID();
        if(!group){
          // Unknown reaction IDs are *never* matched on name alone.
          // A UUID is also the provisional human-readable name if the
          // original name was lost. The actual record is identified by Drive ID.
          const displayName=legacySafeName(item.reactionName||runId);
          const name=usedNames.has(displayName)
            ?Mol.nextDuplicateName(displayName,usedNames):displayName;
          const appProperties={xyzStudio:'colabReactionGroup',
            legacySourceFileId:job.id};
          if(item.reactionId)appProperties.sourceReactionId=item.reactionId;
          group=await(await request(drive+'/files?fields=id,name,appProperties',{
            method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({name,mimeType:folderType,parents:[root],appProperties}),
          })).json();
          usedNames.add(name);
          groups.push(group);
          siblings.set(group.id,[]);
          byLegacyFile.set(job.id,group);
          if(item.reactionId)byReaction.set(item.reactionId,group);
        }
        // The current source parent may be root OR an older reaction group.
        const sourceParent=item.group?.id||root;
        const siblingsNow=siblings.get(group.id)||
          await list("'"+group.id+"' in parents and mimeType = '"+folderType+"'");
        const occupied=new Set();
        for(const other of siblingsNow){
          if(other.id===job.id)continue;
          const number=legacyNumber(other.name,method);
          if(number)occupied.add(number);
          if(other.appProperties?.method===method){
            const propertyNumber=legacyPositive(other.appProperties.runNumber);
            if(propertyNumber)occupied.add(propertyNumber);
          }
        }
        // Existing Drive records are authoritative. Keep their names and numbers.
        // Only the incoming legacy record is renumbered on a collision.
        const runNumber=item.oldNumber&&!occupied.has(item.oldNumber)
          ?item.oldNumber:Math.max(0,...occupied)+1;
        const leaf=method+'('+runNumber+')';
        const props={...job.appProperties,runId,method,runNumber:String(runNumber),
          legacyMigrationVersion:'2'};
        if(item.reactionId)props.sourceReactionId=item.reactionId;
        if(item.reactionName&&new TextEncoder().encode(item.reactionName).length<=100)
          props.reactionName=item.reactionName;
        if(!props.legacyOriginalName&&new TextEncoder().encode(job.name).length<=100)
          props.legacyOriginalName=job.name;
        const moving=sourceParent!==group.id;
        const query=new URLSearchParams({fields:'id,name,parents,appProperties'});
        if(moving){
          query.set('addParents',group.id);
          query.set('removeParents',sourceParent);
        }
        const saved=await(await request(drive+'/files/'+encodeURIComponent(job.id)
          +'?'+query,{
            method:'PATCH',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({name:leaf,appProperties:props}),
          })).json();
        if(saved.name!==leaf||saved.appProperties?.runId!==runId||
          saved.appProperties?.runNumber!==String(runNumber)||
          (moving&&!saved.parents?.includes(group.id)))
          throw Error('Drive上の名前・番号・移動先を確認できませんでした。');
        usedRunIds.add(runId.toLowerCase());
        siblingsNow.push({...job,name:leaf,appProperties:props});
        siblings.set(group.id,siblingsNow);
        converted++;
      }catch(error){
        errors.push({record:job.name,message:error.message});
        console.error('旧計算記録の移行失敗',job.name,error);
      }
    }
    await refresh();
    status('旧記録の移行完了：成功 '+converted+'・未完了 '+skipped+'・失敗 '+errors.length);
    console.table(errors);
    return {mode,converted,skipped,failed:errors.length,errors};
  }finally{
    manualLegacyMigrationRunning=false;
    input.disabled=disabled.input;
    folderInput.disabled=disabled.folder;
    replotButton.disabled=disabled.replot;
    updateImportButtons();
  }
}
Object.defineProperty(window,'molBenchLegacyMigration',{
  configurable:true,value:molBenchLegacyMigration,
});

async function authorize(response) {
  if (!response.access_token) {
    status('Google Driveへの接続が完了しませんでした。');
    return;
  }
  connecting = true;
  token = response.access_token;
  root = null;
  connect.disabled = input.disabled = folderInput.disabled = replotButton.disabled = true;
  updateImportButtons();
  try {
    status('Google Driveの計算記録を読み込んでいます…');
    await withRecordLoading(async () => {
      const folders = await list("mimeType = '" + folderType + "' and appProperties has { key='xyzStudio' and value='colabRecords' }");
      root = folders[0]?.id ?? await folder('分子 XYZ スタジオ Colab計算記録', null, 'colabRecords');
      void pruneColabFileCache();
      await loadRecords();
    });
    status(cards.size + ' 件の計算記録。ZIPまたはフォルダーを追加できます。');
    input.disabled = folderInput.disabled = false;
    updateImportButtons();
    replotButton.disabled = false;
    connect.textContent = 'Google Driveに再接続';
  } catch (error) {
    status(error.message);
  } finally {
    connecting = false;
    connect.disabled = false;
    void runQueue();
  }
}

const setup = get('driveSetup');
const secretInput = get('driveSecret');
let connectionState, checking;
const temporary = get('driveTemporary');
let temporaryClient;
const authScript = document.createElement('script');
authScript.src = 'https://accounts.google.com/gsi/client';
temporary.onclick = () => {
  if (active || connecting || checking) return;
  if (temporaryClient) temporaryClient.requestAccessToken();
  else status('Googleの接続機能を読み込み中です。少し待ってからもう一度押してください。');
};
authScript.onload = () => {
  temporaryClient = google.accounts.oauth2.initTokenClient({
    client_id: '816593665225-jlsi7t1qdl5icihukahrb3t567qu9qnj.apps.googleusercontent.com',
    scope: 'https://www.googleapis.com/auth/drive.file',
    include_granted_scopes: false,
    callback: result => {
      if (!result.access_token) {
        status('Google Driveへの接続が完了しませんでした。');
        return;
      }
      connect.hidden = true;
      setup.hidden = true;
      persistent = false;
      void authorize(result);
    },
    error_callback: () => status('Googleの許可画面を開けませんでした。'),
  });
};
authScript.onerror = () => { temporary.disabled = true; };
document.head.append(authScript);
async function restoreDrive() {
  if (checking || active || connecting) return;
  checking = true;
  connect.disabled = true;
  try {
    const response = await driveFetch('token', {cache: 'no-store'});
    const result = await response.json();
    connectionState = result.state;
    setup.hidden = !['setup', 'invalid_secret'].includes(result.state);
    if (result.state === 'connected') {
      persistent = true;
      connect.hidden = true;
      await authorize(result);
      return;
    }
    connect.hidden = !['signin', 'connect', 'unavailable', 'google_error', 'authorization_error'].includes(result.state);
    connect.textContent = result.state === 'signin' ? 'ChatGPTでログイン' :
      ['connect', 'authorization_error'].includes(result.state) ? 'Google Driveに接続' : '接続を再確認';
    const messages = {
      authorization_error: 'Googleとの接続を完了できませんでした。もう一度接続してください。',
      migration_required: 'この移転先ではGoogle Driveの継続接続は準備中です。',
      signin: '継続接続を利用するにはChatGPTでログインしてください。',
      forbidden: standaloneDrive ? 'Googleアカウントの確認が完了しませんでした。別のアカウントで接続し直してください。' : 'このサイトの継続接続はオーナー専用です。',
      setup: 'Googleで作成したクライアントシークレットを登録してください。',
      invalid_secret: 'Googleがシークレットを認識できませんでした。値を登録し直してください。',
      connect: 'Google Driveに一度接続してください。',
      unavailable: 'サーバーの接続設定を確認できませんでした。',
      google_error: 'Googleとの接続を更新できませんでした。',
    };
    status(messages[result.state] ?? '接続を確認できませんでした。');
    const error = new URLSearchParams(location.search).get('drive_error');
    if (error && result.state === 'connect') {
      status(error === 'exchange' ? 'Googleの許可を保存できませんでした。シークレットとOAuth設定を確認してください。' :
        'Googleの許可が完了しませんでした。もう一度接続できます。');
      setup.hidden = false;
    }
  } catch (error) {
    connect.hidden = false;
    connect.textContent = '接続を再確認';
    status('接続を確認できませんでした。' + (error.message || '不明なエラー'));
  } finally {
    checking = false;
    connect.disabled = false;
  }
}
connect.onclick = () => {
  if (standaloneDrive && ['connect', 'authorization_error'].includes(connectionState)) {
    beginDriveConnection();
    return;
  }
  if (connectionState === 'signin') {
    window.top.location.href = '/signin-with-chatgpt?return_to=' + encodeURIComponent('/colab.html?drive=1');
  } else if (connectionState === 'connect') {
    window.top.location.href = '/api/drive/connect';
  } else {
    void restoreDrive();
  }
};
setup.onsubmit = async event => {
  event.preventDefault();
  const submit = setup.querySelector('button');
  submit.disabled = true;
  try {
    const response = await fetch('/api/drive/setup', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({secret: secretInput.value.trim()}),
    });
    if (!response.ok) throw Error('シークレットを保存できませんでした。値を確認してください。');
    await restoreDrive();
  } catch (error) {
    status(error.message);
  } finally {
    secretInput.value = '';
    submit.disabled = false;
  }
};
void restoreDrive();
window.addEventListener('beforeunload',event => {
  if (!active && !pending.length) return;
  event.preventDefault();
  event.returnValue = '';
});

function zipJob(file) {
  return {name: file.name, sourceLabel: 'ZIP', readFiles: () => readZip(file)};
}

input.onchange = () => {
  enqueue([...input.files].map(zipJob));
  input.value = '';
};

folderInput.onchange = () => {
  const files = [...folderInput.files];
  folderInput.value = '';
  if (!files.length) return;
  const name = files[0].webkitRelativePath.split('/')[0];
  enqueue([{name, sourceLabel: 'フォルダー', readFiles: () =>
    readFolder(files, file => file.webkitRelativePath.slice(name.length + 1))}]);
};

function folderJob(entry) {
  return {name: entry.name, sourceLabel: 'フォルダー', async readFiles() {
    status('フォルダーを読み込んでいます…');
    const entries = await Mol.scanEntries([entry], {
      accept: () => true,
      error: message => { throw Error(message); },
    });
    const files = await Promise.all(entries.map(child =>
      new Promise((resolve, reject) => child.file(resolve, reject))));
    const paths = new Map(files.map((file, index) =>
      [file, entries[index].fullPath.slice(entry.fullPath.length + 1)]));
    return readFolder(files, file => paths.get(file));
  }};
}

// Like the molecule library, allow import drops anywhere on this page.
document.addEventListener('dragover', event => {
  if (!event.dataTransfer?.types.includes('Files')) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = input.disabled ? 'none' : 'copy';
});
document.addEventListener('drop', event => {
  if (!event.dataTransfer?.types.includes('Files')) return;
  event.preventDefault();
  if (input.disabled) {
    status('Google Driveに接続するとZIPやフォルダーを取り込めます。');
    return;
  }
  const {files, items} = event.dataTransfer;
  const records = [];
  const dropped = [...items].filter(item => item.kind === 'file');
  if (dropped.length) {
    for (const item of dropped) {
      const entry = item.webkitGetAsEntry?.();
      if (entry?.isDirectory) {
        records.push(folderJob(entry));
      } else {
        const file = item.getAsFile();
        if (file && /\.zip$/i.test(file.name)) records.push(zipJob(file));
      }
    }
  } else {
    records.push(...[...files].filter(file => /\.zip$/i.test(file.name)).map(zipJob));
  }
  if (records.length) enqueue(records);
  else status('計算結果のZIPまたはフォルダーをドロップしてください。');
});
