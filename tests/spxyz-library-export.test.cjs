'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const library = fs.readFileSync(path.join(__dirname, '../dist/library.html'), 'utf8');
const start = library.indexOf("$('exportStart').onclick=async()=>{");
const end = library.indexOf("window.addEventListener('beforeunload'", start);
assert.ok(start >= 0 && end > start);
const run = new Function('$', 'Mol', 'MolJobs', 'Worker', 'window', 'showSaveFilePicker', 'notice', 'selectionUI', 'runQueue', 'confirm', 'selected', 'metaMap', 'localStorage', `
 let exporting=false,exportCancel=null,active=null;
 ${library.slice(start,end)}
 return {start:()=> $('exportStart').onclick(), cancel:()=> exportCancel?.()};
`);

function setup(exportData, {Worker = class { constructor(){throw Error('Worker unavailable');} }} = {}) {
 const nodes = new Map();
 const $ = id => {
  if (!nodes.has(id)) nodes.set(id, {value:'',close(){}});
  return nodes.get(id);
 };
 $('format').value = 'spxyz';
 $('exportName').value = 'selected';
 $('exportSolvent').value = 'Water';
 const downloaded = [], messages = [];
 let opened = 0;
 const showSaveFilePicker = async () => {opened++; throw Error('Picker should never open for SPXYZ');};
 const Mol = {
  spxyzSolvent: value => value,
  safeName: value => value,
  downloadBlob: (blob,name) => downloaded.push({blob,name}),
 };
 const controls = run($,Mol,{exportData},Worker,{showSaveFilePicker},showSaveFilePicker,
  message=>messages.push(message),()=>{},()=>{},()=>true,new Set(['a','b']),new Map(),{getItem:()=>null});
 return {controls,downloaded,messages,pickerOpens:()=>opened};
}

(async()=>{
 const encoder = new TextEncoder();
 const frame = '原子数: 1 | 組成式: He | スピン多重度: 1 | 電荷数: 0 | 溶媒: Water\n\nHe 0 0 0\n';
 const valid = setup(async(ids,format,send,_cancelled,progress,solvent)=>{
  assert.deepEqual(ids,['a','b']);assert.equal(format,'spxyz');assert.equal(solvent,'Water');
  for(let i=0;i<ids.length;i++){await send(encoder.encode((i?'\n':'')+frame));progress(i+1);}
 });
 await valid.controls.start();
 assert.equal(valid.pickerOpens(),0);
 assert.equal(valid.downloaded.length,1);
 assert.equal(valid.downloaded[0].name,'selected.spxyz');
 assert.equal(await valid.downloaded[0].blob.text(),frame+'\n'+frame);

 const failures = [
  async(_ids,_format,send)=>{await send(encoder.encode(frame));throw Error('The second molecule is invalid');},
  async()=>{},
  async(_ids,_format,send,_cancelled,progress)=>{await send(encoder.encode(frame));progress(1);},
 ];
 for(const exportData of failures){
  const invalid=setup(exportData);
  await invalid.controls.start();
  assert.equal(invalid.pickerOpens(),0);
  assert.equal(invalid.downloaded.length,0);
  assert.match(invalid.messages.at(-1),/^SPXYZの保存:/);
 }
 const waiting=setup(async()=>{throw Error('Cancelled export should not restart');},{
  Worker:class {postMessage(){} terminate(){}},
 });
 const task=waiting.controls.start();
 waiting.controls.cancel();
 await task;
 assert.equal(waiting.downloaded.length,0);
 assert.match(waiting.messages.at(-1),/キャンセル/);
 console.log('PASS SPXYZ library export completes before download and leaves no file on failure or cancellation');
})().catch(error=>{console.error(error);process.exitCode=1;});
