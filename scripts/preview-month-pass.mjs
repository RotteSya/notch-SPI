#!/usr/bin/env node
// Standalone loopback server: no app initialization, environment secrets, DB or Stripe.
import {createServer} from 'node:http';
import {renderMonthPassPreview,MONTH_PASS_PREVIEW_CSP} from '../server/src/purchase-page.ts';
const server=createServer((req,res)=>{
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405,{'Allow':'GET, HEAD'});res.end();return;}
  const url=new URL(req.url,'http://127.0.0.1:43069');
  if(!['/','/month-pass'].includes(url.pathname)){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':MONTH_PASS_PREVIEW_CSP,'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
  res.end(req.method==='HEAD'?'':renderMonthPassPreview(url.searchParams.get('lang')??'zh'));
});
server.listen(43069,'127.0.0.1',()=>console.log('Month-pass preview: http://127.0.0.1:43069/month-pass?lang=zh (offline checkout only)'));
