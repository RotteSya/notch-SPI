import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { createHash } from 'node:crypto';
import { demoScript, siteCSP } from '../src/site-demo.ts';

function setup(reduced = false) {
  const events = new Map<string, (event?: any) => void>();
  let selected = 0;
  const stages = [0, 1, 2].map(index => ({
    get checked() { return selected === index; },
    set checked(value: boolean) { if (value) selected = index; },
  }));
  const toggle = { hidden: true, textContent: '', dataset: { play: 'Play', pause: 'Pause' },
    addEventListener: (name: string, fn: () => void) => events.set(`toggle:${name}`, fn) };
  const demo = { querySelectorAll: () => stages, querySelector: () => toggle,
    contains: (target: unknown) => target === toggle || stages.includes(target as typeof stages[number]),
    addEventListener: (name: string, fn: () => void) => events.set(`demo:${name}`, fn) };
  const document = { hidden: false, getElementById: () => demo,
    addEventListener: (name: string, fn: () => void) => events.set(name, fn) };
  const motion = { matches: reduced, addEventListener: (name: string, fn: () => void) => events.set(`motion:${name}`, fn) };
  let pending: (() => void) | undefined;
  let delay = 0;
  class IntersectionObserver {
    constructor(fn: () => void) { events.set('intersection', fn); }
    observe() {}
  }
  runInNewContext(demoScript, { document, window: { matchMedia: () => motion, IntersectionObserver }, IntersectionObserver,
    setTimeout: (fn: () => void, ms: number) => { pending = fn; delay = ms; return 1; },
    clearTimeout: () => { pending = undefined; } });
  return { stages, toggle, document, motion,
    get selected() { return selected; }, get delay() { return delay; }, get running() { return !!pending; },
    tick() { assert.ok(pending); pending(); },
    fire(name: string, event?: unknown) { events.get(name)!(event); } };
}

test('demo loops all three stages and gives the answer more reading time', () => {
  const demo = setup();
  assert.equal(demo.toggle.hidden, false);
  assert.equal(demo.delay, 3000);
  demo.tick(); assert.equal(demo.selected, 1); assert.equal(demo.delay, 2200);
  demo.tick(); assert.equal(demo.selected, 2); assert.equal(demo.delay, 5000);
  demo.tick(); assert.equal(demo.selected, 0);
  demo.stages[2]!.checked = true; demo.fire('demo:change');
  assert.equal(demo.delay, 5000); demo.tick(); assert.equal(demo.selected, 0);
});

test('pause persists across visibility changes; keyboard focus and offscreen stop rotation', () => {
  const demo = setup();
  demo.fire('toggle:click'); assert.equal(demo.running, false); assert.equal(demo.toggle.textContent, 'Play');
  demo.fire('visibilitychange'); assert.equal(demo.running, false);
  demo.fire('toggle:click'); assert.equal(demo.running, true);
  demo.document.hidden = true; demo.fire('visibilitychange'); assert.equal(demo.running, false);
  demo.document.hidden = false; demo.fire('visibilitychange'); assert.equal(demo.running, true);
  demo.fire('demo:focusin', { target: demo.stages[0] }); assert.equal(demo.running, false);
  demo.fire('demo:focusout', { relatedTarget: null }); assert.equal(demo.running, true);
  demo.fire('intersection', [{ isIntersecting: false }]); assert.equal(demo.running, false);
  demo.fire('intersection', [{ isIntersecting: true }]); assert.equal(demo.running, true);
});

test('reduced motion disables autoplay and responds to preference changes', () => {
  const demo = setup(true); assert.equal(demo.running, false);
  demo.fire('toggle:click'); assert.equal(demo.running, true);
  demo.fire('motion:change'); assert.equal(demo.running, false);
});

test('CSP only permits the exact shipped demo script', () => {
  assert.ok(siteCSP.includes(`script-src 'sha256-${createHash('sha256').update(demoScript).digest('base64')}'`));
  assert.doesNotMatch(siteCSP, /script-src 'unsafe-inline'/);
});
