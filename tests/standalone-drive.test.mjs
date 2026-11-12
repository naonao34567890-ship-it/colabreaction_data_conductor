import assert from 'node:assert/strict';
import worker from '../standalone-drive/worker.mjs';
const APP='https://mol-bench.web.app',HOST='https://mol-bench-drive.naonao34567890.workers.dev';
const store=new Map();
const env={DRIVE_STORAGE_KEY:btoa('x'.repeat(32)),GOOGLE_CLIENT_SECRET:'test-secret',
 DRIVE_KV:{get:async k=>store.get(k)??null,put:async(k,v)=>store.set(k,v),delete:async k=>store.delete(k)}};
let email='owner@example.com',verified=true,refreshError=false,refreshCalls=0;
const originalFetch=globalThis.fetch;
globalThis.fetch=async(url,options)=>{
 if(String(url).includes('/userinfo'))return Response.json({email,email_verified:verified});
 const body=options.body;
 if(body.get('grant_type')==='authorization_code'){
  assert.equal(body.get('redirect_uri'),HOST+'/callback');assert.ok(body.get('code_verifier'));
  return Response.json({refresh_token:'refresh-test',access_token:'access-test',scope:'openid email https://www.googleapis.com/auth/drive.file'});
 }
 refreshCalls++;assert.equal(body.get('refresh_token'),'refresh-test');
 return refreshError?Response.json({error:'invalid_grant'},{status:400}):Response.json({access_token:'renewed-test',expires_in:3600});
};
async function call(path,init={}){return worker.fetch(new Request(HOST+path,init),env);}
try{
 assert.equal((await call('/token',{method:'POST',headers:{Origin:'https://evil.test'}})).status,403);
 assert.equal((await call('/token',{method:'POST',headers:{Origin:APP}})).status,401);
 assert.equal((await call('/callback?state=bad')).status,400);
 assert.equal((await call('/connect?flow=bad')).status,400);
 const flow='a'.repeat(64);
 async function connect(){const start=await call('/connect?flow='+flow);assert.equal(start.status,303);const url=new URL(start.headers.get('Location'));assert.equal(url.searchParams.get('code_challenge_method'),'S256');const state=url.searchParams.get('state');return {state,response:await call('/callback?state='+state+'&code=mock')};}
 verified=false;assert.ok((await connect()).response.headers.get('Location').includes('drive_error=forbidden'));
 verified=true;email='other@example.com';const other=await connect();const otherSession=new URLSearchParams(new URL(other.response.headers.get('Location')).hash.slice(1)).get('drive_session');assert.match(otherSession,/^[a-f0-9]{64}$/);
 email='owner@example.com';const {state,response}=await connect();
 const result=new URL(response.headers.get('Location'));assert.equal(result.origin,APP);const session=new URLSearchParams(result.hash.slice(1)).get('drive_session');assert.match(session,/^[a-f0-9]{64}$/);assert.notEqual(session,otherSession);
 assert.ok(![...store.values()].some(value=>value.includes('refresh-test')),'refresh token is encrypted');
 assert.equal((await call('/callback?state='+state+'&code=mock')).status,400);
 const init={method:'POST',headers:{Origin:APP,Authorization:'Bearer '+session}};
 for(let i=0;i<2;i++){const r=await call('/token',init);assert.equal(r.headers.get('Access-Control-Allow-Origin'),APP);assert.equal((await r.json()).access_token,'renewed-test');}
 assert.equal(refreshCalls,2,'navigation restores using server refresh');
 refreshError=true;assert.equal((await call('/token',init)).status,401);assert.equal((await call('/token',init)).status,401);
 refreshError=false;const second=await connect();const s=new URLSearchParams(new URL(second.response.headers.get('Location')).hash.slice(1)).get('drive_session');const logout={method:'POST',headers:{Origin:APP,Authorization:'Bearer '+s}};
 assert.equal((await call('/logout',logout)).status,200);assert.equal((await call('/token',logout)).status,401);
 assert.equal((await call('/token',{method:'POST',headers:{Origin:APP,Authorization:'Bearer '+otherSession}})).status,200,'logging out one account preserves another session');
 console.log('PASS OAuth PKCE/state, multiple verified accounts and separate sessions, encrypted storage, navigation restore, refresh, revocation, logout, CORS');
}finally{globalThis.fetch=originalFetch;}
