// Matches QuestionImagePreview's image fit and minimum content size.
export function previewSize(image, screen) {
  const width = Math.max(1, image.width || 600), height = Math.max(1, image.height || 400);
  const scale = Math.min(1, (screen.width - 120) / width, (screen.height - 180) / height);
  return {width: Math.round(Math.max(400, width * scale)), height: Math.round(Math.max(240, height * scale))};
}
export function previewLabels(state) {
  const t = (zh, ja, en) => state.settings.language === 'zh' ? zh : state.settings.language === 'ja' ? ja : en;
  const index = state.images.findIndex(image => image.id === state.previewID) + 1;
  return {
    title: t(`截图 ${index} / ${state.images.length} · 预览`, `画像 ${index} / ${state.images.length} · プレビュー`, `Image ${index} / ${state.images.length} · Preview`),
    hint: state.collecting
      ? t('预览期间暂停提交 · 2 张起，关闭后 4 秒提交 · Esc 关闭', 'プレビュー中は送信を停止 · 2枚以上なら閉じて4秒後に送信 · Escで閉じる', 'Sending paused · with 2+ images, closing starts a fresh 4s timer · Esc to close')
      : t('Esc 关闭预览', 'Esc で閉じる', 'Esc to close preview'),
  };
}
