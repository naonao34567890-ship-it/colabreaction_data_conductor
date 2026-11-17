import assert from 'node:assert/strict';
import {LibraryCoordinator} from '../standalone-drive/library-coordinator.mjs';
const state=new Map();
const storage={
 async get(key){return state.get(key);},
 async put(key,value){state.set(key,value);},
};
const object=new LibraryCoordinator({storage});
const reserve=async(runId,reactionId,reactionName,minimumRunNumber=1,method='DMF')=>{
 const response=await object.fetch(new Request('https://internal/runs',{
  method:'POST',body:JSON.stringify({action:'reserveRun',accessToken:'valid-user-token',
   runId,reactionId,reactionName,method,minimumRunNumber})}));
 assert.equal(response.status,200);
 return (await response.json()).run;
};
const id1='11111111-1111-4111-8111-111111111111';
const id2='22222222-2222-4222-8222-222222222222';
const id3='33333333-3333-4333-8333-333333333333';
const id4='44444444-4444-4444-8444-444444444444';
const [a,b]=await Promise.all([
 reserve(id1,'source-a','Bromination'),
 reserve(id2,'source-a','Bromination renamed'),
]);
assert.deepEqual([a.runNumber,b.runNumber],[1,2]);
assert.deepEqual([a.displayPath,b.displayPath],['Bromination/DMF(1)','Bromination/DMF(2)']);
const same=await reserve(id1,'source-a','Another name');
assert.deepEqual(same,a,'run ID must be idempotent');
const third=await reserve(id3,'source-b','Bromination');
assert.equal(third.displayPath,'Bromination (1)/DMF(1)');
const fourth=await reserve(id4,'source-a','Bromination',8);
assert.equal(fourth.runNumber,8);
const lookup=await object.fetch(new Request('https://internal/runs',{
 method:'POST',body:JSON.stringify({action:'lookupRun',accessToken:'token',runId:id2})}));
assert.equal((await lookup.json()).run.runNumber,2);
const collision=await object.fetch(new Request('https://internal/runs',{
 method:'POST',body:JSON.stringify({action:'reserveRun',accessToken:'token',
 runId:id1,reactionId:'other-reaction',reactionName:'Other',method:'DMF'})}));
assert.equal(collision.status,409);
console.log('PASS shared per-account ledger: concurrency, stable run IDs, aliasing, minimum numbers and lookup');
