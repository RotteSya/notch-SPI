import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {changePersona} from '../core/personas.mjs';
const cases=JSON.parse(fs.readFileSync(new URL('./fixtures/persona-library.json',import.meta.url)));
test('shared Mac/desktop persona library scenarios: only explicit activation selects an existing persona',()=>{
 let state={personas:[],persona:{id:'',name:'',description:''}};
 for(const step of cases){
  state=changePersona(state,step.action,['add','update'].includes(step.action)?{id:step.id,name:step.name,description:step.description}:step.id);
  assert.equal(state.persona.id,step.active);assert.equal(state.personas.length,step.count);
  if(step.action==='update')assert.equal(state.persona.description,'');
 }
});
test('profile edits preserve order and reject malformed or oversized content',()=>{
 const s={personas:[{id:'a',name:'A',description:''}],persona:{id:'a',name:'A',description:''}};
 assert.throws(()=>changePersona(s,'update',{id:'a',name:'A',description:'x'.repeat(16001)}));
 assert.equal(changePersona(s,'update',{id:'a',name:' B ',description:'text'}).persona.name,'B');
 assert.equal(s.persona.name,'A');
});
