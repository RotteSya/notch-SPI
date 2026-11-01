import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { createHash } from 'node:crypto';
import { demoScript, siteCSP } from '../src/site-demo.ts';

function setup(reduced = false, geometry?: Record<string, any>, noToggle = false) {
  const events = new Map<string, (event?: any) => void>();
  let selected = 2;
  let now = 0;
  const stages = [0, 1, 2].map(index => ({
    closest: () => geometry?.labels?.[index],
    get checked() { return selected === index; },
    set checked(value: boolean) { if (value) selected = index; },
  }));
  const toggle = { hidden: true, textContent: '', dataset: { play: 'Play', pause: 'Pause' },
    addEventListener: (name: string, fn: () => void) => events.set(`toggle:${name}`, fn) };
  const demo = { dataset: {} as Record<string,string>, querySelectorAll: () => stages, querySelector: (selector: string) => selector === '.demo-toggle' && noToggle ? null : geometry?.[selector] ?? toggle,
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
  runInNewContext(demoScript, { Date: {now: () => now}, document, window: { matchMedia: () => motion, IntersectionObserver, addEventListener: (name: string, fn: () => void) => events.set(name, fn) }, IntersectionObserver,
    setTimeout: (fn: () => void, ms: number) => { pending = fn; delay = ms; return 1; },
    clearTimeout: () => { pending = undefined; } });
  return { stages, toggle, document, motion, element: demo,
    get selected() { return selected; }, get delay() { return delay; }, get running() { return !!pending; },
    advance(ms: number) { now += ms; },
    tick() { assert.ok(pending); pending(); },
    fire(name: string, event?: unknown) { events.get(name)!(event); } };
}

test('demo plays once, holds the answer, and can replay', () => {
  const demo = setup();
  assert.equal(demo.toggle.hidden, false);
  assert.equal(demo.delay, 1800);
  demo.tick(); assert.equal(demo.selected, 1); assert.equal(demo.delay, 3400);
  demo.tick(); assert.equal(demo.selected, 2); assert.equal(demo.running, false);
  demo.fire('toggle:click'); assert.equal(demo.selected, 0); assert.equal(demo.running, true);
  demo.stages[1]!.checked = true; demo.fire('demo:change'); assert.equal(demo.running, false);
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
  const automatic = setup();
  automatic.fire('intersection', [{ isIntersecting: false }]); assert.equal(automatic.running, false);
  automatic.fire('intersection', [{ isIntersecting: true }]); assert.equal(automatic.running, true);
});

test('reduced motion disables autoplay and responds to preference changes', () => {
  const demo = setup(true); assert.equal(demo.running, false); assert.equal(demo.selected, 2);
  demo.fire('toggle:click'); assert.equal(demo.running, false); assert.equal(demo.selected, 2);
  demo.stages[1]!.checked = true;
  demo.fire('motion:change'); assert.equal(demo.running, false); assert.equal(demo.selected, 2);
});

test('CSP only permits the exact shipped demo script', () => {
  assert.ok(siteCSP.includes(`script-src 'sha256-${createHash('sha256').update(demoScript).digest('base64')}'`));
  assert.doesNotMatch(siteCSP, /script-src 'unsafe-inline'/);
});

test('manual capture animates while focused, but explicit pause freezes flight', () => {
  const demo = setup();
  demo.fire('demo:focusin', { target: demo.stages[1] });
  demo.stages[1]!.checked = true;
  demo.fire('demo:change');
  assert.equal(demo.running, false);
  assert.equal(demo.element.dataset.paused, 'false');
  demo.fire('demo:focusout', { relatedTarget: demo.toggle });
  demo.fire('toggle:click');
  assert.equal(demo.running, true);
  demo.fire('toggle:click');
  assert.equal(demo.element.dataset.paused, 'true');
  demo.document.hidden = true;
  demo.fire('visibilitychange');
  assert.equal(demo.element.dataset.paused, 'true');
});


test('explicit user playback wins over a stale intersection observation, but not tab visibility', () => {
  const demo = setup();
  demo.fire('intersection', [{ isIntersecting: false }]);
  demo.stages[1]!.checked = true;
  demo.fire('demo:change');
  assert.equal(demo.element.dataset.paused, 'false');
  demo.fire('toggle:click');
  assert.equal(demo.running, true);
  demo.document.hidden = true;
  demo.fire('visibilitychange');
  assert.equal(demo.running, false);
  assert.equal(demo.element.dataset.paused, 'true');
});


test('flight lands on the thumbnail center inside the device border', () => {
  const coordinates = new Map<string, string>();
  setup(false, {
    '.flying-capture': { offsetLeft: 500, offsetTop: 200, offsetWidth: 160, offsetHeight: 100,
      style: { setProperty: (name: string, value: string) => coordinates.set(name, value) } },
    '.notch': { getBoundingClientRect: () => ({ left: 100, top: 50, width: 400 }), addEventListener() {} },
    '.desktop': { clientLeft: 10, clientTop: 10, getBoundingClientRect: () => ({ left: 50, top: 20 }) },
    '.capture-thumb': { getBoundingClientRect: () => ({ left: 150, top: 100, width: 40, height: 30 }) },
  });
  assert.equal(coordinates.get('--flight-x'), '-470px');
  assert.equal(coordinates.get('--flight-y'), '-165px');
});


test('resume preserves the remaining stage time instead of restarting its clock', () => {
  const demo = setup();
  demo.advance(700);
  demo.fire('toggle:click');
  demo.advance(5000);
  demo.fire('toggle:click');
  assert.equal(demo.delay, 1100);
  demo.tick();
  assert.equal(demo.selected, 1);
  assert.equal(demo.delay, 3400);
});


test('the hero finishes autoplay when the replay control is absent', () => {
  const demo = setup(false, undefined, true);
  demo.tick();
  demo.tick();
  assert.equal(demo.selected, 2);
  assert.equal(demo.running, false);
});


test('step indicator follows measured labels and recomputes after resize', () => {
  const values = new Map<string,string>();
  let offset = 0;
  const controls = {style:{setProperty:(key: string, value: string) => values.set(key, value)},
    clientLeft:1, classList:{add(){}}, getBoundingClientRect:() => ({left:100})};
  const labels = [0,1,2].map(i => ({getBoundingClientRect:() => ({left:105 + i * 110 + offset,width:100 + i,height:40})}));
  const demo = setup(false, {'.stage-controls':controls, labels});
  assert.equal(values.get('--step-x'), '4px');
  demo.tick();
  assert.equal(values.get('--step-x'), '114px');
  assert.equal(values.get('--step-width'), '101px');
  offset = 20;
  demo.fire('resize');
  assert.equal(values.get('--step-x'), '134px');
});
