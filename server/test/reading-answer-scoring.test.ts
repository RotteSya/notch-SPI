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
test('currency prefixes require explicit same-unit permission and preserve signs',()=>{
  const policy=parseReadingAnswerScoring({mode:'number',unit_aliases:['dollars','$','USD'],unit_prefix_aliases:['$','USD'],unit_optional:true},'short_fill',['180']);
  for(const answer of ['$180','USD 180','**$180.00**','＄１８０','＋＄180','180 dollars','180$'])assert.equal(readingAnswerHit(answer,['180'],policy),true,answer);
  for(const answer of ['-$180','$-180','USD −180','−USD 180','－$180'])assert.equal(readingAnswerHit(answer,['-180'],policy),true,answer);
  for(const answer of ['-$-180','+$+180','€180','180 cents','$180 dollars','USD $180','$10²','dollars 180'])assert.equal(readingAnswerHit(answer,['180'],policy),false,answer);
  const suffixOnly=parseReadingAnswerScoring({mode:'number',unit_aliases:['$'],unit_optional:true},'short_fill',['180']);
  assert.equal(readingAnswerHit('$180',['180'],suffixOnly),false);
  assert.throws(()=>parseReadingAnswerScoring({...policy,unit_prefix_aliases:['EUR']},'short_fill',['180']));
  assert.throws(()=>parseReadingAnswerScoring({...policy,unit_prefix_aliases:['$','$']},'short_fill',['180']));
});
test('quantity order accepts printed-kg omission and exact values without unit conversion',()=>{
  const gold=['0.009 kg;0.99 kg;1.025 kg;1.25 kg'];
  const policy=parseReadingAnswerScoring({mode:'quantity_sequence',items:Array.from({length:4},()=>({unit_aliases:['kg','kilograms'],unit_optional:true}))},'ordering',gold);
  for(const answer of ['0.009,0.99,1.025,1.25','0.009kg,0.990kg,1.025kg,1.250kg','9/1000 → 99/100 → 41/40 → 5/4','**0.009 kg\n0.99 kg\n1.025 kg\n1.25 kg**'])assert.equal(readingAnswerHit(answer,gold,policy),true,answer);
  for(const answer of ['0.99,0.009,1.025,1.25','9 g;990 g;1025 g;1250 g','0.009 g;0.99 kg;1.025 kg;1.25 kg','0.009;0.99;1.025','0.009;0.99;1.025;1.25;1.25','0.009kg,0.990kg,1.025kg,1.250kg because this is ascending'])assert.equal(readingAnswerHit(answer,gold,policy),false,answer);
});
test('duration ordering retains unit identity even when all numeric amounts coincide',()=>{
  const gold=['6 days;6 weeks;6 months;6 years'];
  const items=[['day','days'],['week','weeks'],['month','months'],['year','years']].map(unit_aliases=>({unit_aliases,unit_optional:false}));
  const policy=parseReadingAnswerScoring({mode:'quantity_sequence',items},'ordering',gold);
  for(const answer of ['6 days,6 weeks,6 months,6 years','6.0 days;12/2 weeks;6months;6years','6 days\n6 weeks\n6 months\n6 years'])assert.equal(readingAnswerHit(answer,gold,policy),true,answer);
  for(const answer of ['6,6,6,6','6 weeks;6 days;6 months;6 years','6 days;6 weeks;6 weeks;6 years','6 days;42 days;180 days;2190 days','6 days;6 weeks;6 months'])assert.equal(readingAnswerHit(answer,gold,policy),false,answer);
  for(const invalid of [{mode:'quantity_sequence',items:[]},{mode:'quantity_sequence',items:[items[0]]},{mode:'quantity_sequence',items:[{unit_aliases:[],unit_optional:false},items[0]]}])assert.throws(()=>parseReadingAnswerScoring(invalid,'ordering',gold));
  assert.throws(()=>parseReadingAnswerScoring({mode:'quantity_sequence',items},'single_choice',gold));
});
test('sequence line breaks are item boundaries while mixed fractions and thousands stay intact',()=>{
  const policy=parseReadingAnswerScoring({mode:'number_sequence'},'ordering',['1.5;1000;2000']);
  for(const answer of ['1 1/2\n1,000\n2,000','1.5,\r\n1000,\r\n2000','1.5;\n1000;\n2000','１½\u2028１，０００\u2028２，０００','［1.5；1000；2000］','（1.5；1000；2000）','1.5,\n1000\n2000'])assert.equal(readingAnswerHit(answer,['1.5;1000;2000'],policy),true,answer);
  assert.equal(readingAnswerHit('1\n1/2;1000;2000',['1.5;1000;2000'],policy),false);
  const quantities=parseReadingAnswerScoring({mode:'quantity_sequence',items:Array.from({length:3},()=>({unit_aliases:['kg'],unit_optional:true}))},'ordering',['1;200kg;2kg']);
  assert.equal(readingAnswerHit('1,200kg,2kg',['1;200kg;2kg'],quantities),false,'ambiguous thousands cannot become an extra item');
  const currency=parseReadingAnswerScoring({mode:'quantity_sequence',items:Array.from({length:4},()=>({unit_aliases:['$'],unit_prefix_aliases:['$'],unit_optional:true}))},'ordering',['1;200;2;300']);
  assert.equal(readingAnswerHit('$1,200,$2,300',['1;200;2;300'],currency),false);
  assert.equal(readingAnswerHit('$1, 200, $2, 300',['1;200;2;300'],currency),true);
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
