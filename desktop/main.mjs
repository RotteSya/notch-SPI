import { canCopyAnswer, personalityStatusText } from "./generated/ui/reading.mjs";
import { Onboarding } from "./generated/ui/onboarding.mjs";
import { practiceHTML } from "./core/practice.mjs";
import { billingDestination } from "./core/platform-actions.mjs";
import {
  app,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  screen,
  Menu,
  Tray,
  nativeImage,
  clipboard,
  dialog,
  shell,
  nativeTheme,
  systemPreferences,
} from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Vault, LocalStore } from "./platform/storage.mjs";
import { QuestionHistory } from "./platform/history.mjs";
import { createUpdater } from "./platform/updater.mjs";
import { createCaptureVisibility } from "./platform/capture-visibility.mjs";
import { createCaptureExclusion, requireCaptureExclusionSupport } from "./platform/capture-exclusion.mjs";
import { canQueryCapture } from "./core/window-behavior.mjs";
import { createFlights } from "./platform/flights.mjs";
import { capture, listTargets, fromFile } from "./platform/capture.mjs";
import { OfficialClient } from "./core/official.mjs";
import { directAPI, localCLI } from "./core/providers.mjs";
import { Intake, product } from "./core/product.mjs";
import { compose, parseAnswer, personality } from "./core/answer.mjs";
import { AutoSession, PersonaSession } from "./core/sessions.mjs";
const root = path.dirname(fileURLToPath(import.meta.url));
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? null : process.argv[i + 1];
};
const captureSmoke = process.argv.includes("--capture-smoke");
const motionSmoke = process.argv.includes("--motion-smoke") || captureSmoke;
const development = Boolean(arg("--dev-base")),
  qa = arg("--qa") ?? (motionSmoke ? "motion" : null),
  smoke = process.argv.includes("--smoke") || motionSmoke;
if (app.isPackaged && (development || qa || smoke))
  throw new Error("Development flags are unavailable in packaged builds");
if (development || qa || smoke)
  app.setPath(
    "userData",
    path.join(os.tmpdir(), smoke
      ? `notchspi-desktop-smoke-${captureSmoke ? "capture" : qa ?? "launch"}`
      : "notchspi-desktop-development"),
  );
let pendingBilling = process.argv.find((value) => billingDestination(value)),
  routeBilling = null;
app.on("open-url", (event, url) => {
  if (billingDestination(url)) {
    event.preventDefault();
    if (routeBilling) routeBilling(url);
    else pendingBilling = url;
  }
});
if (!app.requestSingleInstanceLock()) {
  app.exit(smoke ? 1 : 0);
} else {
  if (smoke)
    setTimeout(() => {
      console.error("Renderer readiness timed out");
      app.exit(1);
    }, captureSmoke ? 45000 : 15000).unref();
  app
    .whenReady()
    .then(start)
    .catch((error) => {
      console.error(error.message);
      app.exit(1);
    });
}
async function start() {
  if (captureSmoke && process.platform !== "win32") {
    console.log("NSPI_CAPTURE_PIXELS_SKIPPED: Windows interactive desktop required");
    app.exit(0);
    return;
  }
  const local = new LocalStore(app.getPath("userData")),
    vault = new Vault(
      app.getPath("userData"),
      development || Boolean(qa) || smoke,
    );
  const defaults = {
    language: "zh",
    reasoning: "low",
    channel: "official",
    target: "screen",
    autoCap: 20,
    autoCopy: false,
    launchAtLogin: false,
    keepExpanded: false,
    collapseDelay: 4,
    answerSize: 13,
    showReasoning: false,
    allowPurchasedCredits: true,
    protocol: "openai",
    endpoint: "https://api.openai.com/v1/chat/completions",
    model: "gpt-5",
    cliKind: "codex",
    cliPath: "",
    persona: { id: "", name: "", description: "" },
    personas: [],
    hotkeys: {
      single: "CommandOrControl+Shift+1",
      multiple: "CommandOrControl+Shift+2",
      personality: "CommandOrControl+Shift+9",
      auto: "CommandOrControl+Shift+0",
      toggle: "CommandOrControl+Shift+Space",
    },
  };
  let settings = {
    ...defaults,
    ...(development || qa || smoke ? {} : local.read("settings", {})),
  };
  const guide = new Onboarding(
    development || qa || smoke ? {} : local.read("onboarding", {}),
    Boolean(settings.onboarded) ||
      (Boolean(qa) && qa !== "onboarding") ||
      smoke,
  );
  const saveGuide = () => {
    if (!qa && !smoke && !development) local.write("onboarding", guide.saved);
  };
  const client = new OfficialClient({
    base:
      arg("--dev-base") ??
      (qa || smoke ? "http://127.0.0.1:9" : "https://notchspi-api.vercel.app"),
    store: vault,
    development: development || Boolean(qa) || smoke,
    onChange: () => emit(),
  });
  let startupError = null;
  try {
    await client.initialize();
  } catch (e) {
    startupError = e.message;
  }
  const historyStore = new QuestionHistory(app.getPath("userData"));
  let history = [];
  try {
    if (!qa && !smoke) history = historyStore.list();
  } catch (e) {
    startupError ??= e.message;
  }
  const intake = new Intake(),
    auto = new AutoSession(),
    personaSession = new PersonaSession();
  let state = {
    status: "ready",
    mode: "tutor",
    answer: "",
    working: "",
    explanation: "",
    message: startupError ?? "",
    resultState: null,
    personalityNotice: null,
    requestStarted: false,
    images: [],
    expanded: true,
    visible: true,
    page: "notch",
    collecting: false,
    remaining: null,
    undo: false,
    preview: null,
    onboarding: guide.active,
    qaPinned: Boolean(qa),
    dev: development
      ? "Local mock server"
      : qa
        ? "Offline visual fixture"
        : smoke
          ? "Automated smoke"
          : null,
  };
  let flights;
  let win,
    settingsWin,
    historyWin,
    tray,
    active = null,
    generation = 0,
    run = null,
    images = [],
    removed = null,
    autoPolling = false,
    singleDeadline = null,
    expiration = null;
  const windows = () =>
    [win, settingsWin, historyWin].filter((w) => w && !w.isDestroyed());
  const snapshot = () => ({
    ...state,
    onboarding: guide.active,
    guide: guide.snapshot,
    flying: flights?.ids ?? [],
    settings,
    update: updater.state,
    account: client.account,
    accountSync: client.accountSync,
    canCheckSettlement: state.requestStarted && canQueryCapture(run, client.owner(), Date.now(), product.capture.retentionSeconds),
    config: client.config,
    plus: client.plus,
    history: history.map(({ images, ...x }) => ({
      ...x,
      images: images.map(({ thumbnail, id }) => ({ thumbnail, id })),
    })),
    auto: { active: auto.active, count: auto.count, cap: auto.cap },
    canExplain: Boolean(
      run?.receipt?.explanation_available && !state.explanation,
    ),
    canRecover: Boolean(run?.status?.can_recover ?? run?.receipt?.can_recover),
    canRetry: run?.status?.can_retry === true,
    hasKey: false,
    platform: process.platform,
  });
  const emit = () => {
    for (const w of windows()) w.webContents.send("state", snapshot());
  };
  const updater = createUpdater(emit);
  const windowsCapture = process.platform === "win32";
  const exclusion = createCaptureExclusion({
    // The motion smoke also exercises this lifecycle on the Mac test host.
    enabled: windowsCapture || motionSmoke,
    protect: window => window.setContentProtection(windowsCapture),
    validate: () => {
      if (windowsCapture) requireCaptureExclusionSupport(os.release());
    },
  });
  const position = () => {
    const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()),
      width = Math.min(680, d.workArea.width),
      height = Math.min(780, d.workArea.height);
    win.setBounds({
      x: Math.round(d.bounds.x + (d.bounds.width - width) / 2),
      y: d.bounds.y,
      width,
      height,
    });
  };
  const openWindow = (kind) => {
    const w = new BrowserWindow({
      width: kind === "notch" ? 680 : 850,
      height: kind === "notch" ? 780 : 620,
      show: false,
      frame: kind !== "notch",
      titleBarStyle: kind !== "notch" ? "hidden" : undefined,
      titleBarOverlay:
        kind !== "notch" && process.platform === "win32"
          ? { color: "#282b30", symbolColor: "#eeeeee", height: 30 }
          : undefined,
      transparent: kind === "notch",
      backgroundColor:
        kind === "notch"
          ? "#00000000"
          : nativeTheme.shouldUseDarkColors
            ? "#202024"
            : "#fafafa",
      resizable: kind !== "notch",
      alwaysOnTop: kind === "notch",
      skipTaskbar: kind === "notch",
      hasShadow: kind !== "notch",
      title: kind === "notch" ? "NotchSPI" : `NotchSPI — ${kind}`,
      webPreferences: {
        preload: path.join(root, "preload.cjs"),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        backgroundThrottling: kind !== "notch",
      },
    });
    if (!windowsCapture && !motionSmoke) {
      const protect = () => w.setContentProtection(kind === "notch" && !development && !qa && !smoke);
      protect();
      w.on("show", protect);
    }
    w.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    w.webContents.on("will-navigate", (e) => e.preventDefault());
    w.webContents.session.setPermissionRequestHandler(
      (_wc, _permission, done) => done(false),
    );
    w.webContents.on("console-message", (_event, details) => {
      if (details.level === "error")
        console.error("renderer:", details.message);
    });
    if (kind === "settings") {
      w.on("focus", () => {
        if (state.settingsPage === "account") refreshAccount().catch(() => {});
      });
      w.on("closed", () => {
        try {
          registerHotkeys(settings.hotkeys);
        } catch (e) {
          state.message = e.message;
        }
      });
    }
    w.loadFile(path.join(root, "ui/index.html"), { query: { page: kind } });
    w.webContents.once("did-finish-load", () => {
      emit();
      if (kind === "notch") {
        w.showInactive();
      } else w.show();
    });
    return w;
  };
  win = openWindow("notch");
  position();
  flights = createFlights({
    root,
    host: () => win,
    changed: emit,
    protection: !development && !qa && !smoke,
    exclusion,
    ...(motionSmoke ? { reducedMotion: () => false } : {}),
  });
  win.setAlwaysOnTop(true, "screen-saver");
  win.setIgnoreMouseEvents(true, { forward: true });
  exclusion.register(win);
  const withoutOverlay = createCaptureVisibility({
    host: () => win, flights: () => flights, shouldRestore: () => state.visible,
  });
  const captureWithOverlays = windowsCapture || motionSmoke
    ? takePixels => exclusion.capture(takePixels)
    : withoutOverlay;
  const captureScreen = () => captureWithOverlays(() => capture(settings.target));
  // OS coordinates still arrive when the pointer jumps out of the transparent
  // BrowserWindow, where a DOM pointermove/mouseleave can be lost on Windows.
  const pointerTimer = setInterval(() => {
    if (win.isDestroyed() || !win.isVisible()) return;
    const point = screen.getCursorScreenPoint(), bounds = win.getBounds();
    // Re-evaluate even a stationary pointer when the slab or modal state changes.
    win.webContents.send("pointer", { x: point.x - bounds.x, y: point.y - bounds.y });
  }, 50);

  screen.on("display-metrics-changed", position);
  screen.on("display-removed", position);
  app.on("second-instance", (_event, argv) => {
    const callback = argv.find((value) => billingDestination(value));
    if (callback) {
      routeBilling?.(callback);
      return;
    }
    state.visible = true;
    win.show();
    state.expanded = true;
    emit();
  });
  const openPage = (page) => {
    if (page === "history") {
      if (!historyWin || historyWin.isDestroyed())
        historyWin = openWindow("history");
      else historyWin.show();
    } else {
      state.settingsPage = page;
      if (!settingsWin || settingsWin.isDestroyed())
        settingsWin = openWindow("settings");
      else settingsWin.show();
    }
    emit();
    if (page === "account") refreshAccount().catch(() => {});
  };
  async function refreshAccount() {
    if (qa || smoke) return;
    await client.refresh();
    startupError = null;
    emit();
  }
  routeBilling = (raw) => {
    const destination = billingDestination(raw);
    if (!destination) return;
    openPage(destination);
    // Opening Account refreshes the server; the URL never grants entitlement.
  };
  if (app.isPackaged && process.platform === "win32")
    app.setAsDefaultProtocolClient("notchspi");
  if (pendingBilling) {
    routeBilling(pendingBilling);
    pendingBilling = null;
  }
  const fail = (e) => {
    guide.finished(false);
    saveGuide();
    state.status = "error";
    state.message = e?.message ?? String(e);
    state.expanded = true;
    auto.stop();
    emit();
  };
  function cancel({ guideTransition = true } = {}) {
    if (guideTransition) guide.cancel();
    saveGuide();
    flights?.clear();
    generation++;
    active?.abort();
    active = null;
    intake.cancel();
    singleDeadline = null;
    removed = null;
    state.collecting = false;
    state.undo = false;
    state.preview = null;
    state.remaining = null;
    auto.stop();
    state.status = "canceled";
    emit();
  }
  const saveHistory = () => {
    try {
      history = historyStore.save(history);
    } catch {
      state.message =
        "The answer is complete, but local history could not be saved.";
    }
  };
  async function solve(
    batch,
    { mode = "tutor", operation = "solve", retry = false } = {},
  ) {
    active?.abort();
    const task = (active = new AbortController()),
      current = ++generation;
    state.requestStarted = false;
    const frozen = structuredClone(settings);
    const onboardingAttempt =
      guide.active && mode === "tutor" && operation === "solve";
    if (onboardingAttempt) {
      guide.submitting();
      saveGuide();
    }
    singleDeadline = null;
    intake.cancel();
    state.collecting = false;
    state.preview = null;
    state.remaining = null;
    state.undo = false;
    const old = {
      answer: state.answer,
      working: state.working,
      explanation: state.explanation,
      resultState: state.resultState,
    };
    state.status = "running";
    state.personalityNotice = null;
    state.message = "";
    state.settlement = null;
    state.mode = mode;
    state.expanded = true;
    if (operation !== "explain") {
      state.answer = "";
      state.working = "";
      state.explanation = "";
      state.resultState = null;
    }
    flights.retain(batch.map((x) => x.id));
    images = batch;
    state.images = batch.map(({ id, thumbnail, width, height }) => ({
      id,
      thumbnail,
      width,
      height,
    }));
    emit();
    let raw = "", personaToken = null, personaCompleted = false, personaContextCleared = false;
    const completePersona = (transportOK, answerRaw = raw) => {
      personaCompleted = true;
      const outcome = personaSession.complete(answerRaw, { token: personaToken, transportOK,
        currentScope: JSON.stringify([settings.persona, settings.target, settings.channel]) });
      if (current === generation && !task.signal.aborted) {
        state.personalityNotice = {
          primary: outcome.primary,
          contextWasCleared: personaContextCleared || outcome.sessionMutation === "discardedStaleResult",
          questionsRemaining: frozen.channel === "official" && transportOK
            ? client.account?.balance_questions ?? null : null,
        };
      }
      return outcome;
    };
    task.signal.addEventListener("abort", () => {
      if (mode === "personality" && !personaCompleted) completePersona(false);
    }, { once: true });
    const update = (delta) => {
      if (current !== generation || task.signal.aborted) return;
      raw += delta;
      state.status = "streaming";
      if (operation === "explain") state.explanation = raw;
      else if (mode === "personality")
        state.answer = personality(raw, true).visible;
      else {
        const p = parseAnswer(raw, true);
        state.answer = p.final ?? "";
        state.working = p.working;
      }
      emit();
    };
    try {
      if (startupError) throw new Error(startupError);
      if (frozen.channel === "cli") {
        await client.refresh();
        task.signal.throwIfAborted();
        if (client.account?.cli_enabled !== true)
          throw new Error(
            "CLI is not enabled for this device. Choose an available channel in Settings.",
          );
      }
      const context =
        mode === "personality"
          ? personaSession.begin(
              JSON.stringify([frozen.persona, frozen.target, frozen.channel]),
            )
          : "";
      if (mode === "personality") {
        personaToken = personaSession.currentToken;
        personaContextCleared = personaSession.engine.lastBeginClearedContext;
      } else personaSession.reset();
      let result;
      if (frozen.channel === "official") {
        if (operation === "solve" && !retry) {
          const previous = run;
          const pendingRun = await client.freeze(batch, frozen, mode, context);
          if (current !== generation || task.signal.aborted) return;
          run = pendingRun;
          if (
            old.resultState === "retake" &&
            previous?.owner === run.owner &&
            run.screenQuery
          )
            run.body.parent_capture_id = previous.id;
        }
        task.signal.throwIfAborted();
        if (current !== generation) return;
        state.requestStarted = true;
        result = await client.stream(run, {
          signal: task.signal,
          onDelta: update,
          operation,
          finalAnswer: old.answer,
        });
      } else {
        if (operation !== "solve")
          throw new Error("Capture again to use this channel");
        run = null;
        const options = {
          images: batch,
          settings: frozen,
          mode,
          signal: task.signal,
          onDelta: update,
          sessionContext: context,
        };
        result =
          frozen.channel === "api"
            ? await directAPI({
                ...options,
                key: await vault.get("api:" + frozen.endpoint),
              })
            : await localCLI(options);
      }
      if (current !== generation || task.signal.aborted) return;
      if (operation === "explain") {
        state.explanation = result.raw;
        state.answer = old.answer;
        state.working = old.working;
        state.resultState = old.resultState;
        state.status = "done";
        const h = history.find((x) => x.id === run?.id);
        if (h) {
          h.explanation = result.raw;
          saveHistory();
        }
      } else {
        const answer =
          mode === "personality"
            ? completePersona(true, result.raw)
            : compose(result.raw, run?.objective ?? false);
        if (mode === "personality") {
          if (answer.isError)
            throw new Error(personalityStatusText(answer.primary, { language: frozen.language }));
          state.answer = answer.composition.visibleChoices;
        } else {
          state.resultState = answer.state;
          state.answer = answer.finalAnswer ?? "";
          state.working = parseAnswer(result.raw).working;
          if (!state.answer) {
            state.status = answer.state === "retake" ? "retake" : "empty";
            state.message = answer.noResultReason ?? "";
            auto.stop();
            if (onboardingAttempt) {
              guide.finished(false);
              saveGuide();
            }
            emit();
            return;
          }
        }
        state.status = "done";
        if (onboardingAttempt) {
          guide.finished(true);
          saveGuide();
        }
        if (mode !== "personality" && !onboardingAttempt) {
          const id = run?.id ?? crypto.randomUUID();
          history = [
            {
              id,
              time: Date.now(),
              answer: state.answer,
              working: state.working,
              explanation: "",
              resultState: state.resultState,
              images: batch,
            },
            ...history.filter((x) => x.id !== id),
          ];
          saveHistory();
        }
        if (!onboardingAttempt && canCopyAnswer({ mode, resultState: state.resultState,
          hasAnswer: Boolean(state.answer), automatic: true, autoCopyEnabled: frozen.autoCopy }))
          clipboard.writeText(state.answer.replace(/\*\*|__/g, ""));
        if (auto.active)
          auto.succeeded(
            frozen.channel === "official"
              ? client.account?.balance_questions
              : null,
          );
      }
      clearTimeout(expiration);
      expiration = setTimeout(() => {
        if (!active) {
          run = null;
          images = [];
          state.images = [];
          emit();
        }
      }, product.capture.retentionSeconds * 1000);
    } catch (e) {
      if (current !== generation || task.signal.aborted) return;
      if (operation === "explain") {
        Object.assign(state, old);
        state.message = e.message;
        state.status = "done";
      } else {
        if (onboardingAttempt) {
          guide.finished(false);
          saveGuide();
        }
        state.answer = "";
        state.working = "";
        if (mode === "personality" && !personaCompleted) completePersona(false);
        if (["unsupported_scope", "multiple_targets"].includes(e.code)) {
          state.status = "empty";
          state.message = e.code;
        } else fail(e);
      }
      auto.stop();
    } finally {
      if (current === generation) {
        active = null;
        emit();
      }
    }
  }
  async function take(kind = "single", fromAuto = false, file = false) {
    if (!fromAuto) auto.stop();
    if (active) {
      cancel();
      return;
    }
    if (!guide.startCapture(kind)) {
      state.expanded = true;
      emit();
      return;
    }
    saveGuide();
    if (kind === "personality" && !settings.persona.description.trim()) {
      openPage("personas");
      throw new Error("Add a persona in Settings first");
    }
    if (kind !== "multiple") {
      intake.cancel();
      singleDeadline = null;
    }
    state.requestStarted = false;
    const current = generation;
    let token = kind === "multiple" ? intake.begin(Date.now()) : null;
    if (kind === "multiple" && !token) return;
    try {
      let shot;
      if (file) {
        const result = await dialog.showOpenDialog({
          properties: ["openFile"],
          filters: [
            { name: "Question image", extensions: ["png", "jpg", "jpeg"] },
          ],
        });
        if (result.canceled) {
          if (token) intake.finish(token, null, Date.now());
          guide.cancel();
          saveGuide();
          emit();
          return;
        }
        const st = await fs.stat(result.filePaths[0]);
        if (st.size > 16 * 1024 * 1024) throw new Error("Image too large");
        shot = fromFile(await fs.readFile(result.filePaths[0]));
      } else shot = await captureScreen();
      if (current !== generation) return;
      flights.add(shot);
      if (kind === "multiple") {
        intake.finish(token, shot, Date.now());
        images = intake.items;
        state.status = "collecting";
        state.collecting = true;
        state.expanded = true;
        state.answer = "";
        state.working = "";
        state.images = images.map(({ id, thumbnail, width, height }) => ({
          id,
          thumbnail,
          width,
          height,
        }));
        emit();
      } else
        await solve([shot], {
          mode: kind === "personality" ? "personality" : "tutor",
        });
    } catch (e) {
      if (token) intake.finish(token, null, Date.now());
      if (/permission|Capture target is unavailable/.test(e.message))
        guide.permission();
      else guide.finished(false);
      saveGuide();
      throw e;
    }
  }
  function registerHotkeys(next) {
    const actions = {
      single: () => take("single"),
      multiple: () => take("multiple"),
      personality: () => take("personality"),
      auto: () => toggleAuto(),
      toggle: () => {
        state.visible = !state.visible;
        state.visible ? win.showInactive() : win.hide();
        emit();
      },
    };
    globalShortcut.unregisterAll();
    const failed = [];
    for (const [name, fn] of Object.entries(actions)) {
      try {
        if (
          !globalShortcut.register(next[name], () =>
            Promise.resolve().then(fn).catch(fail),
          )
        )
          failed.push(next[name]);
      } catch {
        failed.push(next[name]);
      }
    }
    if (failed.length)
      throw new Error("Shortcut unavailable: " + failed.join(", "));
  }
  async function toggleAuto() {
    if (auto.active) {
      cancel();
      return;
    }
    if (guide.active) {
      state.expanded = true;
      emit();
      return;
    }
    auto.start(settings.autoCap);
    await take("single", true);
  }
  let openingPractice = false;
  async function openPractice(multiple) {
    if (openingPractice) return;
    openingPractice = true;
    try {
      cancel();
      guide.multiple = multiple;
      const directory = path.join(app.getPath("userData"), "practice");
      await fs.mkdir(directory, { recursive: true });
      const file = path.join(
        directory,
        multiple ? "NotchSPI-Multiple-Practice.html" : "NotchSPI-Practice.html",
      );
      const shortcut = settings.hotkeys[
        multiple ? "multiple" : "single"
      ].replace(
        "CommandOrControl",
        process.platform === "darwin" ? "⌘" : "Ctrl",
      );
      await fs.writeFile(
        file,
        practiceHTML({ language: settings.language, shortcut, multiple }),
      );
      const error = await shell.openPath(file);
      guide.move(
        error
          ? multiple
            ? "multiple"
            : "practice"
          : multiple
            ? "multiCapture"
            : "capture",
      );
      state.message = error;
      state.status = "ready";
      state.answer = "";
      state.working = "";
      state.images = [];
      images = [];
      state.expanded = true;
      saveGuide();
      emit();
    } finally {
      openingPractice = false;
    }
  }
  function resumeGuide() {
    if (guide.claiming) return;
    cancel({ guideTransition: false });
    guide.resume();
    saveGuide();
    state.expanded = true;
    win.showInactive();
    emit();
  }
  async function guidePrimary() {
    if (!guide.active || guide.claiming) return;
    if (["welcome", "practice"].includes(guide.step))
      return openPractice(false);
    if (["firstAnswer", "multiple"].includes(guide.step))
      return openPractice(true);
    if (guide.step === "success") {
      guide.move("trial");
      saveGuide();
      emit();
      try {
        await client.refresh();
        startupError = null;
      } catch (e) {
        state.message = e.message;
      }
    } else if (guide.step === "trial") {
      guide.claiming = true;
      emit();
      try {
        await client.refresh();
        if (client.account?.free_trial?.status === "eligible")
          await client.claimTrial();
        else if (
          !client.account?.free_trial ||
          client.account.free_trial.status === "unavailable"
        )
          throw new Error("Trial unavailable; check Account or continue later");
        guide.complete();
        state.message = "";
      } catch (e) {
        state.message = e.message;
      } finally {
        guide.claiming = false;
      }
    } else if (guide.step === "permission") {
      if (
        process.platform === "darwin" &&
        systemPreferences.getMediaAccessStatus("screen") !== "granted"
      ) {
        await shell.openExternal(
          "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
        );
      } else {
        guide.cancel();
        state.message = "";
      }
    }
    saveGuide();
    emit();
  }
  try {
    registerHotkeys(settings.hotkeys);
  } catch (e) {
    state.message = e.message;
  }
  const trayIcon = nativeImage
    .createFromPath(path.join(root, "ui/icon.png"))
    .resize({ width: 16, height: 16 });
  tray = new Tray(trayIcon);
  tray.setToolTip("NotchSPI");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "NotchSPI",
        click: () => {
          win.show();
          state.expanded = true;
          emit();
        },
      },
      { label: "截屏查题 / Screenshot & ask", click: () => take().catch(fail) },
      {
        label: "多图查题 / Multiple images",
        click: () => take("multiple").catch(fail),
      },
      {
        label: "最近查题 / Recent questions",
        click: () => openPage("history"),
      },
      { label: "设置 / Settings", click: () => openPage("general") },
      { label: "使用引导 / Start guide", click: resumeGuide },
      { type: "separator" },
      { label: "退出 / Quit", click: () => app.quit() },
    ]),
  );
  app.on("before-quit", () => {
    clearInterval(pointerTimer);
    flights.dispose();
    exclusion.dispose();
    active?.abort();
    globalShortcut.unregisterAll();
  });
  app.on("window-all-closed", () => {});
  let motionStarted = false;
  async function verifyMotion() {
    if (motionStarted) return;
    motionStarted = true;
    const { assertFlightSample } = await import("./test/motion-continuity.mjs");
    const directory = path.join(root, "test-output/motion"),
      wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    await fs.mkdir(directory, { recursive: true });
    await fs.rm(path.join(directory, "result.json"), { force: true });
    const pixelCheck = captureSmoke
      ? await (await import("./test/capture-pixels.mjs")).prepareCapturePixels({
          win, exclusion, takePixels: () => capture("screen"), directory,
        })
      : null;
    state.status = "running";
    state.answer = "";
    emit();
    await wait(350);
    await fs.writeFile(
      path.join(directory, "ghost-working.png"),
      (await win.webContents.capturePage()).toPNG(),
    );
    const d = screen.getDisplayMatching(win.getBounds());
    const shot = {
      ...images[0],
      sourceBounds: {
        x: d.bounds.x + 30,
        y: d.bounds.y + 90,
        width: 600,
        height: 400,
      },
    };
    flights.add(shot);
    emit();
    for (let i = 0; i < 80 && flights.diagnostics.frames.length === 0; i++)
      await wait(10);
    const started = flights.diagnostics;
    await fs.writeFile(
      path.join(directory, "started.json"),
      JSON.stringify(started, null, 2),
    );
    if (!started.frames.length)
      throw new Error("Flight did not start on the real desktop");
    if (started.frames.some(frame => frame.reduced))
      throw new Error("Full-motion smoke unexpectedly selected reduced motion");
    const painting = (async () => {
      await wait(100);
      return flights.evidence(directory, "flight-moving");
    })();
    const captureContinuity = [];
    let hiddenDuringCapture = false;
    const visibilityMonitor = setInterval(() => {
      const current = flights.diagnostics;
      if (!win.isVisible() || (current.frames.length && current.overlays.some(w => !w.visible)))
        hiddenDuringCapture = true;
    }, 5);
    try {
      const continuity = [0, 40, 80, 120].map(async delay => {
        await wait(delay);
        await captureWithOverlays(async () => {
          const before = flights.diagnostics.frames[0];
          const beforeTime = Date.now();
          assertFlightSample(started.frames[0], before, beforeTime);
          await wait(60); // Keep captures overlapping while the real window paints.
          const after = flights.diagnostics.frames[0];
          const afterTime = Date.now();
          captureContinuity.push({ before: before?.start, after: after?.start, beforeTime, afterTime, visible: win.isVisible() });
          assertFlightSample(started.frames[0], after, afterTime);
        });
      });
      if (pixelCheck) continuity.push((async () => {
        await wait(80);
        await pixelCheck.check("during-flight", takePixels => captureWithOverlays(() => {
          if (!flights.diagnostics.frames.length)
            throw new Error("Native pixel capture missed the active flight");
          return takePixels();
        }));
      })());
      await Promise.all(continuity);
    } finally {
      clearInterval(visibilityMonitor);
      await fs.writeFile(path.join(directory, "continuity.json"), JSON.stringify(captureContinuity, null, 2));
    }
    if (!captureContinuity.some(sample => sample.before != null && sample.after != null))
      throw new Error("No capture observed the active flight continuously");
    if (hiddenDuringCapture) throw new Error("An overlay was hidden during continuous capture");
    const painted = await painting;
    await fs.writeFile(path.join(directory, "painted.json"), JSON.stringify(painted, null, 2));
    if (!painted.some((p) => p.visible && p.ink > 100))
      throw new Error("Flight overlay has no visible painted image");
    await wait(750);
    if (
      flights.ids.length ||
      flights.diagnostics.overlays.some((w) => w.visible)
    )
      throw new Error("Flight did not release/hide after landing");
    state.status = "done";
    state.answer = "B. 60 km/h";
    emit();
    await wait(350);
    await fs.writeFile(
      path.join(directory, "ghost-completion.png"),
      (await win.webContents.capturePage()).toPNG(),
    );
    flights.add({ ...shot, id: "cancel-proof" });
    flights.clear();
    await wait(30);
    if (flights.ids.length) throw new Error("Canceled flight survived");
    if (pixelCheck) {
      for (let i = 0; i < 3; i++) await pixelCheck.check(`continuous-${i + 1}`, captureWithOverlays);
      await pixelCheck.finish();
    }
    await fs.writeFile(
      path.join(directory, "result.json"),
      JSON.stringify(
        {
          host: process.platform,
          started,
          painted,
          captureContinuity,
          hiddenDuringCapture,
          windowsPixels: pixelCheck ? "passed" : "not-run",
          landed: true,
          canceled: true,
          fixture: true,
        },
        null,
        2,
      ),
    );
    console.log("NSPI_DESKTOP_MOTION_OK");
    app.quit();
  }
  const validSender = (event) =>
    windows().some((w) => w.webContents === event.sender) &&
    event.senderFrame === event.sender.mainFrame &&
    event.senderFrame.url.startsWith(
      pathToFileURL(path.join(root, "ui/index.html")).href,
    );
  ipcMain.handle("nspi", async (event, action, payload) => {
    if (!validSender(event)) throw new Error("Untrusted sender");
    try {
      switch (action) {
        case "state":
          return snapshot();
        case "rendered":
          if (smoke && event.sender === win.webContents && payload === true) {
            if (motionSmoke) {
              verifyMotion().catch((error) => {
                console.error(error);
                app.exit(1);
              });
              break;
            }
            if (["personality-warning", "personality-error"].includes(qa)) {
              const view = await win.webContents.executeJavaScript(`(() => {
                const notice = document.querySelector('[data-personality-notice]');
                return { text: notice?.textContent, visible: Boolean(notice && notice.getBoundingClientRect().height > 0),
                  copy: Boolean(document.querySelector('[data-action="copy"]')),
                  shelfText: document.querySelector('.shelf')?.textContent };
              })()`);
              const expected = qa === "personality-error" ? "Screenshot or choices unreadable"
                : "Some questions need the previous-question context · Questionnaire context cleared · 3 questions left · Running low";
              if (view.text !== expected || !view.visible || view.copy || view.shelfText.split(expected).length !== 2) {
                console.error("Personality notice rendering or copy eligibility failed");
                app.exit(1);
                return;
              }
              console.log("NSPI_PERSONALITY_NOTICE_OK");
            }
            await fs.mkdir(path.join(root, "test-output"), { recursive: true });
            await fs.writeFile(
              path.join(root, "test-output", qa === "personality-warning" ? "personality-status.png" : qa === "personality-error" ? "personality-error.png" : "launch.png"),
              (await win.webContents.capturePage()).toPNG(),
            );
            console.log("NSPI_DESKTOP_LAUNCH_OK");
            app.exit(0);
          }
          break;
        case "qaMotion":
          if (!qa || app.isPackaged) break;
          if (payload === "flight") {
            const d =
              screen
                .getAllDisplays()
                .find(
                  (d) => d.id !== screen.getDisplayMatching(win.getBounds()).id,
                ) ?? screen.getDisplayMatching(win.getBounds());
            images[0].sourceBounds = {
              x: d.bounds.x + 30,
              y: d.bounds.y + 80,
              width: Math.min(900, d.bounds.width - 60),
              height: Math.min(600, d.bounds.height - 100),
            };
            state.expanded = true;
            flights.add(images[0]);
            emit();
          } else {
            state.status = payload === "working" ? "running" : "done";
            state.answer = payload === "working" ? "" : "B. 60 km/h";
            state.expanded = true;
            emit();
          }
          break;
        case "flightTargets":
          flights.targets(event.sender, payload);
          break;
        case "interactive":
          if (event.sender === win.webContents) {
            win.setIgnoreMouseEvents(!payload, { forward: true });
            // Electron changes WS_EX_LAYERED when toggling mouse passthrough.
            exclusion.refresh(win);
          }
          break;
        case "expand":
          state.expanded = Boolean(payload);
          if (!state.expanded) flights.clear();
          emit();
          break;
        case "settings":
          openPage(payload ?? "general");
          break;
        case "history":
          openPage("history");
          break;
        case "capture":
          await take(
            ["single", "multiple", "personality"].includes(payload)
              ? payload
              : "single",
          );
          break;
        case "import":
          await take(
            guide.active && guide.multiple ? "multiple" : "single",
            false,
            true,
          );
          break;
        case "auto":
          await toggleAuto();
          break;
        case "cancel":
          cancel();
          break;
        case "submit": {
          const batch = intake.take(Date.now(), true);
          if (batch) await solve(batch);
          break;
        }
        case "remove": {
          const index = intake.items.findIndex((x) => x.id === payload);
          const item = intake.remove(index, Date.now());
          if (item) {
            removed = {
              item,
              index,
              until: Date.now() + product.capture.undoSeconds * 1000,
            };
            state.undo = true;
            images = intake.items;
            flights.retain(images.map((x) => x.id));
            state.images = images.map(({ id, thumbnail, width, height }) => ({
              id,
              thumbnail,
              width,
              height,
            }));
            emit();
          }
          break;
        }
        case "undo":
          if (
            removed &&
            Date.now() < removed.until &&
            intake.restore(removed.item, removed.index, Date.now())
          ) {
            removed = null;
            state.undo = false;
            images = intake.items;
            flights.retain(images.map((x) => x.id));
            state.images = images.map(({ id, thumbnail, width, height }) => ({
              id,
              thumbnail,
              width,
              height,
            }));
            emit();
          }
          break;
        case "preview": {
          const item = images.find((x) => x.id === payload);
          intake.preview(Boolean(item), Date.now());
          state.preview = item ? `data:image/jpeg;base64,${item.base64}` : null;
          emit();
          break;
        }
        case "copy":
          if (state.status === "done" && canCopyAnswer({ mode: state.mode, resultState: state.resultState,
            hasAnswer: Boolean(state.answer) }))
            clipboard.writeText(state.answer.replace(/\*\*|__/g, ""));
          break;
        case "retry":
          if (!run?.status?.can_retry)
            throw new Error("Check settlement before retrying");
          await take("single");
          break;
        case "status":
          if (state.requestStarted && canQueryCapture(run, client.owner(), Date.now(), product.capture.retentionSeconds)) {
            const pendingRun = run, current = generation;
            const status = await client.status(pendingRun);
            if (current !== generation || pendingRun !== run) break;
            state.settlement = {
              status: status.settlement_status,
              charged: status.questions_charged,
            };
            emit();
          }
          break;
        case "recover":
          await solve(images, { operation: "recover" });
          break;
        case "explain":
          await solve(images, { operation: "explain" });
          break;
        case "recordHotkey":
          if (payload === true) globalShortcut.unregisterAll();
          else registerHotkeys(settings.hotkeys);
          break;
        case "newPersona":
        case "selectPersona":
        case "deletePersona": {
          if (active || intake.items.length)
            throw new Error("Finish or cancel the current capture first");
          settings.personas ??= [];
          if (action === "newPersona")
            settings.persona = {
              id: crypto.randomUUID(),
              name: "",
              description: "",
            };
          if (action === "selectPersona") {
            const selected = settings.personas.find((x) => x.id === payload);
            if (selected) settings.persona = { ...selected };
          }
          if (action === "deletePersona") {
            const choice = await dialog.showMessageBox({
              type: "question",
              message: "删除这个人物像？ / Delete this persona?",
              buttons: ["取消 / Cancel", "删除 / Delete"],
              defaultId: 0,
              cancelId: 0,
            });
            if (choice.response !== 1) break;
            settings.personas = settings.personas.filter(
              (x) => x.id !== settings.persona.id,
            );
            settings.persona = settings.personas[0] ?? {
              id: "",
              name: "",
              description: "",
            };
          }
          personaSession.reset();
          local.write("settings", settings);
          emit();
          break;
        }
        case "targets":
          return await listTargets();
        case "checkUpdate":
          await updater.check();
          break;
        case "downloadUpdate":
          await updater.download();
          break;
        case "installUpdate":
          if (active)
            throw new Error("Finish the current question before restarting");
          updater.install();
          break;
        case "refresh":
          await refreshAccount();
          break;
        case "trial":
          await client.claimTrial();
          emit();
          break;
        case "restore":
          if (active)
            throw new Error("Finish or cancel the current capture first");
          await client.restore(String(payload));
          run = null;
          emit();
          break;
        case "recoveryCode":
          return client.token;
        case "guidePrimary":
          await guidePrimary();
          break;
        case "guideDismiss":
          cancel({ guideTransition: false });
          guide.dismiss();
          saveGuide();
          emit();
          break;
        case "guideLater":
          if (guide.active && guide.step === "trial") {
            guide.complete();
            saveGuide();
            emit();
          }
          break;
        case "guideBack":
          if (guide.active && !guide.claiming) {
            const step = guide.step;
            cancel();
            if (step !== "permission")
              guide.move(guide.multiple ? "multiple" : "welcome");
            state.message = "";
            saveGuide();
            emit();
          }
          break;
        case "guideResume":
          resumeGuide();
          break;
        case "saveSettings": {
          if (active || intake.items.length)
            throw new Error("Finish or cancel the current capture first");
          const next = { ...settings };
          for (const k of Object.keys(defaults))
            if (Object.hasOwn(payload, k)) next[k] = payload[k];
          if (
            !["zh", "en", "ja"].includes(next.language) ||
            !product.reasoningEfforts.includes(next.reasoning) ||
            !["official", "api", "cli"].includes(next.channel) ||
            !product.autoCaps.includes(Number(next.autoCap)) ||
            !Number.isFinite(Number(next.answerSize)) ||
            Number(next.answerSize) < 10 ||
            Number(next.answerSize) > 24 ||
            !Number.isFinite(Number(next.collapseDelay)) ||
            Number(next.collapseDelay) < 0 ||
            Number(next.collapseDelay) > 30
          )
            throw new Error("Invalid settings");
          if (
            typeof next.persona?.name !== "string" ||
            typeof next.persona?.description !== "string" ||
            next.persona.description.length > 16000
          )
            throw new Error("Invalid persona");
          try {
            registerHotkeys(next.hotkeys);
          } catch (e) {
            registerHotkeys(settings.hotkeys);
            throw e;
          }
          if (typeof payload.apiKey === "string" && payload.apiKey) {
            await vault.set("api:" + next.endpoint, payload.apiKey);
          }
          if (
            app.isPackaged &&
            process.platform === "win32" &&
            next.launchAtLogin !== settings.launchAtLogin
          )
            app.setLoginItemSettings({
              openAtLogin: Boolean(next.launchAtLogin),
            });
          if (next.persona.description.trim()) {
            next.persona.id ||= crypto.randomUUID();
            next.personas = [
              { ...next.persona },
              ...(settings.personas ?? []).filter(
                (x) => x.id !== next.persona.id,
              ),
            ].slice(0, 100);
          }
          settings = next;
          auto.stop();
          personaSession.reset();
          run = null;
          local.write("settings", settings);
          emit();
          break;
        }
        case "readHistory": {
          const h = historyStore.load(payload);
          if (h) {
            cancel({ guideTransition: false });
            if (guide.active) {
              guide.dismiss();
              saveGuide();
            }
            run = null;
            images = h.images;
            Object.assign(state, {
              status: "done",
              answer: h.answer,
              working: h.working,
              explanation: h.explanation,
              resultState: h.resultState,
              images: h.images.map(({ id, thumbnail, width, height }) => ({
                id,
                thumbnail,
                width,
                height,
              })),
              expanded: true,
              onboarding: false,
            });
            win.show();
            emit();
          }
          break;
        }
        case "clearHistory": {
          const choice = await dialog.showMessageBox({
            type: "question",
            message:
              "删除本机最近查题和题图？ / Delete local question history?",
            buttons: ["取消 / Cancel", "删除 / Delete"],
            defaultId: 0,
            cancelId: 0,
          });
          if (choice.response === 1) {
            history = [];
            saveHistory();
            emit();
          }
          break;
        }
        case "purchase": {
          await client.register();
          const payments = client.config?.payments,
            pack = payments?.packs.find((x) => x.id === payload);
          if (!payments?.purchase_sessions || !pack)
            throw new Error("Refresh the current price catalog first");
          const owner = client.owner();
          const v = await client.request("/v1/purchase-sessions", {
            lang: settings.language,
            pack_id: pack.id,
            catalog_version: payments.catalog_version,
            purchase_id: crypto.randomUUID(),
          });
          const url = new URL(v.purchase_url);
          if (
            owner !== client.owner() ||
            url.origin !== new URL(client.base).origin ||
            url.protocol !== "https:"
          )
            throw new Error("Invalid purchase destination");
          await shell.openExternal(url.href);
          break;
        }
        case "plusCheckout":
        case "plusPortal": {
          await client.register();
          const owner = client.owner(),
            v = await client.request(
              action === "plusCheckout"
                ? "/v1/plus/checkout"
                : "/v1/plus/portal",
              {},
            );
          const url = new URL(v.url);
          if (
            owner !== client.owner() ||
            url.protocol !== "https:" ||
            ![
              "checkout.stripe.com",
              "billing.stripe.com",
              new URL(client.base).hostname,
            ].includes(url.hostname)
          )
            throw new Error("Invalid subscription destination");
          await shell.openExternal(url.href);
          break;
        }
        case "plusCancel": {
          const choice = await dialog.showMessageBox({
            type: "question",
            message: "取消自动续费？ / Cancel automatic renewal?",
            buttons: [
              "保留订阅 / Keep subscription",
              "取消续费 / Cancel renewal",
            ],
            defaultId: 0,
            cancelId: 0,
          });
          if (choice.response === 1) {
            await client.request("/v1/plus/cancel", {});
            await client.refresh();
            emit();
          }
          break;
        }
        case "quit":
          app.quit();
          break;
        default:
          throw new Error("Unknown action");
      }
      return { ok: true };
    } catch (e) {
      if (
        [
          "capture",
          "import",
          "submit",
          "auto",
          "retry",
          "recover",
          "explain",
        ].includes(action)
      )
        fail(e);
      if (qa) console.error("QA action", action, e.message);
      return { ok: false, error: e.message };
    }
  });
  setInterval(async () => {
    if (removed && Date.now() >= removed.until) {
      removed = null;
      state.undo = false;
      emit();
    }
    if (intake.items.length) {
      const remaining =
        intake.deadline === null
          ? null
          : Math.max(0, Math.ceil((intake.deadline - Date.now()) / 1000));
      if (remaining !== state.remaining) {
        state.remaining = remaining;
        emit();
      }
      const batch = intake.take(Date.now());
      if (batch) solve(batch).catch(fail);
    }
    if (auto.active && !active && !autoPolling) {
      autoPolling = true;
      try {
        const shot = await captureScreen();
        if (auto.tick(shot.luma)) await solve([shot]);
      } catch {
        auto.tick(null);
      } finally {
        autoPolling = false;
        emit();
      }
    }
  }, 500).unref();
  if (qa && qa !== "onboarding") {
    state.onboarding = false;
    state.status =
      qa === "waiting" ? "running" : qa === "error" ? "error" : "done";
    state.answer = qa === "waiting" || qa === "error" ? "" : "B. 60 km/h";
    state.message = qa === "error" ? "Connection interrupted" : "";
    state.expanded = true;
    images = [
      fromFile(
        await fs.readFile(path.join(root, "test/fixtures/question.jpg")),
      ),
    ];
    if (["personality-warning", "personality-error"].includes(qa)) {
      settings.language = "en";
      state.mode = "personality";
      state.answer = "1. A\n2. B";
      state.personalityNotice = { primary: "partialMissingPrevious", contextWasCleared: true, questionsRemaining: 3 };
      if (qa === "personality-error") {
        state.status = "error";
        state.answer = "";
        state.message = "Screenshot or choices unreadable";
        state.personalityNotice = { primary: "unreadable" };
      }
    }
    if (qa === "collecting") {
      images = [0, 1, 2, 3].map((i) => ({
        ...images[0],
        id: images[0].id + "-" + i,
      }));
      for (const image of images) {
        const token = intake.begin(Date.now());
        intake.finish(token, image, Date.now());
      }
      intake.preview(true, Date.now()); // Explicit offline layout fixture; it must never submit itself.
      state.status = "collecting";
      state.collecting = true;
      state.answer = "";
    }
    state.images = images.map(({ id, thumbnail, width, height }) => ({
      id,
      thumbnail,
      width,
      height,
    }));
    emit();
  }
}
