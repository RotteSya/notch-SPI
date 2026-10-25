import { LightField } from "./light-field.mjs";
import { installSurface, surfaceTone } from "./surface.mjs";
import { accountHTML, accountPresentation } from "./account.mjs";
import { previewLabels } from "../core/image-preview.mjs";
import { dailyLabels } from "./daily.mjs";
import {
  captureStyle,
  captureIsCompact,
  captureCard,
  landingKeyframes,
  readingScrollPosition,
} from "../generated/ui/capture.mjs";
import { guidePresentation } from "./onboarding.mjs";
import { Ghost } from "../generated/ui/ghost.mjs";
import { readingHTML, personalityStatusText } from "../generated/ui/reading.mjs";
import { containsPoint, canCollapseOnLeave, pointerExitDelay } from "../core/window-behavior.mjs";
import { translate } from "./i18n.mjs";
import { product, spring, close, contentOpacity } from "../core/product.mjs";
import katex from "../node_modules/katex/dist/katex.mjs";
const app = document.querySelector("#app"),
  page = new URLSearchParams(location.search).get("page") ?? "notch";
document.body.className = page;
let lightField,
  previousLightStatus,
  ghostRig,
  previousFlying = new Set(),
  guideTransitionStart = null,
  readingTurn = null,
  readingDetached = false,
  hadFinalAnswer = false,
  hadContentShelf = false,
  shelfRevealStart = null;
let state = null,
  settingsPage = "general",
  selectedPersonaID = null,
  renderedSettingsPage = null,
  pendingAccountFocus = null,
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
  geometry = { width: 200, height: 28, alpha: 0, expansion: 0, depth: 0 };
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
    gear: "M6.7 1h2.6l.4 1.8 1.2.7 1.8-.6 1.3 2.2-1.4 1.3v1.4l1.4 1.3-1.3 2.2-1.8-.6-1.2.7-.4 1.8H6.7l-.4-1.8-1.2-.7-1.8.6L2 9.1l1.4-1.3V6.4L2 5.1l1.3-2.2 1.8.6 1.2-.7L6.7 1M10.4 7.1a2.4 2.4 0 1 1-4.8 0 2.4 2.4 0 1 1 4.8 0",
    down: "M3 6l5 5 5-5",
    history: "M3 5A6 6 0 1 1 2 9M1 2v4h4M8 4v4l3 2",
    shortcuts: "M3 3h10q2 0 2 2v6q0 2-2 2H3q-2 0-2-2V5q0-2 2-2M4 6h.1M6.7 6h.1M9.3 6h.1M12 6h.1M4 8h.1M6.7 8h.1M9.3 8h.1M12 8h.1M5 10h6",
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
  const mac=state.platform==='darwin';
  const labels={CommandOrControl:mac?'⌘':'Ctrl',Command:mac?'⌘':'Win',Control:mac?'⌃':'Ctrl',Alt:mac?'⌥':'Alt',Shift:mac?'⇧':'Shift'};
  const parts=raw.split('+').map(x=>labels[x]??x);
  if(mac){const order=['⌃','⌥','⇧','⌘'];parts.sort((a,b)=>(order.includes(a)?order.indexOf(a):9)-(order.includes(b)?order.indexOf(b):9));}
  return parts.map(x=>`<kbd>${escape(x)}</kbd>`).join('');
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
function notch() {
  if (!document.querySelector(".slab"))
    app.innerHTML =
      '<div class="slab"><div class="slab-face"><div class="slab-background"></div><div class="slab-content"></div><button class="collapsed-ghost" data-action="expand" aria-label="Expand notch"></button></div></div><div id="overlays"></div>';
  const surface = document.querySelector(".slab-background");
  if (!surface.firstChild) { installSurface(surface); lightField = new LightField(surface); }
  const lightStatus = state.status === "done" ? "ready" : state.status;
  const landed = [...previousFlying].some(id => !state.flying?.includes(id));
  lightField.update(lightStatus, geometry.depth, geometry.width, geometry.height, landed || (previousLightStatus === "streaming" && state.status === "done"));
  previousLightStatus = lightStatus;
  const content = document.querySelector(".slab-content");
  const daily = dailyLabels(state);
  const newReadingTurn = readingTurn !== state.readingTurn;
  if (newReadingTurn) { readingDetached = false; hadFinalAnswer = false; }
  readingTurn = state.readingTurn;
  const oldHeading = content.querySelector(".status")?.textContent;
  const priorGuideStep = content.dataset.guideStep;
  const guideUI = state.onboarding ? guidePresentation(state, name => {
    const parts = state.settings.hotkeys[name].split("+");
    if (state.platform === "darwin") {
      const modifiers = ["Control", "Alt", "Shift", "CommandOrControl", "Command"];
      parts.sort((a,b) => (modifiers.includes(a) ? modifiers.indexOf(a) : 99) - (modifiers.includes(b) ? modifiers.indexOf(b) : 99));
    }
    const labels = state.platform === "darwin" ? { Control: "⌃", Alt: "⌥", Shift: "⇧", CommandOrControl: "⌘", Command: "⌘" } : { Control: "Ctrl", CommandOrControl: "Ctrl", Shift: "Shift", Alt: "Alt" };
    return parts.map(key => `<kbd>${escape(labels[key] ?? key)}</kbd>`).join("");
  }) : null;
  content.classList.toggle("guide-active", Boolean(guideUI));
  content.classList.toggle("guide-live", Boolean(guideUI && state.guide.live));
  content.dataset.guideStep = guideUI ? state.guide.step : "";
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
  const focusedValue = document.activeElement?.dataset?.value;
  const workingOpen =
    content.querySelector("details")?.open ?? state.settings.showReasoning;
  let body = "";
  if (state.onboarding && !state.guide.live) {
    body = guideUI.body;
  } else if (state.collecting) {
    body = "";
  } else if (daily.messageFirst) {
    body = `<p class="${state.status === "error" ? "error-message" : "muted"}" role="status">${escape(state.status === "canceled" ? daily.canceledMessage : state.message ? t(state.message) : t(state.status === "retake" ? "retakeHelp" : state.status))}</p>`;
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
  const personalityLabel = state.mode === "personality" && state.personalityNotice && ["done", "error"].includes(state.status)
    ? personalityStatusText(state.personalityNotice.primary, { ...state.personalityNotice, language: state.settings.language })
    : null;
  if (personalityLabel) {
    const notice = `<p class="${state.status === "error" ? "error-message" : "muted"}" role="status" data-personality-notice>${escape(personalityLabel)}</p>`;
    const primary = personalityStatusText(state.personalityNotice.primary, { language: state.settings.language });
    body = state.status === "error" && !state.answer && state.message === primary ? notice : notice + body;
  }
  const material =
    (state.images.length || state.collecting) && (!state.onboarding || state.guide.live)
      ? `<div class="material-strip ${captureIsCompact(state) ? "compact" : "collecting"}">${state.images.map((x, i) => `<div class="thumb">${button("preview", `<img src="${escape(x.thumbnail)}" alt="${t("preview")} ${i + 1}">`, `class="photo-card" data-flight-id="${x.id}" style="opacity:${state.flying?.includes(x.id) ? 0 : 1}" data-value="${x.id}" aria-label="${t("preview")} ${i + 1}"`)}${state.collecting ? `<span class="ordinal">${i + 1}</span>` : ""}${state.collecting && !state.flying?.includes(x.id) ? button("remove", "×", `${daily.canEditImages ? "" : "disabled"} class="remove" data-value="${x.id}" aria-label="${t("remove")} ${i + 1}"`) : ""}</div>`).join("")}${daily.nextSlot ? `<div class="next-capture" aria-hidden="true"><span>＋</span>${escape(daily.next)}</div>` : ""}${state.collecting ? "" : `<span class="image-count">${escape(daily.count)}</span>`}</div>`
      : "";
  let actions = "";
  if (["running", "streaming"].includes(state.status))
    actions = button("cancel", t("cancel"));
  if (state.collecting) actions = "";
  if (state.status === "done" && state.answer)
    actions = state.canExplain ? button("explain", t("explain")) : "";
  if (["error", "canceled"].includes(state.status))
    actions =
      (state.canCheckSettlement ? button("status", t("status"), `title="${t("statusHint")}"`) : "") +
      (state.canRecover ? button("recover", t("recover")) : "") +
      (state.canRetry ? button("retry", t("retry")) : "");
  if (state.onboarding && ["retake", "empty"].includes(state.status))
    actions = button("capture", t("single"), 'data-value="single"');
  if (!state.onboarding && ["error", "retake", "empty"].includes(state.status))
    actions += button("capture", t("multiple"), 'data-value="multiple"') + button("capture", t("single"), 'data-value="single"') + button("clearQuestion", daily.clear);
  if (state.status === "done" && state.message)
    body += `<p class="error-message" role="status">${escape(t(state.message))}</p>`;
  if (state.settlement)
    body += `<p class="muted">${t("settlement_" + state.settlement.status)}${state.settlement.charged == null ? "" : " · " + state.settlement.charged + " " + t("charged")}</p>`;
  if (state.onboarding && !state.guide.live) actions = "";
  const guideFooter = guideUI?.footer ?? "";
  const outsideActions = !state.onboarding && !state.collecting && Boolean(actions);
  const trayHeader = state.collecting ? `<div class="capture-toolbar"><span>${escape(daily.count)}</span><span class="spacer"></span>${button("submit", t("submit"), daily.canSubmit ? "" : "disabled")}${button("cancel", daily.cancel)}</div>` : "";
  const trayFooter = state.collecting ? `<div class="capture-progress" ${daily.progress === null ? 'hidden' : ''}><span style="width:${(daily.progress ?? 0)*100}%"></span></div><div class="capture-hint"><span>${escape(daily.hint)}</span>${state.undo ? button("undo", t("undo"), daily.canEditImages ? "" : "disabled") : ""}</div>` : "";
  content.innerHTML = `${guideUI?.header ?? `<div class="slab-header"><span class="ghost-slot"></span><div><div class="brand">NotchSPI</div><div class="status" role="status">${escape(daily.heading ?? t(state.status))}</div></div><span class="spacer"></span>${button(state.auto.active ? "auto" : "cycleEffort", state.auto.active ? escape(daily.auto) : t(state.settings.reasoning), 'class="effort"')}${button("collapse", icon("down"), `aria-label="${t("collapse")}"`)}${button("menu", icon("gear"), `aria-label="${t("settings")}"`)}</div>`}<div class="shelf ${state.collecting ? "capture-shelf" : ""}">${trayHeader}${body}${material}${trayFooter}${actions && !outsideActions ? `<div class="actions">${actions}</div>` : ""}${guideFooter}</div>${outsideActions ? `<div class="actions daily-actions">${actions}</div>` : ""}`;
  if (!guideUI && oldHeading && oldHeading !== (daily.heading ?? t(state.status)) && !matchMedia("(prefers-reduced-motion:reduce)").matches)
    content.querySelector(".status")?.animate([{opacity:0},{opacity:1}],{duration:160,easing:"ease-in-out"});
  if (!guideUI) guideTransitionStart = null;
  else if (priorGuideStep && priorGuideStep !== state.guide.step) guideTransitionStart = performance.now();
  if (guideUI && guideTransitionStart !== null && !matchMedia("(prefers-reduced-motion:reduce)").matches) {
    const elapsed = performance.now() - guideTransitionStart;
    if (elapsed < 240) for (const node of content.querySelectorAll(".guide-copy,.guide-primary,.guide-footer.live > p")) {
      const fade = node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: "cubic-bezier(.22,.68,0,1)" });
      fade.currentTime = elapsed;
    }
    if (elapsed < 560) for (const node of content.querySelectorAll(".guide-reveal")) {
      const reveal = node.animate([{ opacity: .25, transform: "translateY(7px)" }, { opacity: 1, transform: "translateY(0)" }], { duration: 560, easing: "cubic-bezier(.33,1,.68,1)" });
      reveal.currentTime = elapsed;
    }
  }
  content.style.setProperty("--answer-size", state.settings.answerSize + "px");
  layoutCaptureCards();
  const hasContentShelf = !state.collecting && Boolean(state.answer || state.working);
  if (hasContentShelf && !hadContentShelf) shelfRevealStart = performance.now();
  if (!hasContentShelf) shelfRevealStart = null;
  if (shelfRevealStart !== null && !matchMedia("(prefers-reduced-motion:reduce)").matches) {
    const elapsed = performance.now() - shelfRevealStart;
    if (elapsed < captureStyle.referenceDuration * 1000) {
      const reveal = content.querySelector(".shelf")?.animate([{opacity:0},{opacity:1}], {duration:captureStyle.referenceDuration*1000,easing:"ease-in-out"});
      if (reveal) reveal.currentTime = elapsed;
    }
  }
  hadContentShelf = hasContentShelf;
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
  if (next) {
    next.tabIndex = 0;
    next.setAttribute("aria-label", t("answer"));
    next.scrollTop = readingScrollPosition({previous:scroll,maximum:Math.max(0,next.scrollHeight-next.clientHeight),newTurn:newReadingTurn,firstAnswer:Boolean(state.answer)&&!hadFinalAnswer,detached:readingDetached,streaming:state.status === "streaming",hasAnswer:Boolean(state.answer),atEnd});
  }
  hadFinalAnswer = Boolean(state.answer);
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
  overlays.innerHTML = menu
      ? `<div class="notch-menu" role="menu">${["single", "multiple", "personality"].map((k) => button("capture", t(k), `data-value="${k}"`)).join("")}${state.auto.reviewPending ? button("confirmAutoReview", daily.reviewContinue) : ""}${button("auto", t("auto"))}${button("import", t("import"))}${button("history", t("history"))}${button("settings", t("settings"), 'data-value="general"')}${button("guideResume", state.settings.language === "zh" ? "使用引导" : state.settings.language === "ja" ? "使い方" : "Start guide")}${button("quit", t("quit"))}</div>`
      : "";
  if (state.dev)
    overlays.insertAdjacentHTML(
      "beforeend",
      `<div class="fixture-label">${escape(state.dev)}${state.qaPinned && !state.onboarding ? button("qaMotion", "Replay flight", 'data-value="flight"') + button("qaMotion", "Ghost: working", 'data-value="working"') + button("qaMotion", "Ghost: complete", 'data-value="done"') : ""}</div>`,
    );
  if (focused) {
    const node = [...document.querySelectorAll("[data-action]")].find(
      (x) => x.dataset.action === focused && x.dataset.value === focusedValue && !x.disabled && !x.closest("[inert]") && x.getClientRects().length,
    );
    (node ?? (guideUI ? content.querySelector(".guide-primary:not(:disabled),.guide-back,.guide-dismiss") : null))?.focus({ preventScroll: true });
  }
  // Presentation offsets must not feed back into the next layout measurement.
  content.style.setProperty("--guide-action-shift", "0px");
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
  const placeholder = document.querySelector(".next-capture");
  if (placeholder) placeholder.style.width = Math.min(captureStyle.cardWidth,(placeholder.parentElement.clientWidth-3*captureStyle.cardGap)/4)+"px";
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
      depth: open ? 1 : 0,
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
      depth: origin.depth + (target.expansion - origin.depth) * (1 - (1 - t) ** 3),
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
    const contour = `M 0 0 Q ${r} 0 ${r} ${r} L ${r} ${h - b} Q ${r} ${h} ${r + b} ${h} L ${w - r - b} ${h} Q ${w - r} ${h} ${w - r} ${h - b} L ${w - r} ${r} Q ${w - r} 0 ${w} 0 Z`;
    document.querySelector(".slab-face").style.clipPath = `path('${contour}')`;
    lightField.update(state.status === "done" ? "ready" : state.status, geometry.depth, w, h);
    const tone = surfaceTone(geometry.depth);
    slab.style.setProperty("--surface-sheen", tone.sheen);
    slab.style.setProperty("--surface-edge-alpha", tone.edge);
    slab.style.filter = `drop-shadow(0 9px 8px rgba(0,0,0,${.55*tone.shadow})) drop-shadow(0 2px 2.5px rgba(0,0,0,${.38*tone.shadow}))`;
    document.querySelector(".surface-edge path").setAttribute("d", contour);
    content.style.setProperty("--guide-action-shift", state.onboarding ? `${geometry.height - height}px` : "0px");
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
    state.accountBusy,
    state.accountActionError,
    state.config,
    state.settingsPage,
    state.plus,
    state.update,
  ]);
  if (!force && key === lastSettings) return;
  lastSettings = key;
  document.title = t(settingsPage);
  const oldScroll = document.querySelector(".settings-scroll");
  if (oldScroll && renderedSettingsPage) scrollPositions[renderedSettingsPage] = oldScroll.scrollTop;
  const previousFocus = document.activeElement;
  const focus = previousFocus?.name;
  const focusAction = previousFocus?.dataset?.action;
  const focusValue = previousFocus?.dataset?.value;
  const navigating = renderedSettingsPage !== settingsPage;
  renderedSettingsPage = settingsPage;
  let content = "";
  if (settingsPage === "general")
    content = `<h2>${t("answerStyle")}</h2><div class="group"><div class="reasoning-options" role="radiogroup">${product.reasoningEfforts.map((x) => button("reasoning", `<strong>${t(x)}</strong><small>${t(x + "Hint")}</small>`, `role="radio" aria-checked="${state.settings.reasoning === x}" data-value="${x}"`)).join("")}</div>${row("target", select("target", [[state.settings.target, state.settings.target === "screen" ? t("screen") : state.settings.target]]))}${row(
      "autoCap",
      select(
        "autoCap",
        product.autoCaps.map((n) => [n, n === -1 ? t("unlimited") : String(n)]),
      ),
    )}<p class="muted">${t("capHint")}</p>${check("autoCopy")}</div><h2>${t("presentation")}</h2><div class="group">${row("answerSize", `<input id="answerSize" name="answerSize" type="range" min="11" max="19" step="1" value="${state.settings.answerSize}"><span class="value">${state.settings.answerSize} pt</span>`)}<p class="answer-preview" style="font-size:${state.settings.answerSize+4}px !important">${t("answer")} A = −30</p>${check("showReasoning")}${check("keepExpanded")}${row("collapseDelay", `<input id="collapseDelay" name="collapseDelay" type="range" min="2" max="30" value="${state.settings.collapseDelay}" ${state.settings.keepExpanded ? "disabled" : ""}><span class="value">${state.settings.collapseDelay} ${t("secondsUnit")}</span>`)}</div><h2>${t("preferences")}</h2><div class="group">${row(
      "languageMode",
      select("languageMode", [
        ["system", t("systemLanguage")],
        ["zh", "简体中文"],
        ["ja", "日本語"],
        ["en", "English"],
      ],state.settings.languageMode??state.settings.language),
    )}${check("launchAtLogin")}<p class="muted login-hint">${t("loginHint")}</p>${check("reliabilitySharing")}<p class="muted">${t("reliabilityHint")}</p></div>`;
  if (settingsPage === "shortcuts")
    content = [['captureGroup',['single','multiple','personality']],['sessionGroup',['toggle','auto']]].map(([title,keys])=>`<h2>${t(title)}</h2><div class="group shortcut-group">${keys.map(k=>`<div class="shortcut-row"><div><label>${t(k==='toggle'?'shortcutToggle':k==='auto'?'shortcutAuto':k)}</label>${['single','multiple','personality'].includes(k)?`<p>${t('shortcutDetail_'+k)}</p>`:''}</div>${button('record',shortcut(k),`data-value="${k}" aria-label="${t(k)}"`)}</div>`).join('')}</div>`).join('')+`<p class="shortcut-rule">${t('shortcutRule')}</p><p class="shortcut-hint">${t('shortcutHint')} ${state.platform==='darwin'?'⌘ / ⇧ / ⌥ / ⌃':'Ctrl / Shift / Alt / Win'}</p>`;
  if (settingsPage === "account") content = accountHTML(state,{button,escape,check,t});
  if (settingsPage === "personas") {
    const library = state.settings.personas ?? [];
    if (!library.some(x=>x.id===selectedPersonaID)) selectedPersonaID = state.settings.persona.id || library[0]?.id || null;
    const selected=library.find(x=>x.id===selectedPersonaID);
    content = !selected ? `<div class="persona-empty"><div class="persona-empty-icon">${icon('personas')}</div><p>${t('personaEmpty')}</p>${button('newPersona',t('newPersona'),'class="primary"')}</div>` : `<div class="persona-columns"><section><h2>${t('personaLibrary')}</h2><div class="group"><div class="persona-library" role="listbox" aria-label="${t('personaLibrary')}">${library.map(x=>button('editPersona',`<span class="persona-active">${x.id===state.settings.persona.id?'●':''}</span><span class="persona-list-name">${escape(x.name||t('personaUntitled'))}</span>`,`role="option" aria-selected="${x.id===selectedPersonaID}" data-value="${escape(x.id)}"`)).join('')}</div><div class="actions">${button('newPersona','＋',`aria-label="${t('newPersona')}" title="${t('newPersona')}"`)}${button('deletePersona','－',`aria-label="${t('deletePersona')}" title="${t('deletePersona')}" data-value="${escape(selected.id)}"`)}</div></div></section><section><h2>${t('personaEdit')}</h2><div class="group persona-editor"><input name="personaName" aria-label="${t('personaName')}" placeholder="${t('personaPlaceholder')}" value="${escape(selected.name)}"><label for="persona-description">${t('personaDescription')}</label><textarea id="persona-description" name="personaDescription" aria-label="${t('personaDescription')}">${escape(selected.description)}</textarea>${button('selectPersona',t(selected.id===state.settings.persona.id?'personaInUse':'personaUse'),`class="primary" data-value="${escape(selected.id)}" ${selected.id===state.settings.persona.id?'disabled':''}`)}<p>${t('personaExample')}</p></div></section></div>`;
  }
  if (settingsPage === "service")
    content = `<h2>${t("channel")}</h2><div class="group service-options" role="radiogroup">${["official","api",...(state.account?.cli_enabled || state.settings.channel==='cli' ? ["cli"]:[])].map(x=>button("channel",`<strong>${t(x)}</strong><small>${t(x+'ServiceHint')}</small>`,`role="radio" aria-checked="${state.settings.channel===x}" data-value="${x}"`)).join('')}</div>${
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
  app.innerHTML = `<div class="settings-shell"><div class="window-dragbar" aria-hidden="true"></div><aside class="sidebar"><div class="logo">NotchSPI</div><div class="muted">${t("settings")}</div><nav role="radiogroup" aria-label="${t("settings")}">${["general", "shortcuts", "account", "personas", "service"].map((k) => button("page", `<span>${icon(k)}</span>${t(k)}`, `role="radio" aria-checked="${settingsPage === k}" class="${settingsPage === k ? "selected" : ""}" data-value="${k}"`)).join("")}</nav><div class="version">NotchSPI · 3.0${state.dev ? `<div class="dev-banner">${escape(state.dev)}</div>` : ""}</div></aside><section class="settings-main" data-settings-page="${settingsPage}"><header><h1>${t(settingsPage)}</h1><p>${settingsPage === "general" ? t("rhythm") : settingsPage === "account" ? t("accountSubtitle") : settingsPage === "service" ? t("serviceSubtitle") : settingsPage === "personas" ? t("personaSubtitle") : settingsPage === "shortcuts" ? t("shortcutSubtitle") : ""}</p></header><form id="settings-form" class="settings-scroll">${content}</form><div class="settings-footer"><span class="toast" role="status"></span></div></section></div>`;
  document.querySelector(".settings-scroll").scrollTop =
    scrollPositions[settingsPage] ?? 0;
  if (!navigating && focus)
    document
      .querySelector(`[name="${CSS.escape(focus)}"]`)
      ?.focus({ preventScroll: true });
  const accountFocusTarget = () => ['plusPortal','plusCheckout','refresh'].map(action=>document.querySelector(`.subscription [data-action="${action}"]:not(:disabled)`)).find(Boolean);
  const selectedRow = document.querySelector('.sidebar [data-value="'+settingsPage+'"]');
  if (navigating) {
    pendingAccountFocus=null;
    selectedRow?.focus({preventScroll:true});
    if (!matchMedia('(prefers-reduced-motion:reduce)').matches) document.querySelector('.settings-main')?.animate([{opacity:.65},{opacity:1}],{duration:120,easing:'ease-in-out'});
  } else if (focusAction) {
    const controls=[...document.querySelectorAll('[data-action]')];
    const same=controls.find(n=>n.dataset.action===focusAction && n.dataset.value===focusValue && !n.disabled);
    if(!same && settingsPage==='account' && focusAction!=='page') pendingAccountFocus=focusAction;
    (same ?? (settingsPage==='account'?accountFocusTarget():null) ?? selectedRow)?.focus({preventScroll:true});
  }
  if (settingsPage==='account') {
    if(pendingAccountFocus && !accountPresentation(state).busy) {
      const target=document.querySelector(`[data-action="${pendingAccountFocus}"]:not(:disabled)`) ?? accountFocusTarget();
      target?.focus({preventScroll:true});pendingAccountFocus=null;
    }
    const spend=document.querySelector('[name="allowPurchasedCredits"]');
    if(spend) spend.disabled=accountPresentation(state).busy||accountPresentation(state).external;
  }
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
function imagePreview() {
  const labels = previewLabels(state);
  document.title = labels.title;
  app.innerHTML = `<main class="image-preview"><img src="${escape(state.preview ?? "")}" alt="${escape(labels.title)}"><p>${escape(labels.hint)}</p></main>`;
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
  else if (page === "preview") imagePreview();
  else settings();
}
async function save() {
  const form = document.querySelector("#settings-form"),
    payload = {};
  for (const input of form?.querySelectorAll("[name]") ?? []) {
    const key = input.name;
    if (key === "restoreToken") continue;
    if (key === "personaName" || key === "personaDescription") {
      payload.persona ??= { ...(state.settings.personas ?? []).find(x=>x.id===selectedPersonaID) };
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
  const result = payload.persona ? await call("updatePersona",payload.persona) : await call("saveSettings", payload);
  if (result?.ok) {
    dirty = false;
    state = await call("state");
    settings(true);
    document.querySelector(".toast").textContent = t("saved");
  }
  return result;
}
document.addEventListener("contextmenu", async event => {
  if (event.target.closest(".reading")) {
    event.preventDefault();
    await call("answerMenu");
  }
});
for (const eventName of ["wheel", "pointerdown", "keydown"]) document.addEventListener(eventName, event => {
  const reading = event.target.closest?.(".reading");
  if (reading && (eventName !== "keydown" || ["ArrowDown","ArrowUp","PageDown","PageUp","Home","End"," "].includes(event.key))) {
    readingDetached = true;
    requestAnimationFrame(() => {
      if (reading.isConnected) readingDetached = reading.scrollTop < reading.scrollHeight - reading.clientHeight - 12;
    });
  }
});
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
  if (["newPersona", "editPersona", "selectPersona", "deletePersona"].includes(action)) {
    if (dirty) { const saved=await save(); if(!saved?.ok) return; }
    if(action==='editPersona') { selectedPersonaID=value; settings(true); document.querySelector(`[data-action="editPersona"][data-value="${CSS.escape(value)}"]`)?.focus({preventScroll:true}); return; }
    const result=await call(action,value);
    if(result?.ok) {
      state=await call('state');
      if(action==='newPersona') selectedPersonaID=state.settings.personas.at(-1)?.id;
      if(action==='deletePersona') selectedPersonaID=state.settings.personas[0]?.id;
      settings(true);
      if(action==='newPersona') { const input=document.querySelector('[name="personaName"]');input?.focus();input?.select(); }
    }
    return;
  }
  if (action === "save") {
    await save();
    return;
  }
  if (action === "record") {
    await call("recordHotkey", true);
    document.querySelector('[data-recording]')?.removeAttribute('data-recording');
    if(recording) {const old=document.querySelector(`[data-action="record"][data-value="${recording}"]`);if(old)old.innerHTML=shortcut(recording);}
    recording = value;
    node.dataset.recording='true';node.focus();
    node.textContent = t("recording");
    return;
  }
  if (action === "channel") {
    if(dirty) { const result=await save(); if(!result?.ok)return; }
    await call("saveSettings",{channel:value});return;
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
  if (action === "purchaseSelected") {
    await call("purchase",document.querySelector('#purchase-pack')?.value); return;
  }
  if (action === "openRestore" || action === "recoveryCode") {
    const dialog=document.createElement('dialog');
    dialog.className='account-dialog';
    const label=action==='openRestore'?t('restoreExisting'):t('saveRecovery');
    dialog.innerHTML=`<h2>${escape(label)}</h2><p>${t(action==='openRestore'?'restoreHint':'recoveryWarning')}</p><input type="${action==='openRestore'?'password':'text'}" aria-label="${t('recoveryCode')}" ${action==='recoveryCode'?'readonly':''}><p role="alert"></p><div class="actions"><button type="button" data-dialog-close>${t(action==='openRestore'?'cancel':'close')}</button>${action==='openRestore'?`<button type="button" data-dialog-restore>${t('verifyRestore')}</button>`:''}</div>`;
    document.body.append(dialog); dialog.showModal();
    const input=dialog.querySelector('input'); input.focus();
    const finish=()=>{input.value='';dialog.remove();document.querySelector(`[data-action="${action}"]`)?.focus();};
    dialog.addEventListener('close',finish,{once:true});
    dialog.querySelector('[data-dialog-close]').onclick=()=>dialog.close();
    if(action==='recoveryCode') { const token=await call('recoveryCode'); if(dialog.isConnected) input.value=typeof token==='string'?token:''; }
    else dialog.querySelector('[data-dialog-restore]').onclick=async()=>{
      const submit=dialog.querySelector('[data-dialog-restore]'); submit.disabled=true;
      const result=await call('restore',input.value);
      if(result?.ok) dialog.close(); else {submit.disabled=false;dialog.querySelector('[role=alert]').textContent=result?.error??t('unknown');input.focus();}
    };
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
document.addEventListener('dblclick',async event=>{
  const row=event.target.closest('[data-action="editPersona"]');
  if(row) await call('selectPersona',row.dataset.value);
});
document.addEventListener("input", (event) => {
  if(['answerSize','collapseDelay'].includes(event.target.name)) {
    const value=Number(event.target.value);
    const readout=event.target.closest('.row')?.querySelector('.value');
    if(readout)readout.textContent=value+(event.target.name==='answerSize'?' pt':' '+t('secondsUnit'));
    if(event.target.name==='answerSize') document.querySelector('.answer-preview')?.style.setProperty('font-size',(value+4)+'px','important');
  }
  if (['personaName','personaDescription'].includes(event.target.name)) {
    const selected=(state.settings.personas??[]).find(x=>x.id===selectedPersonaID);
    if(selected) {
      const key=event.target.name==='personaName'?'name':'description';
      selected[key]=key==='name'?event.target.value.trim():event.target.value;
      dirty=true;
      // Keep the live editor/caret intact while persisting every edit, as on Mac.
      call('updatePersona',{...selected});
      const row=[...document.querySelectorAll('[data-action="editPersona"]')].find(n=>n.dataset.value===selected.id);
      if(row) row.querySelector('.persona-list-name').textContent=selected.name||t('personaUntitled');
    }
    return;
  }
  if (event.target.closest("#settings-form") && event.target.name) dirty = true;
});
document.addEventListener("change", async (event) => {
  if(event.target.name==='reliabilitySharing') {
    const result=await call('setReliability',event.target.checked);
    if(result?.ok){dirty=false;state=await call('state');settings(true);}
    return;
  }
  if (event.target.name === "guideLanguage") {
    await call("saveSettings", { language: event.target.value });
    return;
  }
  if (
    event.target.closest("#settings-form") && event.target.name &&
    event.target.name !== "restoreToken"
  )
    await save();
});
document.addEventListener("keydown", async (event) => {
  if (page === "settings" && !recording) {
    if (document.querySelector('dialog[open]')) return;
    const personaRow=event.target.closest('[data-action="editPersona"]');
    if(personaRow && ['ArrowUp','ArrowDown','Enter'].includes(event.key)) {
      event.preventDefault();
      if(event.key==='Enter') { await call('selectPersona',personaRow.dataset.value);return; }
      const rows=[...document.querySelectorAll('[data-action="editPersona"]')];
      const next=rows[Math.max(0,Math.min(rows.length-1,rows.indexOf(personaRow)+(event.key==='ArrowDown'?1:-1)))];next?.click();return;
    }
    const row=event.target.closest('.sidebar [data-action="page"]');
    if(row && ['ArrowUp','ArrowDown'].includes(event.key)) {
      event.preventDefault(); const rows=[...document.querySelectorAll('.sidebar [data-action="page"]')];
      rows[Math.max(0,Math.min(rows.length-1,rows.indexOf(row)+(event.key==='ArrowDown'?1:-1)))].click(); return;
    }
    if(event.key==='Escape') return; // Native settings does not cancel the question behind it.
  }

  if (page === "preview") {
    if (event.key === "Escape") { event.preventDefault(); await call("preview", ""); }
    else if (["Delete", "Backspace"].includes(event.key) && state.collecting && !state.capturing) {
      event.preventDefault(); await call("remove", state.previewID);
    }
    return;
  }
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
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c" && event.target.closest?.(".reading") && !String(window.getSelection())) {
    event.preventDefault(); await call("copy"); return;
  }
  if (event.key === "Tab" && page === "notch" && state.onboarding && !state.preview) {
    const selectors = [".guide-primary", ".material-strip button", ".guide-secondary", ".guide-target", ".guide-back", ".guide-dismiss", ".guide-language"];
    const controls = selectors.flatMap(selector => [...document.querySelectorAll(selector)]).filter(node => !node.disabled && node.getClientRects().length);
    if (controls.length) {
      event.preventDefault();
      const current = controls.indexOf(document.activeElement);
      controls[(current < 0 ? (event.shiftKey ? controls.length - 1 : 0) : (current + (event.shiftKey ? -1 : 1) + controls.length) % controls.length)].focus({ preventScroll: true });
    }
    return;
  }
  if (event.key === "Escape") {
    if (page === "notch" && state.onboarding && !state.preview) {
      event.preventDefault();
      await call("guideDismiss");
      return;
    }
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
  const radio = event.target.closest(".reasoning-options [role=radio],.service-options [role=radio]");
  if (radio && ["ArrowRight", "ArrowLeft"].includes(event.key)) {
    event.preventDefault();
    const choices = [...radio.parentElement.children],
      i = choices.indexOf(radio),
      next = choices[(i + (event.key === "ArrowRight" ? 1 : choices.length-1)) % choices.length];
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
