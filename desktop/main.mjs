import {translate} from './ui/i18n.mjs';
import {createWaitTiming} from './core/wait-timing.mjs';
import { observeWindow, windowState } from './core/window-diagnostics.mjs';
import { enqueueCaptureFlight } from './core/capture-flight.mjs';
import { feedbackSnapshot, authorizeFeedback, writeFeedback } from "./core/feedback.mjs";
import { feedbackText } from "./ui/feedback.mjs";
import { failureKind } from './core/failure-kind.mjs';
import { LocalTestReport } from "./core/local-test-report.mjs";
import { changePersona } from './core/personas.mjs';
import { Reliability, captureObservation } from './core/reliability.mjs';
import { previewSize, previewLabels } from "./core/image-preview.mjs";
import { canPollAutomatic } from "./core/daily-session.mjs";
import { canCopyAnswer, personalityStatusText } from "./generated/ui/reading.mjs";
import { Onboarding, onboardingControls, onboardingBackStep, onboardingDismissal } from "./generated/ui/onboarding.mjs";
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
import { createCaptureExclusion, requireCaptureExclusionSupport, requireCaptureCompositor, createWindowsCaptureProtection } from "./platform/capture-exclusion.mjs";
import { canQueryCapture } from "./core/window-behavior.mjs";
import { createFlights } from "./platform/flights.mjs";
import { capture, listTargets, fromFile } from "./platform/capture.mjs";
import { OfficialClient } from "./core/official.mjs";
import { directAPI, localCLI } from "./core/providers.mjs";
import { Intake, product } from "./core/product.mjs";
import { compose, parseAnswer, personality } from "./core/answer.mjs";
import { AutoSession, PersonaSession } from "./core/sessions.mjs";
// Keep transparent Windows overlays on DirectComposition even without a GPU.
// The legacy layered-bitmap fallback cannot apply capture exclusion.
if (process.platform === "win32") {
  app.commandLine.appendSwitch("use-angle", "d3d11-warp");
  app.commandLine.appendSwitch("ignore-gpu-blocklist");
  const disabled = app.commandLine.getSwitchValue("disable-features");
  app.commandLine.appendSwitch("disable-features", [disabled, "RemoveRedirectionBitmap"].filter(Boolean).join(","));
}
const root = path.dirname(fileURLToPath(import.meta.url));
const packageInfo=JSON.parse(await fs.readFile(path.join(root,"package.json"),"utf8"));
const localReportSmoke=process.argv.includes("--local-report-smoke");
const localTestBuild=packageInfo.localTestReport===true||(!app.isPackaged&&localReportSmoke);
if(localTestBuild)app.setPath("userData",path.join(app.getPath("appData"),"NotchSPI-LocalTest"));
let localReport=null, reportTimer=null;
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? null : process.argv[i + 1];
};
const dailySmoke = process.argv.includes("--daily-smoke");
const feedbackSmoke = process.argv.includes("--feedback-smoke");
const guideSmoke = process.argv.includes("--guide-smoke");
const captureSmoke = process.argv.includes("--capture-smoke");
const settingsSmoke = process.argv.includes("--settings-smoke");
const motionSmoke = process.argv.includes("--motion-smoke") || captureSmoke;
const development = Boolean(arg("--dev-base")),
  qa = arg("--qa") ?? (settingsSmoke ? "settings" : dailySmoke ? "daily" : feedbackSmoke ? "feedback" : guideSmoke ? "onboarding" : motionSmoke ? "motion" : null),
  smoke = localReportSmoke || process.argv.includes("--smoke") || motionSmoke || guideSmoke || dailySmoke || feedbackSmoke || settingsSmoke;
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
    }, settingsSmoke ? 60000 : captureSmoke || guideSmoke || dailySmoke ? 45000 : 15000).unref();
  app
    .whenReady()
    .then(start)
    .catch((error) => {
      console.error(error.message);
      app.exit(1);
    });
}
async function start() {
  if (smoke && process.platform === "win32") {
    const { auxAttributes } = await app.getGPUInfo("complete");
    console.log("NSPI_GPU", JSON.stringify({ features: app.getGPUFeatureStatus(), renderer: auxAttributes.glRenderer, overlay: auxAttributes.overlayInfo }));
  }
  if (captureSmoke && process.platform !== "win32") {
    console.log("NSPI_CAPTURE_PIXELS_SKIPPED: Windows interactive desktop required");
    app.exit(0);
    return;
  }
  if(localTestBuild) {
    const reportDirectory=path.join(app.getPath('userData'),'reports');
    const consent=smoke?{response:0}:await dialog.showMessageBox({type:'info',title:'NotchSPI 本地测试版',message:'正常使用即可，退出后自动生成测试报告。',detail:'报告只保存在本机，不自动上传，不记录题图、答案、窗口标题或凭证。退出时会打开报告文件夹，把 ZIP 发给邀请你测试的人即可。查题仍会按所选服务发送题图并可能消耗额度。此测试版使用独立账户数据目录。',buttons:['开始测试','退出'],defaultId:0,cancelId:1});
    if(consent.response===1){app.quit();return;}
    localReport=new LocalTestReport(reportDirectory,{appVersion:app.getVersion(),source:packageInfo.buildProvenance?.source?.commit,platform:process.platform,arch:process.arch,osRelease:os.release(),electron:process.versions.electron,displays:screen.getAllDisplays().map(d=>({width:d.size.width,height:d.size.height,scale:d.scaleFactor})),gpuCompositing:app.getGPUFeatureStatus().gpu_compositing});
    reportTimer=setInterval(()=>{try{const metrics=app.getAppMetrics();localReport.record('sample',{cpu_percent:metrics.reduce((n,m)=>n+m.cpu.percentCPUUsage,0),cpu_browser:metrics.filter(m=>m.type==='Browser').reduce((n,m)=>n+m.cpu.percentCPUUsage,0),cpu_renderer:metrics.filter(m=>m.type==='Tab').reduce((n,m)=>n+m.cpu.percentCPUUsage,0),cpu_gpu:metrics.filter(m=>m.type==='GPU').reduce((n,m)=>n+m.cpu.percentCPUUsage,0),memory_mb:metrics.reduce((n,m)=>n+m.memory.workingSetSize,0)/1024});}catch{}},30000);reportTimer.unref();
    app.on('child-process-gone',(_event,details)=>{if(details.type==='GPU')localReport.record('gpu_gone',{reason:details.reason});});
    app.on('before-quit',()=>{clearInterval(reportTimer);try{const file=localReport.finish();if(file){if(smoke)console.log('NSPI_LOCAL_REPORT',file);else shell.showItemInFolder(file);}}catch{dialog.showErrorBox('测试报告未能生成','请保留测试版数据目录并告知邀请你测试的人。');}});
  }
  const local = new LocalStore(app.getPath("userData")),
    vault = new Vault(
      app.getPath("userData"),
      development || Boolean(qa) || smoke,
    );
  const defaults = {
    language: "zh",
    languageMode: null,
    reasoning: "low",
    channel: "official",
    target: "screen",
    autoCap: 20,
    autoCopy: false,
    launchAtLogin: false,
    reliabilitySharing: true,
    keepExpanded: false,
    collapseDelay: 9,
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
  settings.answerSize=Math.min(19,Math.max(11,Number(settings.answerSize)||13));
  settings.collapseDelay=Math.min(30,Math.max(2,Number(settings.collapseDelay)||9));
  // Preserve a legacy single profile even if it never entered the old library.
  if(settings.persona?.id && !settings.personas.some(x=>x.id===settings.persona.id))settings.personas.push({...settings.persona});
  const systemLanguage = () => app.getLocale().startsWith('zh') ? 'zh' : app.getLocale().startsWith('ja') ? 'ja' : 'en';
  if (settings.languageMode === 'system') settings.language = systemLanguage();
  const guide = new Onboarding(
    development || qa || smoke ? {} : local.read("onboarding", {}),
    Boolean(settings.onboarded) ||
      (Boolean(qa) && qa !== "onboarding") ||
      (smoke && !guideSmoke),
  );
  const saveGuide = () => {
    if (!qa && !smoke && !development) local.write("onboarding", guide.saved);
  };
  let guideTrial = "unavailable", permissionReturn = "capture", practiceFailed = false, guideTargetLabel = null, guideTrialRevision = 0;
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
  if(localTestBuild)settings.reliabilitySharing=false;
  const reliability=new Reliability({store:local,client,enabled:settings.reliabilitySharing,disabled:localTestBuild||Boolean(qa)||smoke||development,onPreference:enabled=>{
    settings.reliabilitySharing=enabled;
    if(!qa&&!smoke&&!development)local.write('settings',settings);
    emit();
  }});
  settings.reliabilitySharing=reliability.data.preference.sharing_enabled;
  const recordReliability=reliability.record.bind(reliability);
  reliability.record=(name,metadata)=>{localReport?.record(name,metadata);recordReliability(name,metadata);};
  reliability.start();
  const historyStore = new QuestionHistory(app.getPath("userData"));
  let history = [];
  try {
    if (!qa && !smoke) history = historyStore.list();
  } catch (e) {
    startupError ??= e.message;
  }
  const intake = new Intake(),
    auto = new AutoSession((name,metadata)=>reliability.record(name,{...metadata,config_revision:client.config?.revision??'base',variant:client.config?.objective_result_v1?.variant??'control'})),
    personaSession = new PersonaSession();
  let state = {
    status: "ready",
    mode: "tutor",
    answer: "",
    working: "",
    explanation: "",
    message: startupError ?? "",
    resultState: null,
    resultKind: null,
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
    localTestBuild,
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
    previewWin,
    feedbackWin, feedbackView = null, feedbackReview = null, feedbackTurn = null, feedbackFiles = null, feedbackSaving = false,
    feedbackSaveDialog = options => dialog.showSaveDialog(feedbackWin,options),
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
    [win, settingsWin, historyWin, previewWin, feedbackWin].filter((w) => w && !w.isDestroyed());
  const snapshot = () => ({
    ...state,
    canFeedback: state.mode !== "personality" && Boolean(state.working || feedbackTurn),
    onboarding: guide.active,
    guideDone: guide.done,
    readingTurn: generation,
    guide: { ...guide.snapshot, trial: guideTrial, targetLabel: guideTargetLabel, capturing: Boolean(state.capturing), practiceFailed },
    flying: flights?.ids ?? [],
    settings,
    update: updater.state,
    account: guideSmoke && guideTrial === "claimed" ? { free_trial: { status: "active", expires_at: "2026-10-27T12:00:00Z" } } : client.account,
    accountSync: client.accountSync,
    hasAccountCredential: Boolean(client.token),
    canCheckSettlement: state.requestStarted && canQueryCapture(run, client.owner(), Date.now(), product.capture.retentionSeconds),
    config: client.config,
    plus: client.plus,
    history: history.map(({ images, ...x }) => ({
      ...x,
      images: images.map(({ thumbnail, id }) => ({ thumbnail, id })),
    })),
    auto: { active: auto.active, count: auto.count, cap: auto.cap, reviewPending: Boolean(state.autoReviewPending) },
    canExplain: Boolean(
      run?.receipt?.explanation_available && !state.explanation,
    ),
    canRecover: Boolean(run?.status?.can_recover ?? run?.receipt?.can_recover),
    canRetry: run?.status?.can_retry === true,
    hasKey: false,
    platform: process.platform,
  });
  const emit = () => {
    if (!state.preview && previewWin && !previewWin.isDestroyed()) previewWin.close();
    if (!dailySmoke) state.remaining = intake.deadline === null
      ? null : Math.max(0, Math.ceil((intake.deadline - Date.now()) / 1000));
    if (process.platform === "win32" && win && !win.isDestroyed()) {
      const focusable = Boolean(guide.active || state.menuOpen);
      if (win.isFocusable() !== focusable) {
        win.setFocusable(focusable);
        exclusion.refresh(win);
      }
    }
    for (const w of windows()) w.webContents.send("state", w === feedbackWin ? { ...snapshot(), feedback: feedbackView } : snapshot());
  };
  const updater = createUpdater(emit);
  const windowsCapture = process.platform === "win32";
  const exclusion = createCaptureExclusion({
    // The motion smoke also exercises this lifecycle on the Mac test host.
    enabled: windowsCapture || motionSmoke,
    protect: windowsCapture ? createWindowsCaptureProtection() : window => window.setContentProtection(false),
    validate: () => {
      if (windowsCapture) {
        requireCaptureExclusionSupport(os.release());
        requireCaptureCompositor(app.getGPUFeatureStatus().gpu_compositing);
      }
    },
  });
  const position = () => {
    const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()),
      width = Math.min(680, d.workArea.width),
      height = Math.max(28, d.workArea.y + d.workArea.height - d.bounds.y);
    win.setBounds({
      x: Math.round(d.bounds.x + (d.bounds.width - width) / 2),
      y: d.bounds.y,
      width,
      height,
    });
  };
  const openWindow = (kind) => {
    const w = new BrowserWindow({
      width: kind === "notch" ? 680 : kind === "feedback" ? 592 : 850,
      height: kind === "notch" ? 780 : kind === "feedback" ? Math.min(685,screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea.height) : 620,
      useContentSize: kind === "feedback",
      show: false,
      frame: !["notch","feedback"].includes(kind),
      parent: kind === "feedback" ? win : undefined,
      modal: kind === "feedback",
      titleBarStyle: !["notch","preview","feedback"].includes(kind) ? "hidden" : undefined,
      titleBarOverlay:
        !["notch","preview","feedback"].includes(kind) && process.platform === "win32"
          ? { color: "#282b30", symbolColor: "#eeeeee", height: 30 }
          : undefined,
      transparent: ["notch","feedback"].includes(kind),
      focusable: kind !== "notch" || process.platform !== "win32" || guide.active,
      backgroundColor:
        ["notch","feedback"].includes(kind)
          ? "#00000000"
          : nativeTheme.shouldUseDarkColors
            ? "#202024"
            : "#fafafa",
      resizable: !["notch","settings","feedback"].includes(kind),
      minimizable: kind !== "preview",
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
    if (localReport) observeWindow(w, kind, (name, metadata) => localReport.record(name, metadata),
      () => kind === 'notch' ? state.visible : undefined);
    if (!windowsCapture && !motionSmoke) {
      const protect = () => w.setContentProtection(["notch", "preview", "settings", "feedback"].includes(kind) && !development && !qa && !smoke);
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
    if (["preview", "settings", "feedback"].includes(kind)) exclusion.register(w);
    w.loadFile(path.join(root, "ui/index.html"), { query: { page: kind } });
    w.webContents.once("did-finish-load", () => {
      emit();
      if (kind === "notch") {
        w.showInactive();
      } else {
        w.show();
        if(kind === 'feedback') w.setContentSize(592,Math.min(685,screen.getDisplayMatching(w.getBounds()).workArea.height));
      }
    });
    return w;
  };
  const feedbackScope = () => JSON.stringify([settings.target,settings.channel,settings.persona,client.owner()]);
  function beginFeedbackTurn(batch) {
    feedbackTurn = {captureID:crypto.randomUUID(),sessionID:crypto.randomUUID(),scope:feedbackScope(),
      expiresAt:Date.now()+product.capture.retentionSeconds*1000,images:structuredClone(batch)};
  }
  function inspectFeedbackImage(data) {
    const image = nativeImage.createFromBuffer(data), size = image.getSize();
    const extension = data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'png' : data[0]===255&&data[1]===216 ? 'jpg' : null;
    return !image.isEmpty() && extension ? {...size,extension} : null;
  }
  function closeFeedback() { if(feedbackWin && !feedbackWin.isDestroyed()) feedbackWin.close(); }
  function openFeedback() {
    if (feedbackWin && !feedbackWin.isDestroyed()) { feedbackWin.focus(); return; }
    const t=feedbackText(settings.language);
    if (!feedbackTurn || feedbackTurn.scope!==feedbackScope() || feedbackTurn.expiresAt<=Date.now() || !state.answer || state.mode==='personality') {
      state.sessionMessage=t[16];emit();return;
    }
    try {
      feedbackReview = {...feedbackSnapshot({...feedbackTurn,answer:state.answer},inspectFeedbackImage),language:settings.language};
      feedbackView = {id:feedbackReview.id,language:feedbackReview.language,answer:feedbackReview.answer,
        assets:feedbackReview.assets.map(a=>({id:a.id,role:a.role,url:`data:image/${a.extension === 'jpg' ? 'jpeg' : 'png'};base64,${a.data.toString('base64')}`}))};
      feedbackWin = openWindow('feedback');
      const current = feedbackWin;
      current.on('close',event=>{if(feedbackSaving)event.preventDefault();});
      current.setTitle(t[0]);
      current.on('closed',()=>{
        if(feedbackWin!==current)return;
        feedbackWin=null;feedbackReview=null;feedbackView=null;feedbackSaving=false;
        const files=feedbackFiles;feedbackFiles=null;
        if(files)void fs.rm(files,{recursive:true,force:true});
      });
    } catch { feedbackReview=null;state.sessionMessage=t[17];emit(); }
  }
  win = openWindow("notch");
  position();
  win.on("blur", () => { if (state.menuOpen) { state.menuOpen = false; emit(); } });
  flights = createFlights({
    root,
    failed: () => localReport?.record("flight_failed"),
    observe: localReport ? w => observeWindow(w, "flight", (name, metadata) => localReport.record(name, metadata)) : undefined,
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
    localReport?.record("window_intent", {window_role:"notch", window_intent:"second_instance_show", ...windowState(win), expected_visible:state.visible});
    state.visible = true;
    win.show();
    state.expanded = true;
    emit();
  });
  const closePreview = () => {
    state.preview = null; state.previewID = null;
    intake.preview(false, Date.now());
    emit();
  };
  const openPreview = (id) => {
    const item = images.find(image => image.id === id);
    if (!item) { closePreview(); return; }
    intake.preview(true, Date.now());
    state.preview = `data:image/jpeg;base64,${item.base64}`;
    state.previewID = item.id;
    if (!previewWin || previewWin.isDestroyed()) {
      const current = openWindow("preview");
      previewWin = current;
      current.setMinimumSize(400, 240);
      const size = previewSize(item, screen.getDisplayMatching(win.getBounds()).workAreaSize);
      current.setContentSize(size.width, size.height);
      current.center();
      current.once("closed", () => {
        if (previewWin !== current) return;
        previewWin = null;
        closePreview();
      });
    } else { previewWin.show(); previewWin.focus(); }
    previewWin.setTitle(previewLabels(snapshot()).title);
    emit();
  };
  const openPage = (page) => {
    if (page === "history") {
      if (!historyWin || historyWin.isDestroyed())
        historyWin = openWindow("history");
      else historyWin.show();
    } else {
      state.settingsPage = page;
      if (!settingsWin || settingsWin.isDestroyed())
        settingsWin = openWindow("settings");
      else { settingsWin.show(); settingsWin.focus(); }
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
  if (app.isPackaged && process.platform === "win32" && !localTestBuild)
    app.setAsDefaultProtocolClient("notchspi");
  if (pendingBilling) {
    routeBilling(pendingBilling);
    pendingBilling = null;
  }
  const autoFailureReason = error => settings.channel==='official'&&(error?.status===401||(client.account?.balance_questions!=null&&client.account.balance_questions<=0))?'quotaExhausted':'runFailed';
  const fail = (e) => {
    guide.finished(false);
    saveGuide();
    state.failureKind = failureKind(e);
    state.status = "error";
    state.message = state.failureKind === "quota" ? (settings.language === "zh" ? "可用额度不足，请查看账户额度或免费体验。" : settings.language === "ja" ? "利用枠が不足しています。アカウントを確認してください。" : "Insufficient credits. Check your account or free trial.") : e?.message ?? String(e);
    state.expanded = true;
    auto.stop(autoFailureReason(e));
    emit();
  };
  function cancel({ guideTransition = true, userInitiated = false } = {}) {
    const collecting = state.collecting || Boolean(intake.items.length);
    if (guideTransition) guide.cancel();
    saveGuide();
    flights?.clear();
    waitTiming = null; state.paintTiming = null;
    state.sessionMessage = null;
    generation++;
    active?.abort();
    active = null;
    intake.cancel();
    singleDeadline = null;
    removed = null;
    state.collecting = false;
    state.capturing = false;
    state.undo = false;
    state.preview = null;
    state.remaining = null;
    auto.stop("stopButton");
    state.autoReviewPending = false;
    state.status = "canceled";
    if (userInitiated) {
      state.message = "";
      state.answer = ""; state.working = ""; state.explanation = "";
      state.resultState = null;
      if (collecting) { images = []; state.images = []; }
    }
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
  let waitTiming = null;
  function revealNotch() {
    state.visible = true;
    if (!win.isVisible()) win.showInactive();
    state.expanded = true;
  }
  async function solve(
    batch,
    { mode = "tutor", operation = "solve", retry = false } = {},
  ) {
    localReport?.record('solve_attempt',{mode,operation});
    revealNotch();
    state.sessionMessage = null;
    const timing = localReport ? createWaitTiming((name, metadata) => localReport.record(name, metadata)) : null;
    waitTiming = timing;
    state.paintTiming = timing ? {id:timing.id,phase:'waiting_frame'} : null;
    active?.abort();
    const task = (active = new AbortController()),
      current = ++generation;
    state.failureKind = null;
    state.requestStarted = false;
    const frozen = structuredClone(settings);
    const observationID=crypto.randomUUID(),observationStart=Date.now();
    let observationOwner=null,observationEnabled=false,observationParser="none",observationResult=null,observationError=null;
    const observation={capture_id:observationID,trigger:auto.active?'auto':mode==='personality'?'personality_hotkey':batch.length>1?'context_hotkey':'capture_hotkey',mode,operation,channel:frozen.channel==='api'?'custom_key':frozen.channel};
    const beginObservation=()=>{
      observationOwner=client.owner();observation.consent_epoch=reliability.data.preference.consent_epoch;
      observation.config_revision=client.config?.revision??'base';observation.variant=client.config?.objective_result_v1?.variant??'control';
      observationEnabled=localTestBuild||(reliability.data.preference.sharing_enabled&&client.config?.telemetry?.enabled!==false);
      if(observationEnabled)reliability.record('capture_started',observation);
    };
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
    state.operation = operation;
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
      state.resultKind = null;
    }
    flights.retain(batch.map((x) => x.id));
    images = batch;
    if(operation === "solve" && !retry) beginFeedbackTurn(batch);
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
      if (delta) {timing?.mark('first_delta');state.sessionMessage = null;}
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
      if (state.answer || state.working || state.explanation) {
        timing?.mark('first_content');
        if (timing) state.paintTiming = {id:timing.id,phase:'content_frame'};
      }
      emit();
    };
    try {
      if (startupError && frozen.channel === "official") {
        await client.initialize();
        task.signal.throwIfAborted();
        startupError = null;
      }
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
          if(feedbackTurn){feedbackTurn.captureID=run.id;feedbackTurn.scope=feedbackScope();}
          if (
            old.resultState === "retake" &&
            previous?.owner === run.owner &&
            run.screenQuery
          )
            run.body.parent_capture_id = previous.id;
        }
        task.signal.throwIfAborted();
        if (current !== generation) return;
        beginObservation();
        timing?.mark('request_sent');
        state.requestStarted = true;
        result = await client.stream(run, {
          signal: task.signal,
          onDelta: update,
          onResponse: () => {if (current === generation && !task.signal.aborted) timing?.mark('response_headers');},
          operation,
          finalAnswer: old.answer,
        });
      } else {
        if (operation !== "solve")
          throw new Error("Capture again to use this channel");
        run = null;
        beginObservation();
        timing?.mark('request_sent');
        state.requestStarted = true;
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
            : compose(result.raw, frozen.channel !== "official" || run?.structuredTutorResult === true);
        if(mode!=="personality"){observationParser=answer.parserPath;observationResult=answer.state;observationError=answer.noResultReason;}
        if (mode === "personality") {
          if (answer.isError)
            throw new Error(personalityStatusText(answer.primary, { language: frozen.language }));
          state.answer = answer.composition.visibleChoices;
        } else {
          state.resultState = answer.state;
          state.resultKind = answer.result?.kind ?? null;
          state.answer = answer.finalAnswer ?? "";
          state.working = parseAnswer(answer.visibleText).working;
          if (!state.answer) {
            localReport?.record('solve_no_answer',{outcome:answer.state==='retake'?'retake':'no_result'});
            state.status = answer.state === "retake" ? "retake" : "empty";
            state.message = answer.result?.reason ?? answer.noResultReason ?? "";
            auto.stop(autoFailureReason());
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
        state.autoReviewPending = auto.active && state.resultState === "review";
      }
      clearTimeout(expiration);
      expiration = setTimeout(() => {
        if (!active) {
          run = null;
          feedbackTurn = null;
          images = [];
          state.images = [];
          emit();
        }
      }, product.capture.retentionSeconds * 1000);
    } catch (e) {
      state.failureKind=failureKind(e);
      localReport?.record('solve_failed',{failure_kind:state.failureKind,trial_status:client.account?.free_trial?.status,available_credits:client.account?.balance_questions,error_code:e.code??'unknown_error',http_status:e.status,stage:state.requestStarted?'request':'preparation'});
      observationError=e.code??"transport_error";
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
      auto.stop(autoFailureReason(e));
    } finally {
      if (current === generation && !task.signal.aborted && (state.answer || state.working || state.explanation)) {
        timing?.mark('first_content');
        if (timing) state.paintTiming = {id:timing.id,phase:'content_frame'};
      }
      timing?.mark(task.signal.aborted || current !== generation ? 'canceled' : 'finished');
      const canceled=task.signal.aborted||current!==generation;
      if(observationEnabled&&client.owner()===observationOwner) reliability.record('capture_completed',{...observation,...captureObservation({mode,operation,parserPath:observationParser,resultState:observationResult,errorCode:observationError,canceled}),total_ms:Math.min(600000,Date.now()-observationStart)});
      void reliability.flush();
      if (current === generation) {
        state.sessionMessage = null;
        active = null;
        emit();
      }
    }
  }
  async function take(kind = "single", fromAuto = false, file = false) {
    state.sessionMessage = null;
    localReport?.record('capture_attempt',{trigger:fromAuto?'auto':kind==='multiple'?'context_hotkey':kind==='personality'?'personality_hotkey':'capture_hotkey'});
    if (!fromAuto) auto.stop("captureHotkey");
    if (active && kind === 'single') {
      revealNotch();
      state.sessionMessage = translate('answeringWait', settings.language);
      localReport?.record('capture_waiting');
      emit();
      return;
    }
    if (state.capturing && kind === 'single') return;
    if (active) {
      cancel();
      return;
    }
    if (!guide.startCapture(kind)) {
      localReport?.record('capture_blocked');
      state.expanded = true;
      emit();
      return;
    }
    if(!fromAuto) feedbackTurn=null;
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
    state.captureKind = kind;
    state.capturing = true;
    emit();
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
      localReport?.record('capture_pixels_ready');
      if (current !== generation) return;
      state.capturing = false;
      enqueueCaptureFlight(flights, shot, (name, metadata) => localReport?.record(name, metadata));
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
      localReport?.record('capture_pixels_failed',{error_code:'capture_failed'});
      if (token) intake.finish(token, null, Date.now());
      if (/permission|Capture target is unavailable/.test(e.message)) {
        guideTargetLabel = settings.target === "screen" ? null : settings.target;
        try { guideTargetLabel = (await listTargets()).find(target => target.id === settings.target)?.name ?? guideTargetLabel; } catch {}
        permissionReturn = guide.multiple ? "multiCapture" : "capture";
        guide.permission();
      } else guide.finished(false);
      saveGuide();
      throw e;
    } finally {
      if (current === generation) { state.capturing = false; emit(); }
    }
  }
  function registerHotkeys(next) {
    // Offline renderer fixtures must not compete with the user’s running client.
    if (qa || smoke) return;
    const actions = {
      single: () => take("single"),
      multiple: () => take("multiple"),
      personality: () => take("personality"),
      auto: () => toggleAuto(),
      toggle: () => {
        localReport?.record("window_intent", {window_role:"notch", window_intent:state.visible ? "hotkey_hide" : "hotkey_show", ...windowState(win), expected_visible:state.visible});
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
  async function toggleAuto(stopReason="userToggled") {
    if (auto.active) {
      auto.stop(stopReason);
      state.autoReviewPending = false;
      emit();
      return;
    }
    if (guide.active) {
      state.expanded = true;
      emit();
      return;
    }
    state.autoReviewPending = false;
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
      practiceFailed = Boolean(error);
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
    if (guide.step === "trial") void loadGuideTrial();
  }
  function clearGuideAnswer() {
    state.answer = ""; state.working = ""; state.explanation = "";
    state.images = []; images = []; state.message = ""; state.status = "ready";
    state.resultState = null; state.requestStarted = false; state.settlement = null; state.operation = null; run = null;
  }
  function finishGuide() {
    guideTrialRevision++;
    guide.claiming = false;
    guide.complete();
    clearGuideAnswer();
    state.expanded = false;
    saveGuide(); emit();
  }
  function dismissGuide() {
    if (!guide.active) return;
    guideTrialRevision++;
    guide.claiming = false;
    const effect = onboardingDismissal(guide.step, guideTrial);
    if (effect.complete) { finishGuide(); return; }
    if (effect.cancelCollection) cancel({ guideTransition: false });
    if (effect.clearAnswer) clearGuideAnswer();
    guide.dismiss();
    if (!active && !state.capturing) state.expanded = false;
    saveGuide(); emit();
  }
  function trialState() {
    return ({ eligible: "available", active: "claimed", expired: "expired", ineligible: "ineligible" })[client.account?.free_trial?.status] ?? "unavailable";
  }
  async function loadGuideTrial() {
    const revision = ++guideTrialRevision;
    guideTrial = "loading"; emit();
    let result;
    try { await client.refresh(); result = trialState(); }
    catch { result = "failed"; }
    if (revision !== guideTrialRevision || !guide.active || guide.step !== "trial") return;
    guideTrial = result; emit();
  }
  async function guidePrimary() {
    const controls = onboardingControls({ ...guide.snapshot, capturing: state.capturing, trial: guideTrial });
    if (!guide.active || !controls.primary || !controls.primaryEnabled || guide.claiming) return;
    if (["welcome", "practice"].includes(guide.step)) return openPractice(false);
    if (["firstAnswer", "multiple"].includes(guide.step)) return openPractice(true);
    if (guide.step === "success") {
      clearGuideAnswer();
      guide.move("trial"); guideTrial = "loading";
      saveGuide(); emit();
      await loadGuideTrial();
    } else if (guide.step === "trial") {
      if (["claimed", "expired", "ineligible"].includes(guideTrial)) { finishGuide(); return; }
      const revision = ++guideTrialRevision;
      guide.claiming = true; guideTrial = "claiming"; emit();
      try {
        await client.refresh();
        if (client.account?.free_trial?.status === "eligible") await client.claimTrial();
        if (revision !== guideTrialRevision || !guide.active || guide.step !== "trial") return;
        guideTrial = trialState(); state.message = "";
      } catch { if (revision === guideTrialRevision) guideTrial = "failed"; }
      finally { if (revision === guideTrialRevision) guide.claiming = false; }
    } else if (guide.step === "permission") {
      if (process.platform === "darwin" && systemPreferences.getMediaAccessStatus("screen") !== "granted") {
        await shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture");
      } else { guide.move(permissionReturn); state.message = ""; }
    }
    saveGuide(); emit();
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
          localReport?.record("window_intent", {window_role:"notch", window_intent:"tray_show", ...windowState(win), expected_visible:state.visible});
          state.visible = true;
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

    reliability.stop();
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
    const directory = path.join(root, "test-output", captureSmoke ? "capture" : "motion"),
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
    // Cold compositor readback can block this process beyond the 680 ms flight.
    // Prepare empty surfaces before starting its clock, only in the smoke path.
    await flights.prepareEvidence();
    flights.add(shot);
    emit();
    for (let i = 0; i < 80 && flights.diagnostics.frames.length === 0; i++)
      await wait(10);
    const started = flights.diagnostics;
    if (!started.frames.length)
      throw new Error("Flight did not start on the real desktop");
    if (started.frames.some(frame => frame.reduced))
      throw new Error("Full-motion smoke unexpectedly selected reduced motion");
    const painting = (async () => {
      await wait(100);
      const first = await flights.evidence(directory, "flight-moving");
      const samples = [first];
      await fs.writeFile(path.join(directory, "pixel-series.json"), JSON.stringify(samples, null, 2));
      for (let sample = 1; sample <= 6; sample++) {
        await wait(80);
        samples.push(await flights.evidence(directory, `flight-sample-${sample}`));
        await fs.writeFile(path.join(directory, "pixel-series.json"), JSON.stringify(samples, null, 2));
      }
      return first;
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
      await fs.writeFile(path.join(directory, "started.json"), JSON.stringify(started, null, 2));
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
    if (['feedbackOriginal','feedbackSave','feedbackCancel'].includes(action) && event.sender !== feedbackWin?.webContents)
      throw new Error('Feedback action requires its review window');
    if (event.sender === feedbackWin?.webContents && !['state','feedbackOriginal','feedbackSave','feedbackCancel'].includes(action))
      throw new Error(`Unsupported feedback action: ${action}`);
    if(["capture","preview","remove","undo","submit","cancel","auto","expand","settings","guideNext","guideBack","guideDismiss","retry","copy","explain","confirmReview"].includes(action))localReport?.record("action",{action});
    const accountAction=["refresh","trial","restore","purchase","plusCheckout","plusPortal","plusCancel"].includes(action);
    if (accountAction && state.accountBusy) return {ok:false,error:"Account operation already in progress"};
    if (accountAction) { state.accountBusy=true; state.accountActionError=null; emit(); }
    try {
      switch (action) {
        case 'timingPainted':
          if (event.sender === win.webContents && win.isVisible() && payload?.id === waitTiming?.id &&
              state.paintTiming?.id === payload.id && state.paintTiming?.phase === payload.phase &&
              ['waiting_frame','content_frame'].includes(payload.phase)) waitTiming.mark(payload.phase);
          break;
        case "state":
          return event.sender === feedbackWin?.webContents ? { ...snapshot(), feedback:feedbackView } : snapshot();
        case "rendered":
          if (smoke && event.sender === win.webContents && payload === true) {
            console.log("NSPI_RENDERER_READY");
            if (settingsSmoke) {
              import("./test/settings-smoke.mjs").then(async ({verifySettings})=>{
                openPage("general");
                await new Promise(resolve=>settingsWin.webContents.once("did-finish-load",resolve));
                await verifySettings({win:settingsWin,root,snapshot,setFixture:async(fixture)=>{
                  client.account=fixture.account??null; client.plus=fixture.plus??null;
                  client.accountSync={status:fixture.loading?'loading':'ready',error:null,plusError:null};
                  client.config={payments:{currency:'CNY',packs:[{id:'test-pack',questions:300,amount_minor:3900}]}};
                  state.accountBusy=false;state.accountActionError=null;
                  state.status=fixture.status??'done';
                  Object.assign(settings,fixture.settings??{});settings.language=fixture.language??'zh';state.settingsPage=fixture.page??'account';emit();
                }});
                console.log("NSPI_SETTINGS_SMOKE_OK");app.quit();
              }).catch(error=>{console.error(error);app.exit(1);});
              break;
            }
            if (dailySmoke || feedbackSmoke) {
              import(feedbackSmoke ? "./test/feedback-smoke.mjs" : "./test/daily-smoke.mjs").then(async (test) => {
                const verify = feedbackSmoke ? test.verifyFeedback : test.verifyDaily;
                await verify({ win, root, snapshot, verifySolveVisibility: async () => {
                  const savedFreeze = client.freeze, savedStartup = startupError, savedChannel = settings.channel;
                  let release;
                  client.freeze = () => new Promise((_resolve,reject) => {release=()=>reject(new Error('Offline visibility fixture'));});
                  startupError = null; settings.channel = 'official';
                  try {
                    guide.complete(); state.visible=false;win.hide();
                    const pending = solve(images);
                    const shown = win.isVisible() && state.visible;
                    state.visible=false;win.hide(); // A later deliberate hide must remain effective.
                    release();await pending;
                    return {shown, staysHidden:!win.isVisible() && !state.visible};
                  } finally {client.freeze=savedFreeze;startupError=savedStartup;settings.channel=savedChannel;}
                }, verifyBusyCapture: async () => {
                  guide.complete(); auto.stop();
                  const task = active = new AbortController();
                  state.visible = false; win.hide();
                  await take('single');
                  await new Promise(resolve=>setTimeout(resolve,100));
                  await fs.writeFile(path.join(root,'test-output/daily-parity',`busy-wait-${settings.language}.png`),(await win.webContents.capturePage()).toPNG());
                  const result = {aborted:task.signal.aborted, sameTask:active===task, visible:win.isVisible(), expanded:state.expanded, message:state.sessionMessage};
                  cancel({userInitiated:true});
                  return {...result, explicitCancelAborted:task.signal.aborted};
                }, getFeedback:()=>feedbackWin, setFeedbackSaveDialog:handler=>{feedbackSaveDialog=handler;}, toggleAuto, openPreview, getPreview: () => previewWin, intake, cancel: () => cancel({userInitiated:true}),
                  setFixture: async (fixture) => {
                    generation++; guide.complete(); auto.stop(); intake.cancel(); active = null;
                    state.visible = true; win.showInactive();
                    clearGuideAnswer();
                    Object.assign(state,{mode:"tutor",status:"done",collecting:false,capturing:false,preview:null,previewID:null,remaining:null,undo:false,autoReviewPending:false,operation:"solve",expanded:true,answer:"B. 60 km/h"},fixture);
                    Object.assign(settings, fixture.settings ?? {});
                    settings.language = fixture.language ?? "zh";
                    const image = fromFile(await fs.readFile(path.join(root,"test/fixtures/question.jpg")));
                    images = Array.from({length:fixture.count ?? 1},(_,i)=>({...image,id:`daily-${i}`}));
                    beginFeedbackTurn(images);
                    if (fixture.collecting) { intake.items = [...images]; intake.reset(Date.now()); }
                    state.images=images.map(({id,thumbnail,width,height})=>({id,thumbnail,width,height}));
                    if(fixture.autoActive) auto.start(20);
                    emit();
                  }});
                console.log(feedbackSmoke ? "NSPI_FEEDBACK_SMOKE_OK" : "NSPI_DAILY_SMOKE_OK"); app.quit();
              }).catch(error=>{console.error(error);app.exit(1);});
              break;
            }
            if (guideSmoke) {
              import("./test/guide-smoke.mjs").then(async ({ verifyGuide }) => {
                await verifyGuide({ win, root, snapshot, dismissGuide, guidePrimary,
                  setFixture: async ({ step, language = "zh", trial = "available", failed = false, count = 0, previewing = false, capturing = false }) => {
                    guide.active = true; guide.done = false; guide.dismissed = false;
                    guide.move(step); guide.failed = failed; guide.multiple = ["multiple", "multiCapture", "collecting", "success"].includes(step);
                    guideTrial = trial; settings.language = language; practiceFailed = false;
                    clearGuideAnswer(); state.expanded = true; state.capturing = capturing;
                    state.collecting = step === "collecting";
                    state.status = step === "working" ? (failed ? "error" : "running") : ["firstAnswer", "success"].includes(step) ? "done" : "ready";
                    active = state.status === "running" ? new AbortController() : null;
                    if (state.status === "done") state.answer = "B. 60 km/h";
                    const fixture = fromFile(await fs.readFile(path.join(root, "test/fixtures/question.jpg")));
                    state.images = Array.from({ length: count }, (_, i) => ({ ...fixture, id: "guide-" + i }));
                    state.preview = previewing ? fixture.thumbnail : null;
                    emit();
                    return active;
                  } });
                console.log("NSPI_GUIDE_SMOKE_OK"); app.quit();
              }).catch(error => { console.error(error); app.exit(1); });
              break;
            }
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
            if(localReportSmoke) {
              try {
                const {verifyWindowDiagnostics} = await import('./test/window-diagnostics-smoke.mjs');
                await verifyWindowDiagnostics(win, localReport);
                waitTiming = createWaitTiming((name, metadata) => localReport.record(name, metadata));
                state.paintTiming = {id:waitTiming.id,phase:'waiting_frame'};
                emit();
                const deadline = Date.now() + 1500;
                while (!localReport.data.events.some(e => e.timing_id === waitTiming.id && e.phase === 'waiting_frame')) {
                  if (Date.now() > deadline) throw new Error('Renderer did not acknowledge the waiting frame');
                  await new Promise(resolve => setTimeout(resolve, 20));
                }
                console.log('NSPI_WAIT_FRAME_OK');
                console.log('NSPI_WINDOW_DIAGNOSTICS_OK');
                app.quit();
              } catch (error) { console.error(error); app.exit(1); }
            } else app.exit(0);
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
          if (!state.expanded) { flights.clear(); state.menuOpen = false; }
          emit();
          break;
        case "exportFeedback": openFeedback(); break;
        case "feedbackCancel": if(!feedbackSaving)closeFeedback(); break;
        case "feedbackOriginal": {
          if(feedbackSaving || payload?.session!==feedbackReview?.id || !Number.isInteger(payload.index))throw new Error('Invalid feedback image');
          const asset=feedbackReview.assets[payload.index];if(!asset)throw new Error('Invalid feedback image');
          feedbackFiles ??= await fs.mkdtemp(path.join(app.getPath('temp'),'notchspi-feedback-preview-'));
          const file=path.join(feedbackFiles,`${payload.index+1}.${asset.extension}`);
          await fs.writeFile(file,asset.data,{mode:0o600});
          if(!smoke)await shell.openPath(file);
          return {ok:true};
        }
        case "feedbackSave": {
          if(feedbackSaving)return {ok:false};
          const review=feedbackReview, t=feedbackText(review?.language);
          feedbackSaving=true;
          try {
            const selection=authorizeFeedback(review,payload);
            const result=await feedbackSaveDialog({title:t[13],message:t[19],defaultPath:`notchspi-feedback-${review.captureID.toLowerCase()}.json`,filters:[{name:'JSON',extensions:['json']}]});
            if(!result.canceled && result.filePath){
              const id=await writeFeedback(review,selection,result.filePath);
              state.sessionMessage=t[18]+id.slice(0,8).toUpperCase();
            }
          }catch{state.sessionMessage=t[17];}
          finally{feedbackSaving=false;closeFeedback();emit();}
          return {ok:true};
        }
        case "menuOpen":
          state.menuOpen = payload === true;
          emit();
          if (state.menuOpen && process.platform === "win32") win.focus();
          break;
        case "quickReasoning":
          if (!product.reasoningEfforts.includes(payload)) throw new Error("Invalid reasoning effort");
          settings.reasoning = payload;
          if (!qa && !smoke && !development) local.write("settings", settings);
          emit();
          break;
        case "quickTarget": {
          const targets = await listTargets();
          if (payload !== "screen" && !targets.some(x => x.id === payload)) throw new Error("Capture target is unavailable");
          settings.target = payload;
          personaSession.reset();
          if (!qa && !smoke && !development) local.write("settings", settings);
          emit();
          break;
        }
        case "newQuestionnaire":
          personaSession.reset();
          state.sessionMessage = settings.language === "zh" ? "连续题上下文已清空" : settings.language === "ja" ? "連続質問のコンテキストを消去しました" : "Questionnaire context cleared";
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
        case "confirmAutoReview":
          if (auto.active && state.autoReviewPending) { state.autoReviewPending = false; emit(); }
          break;
        case "auto":
          await toggleAuto("stopButton");
          break;
        case "cancel":
          cancel({ userInitiated: true });
          break;
        case "submit": {
          if (state.capturing) break;
          const batch = intake.take(Date.now(), true);
          if (batch) await solve(batch);
          break;
        }
        case "remove": {
          if (state.capturing) break;
          const index = intake.items.findIndex((x) => x.id === payload);
          const item = intake.remove(index, Date.now());
          if (item) {
            if (state.previewID === item.id) { state.preview = null; state.previewID = null; intake.preview(false, Date.now()); }
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
          if (state.capturing) break;
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
        case "preview":
          openPreview(payload);
          break;
        case "clearQuestion":
          if (active || state.capturing || guide.active) break;
          cancel({ guideTransition: false });
          clearGuideAnswer(); emit();
          break;
        case "answerMenu":
          if (state.status === "done" && canCopyAnswer({ mode: state.mode, resultState: state.resultState, hasAnswer: Boolean(state.answer) })) {
            const copyGeneration = generation;
            const text = state.answer.replace(/\*\*|__/g, "");
            Menu.buildFromTemplate([{label: settings.language === "zh" ? "复制答案" : settings.language === "ja" ? "回答をコピー" : "Copy Answer", click: () => { if (generation === copyGeneration && state.status === "done") clipboard.writeText(text); }}]).popup({window:win});
          }
          break;
        case "copy":
          if (state.status === "done" && canCopyAnswer({ mode: state.mode, resultState: state.resultState,
            hasAnswer: Boolean(state.answer) }))
            clipboard.writeText(state.answer.replace(/\*\*|__/g, ""));
          break;
        case "retry":
          if (!run?.status?.can_retry)
            throw new Error("Check settlement before retrying");
          await take(state.captureKind === "multiple" ? "multiple" : "single");
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
        case "setReliability":
          if(localTestBuild)return {ok:false,error:"本地测试版不上传诊断数据"};
          reliability.setEnabled(payload);
          void reliability.flush();
          emit();
          break;
        case "newPersona":
        case "selectPersona":
        case "updatePersona":
        case "deletePersona": {
          settings.personas ??= [];
          if (action === "newPersona") {
            const created={id:crypto.randomUUID(),name:({zh:'新的人物像',ja:'新しい人物像',en:'New persona'})[settings.language],description:''};
            Object.assign(settings,changePersona(settings,'add',created));
          }
          if (action === "selectPersona") Object.assign(settings,changePersona(settings,'activate',payload));
          if (action === "updatePersona") Object.assign(settings,changePersona(settings,'update',payload));
          if (action === "deletePersona") {
            const selected=settings.personas.find(x=>x.id===payload);
            if(!selected) break;
            const lang=settings.language;
            const choice=await dialog.showMessageBox(settingsWin,{
              type:'warning',
              message:lang==='zh'?`删除人物像「${selected.name||'未命名'}」？`:lang==='ja'?`人物像「${selected.name||'無題'}」を削除しますか？`:`Delete persona "${selected.name||'Untitled'}"?`,
              detail:({zh:'删除后无法恢复。',ja:'この操作は取り消せません。',en:'This cannot be undone.'})[lang],
              buttons:({zh:['删除','取消'],ja:['削除','キャンセル'],en:['Delete','Cancel']})[lang],defaultId:1,cancelId:1,
            });
            if(choice.response!==0) break;
            Object.assign(settings,changePersona(settings,'remove',payload));
          }
          if(!active) personaSession.reset();
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
          dismissGuide();
          break;
        case "guideLater":
          if (guide.active && guide.step === "trial" && !["loading", "claiming"].includes(guideTrial)) finishGuide();
          break;
        case "guideBack": {
          const next = onboardingBackStep(guide.step, guide.multiple, permissionReturn, guide.failed);
          if (guide.active && next && !active && !state.capturing && !guide.claiming) {
            const step = guide.step;
            if (step === "working") cancel({ guideTransition: false });
            if (step === "multiple") guide.multiple = false;
            guide.move(next);
            practiceFailed = false; state.message = "";
            saveGuide(); emit();
          }
          break;
        }
        case "guideResume":
          resumeGuide();
          break;
        case "saveSettings": {
          if (active || intake.items.length)
            throw new Error("Finish or cancel the current capture first");
          const next = { ...settings };
          for (const k of Object.keys(defaults))
            if (Object.hasOwn(payload, k)) next[k] = payload[k];
          if (Object.hasOwn(payload,'language') && !Object.hasOwn(payload,'languageMode')) next.languageMode=payload.language;
          if (next.languageMode != null && !['system','zh','ja','en'].includes(next.languageMode)) throw new Error('Invalid language preference');
          if (Object.hasOwn(payload,'languageMode')) next.language=next.languageMode==='system'?systemLanguage():next.languageMode;
          if (
            !["zh", "en", "ja"].includes(next.language) ||
            !product.reasoningEfforts.includes(next.reasoning) ||
            !["official", "api", "cli"].includes(next.channel) ||
            !product.autoCaps.includes(Number(next.autoCap)) ||
            !Number.isFinite(Number(next.answerSize)) ||
            Number(next.answerSize) < 11 ||
            Number(next.answerSize) > 19 ||
            !Number.isFinite(Number(next.collapseDelay)) ||
            Number(next.collapseDelay) < 2 ||
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
          if(typeof next.reliabilitySharing!=='boolean')throw new Error('Invalid reliability preference');
          if(localTestBuild)next.reliabilitySharing=false;
          const sharingChanged=next.reliabilitySharing!==settings.reliabilitySharing;
          settings = next;
          if(sharingChanged){reliability.setEnabled(next.reliabilitySharing);void reliability.flush();}
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
              resultKind: null,
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
      const diagnosticAction={copy:'copy',retry:'retry',explain:'show_explanation',recover:'recover_answer',confirmReview:'confirm_review'}[action];
      if(diagnosticAction) reliability.record('answer_action',{action:diagnosticAction,mode:state.mode,channel:settings.channel==='api'?'custom_key':settings.channel});
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
      if (accountAction) state.accountActionError=e.message;
      if (qa) console.error("QA action", action, e.message);
      return { ok: false, error: e.message };
    } finally {
      if (accountAction) {state.accountBusy=false;emit();}
    }
  });
  setInterval(async () => {
    if (dailySmoke || settingsSmoke) return; // Offline fixtures must never capture or submit.
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
    if (auto.active && state.autoReviewPending && auto.paused() !== "none") {
      state.autoReviewPending = false; emit();
    }
    if (canPollAutomatic({active:auto.active,busy:active,polling:autoPolling,reviewPending:state.autoReviewPending})) {
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
  if (guide.active && guide.step === "trial" && !guideSmoke) void loadGuideTrial();
  if (qa && qa !== "onboarding" && !dailySmoke && !feedbackSmoke) {
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
    beginFeedbackTurn(images);
    state.images = images.map(({ id, thumbnail, width, height }) => ({
      id,
      thumbnail,
      width,
      height,
    }));
    emit();
  }
}
