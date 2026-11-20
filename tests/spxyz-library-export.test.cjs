'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const library = fs.readFileSync(path.join(__dirname, '../dist/library.html'), 'utf8');
const start = library.indexOf('async function prepareSpxyzExport(');
const end = library.indexOf("window.addEventListener('beforeunload'", start);
assert.ok(start >= 0 && end > start);
const run = new Function('$', 'Mol', 'MolJobs', 'Worker', 'window', 'showSaveFilePicker',
 'notice', 'selectionUI', 'runQueue', 'confirm', 'selected', 'metaMap', `
 let exporting=false,exportCancel=null,active=null;
 ${library.slice(start,end)}
 return {start:()=> $('exportStart').onclick(), cancel:()=> exportCancel?.()};
`);

const frame = '原子数: 1 | 組成式: He | スピン多重度: 1 | 電荷数: 0 | 溶媒: Water\n\nHe 0 0 0\n';

function setup(get, {acceptPartial=true} = {}) {
 const nodes = new Map();
 const $ = id => {
  if (!nodes.has(id)) nodes.set(id, {value:'',close(){}});
  return nodes.get(id);
 };
 $('format').value = 'spxyz';
 $('exportName').value = 'selected';
 $('exportSolvent').value = 'Water';
 const downloaded = [], messages = [], confirmations = [];
 let pickerOpens = 0, workerStarts = 0;
 const showSaveFilePicker = async () => {pickerOpens++; throw Error('Unexpected picker');};
 const Mol = {
  get: (store,id) => {assert.equal(store,'body');return get(id);},
  spxyzSolvent: value => value,
  spxyzText: (body,solvent) => {
   assert.equal(solvent,'Water');
   if(body.invalid)throw Error('スピン多重度が合いません。');
   return body.frame;
  },
  safeName: value => value,
  tick: async()=>{},
  downloadBlob: (blob,name) => downloaded.push({blob,name}),
 };
 const Worker = class { constructor(){workerStarts++;throw Error('Unexpected Worker');} };
 const confirm = message=>{confirmations.push(message);return acceptPartial;};
 const controls = run($,Mol,{},Worker,{showSaveFilePicker},showSaveFilePicker,
  message=>messages.push(message),()=>{},()=>{},confirm,new Set(['a','b']),
  new Map([['a',{name:'試料A'}],['b',{name:'試料B'}]]));
 return {controls,downloaded,messages,confirmations,counts:()=>[pickerOpens,workerStarts]};
}

(async()=>{
 const valid=setup(async()=>({frame}));
 await valid.controls.start();
 assert.deepEqual(valid.counts(),[0,0]);
 assert.equal(valid.downloaded.length,1);
 assert.equal(valid.downloaded[0].name,'selected.spxyz');
 assert.equal(await valid.downloaded[0].blob.text(),frame+'\n'+frame);

 for(const bad of [()=>({invalid:true}),()=>undefined,()=>{throw Error('Drive offline');}]){
  const read=async id=>id==='a'?bad():{frame};
  const accepted=setup(read);
  await accepted.controls.start();
  assert.deepEqual(accepted.counts(),[0,0]);
  assert.equal(accepted.confirmations.length,1);
  assert.match(accepted.confirmations[0],/試料A/);
  assert.equal(await accepted.downloaded[0].blob.text(),frame);
  const declined=setup(read,{acceptPartial:false});
  await declined.controls.start();
  assert.equal(declined.downloaded.length,0);
 }

 const invalid=setup(async()=>({frame:''}));
 await invalid.controls.start();
 assert.equal(invalid.downloaded.length,0);
 assert.match(invalid.messages.at(-1),/試料A.*座標/s);

 let unblock;
 const waiting=setup(()=>new Promise(resolve=>{unblock=resolve;}));
 const pending=waiting.controls.start();
 waiting.controls.cancel();
 unblock({frame});
 await pending;
 assert.equal(waiting.downloaded.length,0);
 assert.match(waiting.messages.at(-1),/キャンセル/);
 console.log('PASS SPXYZ reads through the page, preserves valid frames, and reports blocked records');
})().catch(error=>{console.error(error);process.exitCode=1;});
