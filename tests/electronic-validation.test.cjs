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
assert.equal(M.checkElectronicState({atoms:atoms(['C','H','H','H']),charge:0,multiplicity:2}).valid,true,'neutral methyl radical has 9 electrons');
assert.equal(M.checkElectronicState({atoms:atoms(['O','O']),charge:0,multiplicity:3}).valid,true,'neutral oxygen triplet has 16 electrons');
assert.equal(M.checkElectronicState({atoms:atoms(['Fe']),charge:0,multiplicity:5}).valid,true);
assert.equal(M.checkElectronicState({atoms:atoms(['Xx']),charge:0,multiplicity:1}).valid,false);
assert.equal(M.checkElectronicState({atoms:water,charge:.5,multiplicity:1}).valid,false);
const before={name:'old',atoms:water},copy=structuredClone(before);M.checkElectronicState(before);assert.deepEqual(before,copy);
const reaction={START:{atoms:water,charge:0,multiplicity:1},FINISH:{atoms:water,charge:1,multiplicity:2}};
assert.equal(M.electronicWarnings(reaction).length,1,'valid endpoints can still differ in charge');
assert.match(M.electronicWarnings(reaction)[0],/START: 0 \/ FINISH: 1/);
assert.equal(M.electronicWarnings({START:reaction.START}).length,0);
const both=M.electronicWarnings({...reaction,FINISH:{...reaction.FINISH,multiplicity:1}});assert.equal(both.length,2);assert.match(both[0],/FINISH.*電子/);assert.match(both[1],/反応前後/);
const original={id:'r',START:{...reaction.START,name:'start',revision:'old-start',raw:new Blob(['start raw'])},FINISH:{...reaction.FINISH,name:'finish',revision:'old-finish',raw:new Blob(['finish raw'])}};
const mirrored=M.mirrorReactionState(original,'FINISH');
assert.equal(mirrored.START.charge,1);assert.equal(mirrored.START.multiplicity,2);
assert.equal(mirrored.START.atoms,original.START.atoms);assert.equal(mirrored.START.raw,original.START.raw);assert.equal(mirrored.START.name,'start');assert.notEqual(mirrored.START.revision,'old-start');assert.equal(mirrored.FINISH,original.FINISH);assert.equal(original.START.charge,0);
assert.deepEqual(M.electronicWarnings(mirrored),[]);
console.log('PASS electron parity, electron bounds, neutral/charged water, atoms/metals, unknown elements, legacy immutability and reaction charge changes');
