import test from 'node:test';
import assert from 'node:assert/strict';
import {enqueueCaptureFlight} from '../core/capture-flight.mjs';
import {FlightQueue} from '../core/flights.mjs';

const image = {id:'shot',base64:'fixture',width:100,height:100,sourceBounds:{x:0,y:0,width:100,height:100}};
test('capture continues without invoking hung or rejected evidence readback', async () => {
  for (const prepareEvidence of [() => new Promise(() => {}), () => Promise.reject(Error('readback failed'))]) {
    let readbacks=0, submitted=0;
    const queue=new FlightQueue();
    const flights={add:shot=>queue.add(shot),prepareEvidence:()=>{readbacks++;return prepareEvidence();}};
    enqueueCaptureFlight(flights,image);
    submitted++;
    assert.equal(submitted,1);assert.equal(readbacks,0);assert.deepEqual(queue.ids,['shot']);
    queue.clear();
    await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(queue.ids,[], 'cancel must not be undone by a late animation continuation');
  }
});
test('failed flight does not prevent submission or the next capture and exports no exception', () => {
  const events=[];let submitted=0,fail=true;
  const queue=new FlightQueue();
  const flights={add:shot=>{if(fail)throw Error('SECRET');queue.add(shot);}};
  assert.equal(enqueueCaptureFlight(flights,image,(...args)=>events.push(args)),false);submitted++;
  fail=false;
  assert.equal(enqueueCaptureFlight(flights,{...image,id:'next'}),true);submitted++;
  assert.equal(submitted,2);assert.deepEqual(events,[['flight_failed']]);assert.deepEqual(queue.ids,['next']);
});
test('flight clock still starts only after renderer and destination are ready', () => {
  let now=0;const queue=new FlightQueue({now:()=>now});
  enqueueCaptureFlight({add:shot=>queue.add(shot)},image);
  const targets=[{id:'shot',x:10,y:10,width:30,height:30}];
  queue.targets(targets,false);assert.equal(queue.frames.length,0);
  now=400;queue.targets(targets,true);assert.equal(queue.frames[0].start,400);
  queue.clear();now=500;queue.targets(targets,true);assert.equal(queue.frames.length,0);
});
