import test from 'node:test';
import assert from 'node:assert/strict';
import {previewSize,previewLabels} from '../core/image-preview.mjs';
test('preview fits large images and preserves native minimum for small images',()=>{
 assert.deepEqual(previewSize({width:1600,height:900},{width:1000,height:700}),{width:880,height:495});
 assert.deepEqual(previewSize({width:100,height:80},{width:1000,height:700}),{width:400,height:240});
});
test('preview labels identify selected image and explain collection pause',()=>{
 for(const language of ['zh','ja','en']) {
  const state={settings:{language},images:[{id:'a'},{id:'b'}],previewID:'b',collecting:true};
  assert.match(previewLabels(state).title,/2 \/ 2/);
  assert.match(previewLabels(state).hint,/4/);
  assert.doesNotMatch(previewLabels({...state,collecting:false}).hint,/4/);
 }
});
