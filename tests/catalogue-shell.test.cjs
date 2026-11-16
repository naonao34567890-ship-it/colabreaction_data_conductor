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
const orca=fs.readFileSync(path.join(root,'orca.html'),'utf8');
assert.match(orca,/<div class="page" id="orcaPage">/,'ORCA should use molecular library page shell');
assert.match(orca,/<header class="library-shell-header">/,'ORCA should use fixed top actions');
assert.match(orca,/<main class="workspace orca-workspace" id="orcaScroll">/,'ORCA should have an independent catalogue scroll region');
assert.doesNotMatch(orca,/class="main"/,'ORCA should not retain the former standalone centered frame');
const shell=fs.readFileSync(path.join(root,'library-shell.css'),'utf8');
assert.match(shell,/#orcaPage\\s*\\{[\\s\\S]*?height:100dvh/,'ORCA shell should fill the viewport');
for(const filename of ['reactions.html','colab.html','orca.html']){
 const html=fs.readFileSync(path.join(root,filename),'utf8');
 assert.match(html, /class="[^"]*tidy-import[^"]*"/,filename+': missing top file import toolbar');
}
const editor=fs.readFileSync(path.join(root,'editor.html'),'utf8');
assert.match(editor,/<details class="help moiety-help"><summary>交換の使い方<\/summary>/);
assert.match(editor,/<button id="swap"[^>]*>/);
assert.match(editor,/<div class="heading editor-heading">[\s\S]*?<section class="editor-electronic-panel"[\s\S]*?<input id="structureCharge"/);
assert.match(editor,/<input id="structureMultiplicity"/);
assert.equal((editor.match(/id="structureCharge"/g)||[]).length,1);
assert.equal((editor.match(/id="structureMultiplicity"/g)||[]).length,1);
assert.match(editor,/\$\('electronicCheck'\)\.hidden=check\.valid/);
console.log('PASS: catalogue shell preserves critical controls and editor swap help is collapsible');
