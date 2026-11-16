'use strict';
// Fast release guard: tests must not click a button hidden under a closed
// HTML <details> without going through the shared disclosure-aware helper.
// This catches the exact class of UI changes that blocked publication.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const dist=path.join(__dirname,'../dist');
const hidden=new Map();
for(const filename of fs.readdirSync(dist).filter(name=>name.endsWith('.html'))){
  const html=fs.readFileSync(path.join(dist,filename),'utf8');
  for(const disclosure of html.matchAll(/<details\b[^>]*>([\s\S]*?)<\/details>/gi)){
    for(const tag of disclosure[1].matchAll(/<(?:button|input|select)\b[^>]*>/gi)){
      const id=tag[0].match(/\bid=["']([^"']+)["']/i)?.[1];
      if(id){
        if(!hidden.has(id))hidden.set(id,[]);
        hidden.get(id).push(filename);
      }
    }
  }
}
const directClicks=[];
for(const filename of fs.readdirSync(__dirname).filter(name=>/\.test\.(?:cjs|mjs)$/.test(name))){
  const test=fs.readFileSync(path.join(__dirname,filename),'utf8');
  for(const match of test.matchAll(/\.click\(\s*['"`]#([a-zA-Z][\w-]*)['"`]/g)){
    const id=match[1];
    if(hidden.has(id))directClicks.push(filename+': #'+id+' (hidden in '+hidden.get(id).join(', ')+')');
  }
}
assert.deepEqual(directClicks,[], 'Use clickInDisclosure(page, "#id") instead of direct click for hidden controls');
const helper=fs.readFileSync(path.join(__dirname,'support/ui-actions.cjs'),'utf8');
assert.match(helper,/async function clickInDisclosure/);
for(const filename of ['electronic-state-browser.test.cjs','electronic-validation-browser.test.cjs']){
  const test=fs.readFileSync(path.join(__dirname,filename),'utf8');
  assert.match(test,/clickInDisclosure\(page,'#saveReactionStart'\)|clickInDisclosure\(page,'#saveReactionFinish'\)/);
}
console.log('PASS disclosure contract: '+hidden.size+' control IDs scanned across pages; browser tests use safe click helpers');
