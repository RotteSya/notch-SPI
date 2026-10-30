// Local illustrative controls. No model, capture or payment requests are performed here.
export const continuationScript = `(() => {
  const comparison = document.querySelector?.('#capture-comparison');
  if (!comparison) return;
  const slider = comparison.querySelector('.reveal-range');
  const device = comparison.querySelector('.reveal-device');
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  function render() {
    device.style.setProperty('--split', slider.value + '%');
    const lang = document.documentElement.lang.split('-')[0];
    slider.setAttribute('aria-valuetext', lang === 'zh' ? '本机画面 ' + slider.value + '%，捕获画面 ' + (100 - slider.value) + '%' : lang === 'ja' ? '手元の画面 ' + slider.value + '%、キャプチャ ' + (100 - slider.value) + '%' : 'Local view ' + slider.value + '%, captured view ' + (100 - slider.value) + '%');
  }
  slider.addEventListener('input', render);
  const words = [...comparison.querySelectorAll('.capture-words span')];
  const wordBox = comparison.querySelector('.capture-words');
  let wordIndex = 0, wordTimer, inView = true, interacting = false;
  function sizeWord() {
    const current = words[wordIndex];
    if (current && wordBox) wordBox.style.width = current.getBoundingClientRect().width + 'px';
  }
  sizeWord();
  wordBox?.classList.add('words-ready');
  window.addEventListener('resize', sizeWord);
  comparison.addEventListener('focusin', () => { interacting = true; scheduleWords(); });
  comparison.addEventListener('focusout', event => { interacting = comparison.contains(event.relatedTarget); scheduleWords(); });
  slider.addEventListener('pointerdown', () => { interacting = true; scheduleWords(); });
  window.addEventListener('pointerup', () => { interacting = comparison.contains(document.activeElement); scheduleWords(); });
  function scheduleWords() {
    clearTimeout(wordTimer);
    comparison.classList.toggle('reduced-words', motion.matches);
    if (motion.matches) {
      wordIndex = 0;
      words.forEach((word, i) => word.classList.toggle('is-current', i === 0));
      sizeWord();
    }
    if (motion.matches || document.hidden || !inView || interacting) return;
    wordTimer = setTimeout(() => {
      wordIndex = (wordIndex + 1) % words.length;
      words.forEach((word, i) => word.classList.toggle('is-current', i === wordIndex));
      sizeWord();
      scheduleWords();
    }, 2600);
  }
  document.addEventListener('visibilitychange', scheduleWords);
  motion.addEventListener('change', scheduleWords);
  if ('IntersectionObserver' in window) new IntersectionObserver(entries => {
    inView = entries[0].isIntersecting; scheduleWords();
  }).observe(comparison);
  scheduleWords();
  document.querySelectorAll('[data-purchase]').forEach(link => link.addEventListener('click', () => {
    const purchase = document.getElementById('purchase');
    purchase.open = true;
    const selected = document.querySelector('input[name="purchase-pack"]:checked');
    const plan = link.dataset.purchase === 'pack' ? selected?.closest('label') : document.querySelector('.plus-plan .price-line');
    purchase.querySelector('.selected-purchase').textContent = plan?.textContent?.trim() || '';
  }));
  document.querySelectorAll('[data-disclosure]').forEach(link => link.addEventListener('click', () => {
    const section = document.querySelector(link.getAttribute('href'));
    if (section?.tagName === 'DETAILS') section.open = true;
    else section?.querySelector('details')?.setAttribute('open', '');
  }));
  const hashTarget = document.getElementById(location.hash.slice(1));
  if (hashTarget?.tagName === 'DETAILS') hashTarget.open = true;
  render();
})();`;
