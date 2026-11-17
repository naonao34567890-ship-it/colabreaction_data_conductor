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

async function alreadyRegistered(name) {
  const key = await importKey(name);
  const escaped = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const matches = await list("'" + root + "' in parents and mimeType = '" + folderType +
    "' and (name = '" + escaped + "' or appProperties has { key='importKey' and value='" + key + "' })");
  for (const match of matches) {
    if (match.appProperties?.importKey && match.appProperties.importKey !== key) continue;
    const completed = await list("'" + match.id + "' in parents and name = 'config.txt'");
    if (completed.length) return true;
  }
  return false;
}

async function importRecords(name, sourceLabel, readFiles) {
  let parent, temporary;
  try {
    if (await alreadyRegistered(name)) {
      status('登録済みのためスキップしました。' + name);
      return;
    }
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
    const batchManifest=files.get('batch_status.json');
    if(batchManifest){
      let batch;
      try{
        if(batchManifest.size<=5*1024*1024)
          batch=JSON.parse(await batchManifest.text());
      }catch(error){
        throw Error('batch_status.json を解析できませんでした: '+error.message);
      }
      if(batch?.format==='mol-bench-colabreaction-batch'){
        const members=[...files].filter(([path])=>/^[^/]+\\.zip$/i.test(path));
        if(!members.length)throw Error('一括結果ZIPの中に個別計算結果ZIPがありません。');
        let index=0;
        for(const [memberName, memberFile] of members){
          status('一括計算結果を取り込み中 '+(++index)+'/'+members.length+': '+memberName);
          await importRecords(memberName,'ZIP',()=>readZip(memberFile));
        }
        status('一括計算結果ZIPの処理が完了しました（'+members.length+'件）。失敗した項目はエラー欄を確認してください。');
        return;
      }
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
    const reactant = find('reactant.xyz'), product = find('product.xyz');
    const csv = find('DMF_energy.csv'), trajectory = find('DMF_final.xyz');
    if (!reactant || !product || !csv) throw Error('reactant.xyz、product.xyz、DMF_energy.csv が必要です。');
    const points = readEnergy(await csv.text());
    const charge = await outputValue(trajectory, 'charge');
    const spin = await outputValue(trajectory, 'spin');
    const match = name.match(/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/);
    const date = match ? match.slice(1,4).join('-') + ' ' + match.slice(4).join(':') : '不明';
    const start = await thumbnail(reactant), final = await thumbnail(product), plot = await energyPlot(points);
    const config = [
      sourceLabel + '名: ' + name.replace(/[\r\n]/g, ' '), 'プロット点数: ' + points.length,
      'ファイル数: ' + files.size,
      '電荷: ' + charge, 'spin（出力値）: ' + spin, '電荷・spinの取得元: DMF_final.xyz',
      '結果出力日時: ' + date + (match ? '（' + sourceLabel + '名由来・タイムゾーン不明）' : ''),
      ...(sourceReaction?.name?['元の反応名: '+sourceReaction.name]:[]),
      ...(sourceReaction?.sourceReactionId?['元の反応ID: '+sourceReaction.sourceReactionId]:[]),
      ...(sourceReaction?.classification?['元の分類: '+sourceReaction.classification]:[]),
    ].join('\n');
    status('Google Driveに保存しています…');
    parent = await folder(name, root);
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
    await writeRecordSummary(parent,properties);
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

async function writeRecordSummary(id, properties) {
  try {
    await request(drive + '/files/' + encodeURIComponent(id) + '?fields=id', {
      method:'PATCH', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({appProperties:properties}),
    });
  } catch (error) {
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
    ? compareClassifications(a,b) : Mol.compareDisplayOrder(a,b,order.value));
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
  const appProperties = job.appProperties?.importKey ? undefined : {importKey:await importKey(job.name)};
  const response = await request(drive + '/files/' + encodeURIComponent(jobId) + '?fields=name,appProperties',{
    method:'PATCH', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({name,appProperties}),
  });
  Object.assign(job,await response.json());
  job.title.textContent = job.name;
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

async function downloadArchive(job, originals, button) {
  button.disabled = true;
  let output;
  try {
    const filename=Mol.safeName(job.name).replace(/\.zip$/i,'')+'.zip';
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
        const name = Mol.safeName(file.name);
        if (file.mimeType === folderType) pending.push({id:file.id,path:path+name+'/'});
        else files.push({id:file.id,path:path+name});
      }
    }
    if (!files.length) throw Error('ダウンロードできる計算結果がありません。');
    const {Zip,ZipPassThrough} = await import('./vendor/fflate.mjs');
    const pieces=[],paths=new Set();
    let write=Promise.resolve(),failure=null,finished=false;
    const archive=new Zip((error,chunk,final)=>{
      if(error){failure=error;return;}
      if(output)write=write.then(()=>output.write(chunk));
      else pieces.push(chunk);
      if(final)finished=true;
    });
    for(let i=0;i<files.length;i++){
      const file=files[i];
      if(paths.has(file.path))throw Error('ZIP内のファイル名が重複しています。');
      paths.add(file.path);
      button.textContent='取得中 '+(i+1)+'/'+files.length;
      const response=await download(file.id);
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
    button.textContent = '結果ZIPをダウンロード';
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
let classificationSaving = false;
let classificationRenaming = false, classificationFrom = null;

function openClassification(jobId) {
  classificationJob = cards.get(jobId);
  if (!classificationJob || classificationDialog.open) return;
  const current = classificationJob.appProperties?.classification;
  get('classificationCurrent').textContent = '現在の分類：' + (current || 'なし');
  get('classificationStatus').textContent = '';
  classificationName.value = '';
  classificationForm.hidden = classificationCreate.disabled = true;
  get('classificationRemove').disabled = !current;
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
  const jobId = classificationJob.id;
  feedback.textContent = '保存中…';
  try {
    const response = await request(drive + '/files/' + encodeURIComponent(jobId) + '?fields=appProperties', {
      method:'PATCH', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({appProperties:{classification:name || null}}),
    });
    const {appProperties} = await response.json();
    const job = cards.get(jobId);
    if (job) {
      job.appProperties = appProperties;
      job.classificationButton.textContent = name ? '分類：' + name : '分類を設定';
      if (order.value === 'classification') sortCards();
    }
    classificationDialog.close();
  } catch (error) {
    feedback.textContent = error.message;
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
    const folders = await list("'" + root + "' in parents and mimeType = '" + folderType + "'");
    if (folders.some(job=>job.appProperties?.classification===name)) throw Error('同じ名前の分類があります。');
    for (const job of folders.filter(job=>job.appProperties?.classification===from)) {
      const response = await request(drive + '/files/' + encodeURIComponent(job.id) + '?fields=appProperties',{
        method:'PATCH',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({appProperties:{classification:name}}),
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
  const folders = await list("'" + root + "' in parents and mimeType = '" + folderType + "'");
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
  open.onclick = () => void openReaction(job.id,job.name,files.get('計算結果'),files);
  const title = document.createElement('h3');
  title.textContent = job.name;
  title.className = 'colab-record-name';
  Mol.editName(title,name=>renameRecord(job.id,Mol.safeName(name)),status);
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
  card.onclick = event => { if (!event.target.closest('button,input,.colab-record-name,.colab-notes')) open.click(); };
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
  if(job.appProperties?.reactionName){
    const originalName=document.createElement('p');
    originalName.className='muted';
    originalName.textContent='元の反応：'+job.appProperties.reactionName;
    card.append(originalName);
  }
  card.append(title, images, info, notes, open, classificationButton, archive);
  const resultDate = summaryResultDate(parsed);
  cards.set(job.id,Object.assign(job,{card,title,classificationButton,resultDate,recordFiles:files}));
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
