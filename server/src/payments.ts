import type { QuestionPack } from './pricing.ts';

// The top-up seam. Providers implement `renderTopUpPage`; the shared renderer supports three
// button modes:
//   'stripe'   — buttons POST /topup/checkout and redirect to Stripe's hosted Checkout page
//                (see stripe.ts; the verified webhook credits the questions)
//   'stub'     — dev-only: buttons hit POST /topup/stub-complete and credit instantly
//   'disabled' — no live payment path configured; buttons render disabled
// Money stays in integer minor units (cents/分; JPY has none) throughout.

export type PageLang = 'zh' | 'ja' | 'en';
export type PageMode = 'stripe' | 'stub' | 'disabled';
export type PageBanner = 'paid' | 'canceled' | null;

/** Clamp an untrusted ?lang= value to a supported page language (default zh). */
export function normalizeLang(raw: string): PageLang {
  const v = raw.toLowerCase();
  if (v.startsWith('ja')) return 'ja';
  if (v.startsWith('en')) return 'en';
  return 'zh';
}

export interface TopUpPageInput {
  deviceToken: string;
  packs: readonly QuestionPack[];
  currency: string;
  baseURL: string;
  lang: PageLang;
  mode: PageMode;
  /** Post-payment return state (?paid=1 / ?canceled=1) rendered as a banner. */
  banner: PageBanner;
}

export interface PaymentProvider {
  readonly name: string;
  /** HTML for GET /topup?device=<token>. */
  renderTopUpPage(input: TopUpPageInput): string;
}

interface PageStrings {
  title: string;
  subtitle: string;
  perQuestion: string;
  questionsUnit: (n: number) => string;
  popular: string;
  buy: string;
  unavailable: string;
  unavailableNote: string;
  stubWarn: string;
  processing: string;
  successPrefix: string;
  successSuffix: string;
  failPrefix: string;
  networkErr: string;
  device: string;
  security: string;
  paidBanner: string;
  canceledBanner: string;
}

const STRINGS: Record<PageLang, PageStrings> = {
  zh: {
    title: '充值题数',
    subtitle: '每按一次快捷键答一题，消耗 1 题额度。失败不扣题。',
    perQuestion: '每题约',
    questionsUnit: (n) => `${n} 题`,
    popular: '最受欢迎',
    buy: '购买',
    unavailable: '暂未开放',
    unavailableNote: '支付渠道即将开通，敬请期待。',
    stubWarn: '⚠️ 开发用支付桩：点击即直接入账，不涉及真实支付。生产环境请配置 Stripe。',
    processing: '处理中…',
    successPrefix: '已到账！当前剩余 ',
    successSuffix: ' 题。回到 App 即可继续使用。',
    failPrefix: '失败：',
    networkErr: '网络错误：',
    device: '设备',
    security: '题数只与本设备绑定，无需注册账号。支付由 Stripe 安全处理。',
    paidBanner: '🎉 支付成功！题数将在几秒内到账 — 回到 App 点「刷新」即可看到。',
    canceledBanner: '支付已取消，未产生任何费用。',
  },
  ja: {
    title: '質問数をチャージ',
    subtitle: 'ショートカット 1 回につき 1 問分を消費します。失敗時は消費されません。',
    perQuestion: '1問あたり約',
    questionsUnit: (n) => `${n}問`,
    popular: '一番人気',
    buy: '購入',
    unavailable: '近日公開',
    unavailableNote: '決済手段は近日公開予定です。',
    stubWarn: '⚠️ 開発用スタブ：クリックすると即時チャージされます（実際の決済なし）。',
    processing: '処理中…',
    successPrefix: 'チャージ完了！残り ',
    successSuffix: ' 問。アプリに戻ってお使いください。',
    failPrefix: '失敗：',
    networkErr: 'ネットワークエラー：',
    device: 'デバイス',
    security: '質問数はこのデバイスにのみ紐づきます。アカウント登録は不要。決済は Stripe が安全に処理します。',
    paidBanner: '🎉 お支払いが完了しました！数秒でチャージされます — アプリに戻って「更新」を押してください。',
    canceledBanner: 'お支払いはキャンセルされました。料金は発生していません。',
  },
  en: {
    title: 'Top Up Questions',
    subtitle: 'Each hotkey press answers one question and costs 1 credit. Failures are never charged.',
    perQuestion: 'about',
    questionsUnit: (n) => `${n} questions`,
    popular: 'Most popular',
    buy: 'Buy',
    unavailable: 'Coming soon',
    unavailableNote: 'Payment methods are coming soon.',
    stubWarn: '⚠️ Development stub: clicking credits instantly, no real payment involved.',
    processing: 'Processing…',
    successPrefix: 'Done! You now have ',
    successSuffix: ' questions. Head back to the app.',
    failPrefix: 'Failed: ',
    networkErr: 'Network error: ',
    device: 'Device',
    security: 'Credits are tied to this device only — no account needed. Payments are handled securely by Stripe.',
    paidBanner: '🎉 Payment complete! Your questions arrive within seconds — hit Refresh in the app.',
    canceledBanner: 'Payment canceled — nothing was charged.',
  },
};

export function formatMoney(cents: number, currency: string): string {
  const symbol = currency === 'CNY' ? '¥' : currency === 'USD' ? '$' : currency === 'JPY' ? '¥' : currency + ' ';
  if (currency === 'JPY') return `${symbol}${cents}`; // JPY has no minor unit
  const value = cents / 100;
  return `${symbol}${Number.isInteger(value) ? value : value.toFixed(2)}`;
}

/** Localized product name for a pack, e.g. "NotchSPI · 300 题" (shown on Stripe Checkout too). */
export function packDisplayName(pack: QuestionPack, lang: PageLang): string {
  return `NotchSPI · ${STRINGS[lang].questionsUnit(pack.questions)}`;
}

/**
 * The shared top-up page. Buttons behave per `mode`; the inline script wires either the
 * Stripe checkout redirect or the dev stub, never both.
 */
export function renderTopUpPage(input: TopUpPageInput): string {
  const s = STRINGS[input.lang];
  const token = input.deviceToken;
  const popularIdx = input.packs.length >= 2 ? 1 : 0;
  const live = input.mode !== 'disabled';

  const cards = input.packs
    .map((p, i) => {
      const per = p.amountCents / p.questions;
      const perStr = `${s.perQuestion} ${formatMoney(Math.round(per), input.currency)}`;
      const badge = i === popularIdx ? `<div class="badge">${s.popular}</div>` : '';
      const btn = live
        ? `<button class="buy" data-pack="${escapeHtml(p.id)}">${s.buy}</button>`
        : `<button class="buy" disabled title="${s.unavailableNote}">${s.unavailable}</button>`;
      return `<div class="card${i === popularIdx ? ' popular' : ''}">
  ${badge}
  <div class="q">${s.questionsUnit(p.questions)}</div>
  <div class="price">${formatMoney(p.amountCents, input.currency)}</div>
  <div class="per">${perStr}</div>
  ${btn}
</div>`;
    })
    .join('\n');

  const banner = input.banner === 'paid'
    ? `<p class="banner ok">${s.paidBanner}</p>`
    : input.banner === 'canceled'
      ? `<p class="banner">${s.canceledBanner}</p>`
      : '';
  const warn = input.mode === 'stub' ? `<p class="warn">${s.stubWarn}</p>` : '';
  const deviceLine = token
    ? `<p class="hint">${s.device}: <code>${escapeHtml(token.slice(0, 12))}…</code> · ${s.security}</p>`
    : '';

  const stripeJS = `
  for (const btn of document.querySelectorAll('.buy[data-pack]')) {
    btn.addEventListener('click', async () => {
      statusEl.textContent = L.processing;
      btn.disabled = true;
      try {
        const r = await fetch('/topup/checkout', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ device_token: token, pack_id: btn.dataset.pack, lang: LANG }),
        });
        const j = await r.json();
        if (r.ok && j.url) { location.href = j.url; return; }
        statusEl.textContent = L.fail + (j.error?.message || r.status);
      } catch (e) { statusEl.textContent = L.net + e; }
      btn.disabled = false;
    });
  }`;

  const stubJS = `
  for (const btn of document.querySelectorAll('.buy[data-pack]')) {
    btn.addEventListener('click', async () => {
      statusEl.textContent = L.processing;
      try {
        const r = await fetch('/topup/stub-complete', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ device_token: token, pack_id: btn.dataset.pack }),
        });
        const j = await r.json();
        if (r.ok) { statusEl.textContent = L.okPre + j.balance_questions + L.okSuf; }
        else { statusEl.textContent = L.fail + (j.error?.message || r.status); }
      } catch (e) { statusEl.textContent = L.net + e; }
    });
  }`;

  return `<!doctype html>
<html lang="${input.lang === 'zh' ? 'zh-CN' : input.lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>NotchSPI · ${s.title}</title>
<style>
  :root { --accent: #7aa0ff; --accent-hi: #a3bdff; }
  * { box-sizing: border-box; }
  body {
    font: 15px/1.6 -apple-system, "Hiragino Sans", "PingFang SC", system-ui, sans-serif;
    margin: 0; min-height: 100vh; color: #eef1f8;
    background: radial-gradient(1200px 600px at 50% -10%, #1b2340 0%, #0b0e1a 55%, #05060c 100%);
    display: flex; align-items: center; justify-content: center; padding: 48px 20px;
  }
  main { width: 100%; max-width: 720px; }
  h1 { font-size: 26px; font-weight: 700; margin: 0 0 6px; letter-spacing: .01em; }
  .sub { color: #9aa3bd; font-size: 14px; margin: 0 0 28px; }
  .banner { border-radius: 10px; padding: 12px 16px; font-size: 14px; margin: 0 0 22px;
    background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.14); }
  .banner.ok { background: rgba(80,200,130,.10); border-color: rgba(80,200,130,.4); color: #9fe8bf; }
  .packs { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; }
  .card {
    position: relative; border: 1px solid rgba(255,255,255,.10); border-radius: 16px;
    padding: 22px 18px 18px; background: rgba(255,255,255,.04);
    transition: transform .18s ease, border-color .18s ease, box-shadow .18s ease;
  }
  .card:hover { transform: translateY(-3px); border-color: rgba(122,160,255,.45);
    box-shadow: 0 12px 32px rgba(0,0,0,.45); }
  .card.popular { border-color: rgba(122,160,255,.55); background: rgba(122,160,255,.07); }
  .badge {
    position: absolute; top: -11px; left: 50%; transform: translateX(-50%);
    background: linear-gradient(90deg, var(--accent), var(--accent-hi));
    color: #0b0e1a; font-size: 11px; font-weight: 700; padding: 3px 12px; border-radius: 999px;
    white-space: nowrap;
  }
  .q { font-size: 22px; font-weight: 700; }
  .price { font-size: 30px; font-weight: 800; margin: 8px 0 2px; letter-spacing: -.01em; }
  .per { color: #8a93ad; font-size: 12px; margin-bottom: 16px; }
  .buy {
    width: 100%; font-size: 15px; font-weight: 600; padding: 10px 0; border-radius: 10px;
    border: none; cursor: pointer; color: #0b0e1a;
    background: linear-gradient(180deg, var(--accent-hi), var(--accent));
    transition: filter .15s ease, transform .1s ease;
  }
  .buy:hover:not(:disabled) { filter: brightness(1.08); }
  .buy:active:not(:disabled) { transform: scale(.98); }
  .buy:disabled { background: rgba(255,255,255,.10); color: #8a93ad; cursor: default; }
  .warn { background: rgba(255,196,0,.08); border: 1px solid rgba(255,196,0,.35);
    border-radius: 10px; padding: 10px 14px; font-size: 13px; color: #ffd666; margin-top: 24px; }
  .hint { color: #626b85; font-size: 12px; margin-top: 20px; }
  code { color: #9aa3bd; }
  #status { margin-top: 18px; min-height: 22px; font-size: 14px; color: var(--accent-hi); }
</style></head>
<body>
<main>
  <h1>${s.title}</h1>
  <p class="sub">${s.subtitle}</p>
  ${banner}
  <div class="packs">${cards}</div>
  <div id="status"></div>
  ${warn}
  ${deviceLine}
</main>
<script>
  const token = ${jsStringLiteral(token)};
  const LANG = ${jsStringLiteral(input.lang)};
  const statusEl = document.getElementById('status');
  const L = {
    processing: ${jsStringLiteral(s.processing)},
    okPre: ${jsStringLiteral(s.successPrefix)},
    okSuf: ${jsStringLiteral(s.successSuffix)},
    fail: ${jsStringLiteral(s.failPrefix)},
    net: ${jsStringLiteral(s.networkErr)},
  };
${input.mode === 'stripe' ? stripeJS : input.mode === 'stub' ? stubJS : ''}
</script>
</body></html>`;
}

/** Dev/testing provider: instant credits via the (default-disabled) stub endpoint. */
export class StubPaymentProvider implements PaymentProvider {
  readonly name = 'stub';
  renderTopUpPage(input: TopUpPageInput): string {
    return renderTopUpPage(input);
  }
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Encode a string as a JS string literal that is also safe to embed inside an inline
 * `<script>` element — neutralizes `</script>`, HTML-special chars, and the U+2028/U+2029
 * line separators that break inline scripts. Prevents reflected XSS from an untrusted
 * `?device=` value on the unauthenticated top-up page.
 */
export function jsStringLiteral(s: string): string {
  return JSON.stringify(s)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Device tokens are `dev_` + base64url. Reject anything else so the top-up page never reflects
 * arbitrary attacker input (defense-in-depth alongside jsStringLiteral).
 */
export function isValidTokenShape(token: string): boolean {
  return /^dev_[A-Za-z0-9_-]{1,128}$/.test(token);
}
