import {saveLibraries,onCloudProgress,cloudBusy} from './library-cloud.js';
// Navigation stays usable when offline. Failed saves are shown and never delete data.
const link=document.querySelector('a[href="library-cloud.html"]');
if(location.pathname.endsWith('/library-cloud.html')){
 // The settings page owns its detailed progress display.
}else onCloudProgress(text=>{if(link){link.title=text;link.textContent=text.startsWith('保存完了')?'Drive保存 ✓':'Drive保存';}});
async function tick(){
 if(!localStorage.getItem('mol-bench-library-auto-account')||cloudBusy()||document.visibilityState!=='visible')return;
 try{await saveLibraries({onlyChanged:true,automatic:true});}catch(error){if(link){link.textContent='Drive保存：要確認';link.title=error.message;}}
}
setTimeout(tick,12000);setInterval(tick,120000);
