import { fit, flightStyle } from "./flight.mjs";
export const captureStyle = {
  cardWidth: 128,
  cardHeight: 80,
  cardGap: 12,
  referenceWidth: 52,
  referenceHeight: 30,
  referenceGap: 8,
  radius: flightStyle.radius,
  inset: flightStyle.inset,
  referenceInset: 3,
  settleDuration: 0.22,
  reorderDuration: 0.22,
  referenceDuration: 0.32,
};
export function captureCard(image, slot, compact = false) {
  return compact ? { ...slot } : fit(image, slot, captureStyle.inset);
}
export function landingKeyframes() {
  return [
    { rotate: "0deg", offset: 0 },
    { rotate: "-1.2deg", offset: 0.3 },
    { rotate: ".45deg", offset: 0.65 },
    { rotate: "0deg", offset: 1 },
  ];
}

// Preserve the large capture slots until all photos land and usable content arrives.
export function captureIsCompact(state) {
  return (
    !state.collecting &&
    !state.flying?.length &&
    Boolean(
      state.answer ||
      state.working ||
      ["error", "retake", "empty", "canceled"].includes(state.status),
    )
  );
}

// Mirrors TutorModel's daily status precedence. Error/cancel messages must never
// be hidden by text retained from the interrupted request.
export function dailyPresentation(state, language = "en") {
  const t = (zh, ja, en) => language === "zh" ? zh : language === "ja" ? ja : en;
  const busy = ["running", "streaming"].includes(state.status);
  const failure = ["error", "retake", "empty", "canceled"].includes(state.status);
  let heading = null;
  if (state.collecting) {
    heading = state.capturing ? t("截图中", "撮影中", "Capturing")
      : state.preview ? t("已暂停", "一時停止", "Paused")
      : state.remaining != null ? state.remaining <= 0 ? t("等待提交", "送信待ち", "Queued")
      : t(`${Math.ceil(state.remaining)} 秒后查题`, `${Math.ceil(state.remaining)}秒後に送信`, `Asking in ${Math.ceil(state.remaining)}s`)
      : t("等待下一张", "次の画像待ち", "Next image");
  } else if (state.capturing) heading = t("截图中", "撮影中", "Capturing");
  else if (state.status === "canceled") heading = t("已取消", "キャンセル済み", "Canceled");
  else if (state.status === "retake") heading = t("需要重拍", "再撮影が必要", "Retake needed");
  else if (state.status === "error" || state.status === "empty") heading = t("未完成", "未完了", "Incomplete");
  else if (busy && state.operation === "explain") heading = t("解释中", "解説中", "Explaining");
  else if (busy && state.operation === "recover") heading = t("恢复中", "復元中", "Recovering");
  else if (state.status === "done") heading = state.resultState === "review" ? t("需核对", "要確認", "Review needed") : t("完成", "完了", "Done");
  return {
    heading,
    messageFirst: failure && state.mode !== "personality",
    canEditImages: Boolean(state.collecting && !state.capturing),
    canSubmit: Boolean(state.collecting && !state.capturing && state.images.length >= 2),
    nextSlot: Boolean(state.collecting && state.images.length < 4),
    progress: state.collecting && state.remaining != null ? Math.max(0, Math.min(1, state.remaining / 4)) : null,
    canceledMessage: t("本轮已取消。按快捷键开始新的截图。", "今回をキャンセルしました。ショートカットで新しく開始できます。", "Round canceled. Use a shortcut to start again."),
  };
}
export function readingScrollPosition({ previous = 0, maximum = 0, newTurn = false, firstAnswer = false, detached = false, streaming = false, hasAnswer = false, atEnd = false }) {
  if (newTurn || (firstAnswer && !detached)) return 0;
  if (streaming && !hasAnswer && !detached && atEnd) return maximum;
  return Math.min(previous, maximum);
}
