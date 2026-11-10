const ownerEmail = 'naonao34567890@gmail.com';
const origin = 'https://molecular-xyz-studio.naonao3456789077392.chatgpt.site';
const clientId = '816593665225-jlsi7t1qdl5icihukahrb3t567qu9qnj.apps.googleusercontent.com';
const scope = 'https://www.googleapis.com/auth/drive.file';
const callbackPath = '/api/drive/callback';
const returnPath = '/colab.html?drive=1';
const encoder = new TextEncoder();

function json(body, status = 200) {
  return Response.json(body, {status, headers: {'Cache-Control': 'no-store'}});
}
function redirect(path, cookies = []) {
  const headers = new Headers({Location: path, 'Cache-Control': 'no-store'});
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(null, {status: 303, headers});
}
function random() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)),
    byte => byte.toString(16).padStart(2, '0')).join('');
}
function base64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}
async function key(env) {
  return crypto.subtle.importKey('raw', Uint8Array.from(atob(env.DRIVE_STORAGE_KEY), c => c.charCodeAt(0)),
    'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function write(env, name, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({name: 'AES-GCM', iv, additionalData: encoder.encode(name)},
    await key(env), encoder.encode(value));
  await env.BUCKET.put(name, JSON.stringify([base64(iv), base64(new Uint8Array(encrypted))]));
}
async function read(env, name) {
  const entry = await env.BUCKET.get(name);
  if (!entry) return null;
  const [iv, encrypted] = await entry.json();
  const bytes = data => Uint8Array.from(atob(data), c => c.charCodeAt(0));
  const plain = await crypto.subtle.decrypt({name: 'AES-GCM', iv: bytes(iv), additionalData: encoder.encode(name)},
    await key(env), bytes(encrypted));
  return new TextDecoder().decode(plain);
}
const cookie = (name, value, age) =>
  name + '=' + value + '; Path=' + callbackPath + '; Max-Age=' + age + '; HttpOnly; Secure; SameSite=Lax';

async function exchange(secret, fields) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({client_id: clientId, client_secret: secret, ...fields}),
  });
  const data = await response.json();
  return {ok: response.ok, data};
}

async function driveApi(request, env, url) {
  const user = request.headers.get('oai-authenticated-user-id');
  const email = request.headers.get('oai-authenticated-user-email');
  if (!user) return json({state: 'signin'}, 401);
  if (email?.toLowerCase() !== ownerEmail.toLowerCase()) return json({state: 'forbidden'}, 403);
  if (!env.BUCKET || !env.DRIVE_STORAGE_KEY) return json({state: 'unavailable'}, 503);
  const tokenPath = 'drive/refresh/' + encodeURIComponent(user);
  const secretPath = 'drive/client-secret';
  if (url.pathname === '/api/drive/setup' && request.method === 'POST') {
    if (request.headers.get('Origin') !== origin || !request.headers.get('Content-Type')?.startsWith('application/json')) {
      return json({state: 'forbidden'}, 403);
    }
    const {secret} = await request.json();
    if (typeof secret !== 'string' || !/^GOCSPX-[A-Za-z0-9_-]{8,200}$/.test(secret)) {
      return json({state: 'invalid_secret'}, 400);
    }
    await write(env, secretPath, secret);
    return json({state: 'connect'});
  }

  if (request.method !== 'GET') return json({}, 405);
  const secret = await read(env, secretPath);
  if (!secret) return json({state: 'setup'});
  if (url.pathname === '/api/drive/connect') {
    const state = random(), verifier = random();
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(verifier)));
    const challenge = base64(hash).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
    const params = new URLSearchParams({client_id: clientId, redirect_uri: origin + callbackPath,
      response_type: 'code', scope, access_type: 'offline', prompt: 'consent', state,
      code_challenge: challenge, code_challenge_method: 'S256'});
    return redirect('https://accounts.google.com/o/oauth2/v2/auth?' + params,
      [cookie('xyz_drive_state', state, 600), cookie('xyz_drive_verifier', verifier, 600)]);
  }
  if (url.pathname === callbackPath) {
    const clear = [cookie('xyz_drive_state', '', 0), cookie('xyz_drive_verifier', '', 0)];
    const cookies = new Map((request.headers.get('Cookie') ?? '').split(';').map(pair => pair.trim().split('=')));
    const state = cookies.get('xyz_drive_state'), verifier = cookies.get('xyz_drive_verifier');
    const code = url.searchParams.get('code');
    if (!code || !state || state !== url.searchParams.get('state') || !verifier) {
      return redirect(returnPath + '&drive_error=authorization', clear);
    }
    const {ok, data} = await exchange(secret, {grant_type: 'authorization_code', code,
      redirect_uri: origin + callbackPath, code_verifier: verifier});
    if (!ok || !data.refresh_token || !data.scope?.split(' ').includes(scope)) {
      return redirect(returnPath + '&drive_error=exchange', clear);
    }
    await write(env, tokenPath, data.refresh_token);
    return redirect(returnPath, clear);
  }
  if (url.pathname === '/api/drive/token') {
    const refresh = await read(env, tokenPath);
    if (!refresh) return json({state: 'connect'});
    const {ok, data} = await exchange(secret, {grant_type: 'refresh_token', refresh_token: refresh});
    if (!ok) return json({state: data.error === 'invalid_grant' ? 'connect' :
      data.error === 'invalid_client' ? 'invalid_secret' : 'google_error'});
    if (data.refresh_token) await write(env, tokenPath, data.refresh_token);
    return json({state: 'connected', access_token: data.access_token});
  }
  return json({}, 404);
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/drive/')) return env.ASSETS.fetch(request);
    try { return await driveApi(request, env, url); }
    catch { return json({state: 'unavailable'}, 503); }
  },
};
