import {normalizeObjectiveAnswer} from '../../server/src/objective-result.ts';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

export const READING_ANSWER_SCORING_VERSION='reading-answer-v1';
/** Bind semantics and the production parsing dependencies used to derive scored answers. */
export function readingAnswerScoringDigest():string {
  const files=['./reading-answer-scoring.mts','./reading-evaluation.mts',
    '../../server/src/objective-result.ts','../../server/src/screen-query.ts'];
  const hashes=files.map(file=>({file,sha256:createHash('sha256').update(readFileSync(new URL(file,import.meta.url))).digest('hex')}));
  return createHash('sha256').update(JSON.stringify({version:READING_ANSWER_SCORING_VERSION,files:hashes})).digest('hex');
}

/** Frozen per-case semantics for manifest v2. Never applied to legacy baseline results. */
export type ReadingAnswerScoring =
  | {mode:'literal'}
  | {mode:'label_set';labels:string[]}
  | {mode:'label_sequence';labels:string[];prefilled:Array<{position:number;label:string}>}
  | {mode:'number';unit_aliases:string[];unit_optional:boolean}
  | {mode:'number_sequence'};

function fail():never {throw new Error('Invalid reading answer scoring policy or gold');}
function keys(value:Record<string,unknown>,expected:string[]):void {
  if(Object.keys(value).sort().join(',')!==expected.sort().join(','))fail();
}
function text(value:string):string {
  // Preserve the boundary in 1½ before NFKC expands the fraction to 1⁄2.
  return normalizeObjectiveAnswer(value.replace(/(\p{Nd})([\u00BC-\u00BE\u2150-\u215E])/gu,'$1 $2')).replaceAll('−','-');
}
function rawText(value:string):string {
  let result=value.trim().replace(/\s+/gu,' '),changed=true;
  while(changed) {
    changed=false;
    for(const fence of ['**','__','`'])if(result.startsWith(fence)&&result.endsWith(fence)&&result.length>2*fence.length) {
      result=result.slice(fence.length,-fence.length).trim();changed=true;
    }
  }
  return result;
}
function unbracket(value:string):string {
  if(value.startsWith('[')&&value.endsWith(']')||value.startsWith('(')&&value.endsWith(')'))return value.slice(1,-1).trim();
  return value;
}
function labels(value:string,policy:Extract<ReadingAnswerScoring,{labels:string[]}>):string|null {
  const source=unbracket(text(value)).toUpperCase();
  if(/\bOR\b/u.test(source))return null;
  // Conjunctions express a set only. "or" is never equivalent to selecting both options.
  const prepared=policy.mode==='label_set'?source.replace(/,\s*AND\b/gu,',').replace(/\bAND\b|[&和及と]/gu,','):source.replace(/→|->/gu,',');
  if(!/^[A-Z]+(?:(?:\s+|\s*[,;、]\s*)[A-Z]+)*$/u.test(prepared))return null;
  let items=prepared.replace(/[\s,;、]+/gu,'').split('');
  if(!items.length||items.length>26||new Set(items).size!==items.length||items.some(v=>!policy.labels.includes(v)))return null;
  if(policy.mode==='label_sequence') {
    if(items.length===policy.labels.length-policy.prefilled.length&&policy.prefilled.length) {
      if(items.some(v=>policy.prefilled.some(p=>p.label===v)))return null;
      const blanks=[...items];
      items=policy.labels.map((_,position)=>policy.prefilled.find(p=>p.position===position)?.label??blanks.shift()!);
    }
    if(items.length!==policy.labels.length||policy.prefilled.some(p=>items[p.position]!==p.label))return null;
  }
  return (policy.mode==='label_set'?items.sort():items).join(',');
}
interface Rational {n:bigint;d:bigint}
function gcd(a:bigint,b:bigint):bigint {
  a=a<0n?-a:a;while(b){const r=a%b;a=b;b=r;}return a;
}
function rational(n:bigint,d:bigint):Rational|null {
  if(d<=0n)return null;const divisor=gcd(n,d);return {n:n/divisor,d:d/divisor};
}
function number(value:string,thousands=true):Rational|null {
  // NFKC would concatenate an exponent/subscript into the base (10² -> 102).
  // Numeric expressions are outside this grammar; units are parsed separately below.
  if(/[\u00B2\u00B3\u00B9\u2070-\u209F]/u.test(value))return null;
  let source=text(value).replaceAll('⁄','/');
  if(source.length>128)return null;
  if(source.includes(',')) {
    if(!thousands||!/^[-+]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/u.test(source))return null;
    source=source.replaceAll(',','');
  }
  const mixed=/^([-+]?)(\d+) (\d+)\/(\d+)$/u.exec(source);
  if(mixed) {
    const whole=BigInt(mixed[2]!),part=BigInt(mixed[3]!),denominator=BigInt(mixed[4]!);
    if(part>=denominator)return null;
    return rational((mixed[1]==='-'?-1n:1n)*(whole*denominator+part),denominator);
  }
  const fraction=/^([-+]?\d+)\s*\/\s*(\d+)$/u.exec(source);
  if(fraction)return rational(BigInt(fraction[1]!),BigInt(fraction[2]!));
  const decimal=/^([-+]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))$/u.exec(source);
  if(!decimal)return null;
  const digits=decimal[3]??decimal[4]??'';
  return rational((decimal[1]==='-'?-1n:1n)*BigInt((decimal[2]??'0')+digits),10n**BigInt(digits.length));
}
function numeric(value:string,policy:Extract<ReadingAnswerScoring,{mode:'number'}>):string|null {
  const source=rawText(value);
  let parsed=policy.unit_optional?number(source):null;
  if(!parsed&&policy.unit_aliases.length)for(let boundary=1;boundary<source.length;boundary++) {
    const unit=source.slice(boundary).normalize('NFKC').trim().replace(/\s+/gu,' ');
    if(!policy.unit_aliases.includes(unit))continue;
    parsed=number(source.slice(0,boundary).trim());if(parsed)break;
  }
  return parsed?`${parsed.n}/${parsed.d}`:null;
}
function canonical(value:string,policy:ReadingAnswerScoring):string|null {
  if(!value.trim()||[...value].length>512)return null;
  switch(policy.mode) {
    case 'literal':return normalizeObjectiveAnswer(value);
    case 'label_set':case 'label_sequence':return labels(value,policy);
    case 'number':return numeric(value,policy);
    case 'number_sequence':{
      if(/[\u00B2\u00B3\u00B9\u2070-\u209F]/u.test(value))return null;
      // A semicolon, arrow or comma-space preserves grouped thousands within an item.
      // Bare commas are item separators; whitespace alone belongs to mixed numbers.
      const source=unbracket(text(value)),explicit=/;|、|→|->/u.test(source),spacedComma=/,\s+/u.test(source);
      const parts=source.split(explicit?/\s*(?:;|、|→|->)\s*/u:spacedComma?/,\s+/u:/,/u).map(v=>v.trim());
      if(parts.length<2||parts.length>32||parts.some(v=>!v))return null;
      // Any adjacent bare integer pieces that could form a thousands group need an
      // explicit boundary. This includes 1,200 as well as 1,005,2,010.
      if(!explicit&&!spacedComma&&parts.some((v,index)=>/^[-+]?0\d/u.test(v)||
        index>0&&/^[-+]?\d{1,3}$/u.test(parts[index-1]!)&&/^\d{3}(?:\.\d+)?$/u.test(v)))return null;
      const values=parts.map(v=>number(v,explicit||spacedComma));
      return values.some(v=>!v)?null:values.map(v=>`${v!.n}/${v!.d}`).join(';');
    }
  }
}
export function parseReadingAnswerScoring(value:unknown,kind:string,gold:string[]):ReadingAnswerScoring {
  if(!value||typeof value!=='object'||Array.isArray(value))return fail();
  const p=value as Record<string,unknown>;let policy:ReadingAnswerScoring;
  switch(p.mode) {
    case 'literal':keys(p,['mode']);policy={mode:'literal'};break;
    case 'label_set':case 'label_sequence':{
      keys(p,p.mode==='label_sequence'?['mode','labels','prefilled']:['mode','labels']);
      if(p.mode==='label_set'&&!['single_choice','multiple_choice'].includes(kind)||p.mode==='label_sequence'&&kind!=='ordering'||
        !Array.isArray(p.labels)||!p.labels.length||p.labels.length>26||p.labels.some(v=>typeof v!=='string'||!/^[A-Z]$/u.test(v))||new Set(p.labels).size!==p.labels.length)return fail();
      if(p.mode==='label_sequence') {
        if(!Array.isArray(p.prefilled)||p.prefilled.length>=p.labels.length)return fail();
        const prefilled=p.prefilled.map(value=>{
          if(!value||typeof value!=='object'||Array.isArray(value))return fail();
          const slot=value as Record<string,unknown>;keys(slot,['position','label']);
          if(typeof slot.position!=='number'||!Number.isSafeInteger(slot.position)||slot.position<0||slot.position>=(p.labels as string[]).length||
            typeof slot.label!=='string'||!(p.labels as string[]).includes(slot.label))return fail();
          return {position:slot.position,label:slot.label};
        });
        if(new Set(prefilled.map(s=>s.position)).size!==prefilled.length||new Set(prefilled.map(s=>s.label)).size!==prefilled.length)return fail();
        policy={mode:'label_sequence',labels:[...p.labels] as string[],prefilled};
      } else policy={mode:'label_set',labels:[...p.labels] as string[]};
      break;
    }
    case 'number':{
      keys(p,['mode','unit_aliases','unit_optional']);
      if(kind!=='short_fill'||typeof p.unit_optional!=='boolean'||!Array.isArray(p.unit_aliases)||p.unit_aliases.length>16||
        p.unit_aliases.some(v=>typeof v!=='string'||!v||v.length>64||v.normalize('NFKC').trim().replace(/\s+/gu,' ')!==v||/^[\d\s.,+\-/]/u.test(v))||
        new Set(p.unit_aliases).size!==p.unit_aliases.length||!p.unit_optional&&!p.unit_aliases.length)return fail();
      policy={mode:'number',unit_aliases:[...p.unit_aliases] as string[],unit_optional:p.unit_optional};break;
    }
    case 'number_sequence':keys(p,['mode']);if(!['ordering','short_fill'].includes(kind))return fail();policy={mode:'number_sequence'};break;
    default:return fail();
  }
  if(!gold.length||gold.some(answer=>canonical(answer,policy)===null))return fail();
  if(kind==='single_choice'&&policy.mode==='label_set'&&gold.some(answer=>canonical(answer,policy)!.includes(',')))return fail();
  if(policy.mode==='label_sequence'&&gold.some(answer=>canonical(answer,policy)!.split(',').length!==policy.labels.length))return fail();
  return policy;
}
export function readingAnswerHit(actual:string|null|undefined,gold:string[],policy:ReadingAnswerScoring):boolean {
  const result=canonical(actual??'',policy);
  return result!==null&&gold.some(answer=>canonical(answer,policy)===result);
}
