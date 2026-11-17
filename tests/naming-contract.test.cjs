'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const file=p=>fs.readFileSync(path.join(__dirname,'../dist',p),'utf8');
const reactions=file('reaction-store.js');
const start=reactions.indexOf('function createReaction(structures, reactionName) {');
const end=reactions.indexOf('async function importRecords(items)',start);
assert.ok(start>=0&&end>start,'Reaction create function is available');
const ids=['generated-id-A','generated-id-B'];let counter=0;
const create=new Function('Mol','crypto','transaction',reactions.slice(start,end)+';return createReaction;')(
 {electronicState:()=>({charge:0,multiplicity:1})},
 {randomUUID:()=>ids[counter++]},
 (_mode,action)=>action({add:()=>{}},x=>x)
);
const input={id:'attacker-provided-id',name:'wrong name',createdAt:0,START:{atoms:[]}};
const result=create(input,'User-facing reaction');
assert.equal(result.id,'generated-id-A');
assert.equal(result.name,'User-facing reaction');
assert.notEqual(result.createdAt,0);
assert.equal(input.id,'attacker-provided-id','Caller input must not be changed');
const second=create(input,'Different name');
assert.equal(second.id,'generated-id-B');
const worker=file('worker.js');
assert.match(worker,/Mol\.nextDuplicateName\(name,names\)/);
assert.doesNotMatch(worker,/base\+' \('\+\(\+\+n\)/);
const imported=file('molecule-archive.js');
assert.match(imported,/item\.name\+' \('\+\(i\+1\)\+'\)'/);
const archive=file('reaction-archive.js');
assert.match(archive,/label\+'\.reaction-library\.zip'/);
const orca=file('orca-gallery.js');
assert.match(orca,/sourceName\+'\/ORCA\('\+number\+'\)'/);
assert.match(orca,/id:crypto\.randomUUID\(\),name,sourceName,method:'ORCA',runNumber:number/);
const colab=file('colab-records.js');
assert.match(colab,/nextRunNumber:String\(number\+1\)/);
assert.match(colab,/const appProperties=\{\.\.\.\(job\.appProperties\|\|\{\}\)\}/);
assert.match(colab,/sourceReaction\.sourceReactionId!==batchJob\.reaction_id/);
console.log('PASS naming contracts: protected reaction IDs, XYZ imports, archives, ORCA labels and retained run metadata');
