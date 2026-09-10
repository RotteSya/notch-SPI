import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseReadingAnswerScoring,readingAnswerHit} from '../../scripts/lib/reading-answer-scoring.mts';
import {objectiveEvalAnswerHit} from '../src/objective-eval-scoring.ts';

test('multi-select accepts only the complete unique selected set, independently of order',()=>{
  const gold=['A, C'],policy=parseReadingAnswerScoring({mode:'label_set',labels:['A','B','C','D']},'multiple_choice',gold);
  for(const answer of ['C,A','a、c','**C and A**','[A; C]','CA','A C','Ａ，Ｃ'])assert.equal(readingAnswerHit(answer,gold,policy),true,answer);
  for(const answer of ['A','A,B,C','A,A,C','A or C','A/C','A,,C','A,','A C because both apply','A,E','[A,C','["A","C"]',''])assert.equal(readingAnswerHit(answer,gold,policy),false,answer);
  assert.equal(objectiveEvalAnswerHit('C,A',gold),false,'immutable baseline retains its original exact comparison');
  assert.equal(readingAnswerHit('A, B, and C',['A,B,C'],policy),true);
  const wide=parseReadingAnswerScoring({mode:'label_set',labels:['A','C','O','R']},'multiple_choice',['A,C,O,R']);
  assert.equal(readingAnswerHit('A or C',['A,C,O,R'],wide),false);
});
test('label ordering preserves the complete sequence including prefilled positions',()=>{
  const gold=['E,B,C,D,A'],policy=parseReadingAnswerScoring({mode:'label_sequence',prefilled:[],labels:['A','B','C','D','E']},'ordering',gold);
  for(const answer of ['E → B → C → D → A','e b c d a','EBCDA'])assert.equal(readingAnswerHit(answer,gold,policy),true,answer);
  for(const answer of ['E,C,D,A','A,B,C,D,E','E,B,C,D,A,A','E and B and C and D and A','E > B > C > D > A'])assert.equal(readingAnswerHit(answer,gold,policy),false,answer);
});
test('exact rational arithmetic handles decimal, fractional, grouped and mixed values without rounding',()=>{
  const policy=parseReadingAnswerScoring({mode:'number',unit_aliases:[],unit_optional:true},'short_fill',['1.5']);
  for(const answer of ['3/2','1 1/2','1½','１½','+1.500'])assert.equal(readingAnswerHit(answer,['1.5'],policy),true,answer);
  for(const answer of ['1.500000000000000000000001','15/0','1 2/2','1,50','1.5 or 2','1.5 apples','1.5e0'])assert.equal(readingAnswerHit(answer,['1.5'],policy),false,answer);
  assert.equal(readingAnswerHit('−3/2',['-1.5'],policy),true);
  assert.equal(readingAnswerHit('1,800',['1800'],policy),true);
  assert.equal(readingAnswerHit('0',['-0.0'],policy),true);
  assert.equal(readingAnswerHit('0.3333333333333333',['1/3'],policy),false);
  assert.equal(readingAnswerHit('9'.repeat(129),['1'],policy),false);
  for(const [actual,gold] of [['10²','102'],['1/2²','1/22'],['10₂','102'],['¹⁰²','102']])assert.equal(readingAnswerHit(actual,[gold!],policy),false,actual);
});
test('frozen prefilled positions accept complete order or every remaining blank, without hiding omissions',()=>{
  const gold=['C,A,D,B'],policy=parseReadingAnswerScoring({mode:'label_sequence',labels:['A','B','C','D'],prefilled:[{position:0,label:'C'}]},'ordering',gold);
  for(const answer of ['C,A,D,B','A,D,B','A → D → B'])assert.equal(readingAnswerHit(answer,gold,policy),true,answer);
  for(const answer of ['C,A,B,D','A,D','C,D,B','A,B,D','A,C,D,B'])assert.equal(readingAnswerHit(answer,gold,policy),false,answer);
  const second=parseReadingAnswerScoring({mode:'label_sequence',labels:['A','B','C','D','E'],prefilled:[{position:1,label:'B'}]},'ordering',['E,C,D,A']);
  assert.equal(readingAnswerHit('E,B,C,D,A',['E,C,D,A'],second),true);
  assert.equal(readingAnswerHit('E,C,D,A',['E,B,C,D,A'],second),true);
  for(const prefilled of [[{position:4,label:'C'}],[{position:0,label:'C'},{position:0,label:'B'}],[{position:0,label:'C'},{position:1,label:'C'}],[{position:0,label:'Z'}]])
    assert.throws(()=>parseReadingAnswerScoring({mode:'label_sequence',labels:['A','B','C','D'],prefilled},'ordering',gold));
  assert.throws(()=>parseReadingAnswerScoring({mode:'label_sequence',labels:['A','B','C','D'],prefilled:[{position:0,label:'C'}]},'ordering',['A,C,D,B']));
});
test('units require explicit equivalent spelling and never imply magnitude conversion',()=>{
  const gold=['2 hours'];
  const policy=parseReadingAnswerScoring({mode:'number',unit_aliases:['hour','hours','h'],unit_optional:false},'short_fill',gold);
  for(const answer of ['2 h','2hours','2.0 hour','4/2 hours','**2 hours**','`2 h`','__2 hours__'])assert.equal(readingAnswerHit(answer,gold,policy),true,answer);
  for(const answer of ['2','120 minutes','2 dollars','2 H','2e0 h'])assert.equal(readingAnswerHit(answer,gold,policy),false,answer);
  const optional=parseReadingAnswerScoring({...policy,unit_optional:true},'short_fill',gold);
  assert.equal(readingAnswerHit('2',gold,optional),true);
  const metres=parseReadingAnswerScoring({mode:'number',unit_aliases:['m'],unit_optional:false},'short_fill',['2 m']);
  assert.equal(readingAnswerHit('200 cm',['2 m'],metres),false);
  assert.equal(readingAnswerHit('2m',['2 m'],metres),true);
  const area=parseReadingAnswerScoring({mode:'number',unit_aliases:['m2'],unit_optional:false},'short_fill',['2 m²']);
  assert.equal(readingAnswerHit('2 m²',['2 m2'],area),true);
  assert.equal(readingAnswerHit('10² m²',['102 m2'],area),false);
});
test('numeric sequences compare exact values position by position without erasing repeated values',()=>{
  const gold=['0.25, 0.5, 1.5, 2, 2'],policy=parseReadingAnswerScoring({mode:'number_sequence'},'ordering',gold);
  for(const answer of ['1/4 → 1/2 → 1½ → 2.0 → 4/2','[.25; .5; 3/2; 2; 2]'])assert.equal(readingAnswerHit(answer,gold,policy),true,answer);
  for(const answer of ['0.5,0.25,1.5,2,2','0.25,0.5,1.5,2','0.25,0.5,1.5,2,2,','0.25 < 0.5 < 1.5 < 2 < 2','0.25 0.5 1.5 2 2'])assert.equal(readingAnswerHit(answer,gold,policy),false,answer);
  for(const answer of ['1,005; 1,050; 1,500; 1,505','1,005, 1,050, 1,500, 1,505','1005,1050,1500,1505'])
    assert.equal(readingAnswerHit(answer,['1005;1050;1500;1505'],policy),true,answer);
  assert.equal(readingAnswerHit('1,005,2,010',['1;5;2;10'],policy),false);
  assert.equal(readingAnswerHit('1,200',['1;200'],policy),false);
  assert.equal(readingAnswerHit('1,234,2,567',['1;234;2;567'],policy),false);
  assert.equal(readingAnswerHit('1, 200',['1;200'],policy),true);
  assert.equal(readingAnswerHit('10²; 2',['102;2'],policy),false);
});
test('explicit literal policy does not inherit legacy unordered alternatives semantics',()=>{
  const policy=parseReadingAnswerScoring({mode:'literal'},'short_fill',['A or B']);
  assert.equal(readingAnswerHit('**A or B**',['A or B'],policy),true);
  assert.equal(readingAnswerHit('B or A',['A or B'],policy),false);
  assert.equal(objectiveEvalAnswerHit('B or A',['A or B']),true);
});
test('invalid policies, incomplete gold and incompatible question kinds fail before dispatch',()=>{
  const bad:Array<[unknown,string,string[]]>=[
    [{mode:'literal',tolerance:1},'short_fill',['1']],
    [{mode:'number',unit_aliases:[],unit_optional:false},'short_fill',['1']],
    [{mode:'number',unit_aliases:[' m'],unit_optional:true},'short_fill',['1']],
    [{mode:'number',unit_aliases:['m','m'],unit_optional:true},'short_fill',['1']],
    [{mode:'number',unit_aliases:['1m'],unit_optional:true},'short_fill',['1']],
    [{mode:'number',unit_aliases:[],unit_optional:true},'short_fill',['1/0']],
    [{mode:'number',unit_aliases:[],unit_optional:true},'short_fill',['not a number']],
    [{mode:'number',unit_aliases:[],unit_optional:true},'single_choice',['1']],
    [{mode:'number_sequence'},'ordering',['1']],
    [{mode:'label_set',labels:['A','A']},'multiple_choice',['A']],
    [{mode:'label_set',labels:['a']},'multiple_choice',['A']],
    [{mode:'label_set',labels:['A','B']},'single_choice',['A,B']],
    [{mode:'label_sequence',prefilled:[],labels:['A','B']},'ordering',['A,A']],
    [{mode:'label_sequence',prefilled:[],labels:['A','B','C']},'ordering',['A,B']],
    [{mode:'label_set',labels:['A','B']},'ordering',['A,B']],
    [{mode:'literal'},'short_fill',[]],
  ];
  for(const [policy,kind,gold] of bad)assert.throws(()=>parseReadingAnswerScoring(policy,kind,gold),/scoring/);
});
