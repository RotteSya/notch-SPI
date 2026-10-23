// Local, capturable exercise, matching the native onboarding question. No answer or network.
export function practiceHTML({
  language = "en",
  shortcut = "",
  multiple = false,
} = {}) {
  const i = language === "zh" ? 0 : language === "ja" ? 1 : 2,
    t = (...v) => v[i],
    esc = (v) =>
      String(v).replace(
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
  const passage = t(
      "一列火车以恒定速度行驶，2小时行驶了120千米。",
      "ある列車は一定の速さで走り、2時間で120 km進みました。",
      "A train travels at a constant speed, covering 120 km in 2 hours.",
    ),
    question = t(
      "这列火车的平均速度是多少？",
      "この列車の平均の速さは時速何kmですか？",
      "What is the train’s average speed?",
    ),
    choices = "A. 40 km/h　B. 60 km/h　C. 80 km/h";
  return `<!doctype html><html lang="${esc(language)}"><head><meta charset="utf-8"><title>NotchSPI · ${t("练习", "練習", "Practice")}</title><style>*{box-sizing:border-box}body{margin:0;background:#f4f5f7;color:#24262b;font:17px system-ui,sans-serif}main{max-width:880px;margin:360px auto 40px;padding:28px 32px;background:white;border:1px solid #e1e3e8;border-radius:20px;box-shadow:0 12px 44px #17203906;display:grid;grid-template-columns:minmax(0,1fr) 224px;gap:0 32px}small,h1,nav{grid-column:1/-1}small{font-size:10px;letter-spacing:2px;color:#767c88}h1{font-size:26px;font-weight:600;margin:10px 0 24px}section{min-height:150px}h2{font-size:12px;color:#777e8b}p{line-height:1.7}footer{border-left:1px solid #e8eaee;padding:2px 0 0 24px;color:#737b89;font-size:12px;line-height:1.75}kbd{display:inline-block;font:500 14px system-ui;background:#f6f7f9;border:1px solid #dfe3ea;border-radius:7px;padding:6px 11px;margin-bottom:12px}nav{margin-bottom:24px}button{font:500 13px system-ui;border:1px solid #e8eaee;border-radius:7px;padding:8px 18px;cursor:pointer;background:#f0f2f5}button[aria-pressed=true]{background:white;box-shadow:0 1px 4px #17203922}[hidden]{display:none!important}@media(max-width:760px){main{display:block;margin:300px 20px 28px}footer{border-left:0;border-top:1px solid #e8eaee;padding:18px 0 0}}</style></head><body><main><small>NOTCHSPI / ${multiple ? "02" : "01"}</small><h1>${multiple ? t("把一道题，分成两张图。", "1つの問題を、2枚に分けて。", "One question, two captures.") : t("一道题，一次截图。", "1つの問題を、1回で撮影。", "One question, one capture.")}</h1>${multiple ? `<nav><button id="a" aria-pressed="true">1 · ${t("材料", "資料", "Passage")}</button><button id="b" aria-pressed="false">2 · ${t("问题", "問題", "Question")}</button></nav><section id="passage"><h2>1 · ${t("材料", "資料", "Passage")}</h2><p>${passage}</p></section><section id="question" hidden><h2>2 · ${t("问题", "問題", "Question")}</h2><p>${question}</p><p>${choices}</p></section>` : `<section><p>${passage}</p><p>${question}</p><p>${choices}</p></section>`}<footer><kbd>${esc(shortcut)}</kbd><br>${t("让题目完整显示，再按快捷键截图。答案会出现在屏幕顶部。", "問題を表示してショートカットで撮影します。答えは画面上部に表示されます。", "Keep the question visible, then press the shortcut. The answer appears at the top of the screen.")}</footer></main>${multiple ? `<script>function show(q){document.getElementById('passage').hidden=q;document.getElementById('question').hidden=!q;document.getElementById('a').setAttribute('aria-pressed',String(!q));document.getElementById('b').setAttribute('aria-pressed',String(q));}document.getElementById('a').onclick=()=>show(false);document.getElementById('b').onclick=()=>show(true);</script>` : ""}</body></html>`;
}
