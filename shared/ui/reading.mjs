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
