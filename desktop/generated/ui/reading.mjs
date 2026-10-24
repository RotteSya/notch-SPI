// Shared view structure. AppKit retains native selectable text/SwiftMath; Canvas desktop uses DOM/KaTeX.
export const readingStyle = {
  conclusionSize: 24,
  bodySize: 15,
  noteSize: 13,
  sectionSpacing: 18,
  insetX: 28,
  insetTop: 24,
  insetBottom: 28,
};
const words = {
  zh: [
    "答案",
    "解释",
    "此答案需要核对，请结合原题确认。",
    "正在生成解释…",
    "解释未完成，原答案保留。",
    "暂无已生成的解释",
  ],
  ja: [
    "回答",
    "解説",
    "元の問題と照合して確認してください。",
    "解説を生成中…",
    "解説は未完了です。元の回答を保持しています。",
    "生成済みの解説はありません",
  ],
  en: [
    "Answer",
    "Explanation",
    "This answer needs review. Check it against the original question.",
    "Generating explanation…",
    "Explanation incomplete. The original answer is preserved.",
    "No explanation has been generated yet",
  ],
};
export function readingSections({
  answer = "",
  detail = "",
  needsReview = false,
  explaining = false,
  explanationFailed = false,
  language = "en",
  emptyNote = true,
} = {}) {
  const w = words[language] || words.en,
    s = readingStyle,
    rows = [];
  const section = (text) =>
    rows.push({
      kind: "section",
      text,
      size: 12,
      weight: "regular",
      tone: "secondary",
    });
  const text = (value, size, weight = "regular", tone = "primary") =>
    rows.push({ kind: "text", text: value, size, weight, tone });
  section(w[0]);
  text(answer, s.conclusionSize, "semibold");
  if (needsReview) text(w[2], s.noteSize, "regular", "warning");
  if (detail) {
    section(w[1]);
    text(detail, s.bodySize);
  }
  if (explaining) text(w[3], s.noteSize, "regular", "secondary");
  else if (explanationFailed) text(w[4], s.noteSize, "regular", "secondary");
  else if (!detail && emptyNote) text(w[5], s.noteSize, "regular", "secondary");
  return rows;
}
export function readingHTML(value) {
  const esc = (s) =>
    String(s).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  return readingSections(value)
    .map((r) =>
      r.kind === "section"
        ? `<div class="shelf-label">${esc(r.text)}</div>`
        : `<div class="shared-reading-text ${r.tone}" data-rich style="font-size:${r.size}px;font-weight:${r.weight === "semibold" ? 600 : 400}">${esc(r.text)}</div>`,
    )
    .join("");
}

// Automatic copying is reserved for a ready answer; review results require an explicit action.
export function canCopyAnswer({ mode, busy = false, resultState = null, hasAnswer = false,
  automatic = false, autoCopyEnabled = false } = {}) {
  return mode === "tutor" && !busy && hasAnswer && resultState !== "retake" &&
    (!automatic || (autoCopyEnabled && resultState === "ready"));
}

export const personalityLowQuotaThreshold = 10;
const personalityStatuses = {
  "transportFailure": [
    "回答传输中断",
    "回答の受信が中断されました",
    "Answer transport interrupted"
  ],
  "unreadable": [
    "截图或选项无法辨认",
    "画像または選択肢を読み取れません",
    "Screenshot or choices unreadable"
  ],
  "dependsOnMissingPrevious": [
    "本页依赖缺失的上一题",
    "このページには前の質問が必要です",
    "This page depends on the missing previous question"
  ],
  "noValidChoices": [
    "未收到有效选项",
    "有効な選択肢を受信できませんでした",
    "No valid choices received"
  ],
  "invalidContext": [
    "连续题上下文未保存",
    "連続質問のコンテキストを保存できませんでした",
    "Questionnaire context wasn't saved"
  ],
  "contextCleared": [
    "连续题上下文已清空",
    "連続質問のコンテキストを消去しました",
    "Questionnaire context cleared"
  ],
  "partialUnreadable": [
    "部分题目无法辨认",
    "一部の質問を読み取れません",
    "Some questions were unreadable"
  ],
  "partialMissingPrevious": [
    "部分题目缺少上一题上下文",
    "一部の質問に前の質問が必要です",
    "Some questions need the previous-question context"
  ],
  "missingPrevious": [
    "上一题上下文不可用",
    "前の質問のコンテキストがありません",
    "Previous-question context unavailable"
  ],
  "done": [
    "完成",
    "完了",
    "Done"
  ]
};
export function personalityStatusText(primary, { language = "en", contextWasCleared = false,
  questionsRemaining = null, quotaRunningLow = questionsRemaining !== null && questionsRemaining <= personalityLowQuotaThreshold,
  copied = false } = {}) {
  const index = { zh: 0, ja: 1, en: 2 }[language] ?? 2;
  const parts = [(personalityStatuses[primary] ?? personalityStatuses.noValidChoices)[index]];
  if (contextWasCleared && primary !== "contextCleared") parts.push(personalityStatuses.contextCleared[index]);
  if (Number.isSafeInteger(questionsRemaining) && questionsRemaining >= 0) {
    parts.push([`剩余 ${questionsRemaining} 题`, `残り${questionsRemaining}問`,
      questionsRemaining === 1 ? "1 question left" : `${questionsRemaining} questions left`][index]);
  }
  if (quotaRunningLow) parts.push(["额度即将用完", "残りわずか", "Running low"][index]);
  if (copied) parts.push(["已复制", "コピー済み", "Copied"][index]);
  return parts.join(" · ");
}
