import {continuationScript} from './site-continuation-script.ts';
import { createHash } from 'node:crypto';

// Fixed script, authorized by its CSP hash; the demo makes no network requests.
export const demoScript = `(() => {
  const demo = document.getElementById('demo');
  if (!demo) return;
  const stages = [...demo.querySelectorAll('input[name="demo-stage"]')];
  const toggle = demo.querySelector('.demo-toggle');
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const durations = [1800, 3400, 5000];
  let paused = motion.matches;
  if (!paused) stages[0].checked = true;
  let timer;
  let remaining = durations[0], lastIndex = 0, startedAt = 0;
  let visible = true;
  let focused = false;
  let manualStage = false;
  let explicitlyStarted = false;
  function positionFlight() {
    const controls = demo.querySelector('.stage-controls');
    const selected = stages.find(stage => stage.checked)?.closest?.('label');
    if (controls?.style && controls.getBoundingClientRect && selected) {
      const rail = controls.getBoundingClientRect();
      const tab = selected.getBoundingClientRect();
      controls.style.setProperty('--step-x', (tab.left - rail.left - (controls.clientLeft || 0)) + 'px');
      controls.style.setProperty('--step-width', tab.width + 'px');
      controls.style.setProperty('--step-height', tab.height + 'px');
      controls.classList.add('has-indicator');
    }
    const flight = demo.querySelector('.flying-capture');
    const panel = demo.querySelector('.notch');
    const screen = demo.querySelector('.desktop');
    const thumbnail = demo.querySelector('.capture-thumb');
    if (!flight?.style || !panel?.getBoundingClientRect || !screen) return;
    const panelBox = panel.getBoundingClientRect();
    const screenBox = screen.getBoundingClientRect();
    const flightLayout = window.getComputedStyle?.(flight);
    const flightLeft = Number.parseFloat(flightLayout?.left) || flight.offsetLeft;
    const flightTop = Number.parseFloat(flightLayout?.top) || flight.offsetTop;
    const flightWidth = Number.parseFloat(flightLayout?.width) || flight.offsetWidth;
    const flightHeight = Number.parseFloat(flightLayout?.height) || flight.offsetHeight;
    const target = thumbnail?.getBoundingClientRect();
    const targetX = target?.width ? target.left + target.width / 2 : panelBox.left + panelBox.width / 2;
    const targetY = target?.height ? target.top + target.height / 2 : panelBox.top + 50;
    flight.style.setProperty('--flight-x', (targetX - screenBox.left - (screen.clientLeft || 0) - flightLeft - flightWidth / 2) + 'px');
    flight.style.setProperty('--flight-y', (targetY - screenBox.top - (screen.clientTop || 0) - flightTop - flightHeight / 2) + 'px');
  }
  positionFlight();
  window.addEventListener?.('resize', positionFlight);
  demo.querySelector('.notch')?.addEventListener('transitionend', positionFlight);
  const suspendedTransitions = new Set();
  function syncTransitions(frozen) {
    if (frozen) {
      for (const animation of demo.getAnimations?.({subtree:true}) || []) {
        if (animation.transitionProperty && animation.playState === 'running') { animation.pause(); suspendedTransitions.add(animation); }
      }
    } else {
      suspendedTransitions.forEach(animation => { if (animation.playState === 'paused') animation.play(); });
      suspendedTransitions.clear();
    }
  }
  function schedule() {
    if (timer !== undefined) remaining = Math.max(0, remaining - (Date.now() - startedAt));
    clearTimeout(timer);
    timer = undefined;
    const index = stages.findIndex(stage => stage.checked);
    if (index !== lastIndex) { remaining = durations[index]; lastIndex = index; }
    if (index === stages.length - 1) paused = true;
    if (demo.dataset) demo.dataset.paused = String(document.hidden || (!visible && !manualStage && !explicitlyStarted) || (focused && !manualStage) || (paused && !manualStage));
    syncTransitions(demo.dataset?.paused === 'true' && index !== stages.length - 1);
    positionFlight();
    if (toggle) toggle.textContent = paused ? toggle.dataset.play : toggle.dataset.pause;
    if (paused || document.hidden || (!visible && !explicitlyStarted) || focused) return;
    startedAt = Date.now();
    timer = setTimeout(() => {
      timer = undefined;
      stages[(index + 1) % stages.length].checked = true;
      schedule();
    }, remaining);
  }
  document.querySelector?.('.watch-demo')?.addEventListener('click', () => {
    stages[motion.matches ? stages.length - 1 : 0].checked = true; paused = motion.matches; manualStage = false; explicitlyStarted = true; focused = false; schedule();
  });
  if (toggle) toggle.hidden = false;
  demo.addEventListener('change', () => { paused = true; manualStage = true; schedule(); });
  toggle?.addEventListener('click', () => {
    if (motion.matches) { stages[stages.length - 1].checked = true; paused = true; manualStage = false; schedule(); return; }
    manualStage = false;
    explicitlyStarted = true;
    if (stages[stages.length - 1].checked) { stages[0].checked = true; paused = false; }
    else paused = !paused;
    schedule();
  });
  demo.addEventListener('focusin', event => {
    focused = event.target !== toggle;
    schedule();
  });
  demo.addEventListener('focusout', event => {
    focused = demo.contains(event.relatedTarget) && event.relatedTarget !== toggle;
    schedule();
  });
  document.addEventListener('visibilitychange', schedule);
  motion.addEventListener('change', () => {
    paused = motion.matches;
    if (motion.matches) { stages[stages.length - 1].checked = true; manualStage = false; }
    schedule();
  });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(entries => {
      visible = entries[0].isIntersecting;
      schedule();
    }).observe(demo);
  }
  schedule();
})();` + continuationScript;

export const siteCSP = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; media-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; script-src 'sha256-" +
  createHash('sha256').update(demoScript).digest('base64') + "'";
