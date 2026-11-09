/* Shared classic script: browser, classic Worker, and Node parser tests. */
(function (root) {
'use strict';
const symbols='H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og'.split(' ');
const radii=[.31,.28,1.28,.96,.84,.76,.71,.66,.57,.58,1.66,1.41,1.21,1.11,1.07,1.05,1.02,1.06,2.03,1.76,1.70,1.60,1.53,1.39,1.39,1.32,1.26,1.24,1.32,1.22,1.22,1.20,1.19,1.20,1.20,1.16,2.20,1.95,1.90,1.75,1.64,1.54,1.47,1.46,1.42,1.39,1.45,1.44,1.42,1.39,1.39,1.38,1.39,1.40,2.44,2.15,2.07,2.04,2.03,2.01,1.99,1.98,1.98,1.96,1.94,1.92,1.92,1.89,1.90,1.87,1.87,1.75,1.70,1.62,1.51,1.44,1.41,1.36,1.36,1.32,1.45,1.46,1.48,1.40,1.50,1.50,2.60,2.21,2.15,2.06,2.00,1.96];
const palette={H:0xffffff,C:0x909090,N:0x3050f8,O:0xff0d0d,F:0x90e050,Cl:0x1ff01f,Br:0xa62929,I:0x940094,He:0xd9ffff,Ne:0xb3e3f5,Ar:0x80d1e3,Xe:0x429eb0,Kr:0x5cb8d1,Li:0xcc80ff,Na:0xab5cf2,K:0x8f40d4,Rb:0x702eb0,Cs:0x57178f,Be:0xc2ff00,Mg:0x8aff00,Ca:0x3dff00,B:0xffb5b5,Si:0xf0c8a0,P:0xff8000,S:0xffff30,Fe:0xe06633,Cu:0xc88033,Zn:0x7d80b0,Ag:0xc0c0c0,Au:0xffd123,Al:0xbfa6a6};
Object.assign(palette,{Sc:0xe6e6e6,Ti:0xbfc2c7,V:0xa6a6ab,Cr:0x8a99c7,Mn:0x9c7ac7,Co:0xf090a0,Ni:0x50d050,Ga:0xc28f8f,Ge:0x668f8f,As:0xbd80e3,Se:0xffa100,Sr:0x00ff00,Y:0x94ffff,Zr:0x94e0e0,Nb:0x73c2c9,Mo:0x54b5b5,Tc:0x3b9e9e,Ru:0x248f8f,Rh:0x0a7d8c,Pd:0x006985,Cd:0xffd98f,In:0xa67573,Sn:0x668080,Sb:0x9e63b5,Te:0xd47a00,Ba:0x00c900,La:0x70d4ff,Ce:0xffffc7,Pr:0xd9ffc7,Nd:0xc7ffc7,Pm:0xa3ffc7,Sm:0x8fffc7,Eu:0x61ffc7,Gd:0x45ffc7,Tb:0x30ffc7,Dy:0x1fffc7,Ho:0x00ff9c,Er:0x00e675,Tm:0x00d452,Yb:0x00bf38,Lu:0x00ab24,Hf:0x4dc2ff,Ta:0x4da6ff,W:0x2194d6,Re:0x267dab,Os:0x266696,Ir:0x175487,Pt:0xd0d0e0,Hg:0xb8b8d0,Tl:0xa6544d,Pb:0x575961,Bi:0x9e4fb5,Po:0xab5c00,At:0x754f45,Rn:0x428296,Fr:0x420066,Ra:0x007d00,Ac:0x70abfa,Th:0x00baff,Pa:0x00a1ff,U:0x008fff,Np:0x0080ff,Pu:0x006bff,Am:0x545cf2,Cm:0x785ce3,Bk:0x8a4fe3,Cf:0xa136d4,Es:0xb31fd4,Fm:0xb31fba,Md:0xb30da6,No:0xbd0d87,Lr:0xc70066,Rf:0xcc0059,Db:0xd1004f,Sg:0xd90045,Bh:0xe00038,Hs:0xe6002e,Mt:0xeb0026});
const elements=Object.fromEntries(symbols.map((s,i)=>[s,{r:radii[i]||1.6,color:palette[s]??0xff69b4}]));
const tick=()=>new Promise(r=>setTimeout(r,0));
const normalized=s=>s.charAt(0).toUpperCase()+s.slice(1).toLowerCase();
function atomLine(line) {
 const p=line.trim().split(/\s+/), s=normalized(p[0]||'');
 const xyz=p.slice(1,4).map(v=>Number(v.replace(/\*\^/g,'e')));
 if(p.length<4 || xyz.length!==3 || xyz.some(v=>!Number.isFinite(v))) return null;
 return {el:s,x:xyz[0],y:xyz[1],z:xyz[2],extra:p.slice(4),known:!!elements[s]};
}
async function* lines(file, cancelled=()=>false) {
 const decoder=new TextDecoder('utf-8',{ignoreBOM:true}); let pending='';
 for(let start=0;start<file.size;start+=262144){
  if(cancelled())return;
  pending+=decoder.decode(await file.slice(start,start+262144).arrayBuffer(),{stream:true});
  let i=0,begin=0;
  while(i<pending.length){if(pending[i]==='\n'||pending[i]==='\r'){
   if(pending[i]==='\r'&&i===pending.length-1)break;
   const end=i+((pending[i]==='\r'&&pending[i+1]==='\n')?2:1);
   yield {text:pending.slice(begin,i),raw:pending.slice(begin,end)};begin=end;i=end;
  }else i++;}pending=pending.slice(begin);await tick();
 }
 pending+=decoder.decode();
 if(pending.endsWith('\r'))yield {text:pending.slice(0,-1),raw:pending};
 else if(pending)yield {text:pending,raw:pending};
}
/* Bounded lookahead: never concatenate the complete file. A single block is retained. */
async function* parseFile(file,cancelled=()=>false){
 const iter=lines(file,cancelled)[Symbol.asyncIterator]();let buf=[],head=0,eof=false,lineNo=0,current=null,noise=0;
 async function peek(n){while(buf.length-head<=n&&!eof){const v=await iter.next();eof=v.done;if(!v.done)buf.push(v.value);}return buf[head+n];}
 function take(){const v=buf[head++];lineNo++;if(head>4096){buf=buf.slice(head);head=0;}return v;}
 while(!cancelled()&&await peek(0)){
  const row=await peek(0);let n=/^\s*\d+\s*$/.test(row.text)?Number(row.text.trim()):NaN;
  let candidate=Number.isSafeInteger(n)&&n>0&&n<=Math.floor(file.size/6), atoms=[], bad=null;
  if(candidate){if(!await peek(1))candidate=false;
   for(let j=0;candidate&&j<n;j++){const l=await peek(j+2);const a=l&&atomLine(l.text);if(!a){candidate=false;break;}atoms.push(a);if(!a.known)bad='未知の元素: '+a.el;if(j%2000===1999){await tick();if(cancelled())return;}}
  }
  if(!candidate&&Number.isSafeInteger(n)&&n>0&&n<=Math.floor(file.size/6)){
   let atomShaped=true;for(let j=0;j<n;j++){const l=await peek(j+2);if(!l||!/^\s*[a-zA-Z]{1,3}\s+\S+\s+\S+\s+\S+/.test(l.text)){atomShaped=false;break;}}
   if(atomShaped){if(current){yield current;current=null;}yield {error:'原子座標が不正なブロック',line:lineNo+1};for(let j=0;j<n+2;j++)take();continue;}
  }
  if(candidate){
   if(current){yield current;current=null;}
   if(noise){yield {error:'解析できない行をスキップ',line:lineNo-noise+1,lines:noise};noise=0;}
   const raw=[];for(let j=0;j<n+2;j++)raw.push(take());
   if(bad){yield {error:bad,line:lineNo-n-1};continue;}
   current={atoms:atoms.map(({known,...a})=>a),comment:raw[1].text,rawParts:raw.map(r=>r.raw),baseLines:n+2,originalLines:n+2,footerLines:0};
  }else{
   const row=take();if(current){current.rawParts.push(row.raw);current.footerLines++;if(row.text.trim())current.originalLines=current.baseLines+current.footerLines;}
   else if(row.text.trim())noise++;
  }
 }
 if(current&&!cancelled())yield current;
 if(noise)yield {error:'有効なxyzブロックがありません',lines:noise};
}
function standard(m){return `${m.atoms.length}\n${(m.comment||'').replace(/[\r\n]/g,' ')}\n`+m.atoms.map(a=>`${a.el} ${a.x.toPrecision(12)} ${a.y.toPrecision(12)} ${a.z.toPrecision(12)}`).join('\n')+'\n';}
async function output(m){
 const type='chemical/x-xyz';
 if(m.edited||!m.raw)return new Blob([standard({...m,comment:''})],{type});
 const header=lines(m.raw);
 try{
  const {value:count}=await header.next();
  const {value:comment}=await header.next();
  const newline=comment.raw.slice(comment.text.length);
  const offset=new TextEncoder().encode(count.raw+comment.raw).length;
  return new Blob([count.raw,newline,m.raw.slice(offset)],{type});
 }finally{await header.return();}
}
function centroid(atoms,indices){const ids=indices?Array.from(indices):atoms.map((_,i)=>i);const c={x:0,y:0,z:0};for(const i of ids){c.x+=atoms[i].x;c.y+=atoms[i].y;c.z+=atoms[i].z;}for(const k of ['x','y','z'])c[k]/=ids.length||1;return c;}
function swap(atoms,a,b){if(!a.ids.length||!b.ids.length)throw Error('両方のモイエティを登録してください');const set=new Set(a.ids);if(b.ids.some(i=>set.has(i)))throw Error('原子が重複しています。交換できません');
 const anchored=a.point!==null&&b.point!==null;
 const ca=anchored?atoms[a.point]:centroid(atoms,a.ids),cb=anchored?atoms[b.point]:centroid(atoms,b.ids);
 const d={x:cb.x-ca.x,y:cb.y-ca.y,z:cb.z-ca.z};for(const [m,s]of [[a,1],[b,-1]])for(const i of m.ids)for(const k of ['x','y','z'])atoms[i][k]+=s*d[k];}
function bonds(atoms){const size=6.5,grid=new Map(),out=[];atoms.forEach((a,i)=>{const g=[Math.floor(a.x/size),Math.floor(a.y/size),Math.floor(a.z/size)];for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++){for(const j of grid.get([g[0]+x,g[1]+y,g[2]+z].join(','))||[]){const b=atoms[j],d=(a.x-b.x)**2+(a.y-b.y)**2+(a.z-b.z)**2,max=1.22*(elements[a.el].r+elements[b.el].r);if(d>.16&&d<max*max)out.push([j,i]);}}const key=g.join(',');if(!grid.has(key))grid.set(key,[]);grid.get(key).push(i);});return out;}
let dbPromise;const nameHints=new Map();
function db(){if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{const r=indexedDB.open('molecular-xyz-library',1);r.onupgradeneeded=()=>{const d=r.result;const m=d.createObjectStore('meta',{keyPath:'id'});m.createIndex('name','name',{unique:true});d.createObjectStore('body',{keyPath:'id'});d.createObjectStore('thumb',{keyPath:'id'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});return dbPromise;}
const water = {
 id: 'builtin-water',
 name: '水分子（H₂O）',
 comment: 'Built-in water molecule',
 atoms: [
  {el:'O', x:0, y:0, z:0},
  {el:'H', x:0.9572, y:0, z:0},
  {el:'H', x:-0.239987, y:0.926627, z:0},
 ],
 baseLines: 5,
 originalLines: 5,
 edited: true,
};
const hydrogen = {
 id: 'builtin-hydrogen',
 name: '水素原子（H）',
 comment: 'Built-in hydrogen atom',
 atoms: [{el:'H', x:0, y:0, z:0}],
 baseLines: 3,
 originalLines: 3,
 edited: true,
};
const builtins = new Map([water, hydrogen].map(record => [record.id, record]));
const builtinMeta = Array.from(builtins.values(), record => ({
 id: record.id, name: record.name, count: record.atoms.length,
 builtin: true, thumb: false, bytes: standard(record).length,
}));
async function get(store,id){if(store==='body'&&builtins.has(id))return structuredClone(builtins.get(id));const d=await db();return new Promise((res,rej)=>{const r=d.transaction(store).objectStore(store).get(id);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}
const displayNames = new Intl.Collator('ja', {numeric: true});
function compareDisplayOrder(a, b, order='name-asc') {
 const pinned = id => id === water.id ? 0 : id === hydrogen.id ? 1 : 2;
 const pinOrder = pinned(a.id) - pinned(b.id);
 if(pinOrder)return pinOrder;
 const byId = a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
 if(order==='id')return byId;
 const byName = displayNames.compare(a.name, b.name);
 if(order==='name-desc')return -byName || byId;
 if(order==='added-asc'||order==='added-desc'){
  const hasA=Number.isFinite(a.addedAt),hasB=Number.isFinite(b.addedAt);
  if(hasA!==hasB)return hasA?-1:1;
  if(hasA){
   const byAdded=a.addedAt-b.addedAt || a.batchPosition-b.batchPosition;
   return (order==='added-desc'?-byAdded:byAdded) || byId;
  }
 }
 return byName || byId;
}
async function metadata(){const d=await db();return new Promise((res,rej)=>{const result=builtinMeta.map(record => ({...record})),t=d.transaction('meta'),r=t.objectStore('meta').openCursor();r.onsuccess=()=>{const c=r.result;if(c){result.push(c.value);c.continue();}else res(result);};r.onerror=()=>rej(r.error);});}
async function saveBatch(records){if(!records.length)return [];const d=await db();return new Promise((res,rej)=>{
 const tx=d.transaction(['meta','body'],'readwrite'),meta=tx.objectStore('meta'),body=tx.objectStore('body'),saved=[];
 tx.oncomplete=()=>res(saved);tx.onabort=()=>rej(tx.error||Error('保存失敗'));tx.onerror=()=>{};
 // Request chaining keeps the transaction alive and serializes collision checks.
 let i=0;function next(){if(i>=records.length)return;const r=records[i++],base=r.name;let suffix=nameHints.get(base)||1;if(suffix>1)r.name=`${base} (${suffix})`;function attempt(){const q=meta.index('name').getKey(r.name);q.onsuccess=()=>{if(q.result!==undefined){r.name=`${base} (${++suffix})`;attempt();}else{nameHints.set(base,suffix+1);r.id=crypto.randomUUID();const m={id:r.id,name:r.name,count:r.atoms.length,thumb:false,addedAt:performance.timeOrigin+performance.now(),batchPosition:i,bytes:r.raw?.size||standard(r).length};meta.add(m);body.add(r);saved.push(m);next();}};}attempt();}next();
 });}
async function remove(id){return removeMany([id]);}
async function removeMany(ids) {
 if(ids.some(id=>builtins.has(id)))throw Error('組み込みの分子・原子は削除できません');
 if(!ids.length)return;
 const d=await db();
 return new Promise((resolve,reject)=>{
  const stores=['meta','body','thumb'];
  const tx=d.transaction(stores,'readwrite');
  tx.oncomplete=resolve;
  tx.onabort=()=>reject(tx.error||Error('削除に失敗しました'));
  for(const name of stores){
   const store=tx.objectStore(name);
   for(const id of ids)store.delete(id);
  }
 });
}
async function cacheThumb(id,blob){const d=await db();return new Promise((res,rej)=>{const t=d.transaction(['meta','thumb'],'readwrite'),s=t.objectStore('meta'),r=s.get(id);r.onsuccess=()=>{if(r.result)s.put({...r.result,thumb:true});if(r.result||builtins.has(id))t.objectStore('thumb').put({id,blob});};t.oncomplete=res;t.onabort=()=>rej(t.error);});}
function notify(change){if(typeof BroadcastChannel!=='undefined'){const c=new BroadcastChannel('molecular-xyz');c.postMessage(change);c.close();}}
const crcTable=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc32(bytes){let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
function safeName(n){return n.replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').trim()||'molecule';}
async function scanEntries(entries,{cancelled=()=>false,progress=()=>{},error=()=>{}}={}){const found=[],stack=entries.slice();let visited=0;while(stack.length&&!cancelled()){const entry=stack.pop();if(entry.isFile){if(/\.xyz$/i.test(entry.name))found.push(entry);}else if(entry.isDirectory){const reader=entry.createReader();while(!cancelled()){let batch;try{batch=await new Promise((r,j)=>reader.readEntries(r,j));}catch(e){error(entry.fullPath+': '+e.message);break;}if(!batch.length)break;for(const child of batch)stack.push(child);progress(found.length);await tick();}}if(++visited%100===0){progress(found.length);await tick();}}progress(found.length);return found;}
function parseFrameRanges(value,total){
 const ranges=value.normalize('NFKC').split(',').map(entry=>{
  const match=/^(\d+)\s*(?:-\s*(\d+))?$/.exec(entry.trim());
  const first=Number(match?.[1]),last=Number(match?.[2]??match?.[1]);
  if(!match||first<1||last<first||last>total)throw Error(`1〜${total} の番号または範囲をカンマ区切りで指定してください。`);
  return [first,last];
 });
 return ranges;
}
const API={parseFrameRanges,scanEntries,elements,tick,atomLine,lines,parseFile,standard,compareDisplayOrder,output,centroid,swap,bonds,db,get,metadata,saveBatch,remove,removeMany,cacheThumb,notify,crc32,safeName};root.Mol=API;if(typeof module!=='undefined')module.exports=API;
})(globalThis);

/* Browser-only presentation helpers; no DOM or Three dependency in Worker. */
if(typeof document!=='undefined'){
const style=document.createElement('style');style.textContent=`
:root{color-scheme:dark;--ink:#e8efed;--muted:#a8b6b2;--accent:#62d6bf;--border:#34413f;--paper:#101313}*{box-sizing:border-box}body{margin:0;background:var(--paper);font:14px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif;color:var(--ink)}button,input,select,textarea{font:inherit}button{border:1px solid var(--border);background:#191e1e;color:var(--ink);padding:9px 14px;border-radius:7px;cursor:pointer;white-space:nowrap}button:hover{border-color:var(--accent);background:#263330}button:disabled{opacity:.4;cursor:not-allowed}button.primary{background:var(--accent);color:#10201c;border-color:var(--accent)}button.active{background:#214139;border-color:var(--accent)}button.danger{color:#ff929f}input,select,textarea{background:#101515;color:var(--ink);border:1px solid var(--border);padding:8px;border-radius:6px}input[type=range]{padding:0;accent-color:var(--accent)}h1,h2,p{margin:0}h1{font-size:22px;letter-spacing:-.6px}h2{font-size:16px}small,.muted{color:var(--muted)}.eyebrow{font-size:10px;font-weight:700;letter-spacing:2px;color:var(--accent)}header{background:#191e1e;border-bottom:1px solid var(--border);padding:19px 28px 12px;flex-shrink:0}.heading,.toolbar,.row{display:flex;align-items:center;gap:10px}.heading{justify-content:space-between;margin-bottom:17px}.toolbar{flex-wrap:wrap}.spacer{flex:1}.badge{font-size:12px;border:1px solid var(--border);border-radius:30px;padding:5px 12px}.page{height:100dvh;display:flex;flex-direction:column}.progress-area{padding-top:10px;font-size:12px;min-height:40px}.progress-area progress{width:100%;height:5px;accent-color:var(--accent)}.status{white-space:pre-wrap;font-size:12px;color:var(--muted)}.workspace{flex:1;min-height:0;padding:22px 28px;display:flex;flex-direction:column;gap:14px}.grid-view{position:relative;overflow:auto;flex:1;min-height:0;contain:strict}.grid-spacer{position:relative;width:100%}.tile{position:absolute;background:#191e1e;border:1px solid var(--border);border-radius:10px;overflow:hidden;cursor:pointer;outline:none}.tile:hover{border-color:#70aaa3;box-shadow:0 3px 14px #e8efed0b}.tile.selected{border:2px solid var(--accent);background:#1d3530}.thumb{height:145px;background:linear-gradient(120deg,#101616,#151c1c);display:flex;align-items:center;justify-content:center;color:#8ca5a0}.thumb img{width:100%;height:100%;object-fit:contain}.tile-info{padding:8px 11px}.tile-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;font-size:12px}.tile-bottom{display:flex;align-items:center;justify-content:space-between;font-size:11px;color:var(--muted)}.tile-bottom button{font-size:10px;padding:1px 6px}.check{position:absolute;top:8px;left:8px;background:#191e1e;border:1px solid var(--border);border-radius:4px;width:19px;height:19px;text-align:center;line-height:17px;color:var(--accent)}.empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;text-align:center;color:var(--muted)}.empty b{display:block;font-size:22px;color:var(--ink);margin-bottom:12px}.drop-hint{border:1px dashed #a6c5bc;border-radius:8px;background:#1a2825;padding:12px 20px;text-align:center;color:#adc5bc;font-size:12px}.dragging:after{content:'xyz ファイル・フォルダをここにドロップ';position:fixed;inset:12px;background:#152a26f5;border:2px dashed var(--accent);border-radius:16px;z-index:99;display:grid;place-items:center;font-size:24px;pointer-events:none}dialog{background:#191e1e;border:1px solid var(--border);border-radius:14px;max-width:500px;width:90%;padding:26px;color:var(--ink)}dialog::backdrop{background:#000a}dialog h2{margin-bottom:16px}dialog label{display:block;margin:12px 0}dialog input,dialog select{width:100%;margin-top:5px}.dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:22px}.editor-main{display:flex;flex:1;min-height:0}.viewport{position:relative;flex:1;min-width:0;background:#101515;touch-action:none}.viewport canvas{display:block}.viewport .view-label{position:absolute;top:18px;left:22px;pointer-events:none;color:#a9bbb5;font-size:11px;letter-spacing:1px}.viewport .view-info{position:absolute;bottom:18px;left:22px;background:#191e1ef5;padding:9px 13px;border:1px solid var(--border);border-radius:6px;font-size:12px;pointer-events:none}.sidebar{width:330px;flex-shrink:0;background:#191e1e;border-left:1px solid var(--border);padding:20px;display:flex;flex-direction:column;gap:15px;overflow:auto}.panel{border-bottom:1px solid var(--border);padding-bottom:15px}.panel h2{margin-bottom:10px}.moiety{border-left:3px solid #388bda;padding:7px 10px;background:#1b2b3a;margin:8px 0;font-size:12px}.moiety.orange{border-left-color:#ed963b;background:#35291e}.help{font-size:11px;line-height:1.9;color:var(--muted)}.mini-wrap{min-height:280px;display:flex;flex-direction:column;flex:1}.mini-wrap .thumb{height:100px}.mini-wrap .tile-info{padding:5px 7px}.mini-wrap .grid-view{min-height:240px}.mini-wrap .tile-bottom button{display:none}#lassoCanvas{position:absolute;inset:0;pointer-events:none}details summary{cursor:pointer}details pre{white-space:pre-wrap;max-height:220px;overflow:auto;font-size:11px}@media(max-width:850px){header{padding:14px}.workspace{padding:12px}.sidebar{width:270px;padding:12px}.toolbar button{padding:7px 9px}.heading{margin-bottom:10px}}@media(max-width:600px){.editor-main{flex-direction:column;overflow:auto}.viewport{min-height:50vh}.sidebar{width:100%;overflow:visible}.page:has(.editor-main){height:auto;min-height:100dvh}.heading .badge{display:none}}`;
document.head.append(style);
Mol.downloadBlob=function(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);};
Mol.graphics=(async()=>{const T=await import('three');const {OrbitControls}=await import('three/addons/controls/OrbitControls.js');
 function dispose(group){group.traverse(o=>{o.geometry?.dispose();if(o.material){for(const m of Array.isArray(o.material)?o.material:[o.material]){m.map?.dispose();m.dispose();}}});}
 function model(atoms,selected=new Set(),point=null,moieties=[]){const group=new T.Group(),low=atoms.length>500,moietySets=moieties.map(m=>new Set(m.ids));
  const spheres=new T.InstancedMesh(new T.SphereGeometry(1,low?8:20,low?6:14),new T.MeshStandardMaterial({roughness:.55}),atoms.length),dummy=new T.Object3D();
  const halos=[];atoms.forEach((a,i)=>{const e=Mol.elements[a.el];dummy.position.set(a.x,a.y,a.z);dummy.scale.setScalar(Math.max(.19,Math.min(.48,e.r*.4))*(selected.has(i)?1.22:1));dummy.updateMatrix();spheres.setMatrixAt(i,dummy.matrix);spheres.setColorAt(i,new T.Color(e.color));let color=null;if(moietySets[0]?.has(i))color=0x3895ee;if(moietySets[1]?.has(i))color=0xf09c35;if(selected.has(i)&&color===null)color=0x10bfa3;if(point===i)color=0xe027b6;if(color!==null)halos.push({a,color,scale:dummy.scale.x*1.35});});group.add(spheres);group.userData.spheres=spheres;
  if(halos.length){const halo=new T.InstancedMesh(new T.SphereGeometry(1,12,8),new T.MeshBasicMaterial({wireframe:true,transparent:true,opacity:.6}),halos.length);halos.forEach((h,i)=>{dummy.position.set(h.a.x,h.a.y,h.a.z);dummy.scale.setScalar(h.scale);dummy.updateMatrix();halo.setMatrixAt(i,dummy.matrix);halo.setColorAt(i,new T.Color(h.color));});group.add(halo);}
  const pairs=Mol.bonds(atoms),sticks=new T.InstancedMesh(new T.CylinderGeometry(.075,.075,1,low?5:9),new T.MeshStandardMaterial({roughness:.65}),pairs.length*2),up=new T.Vector3(0,1,0),v1=new T.Vector3(),v2=new T.Vector3(),direction=new T.Vector3();
  pairs.forEach(([i,j],k)=>{v1.set(atoms[i].x,atoms[i].y,atoms[i].z);v2.set(atoms[j].x,atoms[j].y,atoms[j].z);direction.subVectors(v2,v1);const len=direction.length();dummy.quaternion.setFromUnitVectors(up,direction.normalize());dummy.scale.set(1,len/2,1);for(let half=0;half<2;half++){dummy.position.copy(v1).lerp(v2,half?.75:.25);dummy.updateMatrix();sticks.setMatrixAt(k*2+half,dummy.matrix);sticks.setColorAt(k*2+half,new T.Color(Mol.elements[atoms[half?j:i].el].color));}});group.add(sticks);
  if(point!==null&&atoms[point]){const c=document.createElement('canvas');c.width=128;c.height=64;const ctx=c.getContext('2d');ctx.fillStyle='#be168f';ctx.font='bold 32px sans-serif';ctx.fillText('★ '+(point+1),4,42);const s=new T.Sprite(new T.SpriteMaterial({map:new T.CanvasTexture(c),depthTest:false}));s.position.set(atoms[point].x,atoms[point].y+.8,atoms[point].z);s.scale.set(1.3,.65,1);group.add(s);}
  return group;
 }
 function light(scene){scene.add(new T.HemisphereLight(0xffffff,0x82988b,2.6));const l=new T.DirectionalLight(0xffffff,2.5);l.position.set(4,8,6);scene.add(l);}
 function fit(camera,atoms,target){const box=new T.Box3();for(const a of atoms)box.expandByPoint(new T.Vector3(a.x,a.y,a.z));if(!atoms.length)box.setFromCenterAndSize(new T.Vector3(),new T.Vector3(3,3,3));const center=box.getCenter(new T.Vector3()),size=Math.max(3,box.getSize(new T.Vector3()).length());camera.near=.01;camera.far=Math.max(2000,size*20);camera.position.copy(center).add(new T.Vector3(.8,.55,1).normalize().multiplyScalar(size*1.45/Math.min(1,camera.aspect)));camera.lookAt(center);camera.updateProjectionMatrix();if(target)target.copy(center);}
 return {T,OrbitControls,model,dispose,light,fit};})();
Mol.graphics.catch(e=>{document.dispatchEvent(new CustomEvent('graphics-error',{detail:e}));});
class Thumbnails{
 constructor(){this.queue=[];this.running=false;this.renderer=null;this.unavailable=false;}
 request(id,alive){return new Promise((resolve)=>{this.queue.push({id,alive,resolve});this.run();});}
 async run(){if(this.running)return;this.running=true;try{while(this.queue.length){this.queue.sort((a,b)=>Number(b.alive(true))-Number(a.alive(true)));const task=this.queue.shift();if(!task.alive()){task.resolve(null);continue;}try{let cached=await Mol.get('thumb',task.id);if(!cached&&task.alive(true)&&!this.unavailable){const m=await Mol.get('body',task.id);if(!m){task.resolve(null);continue;}const g=await Mol.graphics;if(!task.alive(true)){task.resolve(null);continue;}if(!this.renderer){try{this.renderer=new g.T.WebGLRenderer({alpha:true,antialias:true,preserveDrawingBuffer:true});}catch(e){this.unavailable=true;document.dispatchEvent(new CustomEvent('webgl-error'));throw e;}this.renderer.setSize(160,160);this.renderer.setPixelRatio(1);}const scene=new g.T.Scene(),camera=new g.T.PerspectiveCamera(38,1,.01,2000);g.light(scene);const model=g.model(m.atoms);scene.add(model);g.fit(camera,m.atoms);this.renderer.render(scene,camera);const blob=await new Promise(r=>this.renderer.domElement.toBlob(r,'image/png'));g.dispose(model);if(blob){await Mol.cacheThumb(task.id,blob);cached={blob};}}
 task.resolve(cached?.blob||null);}catch(e){task.resolve(null);}await new Promise(requestAnimationFrame);}}finally{this.running=false;}}
}
Mol.thumbnails=new Thumbnails();
Mol.VirtualGrid=class{
 constructor(el,{mini=false,onSelect=()=>{},onOpen=null,onDelete=null,isSelected=()=>false}={}){this.el=el;this.mini=mini;this.onSelect=onSelect;this.onOpen=onOpen;this.onDelete=onDelete;this.isSelected=isSelected;this.data=[];this.nodes=new Map();this.row=mini?160:218;this.spacer=document.createElement('div');this.spacer.className='grid-spacer';el.append(this.spacer);el.addEventListener('scroll',()=>this.schedule());new ResizeObserver(()=>this.schedule()).observe(el);}
 setData(data){this.data=data;this.render();}
 schedule(){if(this.pending)return;this.pending=requestAnimationFrame(()=>{this.pending=null;this.render();});}
 clear(){for(const n of this.nodes.values())this.drop(n);this.nodes.clear();}
 drop(n){n.alive=false;if(n.url)URL.revokeObjectURL(n.url);n.el.remove();}
 render(){const cols=Math.max(1,Math.floor(this.el.clientWidth/(this.mini?128:180))),w=this.el.clientWidth/cols,first=Math.max(0,Math.floor(this.el.scrollTop/this.row)-2),last=Math.ceil((this.el.scrollTop+this.el.clientHeight)/this.row)+2,start=first*cols,end=Math.min(this.data.length,last*cols);this.spacer.style.height=Math.ceil(this.data.length/cols)*this.row+'px';const wanted=new Set(this.data.slice(start,end).map(m=>m.id));for(const [id,n]of this.nodes)if(!wanted.has(id)){this.drop(n);this.nodes.delete(id);}
  for(let i=start;i<end;i++){const m=this.data[i];let n=this.nodes.get(m.id);if(!n){const el=document.createElement('article');el.className='tile';el.tabIndex=0;el.setAttribute('role','checkbox');el.innerHTML='<div class="check"></div><div class="thumb">◌</div><div class="tile-info"><div class="tile-name"></div><div class="tile-bottom"><span></span><button class="delete" aria-label="削除">削除</button></div></div>';el.querySelector('.tile-name').textContent=m.name;el.title=m.name;el.querySelector('.tile-bottom span').textContent=m.count+' 原子';const del=el.querySelector('.delete');if(this.onDelete&&!m.builtin)del.onclick=e=>{e.stopPropagation();this.onDelete(m);};else del.remove();el.onclick=()=>{this.onSelect(m);this.render();};el.onkeydown=e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();this.onSelect(m);this.render();}};if(this.onOpen)el.ondblclick=()=>this.onOpen(m);n={el,alive:true,url:null,loading:false,index:i};this.nodes.set(m.id,n);this.spacer.append(el);}
  n.index=i;n.el.style.cssText=`left:${i%cols*w+4}px;top:${Math.floor(i/cols)*this.row+4}px;width:${w-8}px;height:${this.row-8}px`;const selected=this.isSelected(m.id);n.el.classList.toggle('selected',selected);n.el.setAttribute('aria-checked',String(selected));n.el.querySelector('.check').textContent=selected?'✓':'';
  const visible=()=>n.alive&&Math.floor(n.index/cols)*this.row<this.el.scrollTop+this.el.clientHeight&&(Math.floor(n.index/cols)+1)*this.row>this.el.scrollTop;
  if(n.url&&!visible()){URL.revokeObjectURL(n.url);n.url=null;n.el.querySelector('.thumb').textContent='◌';}
  if(!n.url&&!n.loading&&visible()){n.loading=true;Mol.thumbnails.request(m.id,strict=>strict?visible():n.alive).then(blob=>{n.loading=false;if(blob&&visible()){n.url=URL.createObjectURL(blob);const img=new Image();img.alt=m.name+' の分子モデル';img.src=n.url;n.el.querySelector('.thumb').replaceChildren(img);}else if(n.alive&&Mol.thumbnails.unavailable){n.el.querySelector('.thumb').textContent='WebGL 利用不可';}});}
 }
 }
};
}
