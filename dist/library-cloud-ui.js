import {cloudAccount,onCloudProgress,saveLibraries,listSnapshots,restoreLibraries,exportLocalLibraries,cancelCloudSave} from './library-cloud.js';
const $=id=>document.getElementById(id);let account;
const status=text=>{$('cloudStatus').textContent=text;};onCloudProgress(status);
const buttons=['checkAccount','localCopy','cloudSave','cloudList','cloudRestore'];
async function run(fn){buttons.forEach(id=>$(id).disabled=true);$('cloudAuto').disabled=true;$('cloudCancel').disabled=false;try{await fn();}catch(error){status(error.message);}finally{buttons.forEach(id=>$(id).disabled=false);$('cloudAuto').disabled=false;$('cloudCancel').disabled=true;}}
async function identify(){account=await cloudAccount();$('cloudAccount').textContent='保存先：'+account.email;$('cloudAuto').checked=localStorage.getItem('mol-bench-library-auto-account')===account.sub;return account;}
$('checkAccount').onclick=()=>run(identify);
$('localCopy').onclick=()=>run(exportLocalLibraries);
$('cloudCancel').onclick=cancelCloudSave;
$('cloudSave').onclick=()=>run(async()=>{await identify();if(!confirm(account.email+' のGoogle Driveに、このブラウザの分子・反応をコピーします。元データは残します。'))return;await saveLibraries();});
$('cloudList').onclick=()=>run(async()=>{await identify();const files=await listSnapshots();$('cloudSnapshots').replaceChildren(...files.map(f=>{const o=document.createElement('option');o.value=f.id;o.textContent=new Date(f.createdTime).toLocaleString()+' ／ '+f.name;return o;}));status(files.length+' 件の保存履歴があります。');});
$('cloudRestore').onclick=()=>run(async()=>{if(!$('cloudSnapshots').value)throw Error('先に保存履歴を読み込んでください。');if(!confirm('既存データを残したまま、選択した保存履歴を追加復元します。'))return;await restoreLibraries($('cloudSnapshots').value);});
$('cloudAuto').onchange=()=>{const enabled=$('cloudAuto').checked;void run(async()=>{await identify();if(enabled){if(!localStorage.getItem('mol-bench-library-last-'+account.sub))throw Error('最初に「分子・反応をDriveへ保存」を実行してください。');localStorage.setItem('mol-bench-library-auto-account',account.sub);status(account.email+' への自動保存を有効にしました。');}else{localStorage.removeItem('mol-bench-library-auto-account');status('自動保存を停止しました。');}$('cloudAuto').checked=enabled;}).then(()=>{$('cloudAuto').checked=!!account&&localStorage.getItem('mol-bench-library-auto-account')===account.sub;});};
window.addEventListener('beforeunload',event=>{if(buttons.some(id=>$(id).disabled)){event.preventDefault();event.returnValue='';}});
