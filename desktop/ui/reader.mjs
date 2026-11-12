import { readingHTML } from '../generated/ui/reading.mjs';

export function renderReader(root, state, { escape, button, t, renderMath, call }) {
  const content = state.reader;
  if (!content) return;
  const previous = root.querySelector('.reader-answer');
  const scroll = previous?.scrollTop ?? 0;
  const imageScroll = root.querySelector('.reader-images')?.scrollTop ?? 0;
  const focused = document.activeElement?.dataset.action;
  const signature = JSON.stringify([content.id, content.answer, content.detail, content.canExplain, content.explaining, content.failed, content.current, state.settings.language]);
  if (root.dataset.reading === signature) return;
  root.dataset.reading = signature;
  document.title = t('fullAnswer');
  const initial = !root.querySelector('.reader-shell');
  if (initial) {
  root.innerHTML = `<main class="reader-shell"><h1>${t('fullAnswer')}</h1><p class="muted">${t(content.images.length ? 'readerWithImages' : 'readerWithoutImages')}</p><div class="reader-columns ${content.images.length ? '' : 'without-images'}">${content.images.length ? `<section class="reader-images" aria-label="${t('questionImages')}" tabindex="0">${content.images.map((x, i) => `<img src="${escape(x.url)}" alt="${t('questionImages')} ${i + 1}">`).join('')}</section>` : ''}<section class="reader-answer shared-reading" aria-label="${t('fullAnswer')}" tabindex="0">${readingHTML({ answer: content.answer, detail: content.detail, needsReview: content.needsReview, language: state.settings.language, emptyNote: false })}</section></div><footer><span class="muted" role="status">${content.explaining ? t('running') : content.failed ? t('explanationFailed') : !content.current ? t('readerDetached') : ''}</span><div class="actions">${content.canExplain ? button('readerExplain', t('explain')) : ''}${button('readerCopy', t('copy'))}${button('readerCopyAll', t('copyAll'))}</div></footer></main>`;
  } else {
    root.querySelector('.reader-answer').innerHTML = `${readingHTML({ answer: content.answer, detail: content.detail, needsReview: content.needsReview, language: state.settings.language, emptyNote: false })}`;
    root.querySelector('h1').textContent = t('fullAnswer');
    root.querySelector('.reader-shell > p').textContent = t(content.images.length ? 'readerWithImages' : 'readerWithoutImages');
    root.querySelector('footer').outerHTML = `<footer><span class="muted" role="status">${content.explaining ? t('running') : content.failed ? t('explanationFailed') : !content.current ? t('readerDetached') : ''}</span><div class="actions">${content.canExplain ? button('readerExplain', t('explain')) : ''}${button('readerCopy', t('copy'))}${button('readerCopyAll', t('copyAll'))}</div></footer>`;
  }
  renderMath(root.querySelector(".reader-answer"));
  root.querySelector('.reader-answer').scrollTop = scroll;
  const imageColumn = root.querySelector('.reader-images');
  if (imageColumn) imageColumn.scrollTop = imageScroll;
  if (focused) root.querySelector(`[data-action="${focused}"]`)?.focus({ preventScroll: true });
  if (initial) {
    Promise.allSettled([...root.querySelectorAll('img')].map(image => image.decode())).then(() => requestAnimationFrame(() => {
      const height = Math.max(...[...root.querySelectorAll('.reader-answer,.reader-images')].map(column => {
        const top = column.getBoundingClientRect().top;
        return Math.max(0, ...[...column.children].map(child => child.getBoundingClientRect().bottom - top)) + 16;
      }));
      call('readerSize', height).catch(() => {});
    }));
  }
}

