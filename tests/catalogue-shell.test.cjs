'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.join(__dirname,'../dist');
const pages={
  'library.html':['fileButton','folderButton','libraryOrder','thumbnailMode','grid'],
  'reactions.html':['reactionAll','reactionNone','reactionCopy','reactionPaste','reactionTag','reactionClassify','reactionDelete','reactionOrder','thumbnailMode','reactionDays','reactionArchive','reactionArchiveAll','reactionZip','reactionImport','reactionSelection','reactionCount'],
  'colab.html':['driveConnect','driveTemporary','replotExisting','colabDrop','colabZip','colabFolder','colabStatus','colabQueue','colabErrors','colabOrder','colabJobs','colabCount','driveSetup'],
  'orca.html':['choose','chooseFolder','upload','folder','search','order','exportIndex','cards','drop','status','progress','count','detail'],
  'editor.html':['register1','register2','m1','m2','swap']
};
for(const [filename,required] of Object.entries(pages)){
 const html=fs.readFileSync(path.join(root,filename),'utf8');
 const ids=[...html.matchAll(/\bid=["']([^"']+)["']/g)].map(m=>m[1]);
 assert.equal(new Set(ids).size,ids.length,filename+': duplicate IDs');
 for(const id of required)assert.ok(ids.includes(id),filename+': missing '+id);
 if(['reactions.html','colab.html','orca.html'].includes(filename)){
  assert.match(html,/library-shell\.css/,filename+': shared shell CSS');
  assert.match(html,/class=["'][^"']*library-shell-header/,filename+': shell header');
  assert.match(html,/class=["'][^"']*library-list-row/,filename+': list controls');
  assert.match(html,/class=["'][^"']*library-shell-heading/,filename+': catalogue heading');
 }
}
const editor=fs.readFileSync(path.join(root,'editor.html'),'utf8');
assert.match(editor,/<details class="help moiety-help"><summary>交換の使い方<\/summary>/);
assert.match(editor,/<button id="swap"[^>]*>/);
console.log('PASS: catalogue shell preserves critical controls and editor swap help is collapsible');
