import {previewPlus,grantCommand} from './admin-plus.ts';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import type {AppContext} from './routes.ts';
import {ApiError} from './http.ts';
import {adminFilter,type AdminDevice} from './admin-store.ts';
import {plusEntitlement,PLUS} from './plus.ts';

export function publicDevice(d:AdminDevice){
  const entitlement=plusEntitlement(d.paid,d.manual);
  return {id:d.id,platform:d.platform,app_version:d.appVersion,created_at:d.createdAt,balance_updated_at:d.updatedAt,
    total_questions:d.totalQuestions,stored_balance_questions:d.balanceQuestions,onboarded:d.onboarded,hotkey_presses:d.hotkeyPresses,cli_enabled:d.cliEnabled,
    plus:{active:entitlement.active,expires_at:entitlement.expiresAt,daily_limit:PLUS.dailyLimit,paid_until:d.paid?.paidUntil??null,
      billing_status:d.paid?.status??'none',auto_renews:!!d.paid?.subscriptionId&&!d.paid.cancelAtPeriodEnd,
      manual_from:d.manual?.startsAt??null,manual_until:d.manual?.expiresAt??null}};
}
export function registerAdminRoutes(app:FastifyInstance,ctx:AppContext,requireAdmin:(req:FastifyRequest)=>void){
  // No request body, credential, SQL error or free-text reason reaches the normal log.
  app.register(async scope=>{
    scope.addHook('onRequest',async(req,reply)=>{reply.header('Cache-Control','no-store');requireAdmin(req);});
    scope.setErrorHandler((error,req,reply)=>{
      if(error instanceof ApiError)return reply.code(error.statusCode).send({error:{code:error.code,message:error.message}});
      const code=(error as {statusCode?:number}).statusCode;
      if(code===400||code===413)return reply.code(code).send({error:{code:'bad_request',message:'请求格式或大小无效'}});
      req.log.error('admin operation failed');return reply.code(500).send({error:{code:'internal',message:'保存或读取失败，请保留当前操作并重试'}});
    });
    scope.post('/admin/ops/lookup',{bodyLimit:2048},async(req)=>{
      const body=req.body as Record<string,unknown>|null,code=typeof body?.recovery_code==='string'?body.recovery_code.trim():'';
      if(!/^dev_[A-Za-z0-9_-]{16,128}$/.test(code))throw new ApiError(400,'恢复码格式无效，请复制完整设备账户恢复码');
      if(!await ctx.store.billing.rateLimit('admin_recovery_lookup',60,60000))throw new ApiError(429,'查询过于频繁，请稍后重试');
      const device=await ctx.store.admin.lookup(code);if(!device)throw new ApiError(404,'未找到该恢复码对应的设备账户');
      return {manual_grants_enabled:ctx.config.adminPlusGrantsEnabled,device:publicDevice(device),credential_hint:'dev_••••'+code.slice(-4)};
    });
    scope.post('/admin/ops/plus/preview',{bodyLimit:4096},async req=>{
      if(!ctx.config.adminPlusGrantsEnabled)throw new ApiError(503,'人工 PLUS 尚未启用，请核对上线配置','feature_disabled');
      const body=req.body as Record<string,unknown>|null,id=body?.device_id;
      if(typeof id!=='number'||!Number.isSafeInteger(id)||id<1)throw new ApiError(400,'设备账户编号无效');
      const d=await ctx.store.admin.device(id);if(!d)throw new ApiError(404,'设备账户不存在');
      return previewPlus(d,body!,ctx.config.adminToken);
    });
    scope.post('/admin/ops/plus/grant',{bodyLimit:8192},async req=>{
      if(!ctx.config.adminPlusGrantsEnabled)throw new ApiError(503,'人工 PLUS 规则尚未启用','feature_disabled');
      const body=req.body;if(!body||typeof body!=='object'||Array.isArray(body))throw new ApiError(400,'请求格式无效');
      const command=grantCommand(body as Record<string,unknown>,ctx.config.adminToken);
      const action=await ctx.store.admin.applyGrant(command),device=await ctx.store.admin.device(command.deviceId);
      if(!device)throw new ApiError(404,'设备账户不存在');
      return {operation_id:action.id,device:publicDevice(device)};
    });
    scope.get('/admin/ops/overview',async req=>{
      const q=adminFilter(req.query as Record<string,unknown>);
      return {definition:'operations-v1',timezone:'Asia/Shanghai',from:q.from,to:q.to,generated_at:new Date().toISOString(),storage:ctx.storeKind,
        sources:['devices','plus_subscriptions','admin_plus_entitlements','capture_requests','model_attempts'],...await ctx.store.admin.overview(q)};
    });
    scope.get('/admin/ops/devices',async req=>{const q=adminFilter(req.query as Record<string,unknown>),page=await ctx.store.admin.devices(q);return {...page,items:page.items.map(publicDevice)};});
    scope.get('/admin/ops/devices/:id',async req=>{
      const id=Number((req.params as {id:string}).id);if(!Number.isSafeInteger(id)||id<1)throw new ApiError(400,'设备编号无效');
      const d=await ctx.store.admin.device(id);if(!d)throw new ApiError(404,'设备账户不存在');return {device:publicDevice(d)};
    });
    scope.get('/admin/ops/requests',async req=>ctx.store.admin.requests(adminFilter(req.query as Record<string,unknown>)));
    scope.get('/admin/ops/actions',async req=>ctx.store.admin.actions(adminFilter(req.query as Record<string,unknown>)));
  });
}
