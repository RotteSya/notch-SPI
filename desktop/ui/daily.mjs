import { dailyPresentation } from '../generated/ui/capture.mjs';
export function dailyLabels(state) {
  const t = (zh,ja,en) => state.settings.language === 'zh' ? zh : state.settings.language === 'ja' ? ja : en;
  const p = dailyPresentation(state,state.settings.language);
  return { ...p,
    count: t(`题图 ${state.images.length}${state.collecting?'/4':''}`,`画像 ${state.images.length}${state.collecting?'/4':'枚'}`,`Images ${state.images.length}${state.collecting?'/4':''}`),
    next: t('下一张截图','次の画像','Next capture'),
    cancel: t('取消本轮','今回を取消','Cancel round'),
    reviewContinue: t("已复核，继续自动模式","確認済み・自動モードを続行","Reviewed — continue automatic mode"),
    auto: t(`停止自动 · ${state.auto.count}/${state.auto.cap === -1?'∞':state.auto.cap}`,`自動を停止 · ${state.auto.count}/${state.auto.cap === -1?'∞':state.auto.cap}`,`Stop auto · ${state.auto.count}/${state.auto.cap === -1?'∞':state.auto.cap}`),
    clear: t('清空题图与答案','画像と回答を消去','Clear images and answer'),
    hint: state.preview ? t('正在检查截图 · 自动提交已暂停','画像を確認中 · 送信を一時停止','Checking images · sending paused') : state.capturing ? t('正在捕获 · 自动提交已暂停','キャプチャ中 · 送信を一時停止','Capturing · sending paused') : state.images.length < 2 ? t('继续截图，至少两张才会自动查题。','撮影を続けてください。自動送信には2枚以上必要です。','Keep capturing. Auto-send needs at least two images.') : '',
  };
}
