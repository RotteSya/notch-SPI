import test from 'node:test';
import assert from 'node:assert/strict';
import {failureKind} from '../core/failure-kind.mjs';
import {guidePresentation} from '../ui/onboarding.mjs';
test('transport, HTTP and unknown failures stay distinct without guessing missing content',()=>{
 for(const [e,kind] of [[new TypeError('fetch failed'),'network'],[{name:'TimeoutError'},'network'],[{status:503},'service'],[{status:401},'account'],[{status:429},'rate_limit'],[{status:429,code:'device_busy'},'busy'],[{status:503,code:'service_maintenance'},'maintenance'],[{status:402,code:'insufficient_quota'},'quota'],[{status:409,code:'capture_already_finalized'},'conflict'],[new Error('unknown'),'service']])assert.equal(failureKind(e),kind);
});
test('guide failure uses result state and error category instead of a generic retake prompt',()=>{
 for(const [status,failureKind,expected] of [['error','network','网络连接失败'],['error','service','查题服务'],['error','account','账户或额度'],['error','quota','当前可用额度不足'],['error','maintenance','维护'],['error','busy','还有请求'],['error','conflict','状态冲突'],['error','rate_limit','过于频繁'],['retake',null,'必要内容'],['empty',null,'未得到可用答案']]) {
 const s={guide:{step:'working',failed:true,live:true},settings:{language:'zh'},images:[],status,failureKind};
 const html=guidePresentation(s,()=>'' ).footer;
 assert.ok(html.includes(expected));assert.ok(!html.includes('请让题目和选项完整显示'));
 }
});

test('quota failure provides an account entry during the live guide',async()=>{
 const fs=await import('node:fs/promises');const source=await fs.readFile(new URL('../ui/app.mjs',import.meta.url),'utf8');
 assert.match(source,/state.failureKind === "quota"[\s\S]*?data-value="account"/);
});
