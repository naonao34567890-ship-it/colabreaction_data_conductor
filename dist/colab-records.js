import {readEnergy} from './dmf-energy.js';

const get = id => document.getElementById(id);
const connect = get('driveConnect');
const input = get('colabZip');
const folderInput = get('colabFolder');
const jobs = get('colabJobs');
const order = get('colabOrder');
const cards = new Map();
order.value = 'name-asc';
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
      const renewed = await fetch('/api/drive/token', {cache: 'no-store'});
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
      fields: 'nextPageToken,files(id,name,appProperties,createdTime,mimeType)', pageSize: '100'});
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
  const boundary = crypto.randomUUID();
  const body = new Blob([
    '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n',
    JSON.stringify({name, parents: [parent]}),
    '\r\n--' + boundary + '\r\nContent-Type: ' + (blob.type || 'application/octet-stream') + '\r\n\r\n',
    blob, '\r\n--' + boundary + '--\r\n',
  ]);
  return (await (await request('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST', headers: {'Content-Type': 'multipart/related; boundary=' + boundary}, body,
  })).json()).id;
}

const download = id => request(drive + '/files/' + encodeURIComponent(id) + '?alt=media');
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
  const values = points.map(p => p[1]);
  const ymin = Math.min(...values), ymax = Math.max(...values);
  const low = ymin === ymax ? ymin - 0.5 : ymin;
  const high = ymin === ymax ? ymax + 0.5 : ymax;
  const left = 350, right = 920, top = 155, bottom = 515;
  const x = value => xmin === xmax ? (left + right) / 2 :
    left + (right - left) * (value - xmin) / (xmax - xmin);
  const y = value => bottom - (bottom - top) * (value - low) / (high - low);
  ctx.fillStyle = '#101313';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#e8efed';
  ctx.font = 'bold 90px sans-serif';
  ctx.fillText('ΔE (kJ/mol)', 20, 95);
  ctx.font = 'bold 100px sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let tick = 0; tick <= 3; tick++) {
    const energy = low + (high - low) * tick / 3;
    const yy = y(energy);
    ctx.fillText(energy.toFixed(1), left - 18, yy, left - 28);
    ctx.fillStyle = '#34413f';
    ctx.fillRect(left, yy, right - left, 2);
    ctx.fillStyle = '#e8efed';
  }
  ctx.font = 'bold 84px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(String(xmin), left, 600, 160);
  if (xmax !== xmin) ctx.fillText(String(xmax), right - 38, 600, 160);
  ctx.fillText('フレーム', (left + right) / 2, 600, 335);
  ctx.fillStyle = '#62d6bf';
  for (const [frame, energy] of points) {
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
  status('ZIPを読み込んでいます…');
  if (file.size > 50 * 1024 ** 2) throw Error('ZIPは50 MiB以内にしてください。');
  const {unzipSync} = await import('https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js');
  let total = 0, count = 0;
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()), {filter(entry) {
    total += entry.originalSize;
    if (total > 100 * 1024 ** 2 || ++count > 500) throw Error('展開後は100 MiB・500項目までです。');
    return !entry.name.endsWith('/');
  }});
  const files = new Map();
  for (const [path, bytes] of Object.entries(entries)) {
    const parts = path.split('/');
    if (path.includes('\\') || parts.some(part => !part || part === '.' || part === '..')) {
      throw Error('ZIP内に無効なファイルパスがあります。');
    }
    files.set(path, new Blob([bytes]));
  }
  return files;
}

function readFolder(files, relativePath) {
  const result = new Map();
  let bytes = 0;
  for (const file of files) {
    bytes += file.size;
    if (bytes > 100 * 1024 ** 2 || result.size >= 500) {
      throw Error('フォルダーは100 MiB・500ファイルまでです。');
    }
    result.set(relativePath(file), file);
  }
  return result;
}

async function alreadyRegistered(name) {
  const escaped = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const matches = await list("'" + root + "' in parents and mimeType = '" + folderType +
    "' and name = '" + escaped + "'");
  for (const match of matches) {
    const completed = await list("'" + match.id + "' in parents and name = 'config.txt'");
    if (completed.length) return true;
  }
  return false;
}

async function importRecords(name, sourceLabel, readFiles) {
  let parent;
  try {
    if (await alreadyRegistered(name)) {
      status('登録済みのためスキップしました。' + name);
      return;
    }
    const files = await readFiles();
    function find(name) {
      const matches = [...files].filter(([path]) => path.split('/').at(-1) === name);
      if (matches.length > 1) throw Error(name + ' が複数あります。計算結果を1件ずつ取り込んでください。');
      return matches[0]?.[1];
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
    await upload('START.png', parent, start);
    await upload('FINAL.png', parent, final);
    await upload('Energy.png', parent, plot);
    await upload('config.txt', parent, new Blob([config], {type:'text/plain'}));
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
  }
}

function sortCards() {
  const entries = [...cards.values()].sort((a,b) => Mol.compareDisplayOrder(a,b,order.value));
  for (const entry of entries) jobs.append(entry.card);
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

function connectImageSaver(params, jobId, images) {
  const channelId = crypto.randomUUID();
  params.set('images', channelId);
  const channel = new BroadcastChannel('reaction-images:' + channelId);
  channel.onmessage = async ({data}) => {
    if (data?.close) { channel.close(); return; }
    const {target, image, id} = data ?? {};
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

async function openReaction(jobId, name, originals, images) {
  const tab = window.open('about:blank', '_blank');
  if (!tab) { status('反応経路ビューアのタブを開けませんでした。'); return; }
  tab.opener = null;
  tab.document.body.textContent = '反応経路を読み込み中…';
  const urls = [];
  try {
    if (!originals) throw Error('計算結果フォルダーがありません。');
    const directories = [originals];
    const found = new Map();
    while (directories.length && found.size < 2) {
      for (const file of await list("'" + directories.pop() + "' in parents")) {
        if (file.mimeType === folderType) directories.push(file.id);
        else if (['DMF_final.xyz','DMF_energy.csv'].includes(file.name)) found.set(file.name,file.id);
      }
    }
    if (!found.has('DMF_final.xyz')) throw Error('DMF_final.xyz が見つかりません。');
    const params = new URLSearchParams({name, job:jobId});
    for (const [file, key] of [['DMF_final.xyz','source'], ['DMF_energy.csv','energy']]) {
      if (!found.has(file)) continue;
      const blob = await (await download(found.get(file))).blob();
      const url = URL.createObjectURL(blob);
      urls.push(url);
      params.set(key,url);
    }
    if (tab.closed) throw Error('反応経路ビューアを閉じました。');
    if (images.has('START.png') && images.has('FINAL.png')) connectImageSaver(params,jobId,images);
    tab.location.replace('reaction-viewer.html#' + params);
  } catch (error) {
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

function openClassification(jobId) {
  classificationJob = cards.get(jobId);
  if (!classificationJob || classificationDialog.open) return;
  const current = classificationJob.appProperties?.classification;
  get('classificationCurrent').textContent = '現在の分類：' + (current || 'なし');
  get('classificationStatus').textContent = '';
  classificationName.value = '';
  classificationForm.hidden = classificationCreate.disabled = true;
  get('classificationRemove').disabled = !current;
  const choices = get('classificationChoices');
  choices.replaceChildren();
  const names = new Set([...cards.values()].map(job => job.appProperties?.classification).filter(Boolean));
  for (const name of [...names].sort(Mol.compareTagNames)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = name;
    button.onclick = () => void saveClassification(name);
    choices.append(button);
  }
  classificationDialog.showModal();
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
  classificationForm.hidden = false;
  classificationName.focus();
};
classificationName.oninput = () => { classificationCreate.disabled = !classificationName.value.trim(); };
classificationForm.onsubmit = event => {
  event.preventDefault();
  const name = classificationName.value.trim();
  if (name) void saveClassification(name);
};

async function refresh() {
  for (const url of imageUrls) URL.revokeObjectURL(url);
  imageUrls.clear();
  jobs.replaceChildren();
  cards.clear();
  const folders = await list("'" + root + "' in parents and mimeType = '" + folderType + "'");
  folders.forEach(job => { job.addedAt = Date.parse(job.createdTime); });
  folders.sort((a,b) => Mol.compareDisplayOrder(a,b,order.value));
  for (const job of folders) {
    const files = new Map((await list("'" + job.id + "' in parents")).map(file => [file.name, file.id]));
    if (!files.has('config.txt')) continue;
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
        const url = URL.createObjectURL(await (await download(files.get(name))).blob());
        imageUrls.add(url);
        img.src = url;
        figure.append(img);
      }
      images.append(figure);
    }
    const info = document.createElement('div');
    info.className = 'colab-meta';
    const config = await (await download(files.get('config.txt'))).text();
    const savedCount = config.match(/^ファイル数: (\d+)$/m)?.[1];
    const count = document.createElement('span');
    count.textContent = savedCount !== undefined ? savedCount + 'ファイル'
      : files.has('計算結果') ? (await countOriginalFiles(files.get('計算結果'))) + 'ファイル'
      : 'ファイル数不明';
    info.append(count);
    for (const line of config.split(/\r?\n/)) {
      if (!/^(プロット点数|電荷|spin(?:（出力値）)?|結果出力日時):/.test(line)) continue;
      const field = document.createElement('span');
      field.textContent = line.replace(/^電荷:\s*/, '⚡ ')
        .replace(/^spin(?:（出力値）)?:\s*/, '🌀 ')
        .replace(/^(結果出力日時:.*?)（[^）]*）$/, '$1');
      info.append(field);
    }
    const open = document.createElement('button');
    open.type = 'button';
    open.textContent = '反応経路を開く';
    open.onclick = () => void openReaction(job.id,job.name,files.get('計算結果'),files);
    card.onclick = event => { if (!event.target.closest('button')) open.click(); };
    const classificationButton = document.createElement('button');
    classificationButton.type = 'button';
    classificationButton.textContent = job.appProperties?.classification
      ? '分類：' + job.appProperties.classification : '分類を設定';
    classificationButton.onclick = () => openClassification(job.id);
    card.append(images, info, open, classificationButton);
    cards.set(job.id,{...job,card,classificationButton});
    jobs.append(card);
  }
  sortCards();
}

async function authorize(response) {
  if (!response.access_token) {
    status('Google Driveへの接続が完了しませんでした。');
    return;
  }
  connecting = true;
  token = response.access_token;
  root = null;
  connect.disabled = input.disabled = folderInput.disabled = true;
  try {
    status('Google Driveの計算記録を読み込んでいます…');
    const folders = await list("mimeType = '" + folderType + "' and appProperties has { key='xyzStudio' and value='colabRecords' }");
    root = folders[0]?.id ?? await folder('分子 XYZ スタジオ Colab計算記録', null, 'colabRecords');
    await refresh();
    status(jobs.childElementCount + ' 件の計算記録。ZIPまたはフォルダーを追加できます。');
    input.disabled = folderInput.disabled = false;
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
    const response = await fetch('/api/drive/token', {cache: 'no-store'});
    const result = await response.json();
    connectionState = result.state;
    setup.hidden = !['setup', 'invalid_secret'].includes(result.state);
    if (result.state === 'connected') {
      persistent = true;
      connect.hidden = true;
      await authorize(result);
      return;
    }
    connect.hidden = !['signin', 'connect', 'unavailable', 'google_error'].includes(result.state);
    connect.textContent = result.state === 'signin' ? 'ChatGPTでログイン' :
      result.state === 'connect' ? 'Google Driveに接続' : '接続を再確認';
    const messages = {
      signin: '継続接続を利用するにはChatGPTでログインしてください。',
      forbidden: 'このサイトの継続接続はオーナー専用です。',
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
  } catch {
    connect.hidden = false;
    connect.textContent = '接続を再確認';
    status('接続を確認できませんでした。');
  } finally {
    checking = false;
    connect.disabled = false;
  }
}
connect.onclick = () => {
  if (connectionState === 'signin') {
    window.top.location.href = '/signin-with-chatgpt?return_to=' + encodeURIComponent('/?drive=1');
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
get('colabMode').addEventListener('click', () => { if (!token) void restoreDrive(); });
if (new URLSearchParams(location.search).has('drive')) get('colabMode').click();

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

const drop = get('colabDrop');
drop.ondragover = event => event.preventDefault();
drop.ondrop = event => {
  event.preventDefault();
  if (input.disabled) return;
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
};
