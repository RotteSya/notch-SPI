import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import type {RequestKeys} from './billing.ts';
import type {Usage} from './providers/types.ts';
export interface SavedAnswer {text:string;usage:Usage|null}
// Short lived, account-bound encrypted delivery cache. No screenshot or prompt is stored.
export function sealAnswer(keys:RequestKeys,token:string,id:string,version:string,value:SavedAnswer):string {
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',Buffer.from(keys.digest('delivery-key',token+'\0'+id,version),'hex'),iv);
  const bytes=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),bytes]).toString('base64');
}
export function openAnswer(keys:RequestKeys,token:string,id:string,version:string,value:string):SavedAnswer {
  const b=Buffer.from(value,'base64'),cipher=createDecipheriv('aes-256-gcm',Buffer.from(keys.digest('delivery-key',token+'\0'+id,version),'hex'),b.subarray(0,12));
  cipher.setAuthTag(b.subarray(12,28));
  return JSON.parse(Buffer.concat([cipher.update(b.subarray(28)),cipher.final()]).toString('utf8')) as SavedAnswer;
}
/** Only for idempotent writes/read-back; never wrap a vendor call or arbitrary transaction. */
export async function settleReliably<T>(write:()=>Promise<T>):Promise<T> {
  for(let attempt=0;;attempt++)try{return await write();}catch(e){if(attempt===2)throw e;await delay(100*(attempt+1));}
}
