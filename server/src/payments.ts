import type { Config } from './config.ts';

// The top-up seam. A real integration (Stripe / Alipay / WeChat) implements `renderTopUpPage`
// to show a payment UI and, on a verified webhook, calls `store.credit(...)`. The bundled stub
// renders a dev-only page whose button hits POST /topup/stub-complete to credit the account
// directly — enough to exercise the client's balance-refresh flow without a real gateway.
//
// Swapping providers is intentionally a one-file change: implement this interface and select it
// via PAYMENT_PROVIDER. Money stays in integer cents throughout.

export interface PaymentProvider {
  readonly name: string;
  /** HTML for GET /topup?device=<token>. */
  renderTopUpPage(input: { deviceToken: string; currency: string; baseURL: string }): string;
}

export class StubPaymentProvider implements PaymentProvider {
  readonly name = 'stub';

  renderTopUpPage(input: { deviceToken: string; currency: string; baseURL: string }): string {
    const token = escapeHtml(input.deviceToken);
    const presets = [500, 1000, 5000];
    const buttons = presets
      .map(
        (c) =>
          `<button class="amt" data-cents="${c}">${(c / 100).toFixed(2)} ${escapeHtml(
            input.currency,
          )}</button>`,
      )
      .join('');
    return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>NotchSPI 充值（开发桩）</title>
<style>
  body { font: 15px/1.5 -apple-system, system-ui, sans-serif; max-width: 460px; margin: 40px auto; padding: 0 20px; color: #1d1d1f; }
  h1 { font-size: 20px; } .hint { color: #6e6e73; font-size: 13px; }
  .amt { font-size: 15px; padding: 10px 16px; margin: 6px 8px 6px 0; border: 1px solid #d2d2d7; border-radius: 8px; background: #fff; cursor: pointer; }
  .amt:hover { border-color: #0071e3; } #status { margin-top: 16px; min-height: 20px; }
  .warn { background: #fff8e6; border: 1px solid #ffd666; border-radius: 8px; padding: 10px 12px; font-size: 13px; }
</style></head>
<body>
  <h1>账户充值</h1>
  <p class="warn">⚠️ 这是<strong>开发用支付桩</strong>，点击即直接入账，不涉及真实支付。生产环境请接入 Stripe / 支付宝 / 微信后替换本页。</p>
  <p class="hint">设备：<code>${token.slice(0, 12)}…</code></p>
  <div>${buttons}</div>
  <div id="status"></div>
<script>
  const token = ${JSON.stringify(input.deviceToken)};
  const statusEl = document.getElementById('status');
  for (const btn of document.querySelectorAll('.amt')) {
    btn.addEventListener('click', async () => {
      const cents = Number(btn.dataset.cents);
      statusEl.textContent = '处理中…';
      try {
        const r = await fetch('/topup/stub-complete', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ device_token: token, amount_cents: cents }),
        });
        const j = await r.json();
        if (r.ok) { statusEl.textContent = '充值成功，新余额 ' + (j.balance_cents/100).toFixed(2) + ' ' + j.currency + '。回到 App 点「刷新」即可看到。'; }
        else { statusEl.textContent = '失败：' + (j.error?.message || r.status); }
      } catch (e) { statusEl.textContent = '网络错误：' + e; }
    });
  }
</script>
</body></html>`;
  }
}

export function makePaymentProvider(_config: Config): PaymentProvider {
  // Only the stub ships in this repo. Real providers register here.
  return new StubPaymentProvider();
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
