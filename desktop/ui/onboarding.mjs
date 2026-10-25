import { onboardingControls, onboardingCopy } from "../generated/ui/onboarding.mjs";
const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function guidePresentation(state, shortcut) {
  const g = state.guide;
  const tr = (zh, ja, en) => state.settings.language === "zh" ? zh : state.settings.language === "ja" ? ja : en;
  const trial = g.trial ?? "unavailable";
  const c = onboardingControls({ ...g, count: state.images.length, previewing: Boolean(state.preview) });
  const receipt = { ...(state.account?.free_trial ?? {}), status: ({ claimed: "active", expired: "expired", ineligible: "ineligible" })[trial] ?? state.account?.free_trial?.status };
  const copy = { ...onboardingCopy(g.step, state.settings.language, receipt), note: "" };
  if (["multiple", "multiCapture"].includes(g.step)) {
    copy.body = tr('先按下方快捷键截取“材料”，再切到“问题”按一次。', '下のショートカットで「資料」を撮影。「問題」に切り替え、同じキーをもう一度押します。', 'Press the shortcut below to capture Passage. Switch to Question, then press it again.');
    copy.note = tr('多图模式最多可以截4张图，每张图之间有4秒等待时间。', '複数画像モードでは最大4枚まで撮影でき、各画像の間に4秒の待ち時間があります。', 'Multiple-image mode supports up to 4 captures, with a 4-second waiting period between captures.');
  }
  if (g.practiceFailed && ["practice", "multiple"].includes(g.step)) {
    copy.title = tr('练习题没有打开。', '練習問題を開けませんでした。', 'Practice didn’t open.');
    copy.body = tr('请确认已设置默认浏览器，然后重新打开练习题。', 'デフォルトのブラウザを設定してから、もう一度開いてください。', 'Check that a default browser is set, then open the practice again.');
    copy.action = tr('重新打开练习', '練習を開き直す', 'Reopen practice'); copy.note = "";
  }
  if (g.step === "permission") {
    copy.body = tr('截图目标：', '撮影対象：', 'Capture target: ') + (g.targetLabel || tr('整个屏幕', '画面全体', 'Entire screen'));
    copy.note = tr('检查截图目标与系统权限后返回练习，再按快捷键截图。', '撮影対象と権限を確認して練習に戻り、ショートカットで撮影してください。', 'Check the capture target and system access, return to practice, then press the shortcut.');
  }
  if (g.step === "collecting") {
    copy.body = state.preview
      ? (state.images.length < 2 ? tr('正在预览。关闭后可继续截图，至少两张才会自动查题。', 'プレビュー中です。自動送信には2枚以上必要です。', 'Previewing. Auto-send needs at least two images.') : tr('正在预览，自动提交已暂停。关闭预览后，会重新开始 4 秒倒计时。', 'プレビュー中は自動送信を停止します。閉じると4秒のカウントが再開します。', 'Preview pauses auto-send. Close the preview to restart the 4-second countdown.'))
      : state.images.length === 0 ? tr('按下方快捷键，截取练习的“材料”页。', '下のショートカットで「資料」を撮影します。', 'Press the shortcut below to capture Passage.')
      : state.images.length === 1 ? tr('切到练习的“问题”页，再按一次快捷键。只有一张时不会自动提交。', '「問題」に切り替え、もう一度撮影。1枚だけでは自動送信されません。', 'Switch to Question and press the shortcut again. One image won’t auto-send.')
      : state.images.length >= 4 ? tr('已达 4 张上限。停顿 4 秒自动查题，或删除一张后按快捷键重截。', '上限の4枚です。4秒後に自動送信します。', 'Four-image limit reached. A 4-second pause sends them; remove an image before recapturing.')
      : tr('停顿 4 秒自动查题。点题图可预览并暂停倒计时，也可以删除重截。', '4秒後に自動送信。画像のプレビューでカウントを一時停止できます。', 'A 4-second pause sends the images. Preview to pause; remove and recapture if needed.');
  }
  if (g.step === "working" && g.failed) copy.body = g.multiple
    ? tr('请重新截取“材料”和“问题”两页，每页按一次下方快捷键。', '「資料」と「問題」を開き、各ページを撮り直してください。', 'Capture Passage and Question again. Press the shortcut below once on each page.')
    : tr('请让题目和选项完整显示，再按下方快捷键重新截图。', '問題と選択肢をすべて表示し、もう一度撮影してください。', 'Show the full question and choices, then press the shortcut below to retry.');
  if (g.capturing) copy.body = tr('正在截图…', '撮影中…', 'Capturing…');
  if (g.step === "trial") {
    const terminal = ["claimed", "expired", "ineligible"].includes(trial);
    if (trial === "claimed" && state.account?.free_trial?.expires_at) copy.note = tr('有效至 ', '有効期限：', 'Valid until ') + new Intl.DateTimeFormat(state.settings.language === 'zh' ? 'zh-CN' : state.settings.language === 'ja' ? 'ja-JP' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(state.account.free_trial.expires_at));
    if (!terminal) {
      copy.title = tr('领取 3 天免费体验。', '3日間の無料体験をどうぞ。', 'Enjoy 3 days on us.');
      copy.body = tr('新用户可自行选择领取时间，领取后开始 72 小时体验。稍后可在设置 → 账户与订阅领取。', '開始時期は自由です。受け取りから72時間。あとで設定のアカウント画面から受け取れます。', 'Choose when to start your 72-hour trial. Claim later in Settings → Account & plan.');
      copy.action = trial === "loading" ? tr('正在检查…', '確認中…', 'Checking…') : trial === "claiming" ? tr('正在领取…', '受け取り中…', 'Claiming…') : trial === "failed" ? tr('重新领取', 'もう一度試す', 'Try again') : tr('领取免费体验', '無料体験を始める', 'Claim free trial');
      copy.note = trial === "unavailable" ? tr('3 天免费体验暂未开放。', '3日間の無料体験は、まだご利用いただけません。', 'The 3-day free trial is not available yet.') : trial === "failed" ? tr('暂时无法确认领取结果，请稍后重试。', '受け取り結果を確認できません。しばらくしてからお試しください。', 'Unable to confirm your trial. Please try again shortly.') : tr('每天可免费求解 400 次，北京时间 00:00 重置，失败不计次数。', '毎日400回まで無料。北京時間00:00にリセット。', '400 free solves per day, resetting at 00:00 Beijing time. Failed requests don’t count.');
    }
  }
  const button = (action, label, cls, extra = '') => `<button class="${cls}" data-action="${action}" ${extra}>${escape(label)}</button>`;
  const dismiss = button('guideDismiss', c.finish ? tr('完成','完了','Finish') : tr('稍后继续','あとで','Later'), 'guide-dismiss', `title="${escape(tr('收起引导 · 可在刘海菜单中继续','閉じる・ノッチメニューで再開','Close · resume from the notch menu'))}"`);
  const primary = c.primary ? button('guidePrimary', copy.action, 'primary guide-primary', c.primaryEnabled ? '' : 'disabled') : '';
  const back = c.back ? button('guideBack', tr('返回','戻る','Back'), 'guide-back') : '';
  const secondary = c.secondary ? button(g.step === 'trial' ? 'guideLater' : 'settings', g.step === 'trial' ? tr('稍后领取','あとで受け取る','Claim later') : tr('修改快捷键','ショートカット設定','Change shortcut'), `guide-secondary ${g.step === 'trial' ? 'guide-later' : ''}`, g.step === 'trial' ? '' : 'data-value="shortcuts"') : '';
  const language = c.language ? `<select class="guide-language" aria-label="Language / 语言 / 言語" name="guideLanguage">${[['zh','简体中文'],['ja','日本語'],['en','English']].map(([v,l]) => `<option value="${v}" ${state.settings.language === v ? 'selected' : ''}>${l}</option>`).join('')}</select>` : '';
  const keys = c.shortcut ? `<div class="guide-shortcut ${g.live && !c.back ? 'leading' : ''}" role="img" aria-label="${escape(tr('按 ','撮影キー：','Press ') + (state.settings.hotkeys?.[g.multiple ? 'multiple' : 'single'] ?? ''))}"><span class="keycaps" aria-hidden="true">${shortcut(g.multiple ? 'multiple' : 'single')}</span></div>` : '';
  const target = c.target ? button('settings', tr('更改截图目标','撮影対象を変更','Change target'), 'guide-target', 'data-value="general"') : '';
  return {
    header: `<div class="guide-header"><span>NOTCHSPI</span>${dismiss}</div>`,
    body: `<div class="onboarding"><div class="guide-illustration">${guideIllustration(g.step)}</div><div class="guide-copy"><h1>${escape(copy.title)}</h1><p>${escape(copy.body)}</p>${copy.note ? `<p class="guide-note">${escape(copy.note)}</p>` : ''}${target}${state.message && g.practiceFailed ? `<p class="error-message">${escape(state.message)}</p>` : ''}</div></div>`,
    footer: `<div class="guide-footer ${g.live ? 'live' : ''}">${g.live ? `<p>${escape(copy.body)}</p>` : ''}<div class="guide-actions">${primary}${secondary}${back}${language}${keys}</div></div>`,
  };
}
// The coordinates mirror OnboardingIllustration's 284 × 104 drawing space.
export function guideIllustration(step) {
  const paper = (x,y,w,h,second=false) => `<g transform="translate(${x} ${y})"><rect width="${w}" height="${h}" rx="5" fill="${second ? '#ccc' : '#f5f5f5'}"/><path d="M9 11h${w-22}" stroke="#292929b3" stroke-width="2.5"/><path d="M9 18h${w-18}M9 24h${w-27}" stroke="#29292940" stroke-width="2"/><path d="M9 34h6m16 0h6" stroke="#29292926" stroke-width="3"/><path d="M20 34h6" stroke="var(--accent)" stroke-width="3"/></g>`;
  const multi = ['multiple','multiCapture'].includes(step);
  const x = multi ? 84 : 113;
  const calendar = [0,1,2].map(i => `<g transform="translate(${48+i*64} ${i===1?9:17})"><rect width="60" height="76" rx="10" fill="${i===1?'#1f1f1f':'#161616'}" stroke="${i===1?'var(--accent)':'#ffffff29'}" stroke-width=".75"/><path d="M18 -3v8M42 -3v8" stroke="#ffffff66" stroke-width="2"/><path d="M11 17h38" stroke="#ffffff1a"/><text x="30" y="55" text-anchor="middle" font-size="29" font-weight="300" fill="${i===1?'var(--accent)':'#ffffffc7'}">${i+1}</text></g>`).join('');
  const focus = ['capture','multiCapture'].includes(step) ? `<path d="M${x-5} 42v-5h5M${x+58} 37h5v5M${x-5} 86v5h5M${x+58} 91h5v-5" fill="none" stroke="var(--accent)" stroke-width="1.25"/>` : '';
  return `<svg stroke-linecap="round" viewBox="0 0 284 104" aria-hidden="true" focusable="false"><defs><radialGradient id="guide-glow"><stop stop-color="var(--accent)" stop-opacity=".16"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></radialGradient><linearGradient id="guide-glass" x2="0" y2="1"><stop stop-color="#242424"/><stop offset="1" stop-color="#131313"/></linearGradient></defs><ellipse cx="142" cy="48" rx="126" ry="52" fill="url(#guide-glow)"/>${step === 'trial' ? `<g class="guide-reveal">${calendar}</g>` : `<rect x="40" y="4" width="204" height="94" rx="12" fill="url(#guide-glass)" stroke="#ffffff2e" stroke-width=".75"/><path d="M96 4h92v16q0 9-9 9h-74q-9 0-9-9Z" fill="black"/><path d="M116 16.5h37" stroke="var(--accent)" stroke-width="3"/><path d="M158 16.5h10" stroke="#ffffff8c" stroke-width="3"/><g class="guide-reveal">${step === 'permission' ? '<path d="M142 42l17 6v16q-2 12-17 18-15-6-17-18V48Z M136 61v-6a6 6 0 0 1 12 0v6m-14 0h16v12h-16Z" fill="none" stroke="var(--accent)" stroke-width="1.3"/>' : `${multi ? paper(160,43,50,44,true) : ''}${paper(x,42,58,44)}${focus}<path d="M${x+29} 39C${x+29} 30 142 40 142 32" fill="none" stroke="var(--accent)" stroke-opacity=".65"/>`}</g><path d="M14 51h16M254 51h16" stroke="#ffffff21"/>`}</svg>`;
}
