const assert=require('node:assert/strict'),M=require('../dist/common.js');
const atoms=els=>els.map(el=>({el,x:0,y:0,z:0}));
const water=atoms(['O','H','H']);
for(const charge of [-2,0,2]){
 assert.equal(M.checkElectronicState({atoms:water,charge,multiplicity:1}).valid,true);
 assert.equal(M.checkElectronicState({atoms:water,charge,multiplicity:2}).valid,false);
}
for(const charge of [-1,1]){
 assert.equal(M.checkElectronicState({atoms:water,charge,multiplicity:2}).valid,true);
 assert.equal(M.checkElectronicState({atoms:water,charge,multiplicity:1}).valid,false);
}
assert.equal(M.checkElectronicState({atoms:water,charge:0,multiplicity:11}).valid,true,'maximum all-electron spin');
assert.equal(M.checkElectronicState({atoms:water,charge:0,multiplicity:13}).valid,false,'spin cannot exceed electron count');
assert.equal(M.checkElectronicState({atoms:water,charge:11,multiplicity:1}).valid,false,'negative electrons');
assert.equal(M.checkElectronicState({atoms:water,charge:10,multiplicity:1}).valid,true,'zero electron singlet is arithmetically consistent');
assert.equal(M.checkElectronicState({atoms:atoms(['H']),charge:0,multiplicity:2}).valid,true);
assert.equal(M.checkElectronicState({atoms:atoms(['Fe']),charge:0,multiplicity:5}).valid,true);
assert.equal(M.checkElectronicState({atoms:atoms(['Xx']),charge:0,multiplicity:1}).valid,false);
assert.equal(M.checkElectronicState({atoms:water,charge:.5,multiplicity:1}).valid,false);
const before={name:'old',atoms:water},copy=structuredClone(before);M.checkElectronicState(before);assert.deepEqual(before,copy);
const reaction={START:{atoms:water,charge:0,multiplicity:1},FINISH:{atoms:water,charge:1,multiplicity:2}};
assert.equal(M.electronicWarnings(reaction).length,1,'valid endpoints can still differ in charge');
assert.match(M.electronicWarnings(reaction)[0],/START: 0 \/ FINISH: 1/);
assert.equal(M.electronicWarnings({START:reaction.START}).length,0);
assert.equal(M.electronicWarnings({...reaction,FINISH:{...reaction.FINISH,multiplicity:1}}).length,2);
console.log('PASS electron parity, electron bounds, neutral/charged water, atoms/metals, unknown elements, legacy immutability and reaction charge changes');
