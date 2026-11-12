const external=location.origin==='https://mol-bench.web.app';
const server='https://mol-bench-drive.naonao34567890.workers.dev';
const sessionKey='mol-bench-drive-connection-v1',flowKey='mol-bench-drive-flow-v1';
export const standaloneDrive=external;
let callbackError='';
if(external){
 const params=new URLSearchParams((location.hash||'').slice(1));
 if(params.has('drive_session')||params.has('drive_error')){
  const flow=sessionStorage.getItem(flowKey);
  if(flow&&flow===params.get('flow')){
   sessionStorage.removeItem(flowKey);const session=params.get('drive_session');
   if(/^[a-f0-9]{64}$/.test(session??''))localStorage.setItem(sessionKey,session);
   else callbackError=params.get('drive_error')??'authorization';
  }else callbackError='authorization';
  history.replaceState(null,'',location.pathname+location.search);
 }
}
export function beginDriveConnection(){
 const flow=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
 sessionStorage.setItem(flowKey,flow);location.assign(server+'/connect?flow='+flow);
}
export async function driveFetch(path,options){
 if(!external)return fetch('/api/drive/'+path,options);
 if(callbackError){const reason=callbackError;callbackError='';return Response.json({state:reason==='forbidden'?'forbidden':'authorization_error'});}
 const session=typeof localStorage!=='undefined'?localStorage.getItem(sessionKey):globalThis.MOL_DRIVE_SESSION;if(!session)return Response.json({state:'connect'});
 let response;
 try {
  response=await fetch(server+'/'+path,{method:'POST',headers:{Authorization:'Bearer '+session,...(options?.body?{'Content-Type':'application/json'}:{})},...(options?.body?{body:options.body}:{}),cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(path==='library'?90000:20000)});
 } catch (error) {
  const failure=Error(error.name==='TimeoutError'
   ? 'Drive接続サーバーの応答が20秒以内に届きませんでした。'
   : 'Drive接続サーバーとの通信に失敗しました。接続先：mol-bench-drive.naonao34567890.workers.dev');
  failure.code='DRIVE_NETWORK';throw failure;
 }
 if(!response.headers.get('Content-Type')?.includes('application/json'))
  throw Error('Drive接続サーバーが想定外の応答を返しました（HTTP '+response.status+'）。');
 if(response.status===401&&typeof localStorage!=='undefined')localStorage.removeItem(sessionKey);
 return response;
}
