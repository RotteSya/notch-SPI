import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {serveRequest,trackRequestWork} from '../src/request-lifecycle.ts';
test('serverless lifetime includes settlement after the response closes',async()=>{
 const symbol=Symbol.for('@vercel/request-context'),runtime=globalThis as typeof globalThis & {[key:symbol]:unknown},before=runtime[symbol];
 let retained:Promise<unknown>|undefined,commit!:()=>void,committed=false,finished=false;
 runtime[symbol]={get:()=>({waitUntil:(p:Promise<unknown>)=>{retained=p;}})};
 const req=new EventEmitter() as IncomingMessage,res=new EventEmitter() as ServerResponse;
 try{
  const hold=new Promise<void>(resolve=>{commit=resolve;});
  const task=serveRequest(req,res,()=>{
   void trackRequestWork(req,async()=>{await hold;committed=true;});res.emit('close');
  }).then(()=>{finished=true;});
  await Promise.resolve();await Promise.resolve();assert.ok(retained);assert.equal(finished,false);assert.equal(committed,false);
  commit();await task;await retained;assert.equal(committed,true);assert.equal(finished,true);
 }finally{if(before===undefined)delete runtime[symbol];else runtime[symbol]=before;}
});
