const deploymentCommit = typeof DEPLOYMENT_COMMIT === 'string' ? DEPLOYMENT_COMMIT : null;
export {LibraryCoordinator} from './library-coordinator.mjs';
const APP='https://mol-bench.web.app', CLIENT='816593665225-jlsi7t1qdl5icihukahrb3t567qu9qnj.apps.googleusercontent.com';
const CALLBACK='https://mol-bench-drive.naonao34567890.workers.dev/callback', RETURN=APP+'/colab.html', AGE=30*86400;
const enc=new TextEncoder(), b64=b=>btoa(String.fromCharCode(...b)), bytes=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const random=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
const digest=async s=>new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(s)));
const hash=async s=>Array.from(await digest(s),b=>b.toString(16).padStart(2,'0')).join('');
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
const redirect=url=>new Response(null,{status:303,headers:{Location:url,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
async function key(env){return crypto.subtle.importKey('raw',bytes(env.DRIVE_STORAGE_KEY),'AES-GCM',false,['encrypt','decrypt']);}
async function seal(env,name,value){const iv=crypto.getRandomValues(new Uint8Array(12));const data=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(name)},await key(env),enc.encode(JSON.stringify(value)));return JSON.stringify([b64(iv),b64(new Uint8Array(data))]);}
async function unseal(env,name,value){const [iv,data]=JSON.parse(value);return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(iv),additionalData:enc.encode(name)},await key(env),bytes(data))));}
async function exchange(env,fields){const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({client_id:CLIENT,client_secret:env.GOOGLE_CLIENT_SECRET,...fields})});return {ok:r.ok,data:await r.json()};}
async function route(request,env){
 const url=new URL(request.url);
 if(url.pathname==='/')return json({service:'Mol Bench Drive',deploymentCommit,libraryConfigured:!!env.LIBRARY_COORDINATOR,configured:!!(env.DRIVE_KV&&env.DRIVE_STORAGE_KEY&&env.GOOGLE_CLIENT_SECRET)});
 if(!env.DRIVE_KV||!env.DRIVE_STORAGE_KEY||!env.GOOGLE_CLIENT_SECRET)return json({state:'unavailable'},503);
 if(url.pathname==='/connect'&&request.method==='GET'){
  const flow=url.searchParams.get('flow');if(!/^[a-f0-9]{64}$/.test(flow??''))return json({state:'invalid_flow'},400);
  const state=random(),verifier=random(),name='oauth/'+state;
  await env.DRIVE_KV.put(name,await seal(env,name,{flow,verifier,expiresAt:Date.now()+600000}),{expirationTtl:600});
  const challenge=b64(await digest(verifier)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
  return redirect('https://accounts.google.com/o/oauth2/v2/auth?'+new URLSearchParams({client_id:CLIENT,redirect_uri:CALLBACK,response_type:'code',scope:'openid email https://www.googleapis.com/auth/drive.file',access_type:'offline',prompt:'consent select_account',state,code_challenge:challenge,code_challenge_method:'S256'}));
 }
 if(url.pathname==='/callback'&&request.method==='GET'){
  const state=url.searchParams.get('state');if(!/^[a-f0-9]{64}$/.test(state??''))return json({state:'invalid_state'},400);
  const name='oauth/'+state,stored=await env.DRIVE_KV.get(name);if(!stored)return json({state:'expired_state'},400);
  const pending=await unseal(env,name,stored);await env.DRIVE_KV.delete(name);
  const fail=reason=>redirect(RETURN+'#drive_error='+reason+'&flow='+pending.flow);
  if(pending.expiresAt<=Date.now()||!url.searchParams.get('code'))return fail('authorization');
  const {ok,data}=await exchange(env,{grant_type:'authorization_code',code:url.searchParams.get('code'),redirect_uri:CALLBACK,code_verifier:pending.verifier});
  if(!ok||!data.refresh_token||!data.scope?.split(' ').includes('https://www.googleapis.com/auth/drive.file'))return fail('exchange');
  const identity=await fetch('https://openidconnect.googleapis.com/v1/userinfo',{headers:{Authorization:'Bearer '+data.access_token}});
  if(!identity.ok)return fail('identity');const user=await identity.json();
  if(user.email_verified!==true||typeof user.email!=='string'||!user.email)return fail('forbidden');
  const session=random(),sessionKey='session/'+await hash(session);
  await env.DRIVE_KV.put(sessionKey,await seal(env,sessionKey,{refresh:data.refresh_token,expiresAt:Date.now()+AGE*1000}),{expirationTtl:AGE});
  return redirect(RETURN+'#drive_session='+session+'&flow='+pending.flow);
 }
 if(!['/token','/logout','/library'].includes(url.pathname))return json({},404);
 if(request.method!=='POST')return json({},405);
 if(request.headers.get('Origin')!==APP)return json({state:'forbidden'},403);
 const session=request.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];if(!session)return json({state:'connect'},401);
 const sessionKey='session/'+await hash(session),stored=await env.DRIVE_KV.get(sessionKey);if(!stored)return json({state:'connect'},401);
 const saved=await unseal(env,sessionKey,stored);
 if(url.pathname==='/logout'||saved.expiresAt<=Date.now()){await env.DRIVE_KV.delete(sessionKey);return json({state:'connect'});}
 const {ok,data}=await exchange(env,{grant_type:'refresh_token',refresh_token:saved.refresh});
 if(!ok){if(data.error==='invalid_grant'){await env.DRIVE_KV.delete(sessionKey);return json({state:'connect'},401);}return json({state:'google_error'},502);}
 if(data.refresh_token){saved.refresh=data.refresh_token;await env.DRIVE_KV.put(sessionKey,await seal(env,sessionKey,saved),{expirationTtl:Math.max(60,Math.ceil((saved.expiresAt-Date.now())/1000))});}
 if(url.pathname==='/library'){
  if(!env.LIBRARY_COORDINATOR)return json({state:'library_setup_required'},503);
  const identity=await fetch('https://openidconnect.googleapis.com/v1/userinfo',{headers:{Authorization:'Bearer '+data.access_token}});
  if(!identity.ok)return json({state:'identity_error'},403);
  const user=await identity.json();if(!user.sub||user.email_verified!==true)return json({state:'identity_error'},403);
  const input=await request.json();
  const id=env.LIBRARY_COORDINATOR.idFromName(user.sub);
  const response=await env.LIBRARY_COORDINATOR.get(id).fetch(new Request('https://internal/library',{method:'POST',body:JSON.stringify({...input,accessToken:data.access_token})}));
  const result=await response.json();return json({...result,account:{sub:user.sub,email:user.email}},response.status);
 }
 return json({state:'connected',access_token:data.access_token,expires_in:data.expires_in});
}
export default {async fetch(request,env){
 const origin=request.headers.get('Origin');if(origin&&origin!==APP)return json({state:'forbidden'},403);
 let response;try{response=request.method==='OPTIONS'?new Response(null,{status:204}):await route(request,env);}catch{response=json({state:'unavailable'},503);}
 const headers=new Headers(response.headers);headers.set('Vary','Origin');headers.set('X-Content-Type-Options','nosniff');
 if(origin===APP){headers.set('Access-Control-Allow-Origin',APP);headers.set('Access-Control-Allow-Methods','POST, OPTIONS');headers.set('Access-Control-Allow-Headers','Authorization, Content-Type');}
 return new Response(response.body,{status:response.status,headers});
}};
