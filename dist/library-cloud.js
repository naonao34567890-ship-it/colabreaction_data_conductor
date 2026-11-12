import {driveFetch} from './drive-connection.js?v=2';
import {encode,decode,fingerprint,hash,normalizeMolecule,normalizeReaction,validateManifest} from './library-cloud-core.js';
const drive='https://www.googleapis.com/drive/v3',folderType='application/vnd.google-apps.folder';
let token,account,busy=false,progress=()=>{},stop=false,pinnedAccount;
export function onCloudProgress(fn){progress=fn;}
export function cancelCloudSave(){stop=true;}
function check(){if(stop)throw Error('中止しました。ブラウザと保存済みのDriveファイルは残しています。');}
async function auth(){
 const response=await driveFetch('token');const result=await response.json();
 if(result.state!=='connected'||!result.access_token)throw Error(result.state==='connect'?'先に「Colab計算記録」でGoogle Driveへ継続接続してください。':'Driveの継続接続を確認できません。「Colab計算記録」で接続を確認してください。');
 token=result.access_token;
 const identity=await fetch('https://openidconnect.googleapis.com/v1/userinfo',{headers:{Authorization:'Bearer '+token}});
 if(!identity.ok)throw Error('接続中のGoogleアカウントを確認できませんでした。');
 const nextAccount=await identity.json();if(!nextAccount.sub||nextAccount.email_verified!==true)throw Error('Googleアカウントの確認が必要です。');
 if(busy&&pinnedAccount&&pinnedAccount!==nextAccount.sub)throw Error('処理中にGoogleアカウントが切り替わりました。元のデータを残して中断しました。');
 account=nextAccount;if(busy)pinnedAccount=account.sub;
 return account;
}
export async function cloudAccount(){if(busy)throw Error('クラウド保存・復元が実行中です。完了後に確認してください。');return auth();}
async function request(url,init={},retry=true){
 check();const response=await fetch(url,{...init,headers:{...init.headers,Authorization:'Bearer '+token}});
 if(response.status===401&&retry){await auth();return request(url,init,false);}
 if(!response.ok)throw Error('Driveへの保存・読み込みに失敗しました（HTTP '+response.status+'）。ブラウザのデータは残っています。');
 return response;
}
async function list(query){let pageToken;const files=[];do{const q=new URLSearchParams({q:query+' and trashed = false',fields:'nextPageToken,files(id,name,createdTime,appProperties)',pageSize:'1000'});if(pageToken)q.set('pageToken',pageToken);const page=await(await request(drive+'/files?'+q)).json();files.push(...page.files);pageToken=page.nextPageToken;}while(pageToken);return files;}
async function folders(parent,kind){return list("mimeType = '"+folderType+"' and "+(parent?"'"+parent+"' in parents and ":'')+"appProperties has { key='molBenchLibrary' and value='"+kind+"' }");}
async function ensureFolder(parent,kind,name){const existing=await folders(parent,kind);if(existing.length)return existing.sort((a,b)=>a.createdTime.localeCompare(b.createdTime))[0].id;return(await(await request(drive+'/files?fields=id',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,mimeType:folderType,...(parent?{parents:[parent]}:{}),appProperties:{molBenchLibrary:kind}})})).json()).id;}
async function upload(parent,name,blob,appProperties={}){
 const boundary=crypto.randomUUID();const body=new Blob(['--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n',JSON.stringify({name,parents:[parent],appProperties}),'\r\n--'+boundary+'\r\nContent-Type: '+(blob.type||'application/octet-stream')+'\r\n\r\n',blob,'\r\n--'+boundary+'--\r\n']);
 return(await(await request('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',{method:'POST',headers:{'Content-Type':'multipart/related; boundary='+boundary},body})).json()).id;
}
async function uploadJSON(parent,name,value,props){return upload(parent,name,new Blob([JSON.stringify(value)],{type:'application/json'}),props);}
function allStores(db,names){return new Promise((resolve,reject)=>{const tx=db.transaction(names,'readonly'),out={};for(const name of names){const r=tx.objectStore(name).getAll();r.onsuccess=()=>{out[name]=r.result;};}tx.oncomplete=()=>resolve(out);tx.onabort=()=>reject(tx.error);});}
async function reactionDB(){return new Promise((resolve,reject)=>{const r=indexedDB.open('molecular-xyz-reactions',1);r.onupgradeneeded=()=>r.result.createObjectStore('reactions',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function capture(){
 const data=await allStores(await Mol.db(),['meta','body','tags']);const db=await reactionDB();let reactions;try{reactions=(await allStores(db,['reactions'])).reactions;}finally{db.close();}
 const bodies=new Map(data.body.map(b=>[b.id,b]));const molecules=data.meta.map(meta=>{const body=bodies.get(meta.id);if(!body)throw Error('分子「'+meta.name+'」の構造が見つからないため、保存を中断しました。');return {meta,body};});
 return {molecules,reactions,tags:data.tags,logs:JSON.parse(localStorage.getItem('xyz-optimization-logs')||'[]')};
}
function safeName(name){return String(name||'unnamed').replace(/[\x00-\x1f/\\]/g,'_').slice(0,100);}
async function xyz(record){return Mol.output(record,false);}
async function storeRecord(parent,kind,record,existing){
 const normalized=kind==='molecule'?normalizeMolecule(record.meta,record.body):normalizeReaction(record);
 const encoded=await encode(normalized),text=JSON.stringify(encoded),digest=await hash(text);
 if(existing.has(digest))return {id:existing.get(digest),hash:digest};
 const stem=safeName(kind==='molecule'?record.meta.name:record.name)+'--'+digest.slice(0,12);
 // Record JSON is written last, after its human-readable XYZ companions.
 if(kind==='molecule')await upload(parent,stem+'.xyz',await xyz({...record.body,name:record.meta.name}));
 else for(const slot of ['START','FINISH'])if(record[slot])await upload(parent,stem+'_'+slot+'.xyz',await xyz(record[slot]));
 const id=await uploadJSON(parent,stem+'.json',encoded,{contentHash:digest,recordKind:kind});existing.set(digest,id);return {id,hash:digest};
}
async function locked(fn){if(busy)throw Error('別のクラウド保存・復元が実行中です。');busy=true;stop=false;pinnedAccount=null;try{if(navigator.locks)return await navigator.locks.request('mol-bench-library-cloud',{ifAvailable:true},lock=>{if(!lock)throw Error('別のタブでクラウド保存・復元中です。');return fn();});return await fn();}finally{busy=false;pinnedAccount=null;}}
async function workSignature(data){return fingerprint({molecules:await Promise.all(data.molecules.map(r=>fingerprint(normalizeMolecule(r.meta,r.body)))),reactions:await Promise.all(data.reactions.map(r=>fingerprint(normalizeReaction(r)))),tags:data.tags,logs:data.logs});}
export async function saveLibraries({onlyChanged=false,automatic=false}={}){return locked(async()=>{
 await auth();if(automatic&&localStorage.getItem('mol-bench-library-auto-account')!==account.sub)return null;
 progress('ブラウザ内の分子・反応を確認中…');const data=await capture();const signature=await workSignature(data);const lastKey='mol-bench-library-last-'+account.sub;
 if(onlyChanged&&localStorage.getItem(lastKey)===signature){progress('保存済みの内容から変更はありません。');return null;}
 const root=await ensureFolder(null,'root','Mol Bench');
 const moleculeFolder=await ensureFolder(root,'molecules','分子ライブラリ'),reactionFolder=await ensureFolder(root,'reactions','反応ライブラリ'),history=await ensureFolder(root,'history','保存履歴');
 const maps=[];for(const id of [moleculeFolder,reactionFolder])maps.push(new Map((await list("'"+id+"' in parents")).filter(f=>f.appProperties?.contentHash).map(f=>[f.appProperties.contentHash,f.id])));
 const molecules=[],reactions=[];let done=0,total=data.molecules.length+data.reactions.length;
 for(const [kind,items,parent,existing,out]of [['molecule',data.molecules,moleculeFolder,maps[0],molecules],['reaction',data.reactions,reactionFolder,maps[1],reactions]])for(const record of items){check();progress('Driveへ保存中 '+done+' / '+total+' 件');out.push(await storeRecord(parent,kind,record,existing));done++;}
 check();const manifest={format:'mol-bench-library',version:1,createdAt:new Date().toISOString(),origin:location.origin,molecules,reactions,tags:data.tags,logs:data.logs,signature};
 await uploadJSON(history,manifest.createdAt.replaceAll(':','-')+'--'+crypto.randomUUID()+'.json',manifest,{molBenchSnapshot:'complete'});
 localStorage.setItem(lastKey,signature);progress('保存完了：分子 '+molecules.length+' 件・反応 '+reactions.length+' 件。元のデータも残しています。');return manifest;
 });}
export async function listSnapshots(){return locked(async()=>{await auth();const results=[];for(const root of await folders(null,'root'))for(const history of await folders(root.id,'history'))results.push(...await list("'"+history.id+"' in parents and appProperties has { key='molBenchSnapshot' and value='complete' }"));return results.sort((a,b)=>b.createdTime.localeCompare(a.createdTime));});}
async function downloadJSON(id,expected){const text=await(await request(drive+'/files/'+encodeURIComponent(id)+'?alt=media')).text();if(expected&&await hash(text)!==expected)throw Error('保存内容の整合性を確認できないため、復元を中断しました。');return JSON.parse(text);}
async function addReaction(record){const value={...record,id:crypto.randomUUID()};value._cloudRestoredSignature=await fingerprint(normalizeReaction(value));const db=await reactionDB();try{return await new Promise((resolve,reject)=>{const tx=db.transaction('reactions','readwrite');tx.objectStore('reactions').add(value);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});}finally{db.close();}}
async function restoreMeta(saved,source){const db=await Mol.db();return new Promise((resolve,reject)=>{const tx=db.transaction('meta','readwrite'),store=tx.objectStore('meta'),read=store.get(saved.id);read.onsuccess=()=>{if(read.result)store.put({...source,...read.result,...(Number.isFinite(source.addedAt)?{addedAt:source.addedAt}:{}),...(Number.isFinite(source.batchPosition)?{batchPosition:source.batchPosition}:{})});};tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});}
async function markRestoredMolecule(id){const meta=await Mol.get('meta',id),body=await Mol.get('body',id);const signature=await fingerprint(normalizeMolecule(meta,body));const db=await Mol.db();return new Promise((resolve,reject)=>{const tx=db.transaction('body','readwrite');tx.objectStore('body').put({...body,_cloudRestoredSignature:signature});tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});}
async function mergeTags(tags){const db=await Mol.db();return new Promise((resolve,reject)=>{const tx=db.transaction('tags','readwrite');const store=tx.objectStore('tags');for(const tag of tags){if(typeof tag.name!=='string')continue;const r=store.get(tag.name);r.onsuccess=()=>{if(!r.result)store.add(tag);};}tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});}
export async function restoreLibraries(id){return locked(async()=>{
 await auth();const manifest=validateManifest(await downloadJSON(id));const current=await capture();
 const molecules=new Set(),reactions=new Set();for(const r of current.molecules){const currentHash=await fingerprint(normalizeMolecule(r.meta,r.body));molecules.add(currentHash);if(r.body._cloudFingerprint&&r.body._cloudRestoredSignature===currentHash)molecules.add(r.body._cloudFingerprint);}for(const r of current.reactions){const currentHash=await fingerprint(normalizeReaction(r));reactions.add(currentHash);if(r._cloudFingerprint&&r._cloudRestoredSignature===currentHash)reactions.add(r._cloudFingerprint);}
 // Validate and download every missing record before changing any local data.
 const pendingM=[],pendingR=[];
 for(const [refs,known,out,kind]of [[manifest.molecules,molecules,pendingM,'molecule'],[manifest.reactions,reactions,pendingR,'reaction']])for(const ref of refs){check();if(known.has(ref.hash))continue;progress('復元データを確認中…');const value=decode(await downloadJSON(ref.id,ref.hash));if(kind==='molecule'&&(!Array.isArray(value.body?.atoms)||typeof value.meta?.name!=='string'))throw Error('分子の保存形式が壊れています。');if(kind==='reaction'&&typeof value.name!=='string')throw Error('反応の保存形式が壊れています。');const structures=kind==='molecule'?[value.body]:[value.START,value.FINISH].filter(Boolean);for(const structure of structures)if(!Array.isArray(structure.atoms)||structure.atoms.some(a=>!Mol.elements[a.el]||!['x','y','z'].every(k=>Number.isFinite(a[k]))))throw Error('保存された原子座標が壊れています。');out.push({value,hash:ref.hash});known.add(ref.hash);}
 for(const {value,hash:digest}of pendingM){check();const saved=await Mol.saveBatch([{...value.body,name:value.meta.name,tags:value.meta.tags,_cloudFingerprint:digest}]);await restoreMeta(saved[0],value.meta);await markRestoredMolecule(saved[0].id);Mol.notify({type:'added',items:saved});}
 for(const {value,hash:digest}of pendingR){check();await addReaction({...value,_cloudFingerprint:digest});}
 await mergeTags(manifest.tags);
 const logs=JSON.parse(localStorage.getItem('xyz-optimization-logs')||'[]');const ids=new Set(logs.map(x=>x.id));for(const log of manifest.logs||[])if(!ids.has(log.id)){logs.push(log);ids.add(log.id);}localStorage.setItem('xyz-optimization-logs',JSON.stringify(logs));
 progress('追加復元しました：分子 '+pendingM.length+' 件・反応 '+pendingR.length+' 件。既存の内容は上書き・削除していません。ライブラリを再読み込みしてください。');return {molecules:pendingM.length,reactions:pendingR.length};
 });}
export async function exportLocalLibraries(){return locked(async()=>{const data=await capture();const backup={format:'mol-bench-local-copy',version:1,createdAt:new Date().toISOString(),data:await encode(data)};Mol.downloadBlob(new Blob([JSON.stringify(backup)],{type:'application/json'}),'mol-bench-local-backup-'+Date.now()+'.json');progress('分子・反応のローカル控えを保存しました。');});}
export function cloudBusy(){return busy;}
