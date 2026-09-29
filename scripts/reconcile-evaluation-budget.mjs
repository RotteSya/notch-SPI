#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {readFileSync} from 'node:fs';
import {settleEvaluationBudget} from './lib/evaluation-settlement.mts';

const {values}=parseArgs({options:{ledger:{type:'string'},policy:{type:'string'},batch:{type:'string'},'batch-sha':{type:'string'},
  review:{type:'string'},'review-sha':{type:'string'},apply:{type:'boolean',default:false}},strict:true});
for(const name of ['ledger','policy','batch','batch-sha','review','review-sha'])if(!values[name])throw new Error(`Missing --${name}`);
const result=settleEvaluationBudget({ledger:values.ledger,policy:JSON.parse(readFileSync(values.policy,'utf8')),
  batchFile:values.batch,batchSHA:values['batch-sha'],reviewFile:values.review,reviewSHA:values['review-sha'],apply:values.apply});
console.log(JSON.stringify(result,null,2));
