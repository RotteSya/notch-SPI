import {test} from 'node:test';
import assert from 'node:assert/strict';
import {summarizeFailure} from '../src/failure-summary.ts';

test('pool connect timeout is labelled without copying the message', () => {
  const wrapped = new Error('Connection terminated due to connection timeout', {cause: new Error('Connection terminated')});
  const summary = summarizeFailure(wrapped);
  assert.equal(summary.kind, 'db_connect_timeout');
  assert.equal(summary.name, 'Error');
  assert.ok(summary.frames.length > 0 && summary.frames.every(frame => frame.startsWith('at ')));
  assert.equal(JSON.stringify(summary).includes('Connection terminated'), false);
});

test('codes come from wrapped causes and SQLSTATE timeouts are labelled', () => {
  const statement = Object.assign(new Error('canceling statement due to statement timeout'), {code: '57014'});
  assert.deepEqual({...summarizeFailure(new Error('outer', {cause: statement})), frames: []},
    {kind: 'db_statement_timeout', name: 'Error', code: '57014', frames: []});
  const reset = Object.assign(new Error('read ECONNRESET'), {code: 'ECONNRESET'});
  assert.equal(summarizeFailure(reset).code, 'ECONNRESET');
  assert.equal(summarizeFailure(reset).kind, 'unclassified');
});

test('messages, odd codes and names never reach the summary', () => {
  const secret = 'postgres://user:hunter2@db.example/neondb';
  const error = Object.assign(new Error(`${secret}\n    at fake (${secret})`), {code: `x ${secret}`});
  const summary = summarizeFailure(error);
  assert.equal(summary.code, undefined);
  assert.equal(JSON.stringify(summary).includes('hunter2'), false);
  const named = new Error('private'); named.name = 'bad name: private';
  assert.equal(summarizeFailure(named).name, 'unknown');
  assert.equal(JSON.stringify(summarizeFailure(named)).includes('private'), false);
  assert.deepEqual(summarizeFailure('private string'), {kind: 'non_error', name: 'unknown', frames: []});
});
