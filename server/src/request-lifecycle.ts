import type {IncomingMessage, ServerResponse} from 'node:http';
let reported=false;
const work = new WeakMap<IncomingMessage, Promise<void>>();

// The transport may close before a negotiated capture has durably settled.
// Keep that work attached to the serverless invocation, never fire-and-forget.
export function trackRequestWork(req:IncomingMessage, run:()=>Promise<void>):Promise<void> {
  const running=Promise.resolve().then(run);
  work.set(req,running.then(()=>{},()=>{}));
  return running;
}
export function serveRequest(req:IncomingMessage,res:ServerResponse,dispatch:()=>void):Promise<void> {
 const running=(async()=>{
  const transport=new Promise<void>(resolve=>{
    const done=()=>{res.off('finish',done);res.off('close',done);resolve();};
    res.once('finish',done);res.once('close',done);
    if(res.destroyed||res.writableFinished)done();
  });
  dispatch();
  await transport;
  await work.get(req);
 })();
 // The runtime hook used by @vercel/functions waitUntil. Keep the bridge local
 // to avoid introducing a dependency solely for this two-method adapter.
 // Source contract: vercel/vercel packages/functions/src/get-context.ts.
 const symbol=Symbol.for('@vercel/request-context');
 const runtime=globalThis as typeof globalThis & {[key:symbol]:{get?:()=>{waitUntil?:(promise:Promise<unknown>)=>void}}|undefined};
 const context=runtime[symbol]?.get?.();
 if(process.env.VERCEL&&!reported){reported=true;console.info(JSON.stringify({requestLifetimeExtension:typeof context?.waitUntil==='function'}));}
 context?.waitUntil?.(running);
 return running;
}
