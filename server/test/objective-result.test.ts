import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  composeObjectiveResult, normalizeObjectiveAnswer, objectiveResultIsBillable,
} from '../src/objective-result.ts';

const line = (body: object) => `NSPI_RESULT_V1: ${JSON.stringify(body)}`;

test('shared Swift/Node golden fixtures agree with the Node parser', () => {
  const fixtures = JSON.parse(readFileSync(
    new URL('../../Tests/Fixtures/objective-result-v1/cases.json', import.meta.url), 'utf8',
  )) as Array<{ id: string; raw: string; path: string; state: string | null; violations: string[] }>;
  assert.ok(fixtures.length >= 12);
  for (const fixture of fixtures) {
    const parsed = composeObjectiveResult(fixture.raw);
    assert.equal(parsed.parserPath, fixture.path, fixture.id);
    assert.equal(parsed.state, fixture.state, fixture.id);
    for (const violation of fixture.violations) assert.ok(parsed.violations.includes(violation as never), fixture.id);
  }
});

test('answer coverage fixtures keep every answer item through the parser', () => {
  const scenarios = JSON.parse(readFileSync(
    new URL('../../Tests/Fixtures/answer-coverage/cases.json', import.meta.url), 'utf8',
  )) as Array<{ id: string; protocol: boolean; raw: string; path: string; state: string | null; final: string; items: string[] }>;
  assert.ok(scenarios.length >= 7);
  const items = (final: string) => final.split(/[;；]/u).map(item => item.trim()).filter(Boolean);
  for (const scenario of scenarios) {
    const parsed = composeObjectiveResult(scenario.raw, scenario.protocol);
    assert.equal(parsed.parserPath, scenario.path, scenario.id);
    assert.equal(parsed.state, scenario.state, scenario.id);
    // One question stays one answer; several questions or sub-questions keep one item each, in order.
    assert.equal(parsed.finalAnswer, scenario.final, scenario.id);
    assert.deepEqual(items(parsed.finalAnswer ?? ''), scenario.items, scenario.id);
    assert.equal(parsed.visibleText.includes('NSPI_RESULT'), false, scenario.id);
    assert.ok(parsed.visibleText.endsWith('FINAL: ' + scenario.final), scenario.id);
  }
});

test('a FINAL that is not the single last conclusion needs review without changing billing', () => {
  const ready = (kind: string, answer: string) => line({ v: 1, kind, state: 'ready', answer, reason: 'none' });
  for (const raw of [
    // One FINAL per question: only the last one would reach the answer card.
    `Q1 work\nFINAL: A\nQ2 work\nFINAL: C\nQ3 work\nFINAL: B\n${ready('single_choice', 'B')}`,
    // Answers continued on the lines after FINAL: only the first line would reach the card.
    `FINAL: Q1: A\nQ2: C\nQ3: B\n${ready('other', 'Q1: A')}`,
  ]) {
    const parsed = composeObjectiveResult(raw);
    assert.equal(parsed.result, null);
    assert.equal(parsed.parserPath, 'legacy_fallback');
    assert.equal(parsed.state, 'review');
    assert.deepEqual(parsed.violations, ['finalMismatch']);
    assert.equal(objectiveResultIsBillable(parsed), true);
    // Nothing is removed from the visible reply.
    assert.equal(parsed.visibleText, raw.split('\n').slice(0, -1).join('\n'));
  }
  const repeated = composeObjectiveResult(`FINAL: B\n\nFINAL: **b**\n${ready('single_choice', 'B')}`);
  assert.equal(repeated.parserPath, 'v1');
  assert.equal(repeated.state, 'ready');
  // Legacy parsing without the protocol is unchanged: the last FINAL still wins.
  const legacy = composeObjectiveResult('FINAL: A\nFINAL: C', false);
  assert.equal(legacy.parserPath, 'legacy');
  assert.equal(legacy.finalAnswer, 'C');
});

test('valid ready/review are billable and marker is hidden', () => {
  for (const state of ['ready', 'review'] as const) {
    const reason = state === 'ready' ? 'none' : 'ambiguous_options';
    const parsed = composeObjectiveResult(`work\nFINAL: **b**\n${line({
      v: 1, kind: 'single_choice', state, answer: 'B', reason,
    })}`);
    assert.equal(parsed.parserPath, 'v1');
    assert.equal(parsed.state, state);
    assert.equal(parsed.visibleText.includes('NSPI_RESULT'), false);
    assert.equal(objectiveResultIsBillable(parsed), true);
  }
});

test('valid retake is not billable', () => {
  const parsed = composeObjectiveResult(line({
    v: 1, kind: 'single_choice', state: 'retake', answer: null, reason: 'cropped',
  }));
  assert.equal(parsed.parserPath, 'v1');
  assert.equal(parsed.state, 'retake');
  assert.equal(objectiveResultIsBillable(parsed), false);
});

test('a valid retake overrides a conflicting FINAL without changing legacy parsing', () => {
  const raw = `FINAL: B\n${line({v:1,kind:'single_choice',state:'retake',answer:null,reason:'unreadable'})}`;
  const parsed = composeObjectiveResult(raw);
  assert.equal(parsed.state, null);
  assert.equal(parsed.parserPath, 'none');
  assert.equal(parsed.finalAnswer, null);
  assert.equal(parsed.visibleText, '');
  assert.ok(parsed.violations.includes('invalidStateCombination'));
  assert.equal(objectiveResultIsBillable(parsed), false);
  const legacy = composeObjectiveResult(raw, false);
  assert.equal(legacy.parserPath, 'legacy');
  assert.equal(legacy.finalAnswer, 'B');
});

test('invalid V1 with usable FINAL becomes legacy fallback', () => {
  const parsed = composeObjectiveResult(`FINAL: A\n${line({
    v: 1, kind: 'single_choice', state: 'ready', answer: 'B', reason: 'none',
  })}`);
  assert.equal(parsed.parserPath, 'legacy_fallback');
  assert.ok(parsed.violations.includes('finalMismatch'));
  assert.equal(objectiveResultIsBillable(parsed), true);
});

test('strict marker placement, cardinality and exact keys', () => {
  const valid = line({ v: 1, kind: 'single_choice', state: 'ready', answer: 'A', reason: 'none' });
  const duplicate = composeObjectiveResult(`FINAL: A\n${valid}\n${valid}`);
  assert.equal(duplicate.parserPath, 'legacy_fallback');
  assert.ok(duplicate.violations.includes('duplicateMarker'));
  const extra = composeObjectiveResult(`FINAL: A\n${line({
    v: 1, kind: 'single_choice', state: 'ready', answer: 'A', reason: 'none', extra: 1,
  })}`);
  assert.ok(extra.violations.includes('unknownField'));
  const notLast = composeObjectiveResult(`FINAL: A\n${valid}\nafter`);
  assert.ok(notLast.violations.includes('markerNotLast'));
});

test('normalization is NFKC, whitespace/fence tolerant and option-case stable', () => {
  assert.equal(normalizeObjectiveAnswer(' **ｂ** '), 'B');
  assert.equal(normalizeObjectiveAnswer('`foo   bar`'), 'foo bar');
});

test('oversized JSON and missing usable result are rejected', () => {
  const parsed = composeObjectiveResult(`NSPI_RESULT_V1: ${'x'.repeat(4097)}`);
  assert.equal(parsed.parserPath, 'none');
  assert.ok(parsed.violations.includes('oversizedJSON'));
  assert.ok(parsed.violations.includes('missingUsableResult'));
});
