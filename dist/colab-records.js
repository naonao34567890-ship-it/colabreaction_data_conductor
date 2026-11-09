const get = id => document.getElementById(id);
const connect = get('driveConnect');
const input = get('colabZip');
const jobs = get('colabJobs');
const status = message => { get('colabStatus').textContent = message; };
const scope = 'https://www.googleapis.com/auth/drive.file';
const folderType = 'application/vnd.google-apps.folder';
const drive = 'https://www.googleapis.com/drive/v3';
let token, root, client, renderer;
const imageUrls = new Set();

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options, headers: { ...options.headers, Authorization: 'Bearer ' + token },
  });
  if (response.status === 401) {
    token = null;
    input.disabled = true;
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
      fields: 'nextPageToken,files(id,name,appProperties)', pageSize: '100'});
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
  canvas.width = 720;
  canvas.height = 360;
  const ctx = canvas.getContext('2d');
  const xmin = points[0][0], xmax = points.at(-1)[0];
  const values = points.map(p => p[1]);
  const ymin = Math.min(...values), ymax = Math.max(...values);
  const x = value => 72 + 620 * (value - xmin) / (xmax - xmin || 1);
  const y = value => 304 - 252 * (value - ymin) / (ymax - ymin || 1);
  ctx.fillStyle = '#101313';
  ctx.fillRect(0, 0, 720, 360);
  ctx.font = '16px sans-serif';
  ctx.fillStyle = '#e8efed';
  ctx.fillText('ΔE (kJ/mol)', 16, 25);
  ctx.fillText('フレーム番号', 580, 345);
  for (let tick = 0; tick <= 4; tick++) {
    const energy = ymin + (ymax - ymin || 1) * tick / 4;
    const yy = y(energy);
    ctx.fillText(energy.toFixed(1), 8, yy + 5);
    ctx.fillStyle = '#34413f';
    ctx.fillRect(72, yy, 620, 1);
    ctx.fillStyle = '#e8efed';
  }
  ctx.fillText(String(xmin), 72, 325);
  if (xmax !== xmin) ctx.fillText(String(xmax), 665, 325);
  ctx.strokeStyle = ctx.fillStyle = '#62d6bf';
  ctx.lineWidth = 2;
  ctx.beginPath();
  points.forEach(([frame, energy], index) =>
    index ? ctx.lineTo(x(frame), y(energy)) : ctx.moveTo(x(frame), y(energy)));
  ctx.stroke();
  for (const [frame, energy] of points) {
    ctx.beginPath();
    ctx.arc(x(frame), y(energy), 2, 0, 2 * Math.PI);
    ctx.fill();
  }
  return canvasPng(canvas);
}

function readEnergy(csv) {
  const [header, ...rows] = csv.trim().split(/\r?\n/);
  const columns = header.split(',').map(s => s.trim());
  const frame = columns.indexOf('image');
  const energy = columns.indexOf('Delta E vs. reactant [kcal/mol]');
  if (frame < 0 || energy < 0) throw Error('DMF_energy.csv の列を認識できません。');
  const points = [];
  for (const line of rows) {
    const fields = line.split(',');
    if (!fields[frame]?.trim() || !fields[energy]?.trim()) continue;
    const x = Number(fields[frame]), y = Number(fields[energy]) * 4.184;
    if (Number.isSafeInteger(x) && Number.isFinite(y)) points.push([x, y]);
  }
  if (!points.length) throw Error('プロットできるエネルギーがありません。');
  return points.sort((a,b) => a[0]-b[0]);
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

async function importZip(file) {
  if (input.disabled || !token || !root) return;
  input.disabled = connect.disabled = true;
  let parent;
  try {
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
    const match = file.name.match(/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/);
    const date = match ? match.slice(1,4).join('-') + ' ' + match.slice(4).join(':') : '不明';
    const start = await thumbnail(reactant), final = await thumbnail(product), plot = await energyPlot(points);
    const config = [
      'ZIP名: ' + file.name.replace(/[\r\n]/g, ' '), 'プロット点数: ' + points.length,
      '電荷: ' + charge, 'spin（出力値）: ' + spin, '電荷・spinの取得元: DMF_final.xyz',
      '結果出力日時: ' + date + (match ? '（ZIP名由来・タイムゾーン不明）' : ''),
    ].join('\n');
    status('Google Driveに保存しています…');
    parent = await folder(file.name, root);
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
    status(error.message + partial);
  } finally {
    input.disabled = !token;
    connect.disabled = false;
    input.value = '';
  }
}

async function refresh() {
  for (const url of imageUrls) URL.revokeObjectURL(url);
  imageUrls.clear();
  jobs.replaceChildren();
  const folders = await list("'" + root + "' in parents and mimeType = '" + folderType + "'");
  for (const job of folders.reverse()) {
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
    info.style.whiteSpace = 'pre-wrap';
    info.textContent = await (await download(files.get('config.txt'))).text();
    card.append(images, info);
    jobs.append(card);
  }
}

async function authorize(response) {
  if (!response.access_token) {
    status('Google Driveへの接続が完了しませんでした。');
    return;
  }
  token = response.access_token;
  connect.disabled = input.disabled = true;
  try {
    status('Google Driveの計算記録を読み込んでいます…');
    const folders = await list("mimeType = '" + folderType + "' and appProperties has { key='xyzStudio' and value='colabRecords' }");
    root = folders[0]?.id ?? await folder('分子 XYZ スタジオ Colab計算記録', null, 'colabRecords');
    await refresh();
    status(jobs.childElementCount + ' 件の計算記録。ZIPを追加できます。');
    input.disabled = false;
    connect.textContent = 'Google Driveに再接続';
  } catch (error) {
    status(error.message);
  } finally { connect.disabled = false; }
}

connect.disabled = true;
const authScript = document.createElement('script');
authScript.src = 'https://accounts.google.com/gsi/client';
authScript.onload = () => {
  client = google.accounts.oauth2.initTokenClient({
    client_id: '816593665225-jlsi7t1qdl5icihukahrb3t567qu9qnj.apps.googleusercontent.com',
    scope, include_granted_scopes: false, callback: authorize,
    error_callback: () => status('Googleの許可画面を開けませんでした。'),
  });
  connect.disabled = false;
};
authScript.onerror = () => status('Googleの接続機能を読み込めませんでした。');
document.head.append(authScript);
connect.onclick = () => client.requestAccessToken({prompt: 'select_account'});
input.onchange = () => { if (input.files[0]) void importZip(input.files[0]); };
const drop = get('colabDrop');
drop.ondragover = event => event.preventDefault();
drop.ondrop = event => {
  event.preventDefault();
  if (event.dataTransfer.files.length !== 1) {
    status('ZIPを1件ずつ追加してください。');
    return;
  }
  if (input.disabled) return;
  void importZip(event.dataTransfer.files[0]);
};
