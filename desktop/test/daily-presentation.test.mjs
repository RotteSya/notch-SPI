import {canPollAutomatic} from '../core/daily-session.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {dailyPresentation,readingScrollPosition} from '../generated/ui/capture.mjs';
const base = {images:[{},{}],mode:'tutor',status:'done'};
test('retained text never masks a tutor error, retake, empty result or cancellation',()=>{
 for(const status of ['error','retake','empty','canceled']) assert.equal(dailyPresentation({...base,status,answer:'stale answer'}).messageFirst,true);
 assert.equal(dailyPresentation({...base,status:'done',operation:'explain',message:'explanation failed'}).messageFirst,false);
 assert.equal(dailyPresentation({...base,status:'error',mode:'personality'}).messageFirst,false);
});
test('native collection precedence: capture, preview, countdown, next image',()=>{
 const s={...base,collecting:true,remaining:3};
 assert.equal(dailyPresentation(s,'zh').heading,'3 秒后查题');
 assert.equal(dailyPresentation({...s,preview:'x'},'zh').heading,'已暂停');
 assert.equal(dailyPresentation({...s,preview:'x',capturing:true},'zh').heading,'截图中');
 assert.equal(dailyPresentation({...s,remaining:null},'zh').heading,'等待下一张');
 assert.equal(dailyPresentation({...s,remaining:0},'zh').heading,'等待提交');
 assert.equal(dailyPresentation(s).progress,.75);
});
test('capture disables submission and mutation; four images removes only next slot',()=>{
 for(const capturing of [false,true]) for(const count of [0,1,2,3,4]){
  const p=dailyPresentation({...base,collecting:true,capturing,images:Array(count).fill({})});
  assert.equal(p.canSubmit,!capturing&&count>=2);assert.equal(p.canEditImages,!capturing);assert.equal(p.nextSlot,count<4);
 }
});
test('new answer starts at top; final never jumps to bottom; reader detachment survives streaming',()=>{
 const s={previous:90,maximum:300,atEnd:true};
 assert.equal(readingScrollPosition({...s,newTurn:true}),0);
 assert.equal(readingScrollPosition({...s,firstAnswer:true}),0);
 assert.equal(readingScrollPosition({...s,firstAnswer:true,detached:true}),90);
 assert.equal(readingScrollPosition({...s,streaming:true}),300);
 assert.equal(readingScrollPosition({...s,streaming:true,detached:true}),90);
 assert.equal(readingScrollPosition({...s,streaming:true,hasAnswer:true}),90);
});

test('auto review pauses capture until confirmation and never overlaps an in-flight solve',()=>{
 assert.equal(canPollAutomatic({active:true}),true);
 for(const key of ['busy','polling','reviewPending'])assert.equal(canPollAutomatic({active:true,[key]:true}),false);
 assert.equal(canPollAutomatic({active:false}),false);
});
