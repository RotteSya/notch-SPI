#!/usr/bin/env node
// Local-only supervisor. Stripe credentials stay outside the repository and app bundle.
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
const exec=promisify(execFile),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const state=path.join(os.homedir(),'Library/Application Support/NotchSPI-Plus-Sandbox/Server');
const config=path.join(state,'stripe.toml'),cli=path.join(state,'stripe'),pidfile=path.join(state,'server.pid');
const account='acct_1URPe9DRrnCxrM32',base='http://127.0.0.1:43081';
const appPath=path.join(root,'output/plus-native-sandbox/NotchSPI Plus Sandbox.app');
const cleanEnv={HOME:os.homedir(),PATH:process.env.PATH??'/usr/bin:/bin',TMPDIR:os.tmpdir(),LANG:'en_US.UTF-8'};
const args=['--config',config];
async function stripe(command,rest=[]){return exec(cli,[...args,command,...rest],{env:cleanEnv,timeout:20000,maxBuffer:2*1024*1024});}
async function scope(){const who=JSON.parse((await stripe('whoami',['--format','json'])).stdout);if(who.mode!=='test'||who.account_id!==account)throw Error('Stripe 当前不是 NotchSPI 3.0 QA 沙箱；停止操作，请切回此沙箱。');}
async function status(){try{const r=await fetch(base+'/_sandbox/status',{signal:AbortSignal.timeout(1500)});const d=await r.json();return d.fixture==='notchspi-plus-native'&&d.account===account?d:null;}catch{return null;}}
async function serve(){
 await scope();
 let listener,app;let stopping=false;
 async function stop(){if(stopping)return;stopping=true;listener?.kill('SIGTERM');await app?.close();await fs.rm(pidfile,{force:true});process.exit(0);}
 process.on('SIGTERM',stop);process.on('SIGINT',stop);
 listener=spawn(cli,[...args,'listen','--forward-to',base+'/webhooks/stripe','--events','checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.expired,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.paid,invoice.payment_failed,invoice.payment_action_required,invoice.voided'],{env:cleanEnv,stdio:['ignore','pipe','pipe']});
 listener.on('error',()=>{console.error('Stripe listener failed');void stop();});
 const secret=await new Promise((resolve,reject)=>{
  let buf='';const timer=setTimeout(()=>reject(Error('Stripe listener timeout')),45000);
  const consume=b=>{buf=(buf+b.toString()).slice(-10000);const match=buf.match(/whsec_[A-Za-z0-9]+/);if(match){clearTimeout(timer);resolve(match[0]);}};
  listener.stdout.on('data',consume);listener.stderr.on('data',consume);
  listener.once('exit',()=>{clearTimeout(timer);reject(Error('Stripe listener exited'));void stop();});
 });
 // OAuth CLI transport, not a mocked payment API. No --live, and account verified before every request.
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async(input,init={})=>{
  const u=new URL(String(input));if(u.hostname!=='api.stripe.com')return originalFetch(input,init);
  await scope();const method=(init.method??'GET').toLowerCase();
  if(!['get','post'].includes(method)||!/^\/v1\/(checkout\/sessions|subscriptions|billing_portal\/sessions|invoices|refunds|charges|disputes)(\/|$)/.test(u.pathname))throw Error('Sandbox transport path rejected');
  const params=[u.pathname,'--stripe-version','2026-08-26.dahlia'];if(method==='post')params.push('--confirm');
  for(const [k,v] of u.searchParams)params.push('-d',k+'='+v);
  if(init.body)for(const [k,v]of new URLSearchParams(String(init.body)))params.push('-d',k+'='+v);
  const h=new Headers(init.headers);if(h.has('Idempotency-Key'))params.push('--idempotency',h.get('Idempotency-Key'));
  const {stdout}=await stripe(method,params);const data=JSON.parse(stdout);
  if(data.livemode===true)throw Error('Live response rejected');
  return new Response(JSON.stringify(data),{status:data.error?400:200,headers:{'content-type':'application/json'}});
 };
 Object.assign(process.env,{DB_PATH:path.join(state,'native-qa.sqlite'),OFFICIAL_PROVIDER:'mock',OBJECTIVE_RESULT_V1_PROVIDER:'mock',PAYMENT_PROVIDER:'stripe',STRIPE_SECRET_KEY:'sk_test_cli_transport',STRIPE_WEBHOOK_SECRET:secret,PLUS_ENABLED:'1',FREE_TRIAL_ENABLED:'1',PUBLIC_BASE_URL:base,LOG_LEVEL:'silent'});
 const {buildApp}=await import(path.join(root,'server/src/index.ts'));app=await buildApp();
 // Fixture-only return URL. Never register or take over the production notchspi scheme.
 app.addHook('onSend',async(req,reply,payload)=>typeof payload==='string'&&String(reply.getHeader('content-type')).includes('text/html')?payload.replaceAll('notchspi://','notchspi-sandbox://'):payload);
 app.get('/_sandbox/status',async()=>({fixture:'notchspi-plus-native',account,pid:process.pid,payment:'Stripe sandbox',answers:'local mock',persistent:true}));
 await app.listen({host:'127.0.0.1',port:43081});await fs.writeFile(pidfile,String(process.pid),{mode:0o600});
 console.log('READY: local mock answers + NotchSPI 3.0 QA Stripe sandbox');
}
async function main(){
 const mode=process.argv[2];
 if(mode==='serve'){await serve();return;}
 if(mode==='status'){console.log(await status()??'沙箱未运行。请双击「启动沙箱.command」。');return;}
 if(mode==='stop'){const s=await status();if(s){const pid=Number(await fs.readFile(pidfile,'utf8'));if(pid!==s.pid)throw Error('PID mismatch');process.kill(pid,'SIGTERM');console.log('已停止本地后端与 Stripe 监听；测试账户和记录保留。请从 App 菜单退出沙箱 App。');}else console.log('沙箱未运行。');return;}
 if(mode!=='start')throw Error('Usage: control.mjs start [--no-open] | status | stop');
 await fs.mkdir(state,{recursive:true,mode:0o700});await fs.chmod(state,0o700);await scope();
 let s=await status();if(!s){
  const log=await fs.open(path.join(state,'server.log'),'a',0o600);
  const child=spawn(process.execPath,[fileURLToPath(import.meta.url),'serve'],{cwd:root,env:cleanEnv,detached:true,stdio:['ignore',log.fd,log.fd]});child.unref();await log.close();
  for(let i=0;i<55&&!s;i++){await new Promise(r=>setTimeout(r,1000));s=await status();}
  if(!s)throw Error('沙箱启动失败，请查看私有目录的 server.log（不要分享凭据文件）。');
 }
 console.log('沙箱已就绪。测试卡：4242 4242 4242 4242，任意未来日期及三位 CVC。');
 if(!process.argv.includes('--no-open')){
  let pids=[];try{pids=(await exec('/usr/bin/pgrep',['-x','NotchSPI'])).stdout.trim().split(/\s+/);}catch{}
  for(const pid of pids){const cmd=(await exec('/bin/ps',['-p',pid,'-o','command='])).stdout;if(!cmd.includes(appPath)){console.log('请先从菜单退出正在运行的正式版/其他 QA App，再双击启动沙箱，避免快捷键冲突。');return;}}
  await exec('/usr/bin/open',[appPath]);
 }
}
main().catch(e=>{console.error(e.message?.startsWith('Command failed')?'Stripe 沙箱命令失败；请检查授权和网络。':e.message);process.exit(1);});
