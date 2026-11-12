import type {IncomingMessage, ServerResponse} from 'node:http';
const work = new WeakMap<IncomingMessage, Promise<void>>();

// The transport may close before a negotiated capture has durably settled.
// Keep that work attached to the serverless invocation, never fire-and-forget.
export function trackRequestWork(req:IncomingMessage, run:()=>Promise<void>):Promise<void> {
  const running=Promise.resolve().then(run);
  work.set(req,running.then(()=>{},()=>{}));
  return running;
}
export async function serveRequest(req:IncomingMessage,res:ServerResponse,dispatch:()=>void):Promise<void> {
  const transport=new Promise<void>(resolve=>{
    const done=()=>{res.off('finish',done);res.off('close',done);resolve();};
    res.once('finish',done);res.once('close',done);
    if(res.destroyed||res.writableFinished)done();
  });
  dispatch();
  await transport;
  await work.get(req);
}
