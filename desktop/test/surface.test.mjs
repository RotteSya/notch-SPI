import test from 'node:test';
import assert from 'node:assert/strict';
import { ditherPixels, surfaceTone } from '../ui/surface.mjs';
import { lightTarget } from '../ui/light-field.mjs';

test('material remains bounded through spring overshoot and collapsed shadow disappears',()=>{
 assert.deepEqual(surfaceTone(-.05),surfaceTone(0));
 assert.deepEqual(surfaceTone(1.05),surfaceTone(1));
 assert.equal(surfaceTone(0).shadow,0);
 for(let i=1;i<=100;i++) assert.ok(surfaceTone(i/100).sheen>=surfaceTone((i-1)/100).sheen);
});
test('static native noise never changes across refreshes and has opaque monochrome pixels',()=>{
 const first=ditherPixels();assert.equal(first.length,96*96*4);assert.deepEqual(first,ditherPixels());
 const values=new Set();for(let i=0;i<first.length;i+=4){assert.equal(first[i],first[i+1]);assert.equal(first[i],first[i+2]);assert.equal(first[i+3],255);values.add(first[i]);}
 assert.equal(values.size,256);
});
test('only thinking sweeps; streaming is calm, errors amber, completion returns to idle light',()=>{
 assert.equal(lightTarget('running').scan,1);
 for(const status of ['ready','streaming','error','done'])assert.equal(lightTarget(status).scan,0);
 assert.ok(lightTarget('running').energy>lightTarget('streaming').energy);
 assert.deepEqual(lightTarget('error').tint,[1,.55,.22]);
 assert.deepEqual(lightTarget('done'),lightTarget('ready'));
});

test('high-refresh displays do not accelerate light glides or completion pulses',async()=>{
 const {LightField}=await import('../ui/light-field.mjs');
 const original=globalThis.document;globalThis.document={hidden:false};
 try {
  const field=Object.create(LightField.prototype);
  Object.assign(field,{program:{},depth:1,status:'running',flow:1,shown:lightTarget('ready'),target:lightTarget('running'),frame:null});
  const frames=[];field.draw=time=>frames.push(time);field.wake=()=>{};
  for(const time of [0,8,16.667,25,33.334])field.step(time);
  assert.deepEqual(frames,[0,16.667,33.334]);
  assert.ok(Math.abs(field.flow-.9**3)<1e-9);
 } finally {if(original===undefined)delete globalThis.document;else globalThis.document=original;}
});
