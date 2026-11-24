'use strict';
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.join(__dirname,'../dist');
const html=fs.readFileSync(path.join(root,'colab.html'),'utf8');
const js=fs.readFileSync(path.join(root,'colab-records.js'),'utf8');
const editor=fs.readFileSync(path.join(root,'editor.html'),'utf8');
const viewer=fs.readFileSync(path.join(root,'reaction-viewer.html'),'utf8');
const slideshow=fs.readFileSync(path.join(root,'slideshow.js'),'utf8');
// New selection controls are complete and uniquely identified.
for(const id of ['colabSelectionToolbar','colabSelectionCount','colabSelectionClassify','colabSelectionClear']){
  const found=[...html.matchAll(new RegExp('id="'+id+'"','g'))];
  assert.equal(found.length,1,id+' must exist exactly once');
}
assert.match(js,/const selectedJobIds = new Set\(\)/);
assert.match(js,/card\.addEventListener\('click',[\s\S]*?event\.ctrlKey \|\| event\.metaKey/);
assert.match(js,/card\.addEventListener\('contextmenu',[\s\S]*?event\.shiftKey/);
assert.match(js,/selectionCheckbox\.onclick[\s\S]*?toggleSelected\(job\.id\)/);
assert.match(js,/const targets = \[\.\.\.classificationTargets\]/);
assert.match(html,/id="classificationKnownNames"/);
assert.match(html,/分類名を一括変更/);
assert.match(js,/get\('classificationKnownNames'\)/);
assert.match(js,/classificationTargets\.length > 1/);
assert.match(js,/for \(const jobId of targets\)/);
assert.match(js,/failed\.length/);
assert.match(js,/if \(event\.target\.closest\('button,input,\.colab-record-name,\.colab-notes'\)\) return;/);
assert.match(html,/#colabSelectionToolbar\[hidden\]\{display:none\}/);
// Existing core functions cannot be lost by a cosmetic selection patch.
for(const feature of ['downloadArchive(', 'openReaction(', 'openClassification(', 'renameClassification(', 'function loadRecords(', 'function renderRecord(']){
  assert.ok(js.includes(feature),'retained Colab feature: '+feature);
}
assert.match(editor,/id="speed" type="range" min="0\.1" max="8" step="0\.1" value="5"/);
assert.match(editor,/id="optimize"[\s\S]{0,250}id="optimizeGfn1"/);
assert.doesNotMatch(viewer,/出発物を選んで生成物として保存/);
assert.match(slideshow,/元反応ZIPの追加情報を取得できません/);
assert.match(slideshow,/上書きをしますか/);
console.log('Colab selection, editor, viewer source contracts passed');
