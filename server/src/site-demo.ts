import { createHash } from 'node:crypto';

// Fixed script, authorized by its CSP hash; the demo makes no network requests.
export const demoScript = `(() => {
  const demo = document.getElementById('demo');
  if (!demo) return;
  const stages = [...demo.querySelectorAll('input[name="demo-stage"]')];
  const toggle = demo.querySelector('.demo-toggle');
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const durations = [3000, 2200, 5000];
  let paused = motion.matches;
  let timer;
  let visible = true;
  let focused = false;
  function schedule() {
    clearTimeout(timer);
    toggle.textContent = paused ? toggle.dataset.play : toggle.dataset.pause;
    if (paused || document.hidden || !visible || focused) return;
    const index = stages.findIndex(stage => stage.checked);
    timer = setTimeout(() => {
      stages[(index + 1) % stages.length].checked = true;
      schedule();
    }, durations[index]);
  }
  toggle.hidden = false;
  demo.addEventListener('change', schedule);
  toggle.addEventListener('click', () => { paused = !paused; schedule(); });
  demo.addEventListener('focusin', event => {
    focused = event.target !== toggle;
    schedule();
  });
  demo.addEventListener('focusout', event => {
    focused = demo.contains(event.relatedTarget) && event.relatedTarget !== toggle;
    schedule();
  });
  document.addEventListener('visibilitychange', schedule);
  motion.addEventListener('change', () => { paused = motion.matches; schedule(); });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(entries => {
      visible = entries[0].isIntersecting;
      schedule();
    }).observe(demo);
  }
  schedule();
})();`;

export const siteCSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; script-src 'sha256-" +
  createHash('sha256').update(demoScript).digest('base64') + "'";
