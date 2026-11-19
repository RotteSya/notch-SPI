import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,realpathSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {ComparisonBudget,executeComparison} from './model-comparison.mts';
import {createControlledTransport,ENDPOINTS} from './model-comparison-transport.mts';

export const AUTHORIZATION_PATH='docs/experiments/model-comparison-20261117-authorization.json';
export const PAID_DIRECTORY='output/model-comparison-paid-20261117';
export const CONSUMED_PATH='output/model-comparison-20261117.permit-consumed.json';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export function materialScope(plan){return plan.cases.map(item=>({case_id:item.id,
  images:item.images.map(({sha256})=>sha256),models:plan.config.models.map(m=>m.id)}));}

export function validateAuthorization(record,plan,now=Date.now()){
  assert.equal(record.schema_version,1);assert.equal(record.status,'approved','This campaign is not authorized');
  assert.equal(plan.config.id,'model-comparison-20261117');assert.equal(plan.cases.length,28);
  assert.equal(record.experiment_id,plan.config.id);
  assert.equal(record.config_sha256,plan.sourceIdentity.config_sha256,'Approval does not bind this frozen configuration');
  assert.equal(record.cases_sha256,plan.sourceIdentity.cases_sha256);
  assert.equal(record.materials_sha256,plan.config.materials_manifest.sha256);
  assert.deepEqual(record.material_scope,materialScope(plan),'Only the exact 28 reviewed items may be sent');
  assert.deepEqual(record.models,plan.config.models.map(m=>({id:m.id,endpoint:ENDPOINTS[m.id]})));
  assert.equal(record.budget.currency,'USD');assert.equal(record.budget.hard_cap_micros,15_000_000);
  assert.equal(record.budget.rolling_settlement,true);assert.equal(record.maximum_attempts,168);
  assert.equal(record.purpose,'seen_regression_screening_only_no_production_acceptance');
  assert.equal(record.user_approval.budget,true);assert.equal(record.user_approval.exact_materials_and_recipients,true);
  assert.ok(typeof record.user_approval.message_reference==='string'&&record.user_approval.message_reference.trim().length>0);
  assert.equal(record.user_approval.empirical_bound_limitation_acknowledged,true);
  const issued=Date.parse(record.user_approval.approved_at),expires=Date.parse(record.expires_at);
  assert.ok(Number.isFinite(issued)&&Number.isFinite(expires)&&issued<=now&&now<expires&&expires-issued<=24*3600_000,'Approval must be current and at most 24 hours');
  assert.equal(record.preflight.prices_versions_parameters_reviewed,true);
  assert.equal(record.preflight.exact_inputs_and_billing_scope_reviewed,true);
  assert.equal(record.preflight.account_standard_no_region_no_tools,true);
  assert.equal(record.preflight.privacy_review_accepted,true);
  assert.ok(typeof record.preflight.evidence_reference==='string'&&record.preflight.evidence_reference.length>0);
  assert.equal(record.preflight.billing_catalog_sha256,sha(JSON.stringify(plan.config.models)));
  assert.equal(record.preflight.input_bound_kind,'empirical_not_vendor_guarantee');
  for(const model of plan.config.models)assert.deepEqual(record.expected_returned_models[model.id],[model.id]);
  return true;
}

function safeProjectPath(root,relative){
  const path=resolve(root,relative);let ancestor=existsSync(path)?path:dirname(path);
  while(!existsSync(ancestor))ancestor=dirname(ancestor);
  assert.equal(realpathSync(ancestor),ancestor,'Symlinked execution files are refused');return path;
}

/** Fixed, one-use campaign. A failed/interrupted run cannot be restarted by changing
 * run IDs or deleting its database. No reset, resume, cap override or ledger override CLI. */
export function claimExecution(root,authorizationSHA,configSHA){
  const marker=safeProjectPath(root,CONSUMED_PATH),directory=safeProjectPath(root,PAID_DIRECTORY);
  assert.ok(!existsSync(marker),'Execution permit already consumed; reconcile the existing campaign before any new authorization');
  assert.ok(!existsSync(directory),'Existing campaign artifacts must not be overwritten or reset');
  mkdirSync(dirname(marker),{recursive:true,mode:0o700});
  writeFileSync(marker,JSON.stringify({experiment_id:'model-comparison-20261117',authorizationSHA,configSHA,claimed_at:new Date().toISOString()},null,2)+'\n',{flag:'wx',mode:0o600});
  mkdirSync(directory,{mode:0o700});return directory;
}

export async function runAuthorized(plan,root,authorizationPath){
  assert.equal(authorizationPath,AUTHORIZATION_PATH,'Only this campaign authorization path is accepted');
  const path=safeProjectPath(root,authorizationPath),bytes=readFileSync(path),authorization=JSON.parse(bytes);
  validateAuthorization(authorization,plan);
  const digest=sha(bytes);
  const assertAuthorized=()=>{
    assert.equal(sha(readFileSync(path)),digest,'Authorization changed during execution');
    validateAuthorization(authorization,plan);
  };
  const directory=claimExecution(root,digest,plan.sourceIdentity.config_sha256);
  const budget=new ComparisonBudget(resolve(directory,'budget.sqlite3'),
    {campaignId:plan.config.id,limitMicros:15_000_000,rolling:true},plan.config.models);
  try{
    const transport=createControlledTransport({assertAuthorized,
      credentialFor:model=>process.env[model==='deepseek-flash'?'NSPI_EVAL_DEEPSEEK_KEY':'NSPI_EVAL_OPENAI_KEY'] ?? '',
      expectedModels:authorization.expected_returned_models});
    writeFileSync(resolve(directory,'plan.json'),JSON.stringify({source:plan.sourceIdentity,authorization_sha256:digest,
      material_scope:materialScope(plan),budget:plan.quote,timing_scope:'evaluator_not_native_UI'},null,2)+'\n',{flag:'wx',mode:0o600});
    const result=await executeComparison({cases:plan.cases,models:plan.config.models,promptFor:plan.promptFor,
      imagesFor:plan.imagesFor,budget,transport,limits:plan.config.limits,maxUnknownAttempts:3,
      onEvidence(kind,record){
        const id=kind==='attempt'?record.id:`${record.caseId}-${record.model}`;
        writeFileSync(resolve(directory,`${kind}-${id}.json`),JSON.stringify(record,null,2)+'\n',{flag:'wx',mode:0o600});
      }});
    writeFileSync(resolve(directory,'results.json'),JSON.stringify({...result,authorization_sha256:digest},null,2)+'\n',{flag:'wx',mode:0o600});
    return {mode:'authorized-live',output_directory:PAID_DIRECTORY,attempts:result.attempts.length,stopped:result.stopped,
      budget:budget.snapshot(),timing_scope:result.timingScope};
  } finally{budget.close();}
}
