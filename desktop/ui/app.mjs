import {
  captureStyle,
  captureIsCompact,
  captureCard,
  landingKeyframes,
} from "../generated/ui/capture.mjs";
import { onboardingCopy } from "../generated/ui/onboarding.mjs";
import { Ghost } from "../generated/ui/ghost.mjs";
import { readingHTML } from "../generated/ui/reading.mjs";
import { containsPoint, canCollapseOnLeave, pointerExitDelay } from "../core/window-behavior.mjs";
import { translate } from "./i18n.mjs";
import { product, spring, close, contentOpacity } from "../core/product.mjs";
import katex from "../node_modules/katex/dist/katex.mjs";
const app = document.querySelector("#app"),
  page = new URLSearchParams(location.search).get("page") ?? "notch";
document.body.className = page;
let ghostRig,
  heroRig,
  previousFlying = new Set();
let state = null,
  settingsPage = "general",
  lastSettings = "",
  dirty = false,
  recording = null,
  menu = false,
  hover = false,
  pointerModal = false,
  manualCollapse = false,
  leaveTimer,
  answerTimer,
  lastStatus,
  scrollPositions = {},
  expanded = null,
  animation = null,
  geometry = { width: 200, height: 28, alpha: 0, expansion: 0 };
const escape = (x) =>
  String(x ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const t = (key) => translate(key, state?.settings.language);
const icon = (name) => {
  const paths = {
    gear: "M8 1l1.1 2 2.2-.2.8 1.4-1.1 1.9.9 1.9-.9 1.9 1.1 1.9-.8 1.4-2.2-.2L8 15l-1.1-2-2.2.2-.8-1.4L5 9.9 4.1 8 5 6.1 3.9 4.2l.8-1.4 2.2.2L8 1M10.5 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 1 1 5 0",
    down: "M3 6l5 5 5-5",
    history: "M3 5A6 6 0 1 1 2 9M1 2v4h4M8 4v4l3 2",
    shortcuts: "M1 3h14v10H1zM4 6h1m2 0h1m2 0h1M4 9h1m2 0h5",
    account: "M1 3h14v10H1zM1 6h14M4 10h4",
    personas:
      "M1 2h14v12H1zM9 6h3M9 9h3M6 6a1.5 1.5 0 1 1-3 0 1.5 1.5 0 1 1 3 0M2 12q2.5-5 5 0",
    service:
      "M2 1l4 4-1 2-2 1-3-4M6 7l7 7 2-2-7-7M10 1l-2 3 2 2 3-1 2-3M2 15l5-5",
  };
  return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name === "general" ? "gear" : name] ?? paths.gear}"/></svg>`;
};
const button = (action, label, extra = "") =>
  `<button data-action="${action}" ${extra}>${label}</button>`;
async function call(action, payload) {
  const result = await window.nspi.call(action, payload);
  if (result?.error) {
    const error = document.querySelector(".toast");
    if (error) error.textContent = result.error;
    else if (state?.qaPinned)
      document
        .querySelector(".fixture-label")
        ?.append(document.createTextNode(result.error));
  }
  return result;
}
const shortcut = (name) => {
  const raw = state.settings.hotkeys[name];
  return raw
    .replace("CommandOrControl", state.platform === "darwin" ? "⌘" : "Ctrl")
    .replace("Shift", "⇧")
    .replace("Space", "Space")
    .split("+")
    .map((x) => `<kbd>${escape(x)}</kbd>`)
    .join("");
};
function richText(text) {
  const fragment = document.createDocumentFragment(),
    pattern = /\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`/g;
  let offset = 0;
  for (const m of text.matchAll(pattern)) {
    fragment.append(document.createTextNode(text.slice(offset, m.index)));
    const node = document.createElement(m[3] ? "code" : "strong");
    node.textContent = m[1] ?? m[2] ?? m[3];
    fragment.append(node);
    offset = m.index + m[0].length;
  }
  fragment.append(document.createTextNode(text.slice(offset)));
  return fragment;
}
function renderMath(root) {
  for (const node of [...root.querySelectorAll("[data-rich]")]) {
    const text = node.textContent,
      regex =
        /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|(?<!\\)\$([^$\n]+?)\$/g;
    let offset = 0,
      match;
    const fragment = document.createDocumentFragment();
    while ((match = regex.exec(text))) {
      fragment.append(richText(text.slice(offset, match.index)));
      const span = document.createElement("span");
      span.className = "math-inline";
      try {
        katex.render(match[1] ?? match[2] ?? match[3] ?? match[4], span, {
          displayMode: Boolean(match[1] || match[2]),
          throwOnError: false,
          trust: false,
          maxExpand: 500,
          maxSize: 20,
          strict: "warn",
        });
      } catch {
        span.textContent = match[0];
      }
      fragment.append(span);
      offset = regex.lastIndex;
    }
    fragment.append(richText(text.slice(offset)));
    node.replaceChildren(fragment);
  }
}
function guide() {
  return `<div class="shortcut-guide">${["single", "multiple", "personality", "auto"].map((key) => button(key === "auto" ? "auto" : "capture", `<span class="keycaps">${shortcut(key)}</span><span>${t(key)}</span>`, key === "auto" ? "" : `data-value="${key}"`)).join("")}</div>`;
}
function onboardingFooter() {
  const g = state.guide,
    copy = onboardingCopy(
      g.step,
      state.settings.language,
      state.account?.free_trial,
    );
  const tr = (zh, ja, en) =>
    state.settings.language === "zh"
      ? zh
      : state.settings.language === "ja"
        ? ja
        : en;
  const trialStarted =
    state.account?.free_trial && state.account.free_trial.status !== "eligible";
  const primary = copy.action;
  return `<div class="guide-footer">${g.live ? `<p>${escape(copy.body)}</p>` : ""}<div class="actions">${primary ? button("guidePrimary", escape(g.claiming ? tr("正在确认…", "確認中…", "Checking…") : primary), `class="primary" ${g.claiming ? "disabled" : ""}`) : ""}${g.failed ? button("capture", t("single"), `data-value="${g.multiple ? "multiple" : "single"}"`) : ""}${g.step === "trial" ? (trialStarted ? "" : button("guideLater", tr("稍后领取", "あとで", "Claim later"), g.claiming ? "disabled" : "")) : button("guideDismiss", tr("稍后继续", "あとで", "Continue later"))}${!["welcome", "trial"].includes(g.step) ? button("guideBack", tr("返回", "戻る", "Back")) : ""}${button("settings", tr("账户与订阅", "アカウント", "Account"), 'data-value="account"')}${["capture", "multiCapture", "permission"].includes(g.step) ? button("settings", t("settings"), 'data-value="general"') : ""}</div></div>`;
}
function notch() {
  if (!document.querySelector(".slab"))
    app.innerHTML =
      '<div class="slab"><div class="slab-face"><div class="slab-background"></div><div class="slab-content"></div><button class="collapsed-ghost" data-action="expand" aria-label="Expand notch"></button></div></div><div id="overlays"></div>';
  const content = document.querySelector(".slab-content");
  const previousCards = new Map(
    [...content.querySelectorAll("[data-flight-id]")].map((n) => [
      n.dataset.flightId,
      n.getBoundingClientRect(),
    ]),
  );
  const previous = content.querySelector(".reading"),
    scroll = previous?.scrollTop ?? 0,
    atEnd =
      !previous || previous.scrollHeight - previous.clientHeight - scroll < 12;
  const focused = document.activeElement?.dataset?.action;
  const workingOpen =
    content.querySelector("details")?.open ?? state.settings.showReasoning;
  let body = "";
  if (state.onboarding && !state.guide.live) {
    const copy = onboardingCopy(
      state.guide.step,
      state.settings.language,
      state.account?.free_trial,
    );
    body = `<div class="onboarding"><div class="guide-hero"></div><h1>${escape(copy.title)}</h1><p>${escape(copy.body)}</p>${["capture", "multiCapture"].includes(state.guide.step) ? button("capture", `<span class="keycaps">${shortcut(state.guide.multiple ? "multiple" : "single")}</span>`, `class="guide-capture" data-value="${state.guide.multiple ? "multiple" : "single"}"`) : ""}${state.message ? `<p class="error-message">${escape(state.message)}</p>` : ""}</div>`;
  } else if (state.collecting) {
    body = `<p class="muted">${state.preview ? t("paused") : state.remaining === null ? t(state.images.length > 1 ? "paused" : "waitOne") : `${state.images.length}/4 · ${state.remaining} ${t("seconds")}`}</p>`;
  } else if (state.flying?.length) {
    body = '<div class="waiting-light"></div>';
  } else if (state.answer) {
    body = `<div class="reading shared-reading">${readingHTML({ answer: state.answer, detail: state.explanation, needsReview: state.resultState === "review", language: state.settings.language, emptyNote: false })}${state.working ? `<details ${workingOpen ? "open" : ""}><summary>${t("working")}</summary><div class="working" data-rich>${escape(state.working)}</div></details>` : ""}</div>`;
  } else if (["error", "retake", "empty", "canceled"].includes(state.status)) {
    body = `<p class="${state.status === "error" ? "error-message" : "muted"}">${escape(state.message ? t(state.message) : t(state.status === "retake" ? "retakeHelp" : state.status))}</p>`;
  } else if (["running", "streaming"].includes(state.status)) {
    body = state.working
      ? `<div class="reading working" data-rich>${escape(state.working)}</div>`
      : '<div class="waiting-light"></div>';
  } else body = guide();
  const material =
    state.images.length && (!state.onboarding || state.guide.live)
      ? `<div class="material-strip ${captureIsCompact(state) ? "compact" : "collecting"}">${state.images.map((x, i) => `<div class="thumb">${button("preview", `<img src="${escape(x.thumbnail)}" alt="${t("preview")} ${i + 1}">`, `class="photo-card" data-flight-id="${x.id}" style="opacity:${state.flying?.includes(x.id) ? 0 : 1}" data-value="${x.id}" aria-label="${t("preview")} ${i + 1}"`)}${state.collecting ? `<span class="ordinal">${i + 1}</span>` : ""}${state.collecting ? button("remove", "×", `class="remove" data-value="${x.id}" aria-label="${t("remove")} ${i + 1}"`) : ""}</div>`).join("")}<span class="image-count">${state.settings.language === "zh" ? "题图 " : state.settings.language === "ja" ? "画像 " : "Images "}${state.images.length}</span></div>`
      : "";
  let actions = "";
  if (["running", "streaming"].includes(state.status))
    actions = button("cancel", t("cancel"));
  if (state.collecting)
    actions =
      button("submit", t("submit"), state.images.length < 2 ? "disabled" : "") +
      button("cancel", t("cancel")) +
      (state.undo ? button("undo", t("undo")) : "");
  if (state.status === "done" && state.answer)
    actions =
      button("copy", t("copy")) +
      (state.canExplain ? button("explain", t("explain")) : "");
  if (["error", "canceled"].includes(state.status))
    actions =
      (state.canCheckSettlement ? button("status", t("status"), `title="${t("statusHint")}"`) : "") +
      (state.canRecover ? button("recover", t("recover")) : "") +
      (state.canRetry ? button("retry", t("retry")) : "");
  if (["retake", "empty"].includes(state.status))
    actions = button("capture", t("single"), 'data-value="single"');
  if (state.auto.active)
    actions += button(
      "auto",
      `${t("stop")} ${state.auto.count}/${state.auto.cap === -1 ? "∞" : state.auto.cap}`,
    );
  if (state.settlement)
    body += `<p class="muted">${t("settlement_" + state.settlement.status)}${state.settlement.charged == null ? "" : " · " + state.settlement.charged + " " + t("charged")}</p>`;
  if (state.onboarding && !state.guide.live) actions = "";
  const guideFooter = state.onboarding ? onboardingFooter() : "";
  const heroCanvas = content.querySelector(".guide-hero canvas");
  content.innerHTML = `<div class="slab-header"><span class="ghost-slot"></span><div><div class="brand">NotchSPI</div><div class="status" role="status">${t(state.status)}</div></div><span class="spacer"></span>${button("cycleEffort", t(state.settings.reasoning), 'class="effort"')}${button("collapse", icon("down"), `aria-label="${t("collapse")}"`)}${button("menu", icon("gear"), `aria-label="${t("settings")}"`)}</div><div class="shelf">${body}${material}${actions ? `<div class="actions ${state.status === "done" ? "answer-actions" : ""}">${actions}</div>` : ""}${guideFooter}</div>`;
  const heroSlot = content.querySelector(".guide-hero");
  if (heroSlot) {
    const canvas = heroCanvas ?? document.createElement("canvas");
    heroSlot.append(canvas);
    if (!heroRig) heroRig = new Ghost(canvas);
    heroRig.set({ hero: true });
  } else if (heroRig) {
    heroRig.dispose();
    heroRig = null;
  }
  content.style.setProperty("--answer-size", state.settings.answerSize + "px");
  layoutCaptureCards();
  const reduced = matchMedia("(prefers-reduced-motion:reduce)").matches;
  for (const n of content.querySelectorAll("[data-flight-id]")) {
    const id = n.dataset.flightId,
      before = previousCards.get(id),
      after = n.getBoundingClientRect();
    if (!reduced && previousFlying.has(id) && !state.flying?.includes(id))
      n.animate(landingKeyframes(), {
        duration: captureStyle.settleDuration * 1000,
        easing: "ease-in-out",
      });
    if (
      !reduced &&
      before &&
      !state.flying?.includes(id) &&
      (Math.abs(before.x - after.x) > 0.5 ||
        Math.abs(before.width - after.width) > 0.5)
    )
      n.animate(
        [
          {
            transform: `translate(${before.x + before.width / 2 - after.x - after.width / 2}px,${before.y + before.height / 2 - after.y - after.height / 2}px) scale(${before.width / after.width},${before.height / after.height})`,
          },
          { transform: "none" },
        ],
        {
          duration:
            (state.collecting
              ? captureStyle.reorderDuration
              : captureStyle.referenceDuration) * 1000,
          easing: "ease-in-out",
        },
      );
  }
  previousFlying = new Set(state.flying ?? []);
  renderMath(content);
  const next = content.querySelector(".reading");
  if (next) next.scrollTop = atEnd ? next.scrollHeight : scroll;
  const persistentGhost = document.querySelector(".collapsed-ghost");
  if (!ghostRig) {
    const canvas = document.createElement("canvas");
    canvas.className = "ghost-canvas";
    canvas.setAttribute("aria-hidden", "true");
    persistentGhost.append(canvas);
    ghostRig = new Ghost(canvas);
  }
  ghostRig.set({
    busy: ["running", "streaming"].includes(state.status),
    color:
      state.status === "error"
        ? "#f7524a"
        : ["running", "streaming"].includes(state.status)
          ? "#aabcf0"
          : "#ffffff",
    completed:
      state.status === "done" && ["running", "streaming"].includes(lastStatus),
  });
  const overlays = document.querySelector("#overlays");
  overlays.innerHTML = state.preview
    ? `<div class="preview" role="dialog" aria-label="${t("preview")}">${button("preview", t("close"), 'data-value=""')}<img src="${escape(state.preview)}" alt="${t("preview")}"><small>${t("paused")}</small></div>`
    : menu
      ? `<div class="notch-menu" role="menu">${["single", "multiple", "personality"].map((k) => button("capture", t(k), `data-value="${k}"`)).join("")}${button("auto", t("auto"))}${button("import", t("import"))}${button("history", t("history"))}${button("settings", t("settings"), 'data-value="general"')}${button("guideResume", state.settings.language === "zh" ? "使用引导" : state.settings.language === "ja" ? "使い方" : "Start guide")}${button("quit", t("quit"))}</div>`
      : "";
  if (state.dev)
    overlays.insertAdjacentHTML(
      "beforeend",
      `<div class="fixture-label">${escape(state.dev)}${state.qaPinned && !state.onboarding ? button("qaMotion", "Replay flight", 'data-value="flight"') + button("qaMotion", "Ghost: working", 'data-value="working"') + button("qaMotion", "Ghost: complete", 'data-value="done"') : ""}</div>`,
    );
  if (focused) {
    const node = [...document.querySelectorAll("[data-action]")].find(
      (x) => x.dataset.action === focused,
    );
    node?.focus({ preventScroll: true });
  }
  const targetHeight = Math.min(innerHeight - 28, content.scrollHeight);
  morph(state.expanded, targetHeight);
  requestAnimationFrame(reportFlightTargets);
  if (lastStatus !== state.status) {
    clearTimeout(answerTimer);
    if (state.status === "done" && !state.settings.keepExpanded && state.settings.collapseDelay > 0)
      answerTimer = setTimeout(() => {
        if (
          !state.qaPinned &&
          !state.onboarding &&
          !hover &&
          !menu &&
          !state.preview
        )
          call("expand", false);
      }, state.settings.collapseDelay * 1000);
    lastStatus = state.status;
  }
}
function layoutCaptureCards() {
  for (const node of document.querySelectorAll("[data-flight-id]")) {
    const image = state.images.find((x) => x.id === node.dataset.flightId),
      slot = node.parentElement;
    const compact = captureIsCompact(state);
    const width = !compact
      ? Math.min(
          captureStyle.cardWidth,
          (slot.parentElement.clientWidth - 3 * captureStyle.cardGap) / 4,
        )
      : captureStyle.referenceWidth;
    const height = !compact
      ? captureStyle.cardHeight
      : captureStyle.referenceHeight;
    slot.style.width = width + "px";
    slot.style.height = height + "px";
    const frame = captureCard(
      image?.width ? image : { width: 16, height: 9 },
      { x: 0, y: 0, width, height },
      compact,
    );
    Object.assign(node.style, {
      left: frame.x + "px",
      top: frame.y + "px",
      width: frame.width + "px",
      height: frame.height + "px",
      padding:
        (!compact ? captureStyle.inset : captureStyle.referenceInset) + "px",
      borderRadius: captureStyle.radius + "px",
    });
  }
}
let targetSignature = "";
function reportFlightTargets() {
  const targets = [...document.querySelectorAll("[data-flight-id]")].map(
    (node) => {
      const r = node.getBoundingClientRect();
      return {
        id: node.dataset.flightId,
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
      };
    },
  );
  const signature = JSON.stringify(targets);
  if (signature !== targetSignature || state?.flying?.length) {
    targetSignature = signature;
    call("flightTargets", targets);
  }
}
window.addEventListener("resize", () => {
  layoutCaptureCards();
  reportFlightTargets();
});
function morph(open, height) {
  const targetWidth = Math.min(product.layout.cardWidth, innerWidth - 44),
    target = {
      width: open ? targetWidth : product.layout.collapsedWidth,
      height: open ? height : product.layout.collapsedHeight,
      alpha: open ? 1 : 0,
      expansion: open ? 1 : 0,
    };
  if (expanded === open && Math.abs(geometry.height - target.height) < 1)
    return;
  cancelAnimationFrame(animation);
  const origin = { ...geometry },
    start = performance.now();
  expanded = open;
  const reduced = matchMedia("(prefers-reduced-motion:reduce)").matches;
  function paint(time) {
    const t = reduced
        ? 1
        : Math.min(1, (time - start) / (product.motion.duration * 1000)),
      p = t === 1 ? 1 : open ? spring(t) : close(t);
    geometry = {
      width: origin.width + (target.width - origin.width) * p,
      height: origin.height + (target.height - origin.height) * p,
      alpha: t === 1 ? target.alpha : contentOpacity(t, origin.alpha, open),
      expansion: origin.expansion + (target.expansion - origin.expansion) * p,
    };
    if (!open && origin.height > target.height) {
      const ratio = Math.min(
        1,
        Math.max(
          0.35,
          ((origin.width - target.width) / 2 +
            (product.layout.shadowBottom - product.layout.shadowH) *
              origin.expansion) /
            (origin.height - target.height),
        ),
      );
      const hp = p + (1 - ratio) * p * (1 - p);
      geometry.height = origin.height + (target.height - origin.height) * hp;
    }
    const slab = document.querySelector(".slab"),
      content = document.querySelector(".slab-content"),
      g = geometry.expansion,
      gr = g <= 1 ? g : 1 + (g - 1) * 6,
      w = geometry.width,
      h = geometry.height,
      r = 6 + 2 * gr,
      b = Math.min(14 + 8 * gr, h - r);
    slab.style.width = w + "px";
    slab.style.height = h + "px";
    document.querySelector(".slab-face").style.clipPath =
      `path('M 0 0 Q ${r} 0 ${r} ${r} L ${r} ${h - b} Q ${r} ${h} ${r + b} ${h} L ${w - r - b} ${h} Q ${w - r} ${h} ${w - r} ${h - b} L ${w - r} ${r} Q ${w - r} 0 ${w} 0 Z')`;
    content.style.width = targetWidth + "px";
    content.style.transform = `translateX(${(w - targetWidth) / 2}px)`;
    content.style.opacity = geometry.alpha;
    content.style.pointerEvents = geometry.alpha > 0.5 ? "auto" : "none";
    content.inert = geometry.alpha < 0.01;
    content.setAttribute("aria-hidden", String(geometry.alpha < 0.01));
    const collapsed = document.querySelector(".collapsed-ghost");
    collapsed.style.opacity = 1;
    collapsed.style.left = 14 + 2.2 * Math.min(1, g) + "px";
    collapsed.style.top = 4 + 10 * Math.min(1.1, g) + "px";
    collapsed.inert = g > 0.99;
    collapsed.setAttribute("aria-hidden", String(g > 0.99));
    reportFlightTargets();
    if (t < 1) animation = requestAnimationFrame(paint);
    else geometry = target;
  }
  animation = requestAnimationFrame(paint);
}
const row = (label, control) =>
  `<div class="row"><label for="${label}">${t(label)}</label>${control}</div>`;
const check = (key) =>
  row(
    key,
    `<input id="${key}" name="${key}" type="checkbox" ${state.settings[key] ? "checked" : ""}>`,
  );
const select = (name, options, value = state.settings[name]) =>
  `<select id="${name}" name="${name}">${options.map(([v, label]) => `<option value="${escape(v)}" ${String(value) === String(v) ? "selected" : ""}>${escape(label)}</option>`).join("")}</select>`;
const field = (name, label, value = state.settings[name], type = "text") =>
  `<label class="stack">${t(label ?? name)}<input name="${name}" type="${type}" value="${escape(value)}" autocomplete="off"></label>`;
function settings(force = false) {
  if (!force && (dirty || recording)) return;
  const key = JSON.stringify([
    state.settings,
    state.account,
    state.accountSync,
    state.config,
    state.settingsPage,
    state.plus,
    state.update,
  ]);
  if (!force && key === lastSettings) return;
  lastSettings = key;
  const oldScroll = document.querySelector(".settings-scroll");
  if (oldScroll) scrollPositions[settingsPage] = oldScroll.scrollTop;
  const focus = document.activeElement?.name;
  let content = "";
  if (settingsPage === "general")
    content = `<h2>${t("answerStyle")}</h2><div class="group"><div class="reasoning-options" role="radiogroup">${product.reasoningEfforts.map((x) => button("reasoning", `<strong>${t(x)}</strong><small>${t(x + "Hint")}</small>`, `role="radio" aria-checked="${state.settings.reasoning === x}" data-value="${x}"`)).join("")}</div>${row("target", select("target", [[state.settings.target, state.settings.target === "screen" ? t("screen") : state.settings.target]]))}${row(
      "autoCap",
      select(
        "autoCap",
        product.autoCaps.map((n) => [n, n === -1 ? t("unlimited") : String(n)]),
      ),
    )}<p class="muted">${t("capHint")}</p>${check("autoCopy")}</div><h2>${t("presentation")}</h2><div class="group">${row("answerSize", `<input id="answerSize" name="answerSize" type="range" min="10" max="24" step="1" value="${state.settings.answerSize}"><span class="value">${state.settings.answerSize} pt</span>`)}<p class="answer-preview">${t("answer")} A = −30</p>${check("showReasoning")}${check("keepExpanded")}${row("collapseDelay", `<input id="collapseDelay" name="collapseDelay" type="range" min="0" max="30" value="${state.settings.collapseDelay}" ${state.settings.keepExpanded ? "disabled" : ""}><span class="value">${state.settings.collapseDelay} s</span>`)}</div><h2>${t("preferences")}</h2><div class="group">${row(
      "language",
      select("language", [
        ["zh", "简体中文"],
        ["ja", "日本語"],
        ["en", "English"],
      ]),
    )}${check("launchAtLogin")}</div>`;
  if (settingsPage === "shortcuts")
    content = `<p class="muted">${t("shortcutHint")}</p>${[
      ["captureGroup", ["single", "multiple", "personality"]],
      ["sessionGroup", ["auto", "toggle"]],
    ]
      .map(
        ([title, keys]) =>
          `<h2>${t(title)}</h2><div class="group">${keys.map((k) => row(k, button("record", escape(state.settings.hotkeys[k]), `data-value="${k}"`))).join("")}</div>`,
      )
      .join("")}`;
  if (settingsPage === "account") {
    const a = state.account,
      trial = a?.free_trial;
    const sync = state.accountSync ?? { status: "idle" };
    const balance = a?.balance_questions ?? t(sync.status === "loading" ? "accountLoading" : sync.status === "error" ? "accountUnavailable" : "unknown");
    content = `<h2>${t("trial")}</h2><div class="group"><p>${t("trialHelp")}</p>${trial?.status === "eligible" ? button("trial", t("claim"), 'class="primary"') : ""}<div class="row"><div><small>${t("balance")}</small><div class="account-balance">${balance}</div></div>${button("refresh", t(sync.status === "loading" ? "accountLoading" : "refresh"), sync.status === "loading" ? "disabled" : "")}</div>${sync.error ? `<p class="error-message" role="alert">${t("accountRefreshFailed")} ${escape(sync.error)}</p>` : ""}${trial?.status === "active" ? `<p class="muted">${trial.daily_remaining} / ${trial.daily_limit} · ${escape(trial.expires_at)}</p>` : ""}</div><h2>${t("plus")}</h2><div class="group"><p>${state.plus ? escape(t("plus_" + state.plus.status)) : t(sync.status === "loading" ? "accountLoading" : sync.error || sync.plusError ? "accountUnavailable" : "unknown")}</p>${state.plus?.status === "active" ? `<p>${state.plus.daily_remaining} / ${state.plus.daily_limit} · ${escape(state.plus.paid_until)}</p>${state.plus.cancel_at_period_end ? `<p>${t("renewalCanceled")}</p>` : ""}` : ""}<div class="actions">${state.plus?.available && ["inactive", "expired", "pending"].includes(state.plus.status) ? button("plusCheckout", t("subscribe")) : ""}${state.plus?.can_manage ? button("plusPortal", t("manageBilling")) + (!state.plus.cancel_at_period_end ? button("plusCancel", t("cancelRenewal")) : "") : ""}</div></div>${sync.plusError ? `<p class="error-message">${t("subscriptionRefreshFailed")} ${escape(sync.plusError)}</p>` : ""}<h2>${t("extra")}</h2><div class="group">${check("allowPurchasedCredits")}<div class="actions">${(state.config?.payments?.packs ?? []).map((p) => button("purchase", `${p.questions} · ${escape(new Intl.NumberFormat(state.settings.language, { style: "currency", currency: state.config.payments.currency }).format(p.amount_minor / (state.config.payments.currency === "JPY" ? 1 : 100)))}`, `data-value="${p.id}"`)).join("")}</div></div><h2>${t("restore")}</h2><div class="group"><p class="muted">${t("restoreHint")}</p>${button("recoveryCode", t("showCode"))}<pre id="recovery-code"></pre>${field("restoreToken", "recoveryCode", "", "password")}${button("restore", t("restore"))}</div>`;
  }
  if (settingsPage === "personas")
    content = `<h2>${t("personas")}</h2><div class="group"><div class="persona-library">${(state.settings.personas ?? []).map((x) => button("selectPersona", escape(x.name || t("personas")), `data-value="${x.id}" class="${x.id === state.settings.persona.id ? "primary" : ""}"`)).join("")}</div><div class="actions">${button("newPersona", t("newPersona"))}${state.settings.persona.id ? button("deletePersona", t("deletePersona")) : ""}</div></div><div class="group"><p class="muted">${t("personaHint")}</p>${field("personaName", "personaName", state.settings.persona.name)}<label class="stack">${t("personaDescription")}<textarea name="personaDescription">${escape(state.settings.persona.description)}</textarea></label></div>`;
  if (settingsPage === "service")
    content = `<h2>${t("channel")}</h2><div class="group">${row(
      "channel",
      select(
        "channel",
        ["official", "api", "cli"].map((x) => [x, t(x)]),
      ),
    )}</div>${
      state.settings.channel === "api"
        ? `<h2>${t("service")}</h2><div class="group">${row(
            "protocol",
            select("protocol", [
              ["openai", "OpenAI compatible"],
              ["anthropic", "Anthropic Messages"],
            ]),
          )}${field("endpoint")}${field("model")}${field("apiKey", "apiKey", "", "password")}</div>`
        : state.settings.channel === "cli"
          ? `<h2>${t("cli")}</h2><div class="group">${row(
              "cli",
              select("cliKind", [
                ["codex", "Codex"],
                ["claude", "Claude"],
              ]),
            )}${field("cliPath")}</div>`
          : ""
    }`;
  if (settingsPage === "service")
    content += `<h2>${t("updates")}</h2><div class="group"><p>${t("update_" + state.update.status)} ${state.update.version ?? ""} ${state.update.status === "downloading" ? state.update.percent + "%" : ""}</p><p class="muted">${escape(state.update.message)}</p>${button("checkUpdate", t("checkUpdate"), ["unconfigured", "checking", "downloading"].includes(state.update.status) ? "disabled" : "")}${state.update.status === "available" ? button("downloadUpdate", t("downloadUpdate")) : ""}${state.update.status === "downloaded" ? button("installUpdate", t("installUpdate")) : ""}</div>`;
  app.innerHTML = `<div class="settings-shell"><div class="window-dragbar" aria-hidden="true"></div><aside class="sidebar"><div class="logo">NotchSPI</div><div class="muted">${t("settings")}</div><nav>${["general", "shortcuts", "account", "personas", "service"].map((k) => button("page", `<span>${icon(k)}</span>${t(k)}`, `class="${settingsPage === k ? "selected" : ""}" data-value="${k}"`)).join("")}</nav><div class="version">NotchSPI · 3.0${state.dev ? `<div class="dev-banner">${escape(state.dev)}</div>` : ""}</div></aside><section class="settings-main"><header><h1>${t(settingsPage)}</h1><p>${settingsPage === "general" ? t("rhythm") : ""}</p></header><form id="settings-form" class="settings-scroll">${content}</form><div class="settings-footer">${["personas", "service"].includes(settingsPage) ? button("save", t("save")) : ""}<span class="toast" role="status"></span></div></section></div>`;
  document.querySelector(".settings-scroll").scrollTop =
    scrollPositions[settingsPage] ?? 0;
  if (focus)
    document
      .querySelector(`[name="${CSS.escape(focus)}"]`)
      ?.focus({ preventScroll: true });
  if (settingsPage === "general")
    call("targets").then((targets) => {
      const select = document.querySelector("#target");
      if (!select || !Array.isArray(targets)) return;
      select.innerHTML =
        `<option value="screen">${t("screen")}</option>` +
        targets
          .filter((x) => x.id !== "screen")
          .map(
            (x) =>
              `<option value="${escape(x.id)}" ${state.settings.target === x.id ? "selected" : ""}>${escape(x.name)}</option>`,
          )
          .join("");
    });
}
function history() {
  app.innerHTML = `<section class="history-shell"><h1>${t("history")}</h1><p class="muted">${t("historyHint")}</p><div class="actions">${button("clearHistory", t("clear"))}</div><div class="history-list">${state.history.length ? state.history.map((h) => button("readHistory", `${h.images[0] ? `<img src="${escape(h.images[0].thumbnail)}" alt="">` : ""}<div><strong>${escape(h.answer)}</strong><small>${new Date(h.time).toLocaleString(state.settings.language)}${h.resultState === "review" ? " · " + t("review") : ""}</small></div>`, `class="history-item" data-value="${h.id}"`)).join("") : `<p class="muted">${t("historyEmpty")}</p>`}</div><div class="toast"></div></section>`;
}
function receive(next) {
  if (
    next.settingsPage &&
    next.settingsPage !== state?.settingsPage &&
    !dirty
  ) {
    settingsPage = next.settingsPage;
    lastSettings = "";
  }
  state = next;
  document.documentElement.lang = state.settings.language;
  if (page === "notch") notch();
  else if (page === "history") history();
  else settings();
}
async function save() {
  const form = document.querySelector("#settings-form"),
    payload = {};
  for (const input of form?.querySelectorAll("[name]") ?? []) {
    const key = input.name;
    if (key === "restoreToken") continue;
    if (key === "personaName" || key === "personaDescription") {
      payload.persona ??= { ...state.settings.persona };
      payload.persona[key === "personaName" ? "name" : "description"] =
        input.value;
    } else
      payload[key] =
        input.type === "checkbox"
          ? input.checked
          : ["autoCap", "answerSize", "collapseDelay"].includes(key)
            ? Number(input.value)
            : input.value;
  }
  const result = await call("saveSettings", payload);
  if (result?.ok) {
    dirty = false;
    state = await call("state");
    settings(true);
    document.querySelector(".toast").textContent = t("saved");
  }
  return result;
}
document.addEventListener("click", async (event) => {
  const node = event.target.closest("[data-action]");
  if (!node) return;
  const action = node.dataset.action,
    value = node.dataset.value;
  if (action === "page") {
    if (dirty) {
      const result = await save();
      if (!result?.ok) return;
    }
    recording = null;
    await call("recordHotkey", false);
    settingsPage = value;
    settings(true);
    await call("settings", value);
    return;
  }
  if (
    ["newPersona", "selectPersona", "deletePersona"].includes(action) &&
    dirty
  ) {
    const saved = await save();
    if (!saved?.ok) return;
  }
  if (action === "save") {
    await save();
    return;
  }
  if (action === "record") {
    await call("recordHotkey", true);
    recording = value;
    node.textContent = t("recording");
    return;
  }
  if (action === "reasoning") {
    await call("saveSettings", { reasoning: value });
    return;
  }
  if (action === "cycleEffort") {
    await call("saveSettings", {
      reasoning:
        product.reasoningEfforts[
          (product.reasoningEfforts.indexOf(state.settings.reasoning) + 1) % 3
        ],
    });
    return;
  }
  if (action === "menu") {
    menu = !menu;
    notch();
    return;
  }
  if (action === "expand") {
    manualCollapse = false;
    await call("expand", true);
    return;
  }
  if (action === "collapse") {
    manualCollapse = true;
    menu = false;
    await call("expand", false);
    return;
  }
  if (action === "restore") {
    await call("restore", document.querySelector("[name=restoreToken]").value);
    return;
  }
  if (action === "recoveryCode") {
    const token = await call("recoveryCode");
    document.querySelector("#recovery-code").textContent =
      typeof token === "string" ? token : t("unknown");
    return;
  }
  if (action === "copy") {
    await call("copy");
    node.textContent = t("copied");
    return;
  }
  menu = false;
  await call(action, value);
});
document.addEventListener("submit", (e) => e.preventDefault());
document.addEventListener("input", (event) => {
  if (event.target.closest("#settings-form")) dirty = true;
});
document.addEventListener("change", async (event) => {
  if (
    event.target.closest("#settings-form") &&
    ![
      "restoreToken",
      "apiKey",
      "personaName",
      "personaDescription",
      "cliPath",
      "endpoint",
      "model",
    ].includes(event.target.name)
  )
    await save();
});
document.addEventListener("keydown", async (event) => {
  if (recording) {
    event.preventDefault();
    if (event.key === "Escape") {
      recording = null;
      await call("recordHotkey", false);
      settings(true);
      return;
    }
    if (["Control", "Shift", "Alt", "Meta"].includes(event.key)) return;
    const mods = [
      event.ctrlKey ? "Control" : "",
      event.metaKey ? "Command" : "",
      event.altKey ? "Alt" : "",
      event.shiftKey ? "Shift" : "",
    ].filter(Boolean);
    if (!mods.length) return;
    const key = event.code.startsWith("Digit")
      ? event.code.slice(5)
      : event.key === " "
        ? "Space"
        : event.key.toUpperCase();
    const hotkeys = {
      ...state.settings.hotkeys,
      [recording]: [...mods, key].join("+"),
    };
    recording = null;
    await call("saveSettings", { hotkeys });
    settings(true);
    return;
  }
  if (event.key === "Escape") {
    if (state.preview) {
      await call("preview", "");
    } else if (menu) {
      menu = false;
      notch();
    } else if (["running", "streaming", "collecting"].includes(state.status)) {
      await call("cancel");
    } else if (page === "notch") {
      manualCollapse = true;
      await call("expand", false);
    }
  }
  const radio = event.target.closest(".reasoning-options [role=radio]");
  if (radio && ["ArrowRight", "ArrowLeft"].includes(event.key)) {
    event.preventDefault();
    const choices = [...radio.parentElement.children],
      i = choices.indexOf(radio),
      next = choices[(i + (event.key === "ArrowRight" ? 1 : 2)) % 3];
    await call("saveSettings", { reasoning: next.dataset.value });
    document.querySelector(`[data-value="${next.dataset.value}"]`)?.focus();
  }
});
function updatePointer(point) {
  if (page !== "notch" || !state) return;
  const inside = [...document.querySelectorAll(".slab,.notch-menu,.preview")].some(node => containsPoint(node.getBoundingClientRect(), point));
  const modal = Boolean(state.onboarding || state.preview || menu);
  const left = hover && !inside, released = pointerModal && !modal;
  pointerModal = modal;
  if (inside !== hover) {
    hover = inside;
    call("interactive", inside);
    if (inside && !manualCollapse) call("expand", true);
    if (!inside) manualCollapse = false;
  }
  if (inside || !canCollapseOnLeave(state, menu)) {
    clearTimeout(leaveTimer);
    leaveTimer = null;
  } else if ((left || released) && state.expanded && !leaveTimer) {
    leaveTimer = setTimeout(() => {
      leaveTimer = null;
      if (!hover && canCollapseOnLeave(state, menu)) call("expand", false);
    }, pointerExitDelay);
  }
}
document.addEventListener("pointermove", event => updatePointer({x:event.clientX,y:event.clientY}));
document.documentElement.addEventListener("pointerleave", () => updatePointer({x:-1,y:-1}));
window.nspi.onPointer(updatePointer);
window.nspi.onState(receive);
receive(await call("state"));
if (page === "notch") {
  const ready = () => {
    if (
      geometry.alpha >= 0.999 &&
      document.querySelector(".slab-content")?.textContent.trim()
    )
      call("rendered", true);
    else requestAnimationFrame(ready);
  };
  requestAnimationFrame(ready);
}
