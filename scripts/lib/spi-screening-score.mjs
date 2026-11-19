// Versioned, offline final-answer assessment. Never changes the legacy scorer or model input.
import assert from 'node:assert/strict';
import {composeObjectiveResult} from '../../server/src/objective-result.ts';

export const VERSION='spi-choice-content-v1';
export function normalizeContent(value) {
  // Keep decimal separators and internal punctuation: 4.4% must never become 44%.
  return String(value).normalize('NFKC').trim().replace(/[\s「」『』“”"'()（）\[\]【】]/gu,'')
    .replace(/(?:です|である)[。.]?$/u,'').replace(/[。.]$/u,'').toLowerCase();
}
export function validateRules(rules) {
  assert.equal(rules.version,VERSION);
  assert.equal(rules.status,'frozen_before_new_requests');
  assert.equal(rules.questions.length,16);
  assert.equal(new Set(rules.questions.map(q=>q.id)).size,16);
  for(const q of rules.questions){
    assert.ok(q.labels.includes(q.gold));
    const meanings=new Map();
    for(const [label,aliases] of Object.entries(q.content_by_label)){
      assert.ok(q.labels.includes(label));
      for(const alias of aliases){
        const n=normalizeContent(alias);assert.ok(n&&!q.labels.includes(n));
        assert.ok(!meanings.has(n)||meanings.get(n)===label,'Ambiguous alias across choices');meanings.set(n,label);
      }
    }
  }
  return true;
}

export function judgeChoice(value,rule) {
  let text=String(value).normalize('NFKC').trim().replace(/^\*\*(.*?)\*\*$/u,'$1');
  text=text.replace(/^(?:答え(?:は|:)?|解答(?:は|:)?|正解(?:は|:)?|選択肢|選択肢は|option\s*|answer\s*:?\s*)/iu,'').trim();
  text=text.replace(/(?:です|である)[。.]?$/u,'').trim();
  const labelMatch=/^(?:\(([A-E1-5])\)|([A-E1-5]))(?:番)?(?:\s*[.。、,:：)\-]\s*|\s+|(?=[(「])|$)(.*)$/iu.exec(text);
  let label=labelMatch?(labelMatch[1]??labelMatch[2]).toUpperCase():null;
  let content=labelMatch?labelMatch[3].trim():text;
  if(label&&!rule.labels.includes(label))return {correct:false,label,reason:'invalid_choice'};
  if(label&&!content)return {correct:label===rule.gold,label,reason:'single_choice_label'};
  const normalized=normalizeContent(content);
  const candidates=Object.entries(rule.content_by_label).filter(([,aliases])=>aliases.some(x=>normalizeContent(x)===normalized)).map(([l])=>l);
  if(candidates.length===1){
    if(label&&label!==candidates[0])return {correct:false,label,reason:'choice_content_conflict'};
    return {correct:candidates[0]===rule.gold,label:label??candidates[0],reason:label?'choice_and_matching_content':'unambiguous_content'};
  }
  // Exact aliases are checked first: "5/9" is one value, while "D or E" is not one choice.
  if(/(?:\bor\b|または|又は|もしくは|あるいは|かもしれ|不明|分から|わから|不確定)/iu.test(text)
    ||/^[A-E1-5]\s*[,\/、・&]\s*[A-E1-5](?:\s|$)/iu.test(text)){
    return {correct:false,label,reason:'multiple_or_uncertain_answers'};
  }
  // A recognized label never licenses ignoring an unverified or contradictory value/description.
  return {correct:null,label,reason:label?'content_not_in_frozen_dictionary':'unresolved_answer'};
}

export function assessAnswer(raw,item,finishReason,rules) {
  const rule=rules.questions.find(q=>q.id===item.id);assert.ok(rule,'No frozen scoring rule');
  assert.equal(rule.gold,item.expected.accepted_answers[0],'Scoring gold changed');
  const parsed=composeObjectiveResult(raw,true);
  const finalLines=[...raw.matchAll(/^\s*FINAL:\s*(.+)$/gmu)].map(x=>x[1].trim());
  const result=parsed.result;
  const protocolValid=finishReason==='stop'&&parsed.parserPath==='v1'&&!parsed.violations.length
    &&result?.kind==='single_choice'&&['ready','review'].includes(result?.state)&&!!result.answer;
  let content;
  if(finalLines.length>1)content={correct:false,label:null,reason:'multiple_final_lines'};
  else if(finalLines.length===1&&result?.answer&&normalizeContent(finalLines[0])!==normalizeContent(result.answer))
    content={correct:false,label:null,reason:'final_protocol_conflict'};
  else if(!finalLines.length&&!result?.answer)content={correct:false,label:null,reason:result?.state==='retake'?'retake':'missing_answer'};
  else content=judgeChoice(finalLines[0]??result.answer,rule);
  return {version:VERSION,answer:finalLines[0]??result?.answer??null,
    content_correct:content.correct,content_status:content.reason,selected_label:content.label,
    protocol_valid:Boolean(protocolValid),protocol_issues:parsed.violations,
    finish_reason:finishReason,state:result?.state??null,
    state_matches_frozen:result?.state===item.expected.state,
    fully_valid_correct:Boolean(protocolValid&&content.correct===true),
    needs_assistant_review:content.correct===null,assistant_review:null,human_signoff:false};
}
