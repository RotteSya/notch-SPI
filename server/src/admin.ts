// The admin grant console, served at GET /admin — a single password-protected page the operator
// uses to manually top up a specific device's question balance (support, comps, refunds-in-kind).
// The page itself carries NO secret: the admin key is entered here, kept in localStorage for
// convenience, and sent as the `x-admin-token` header on POST /admin/grant, which verifies it
// server-side. The whole /admin path is 404 unless ADMIN_TOKEN is configured (see routes.ts).

export interface AdminPageInput {
  currency: string;
}

export function renderAdminPage(_input: AdminPageInput): string {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>NotchSPI · 管理后台</title>
<style>
  :root { --accent:#7aa0ff; --accent-hi:#a3bdff; --ink:#eef1f8; --dim:#9aa3bd; --faint:#626b85; }
  * { box-sizing:border-box; margin:0; }
  body {
    font: 15px/1.6 -apple-system, "Hiragino Sans", "PingFang SC", system-ui, sans-serif;
    min-height:100vh; color:var(--ink);
    background: radial-gradient(1200px 600px at 50% -10%, #1b2340 0%, #0b0e1a 55%, #05060c 100%);
    display:flex; align-items:flex-start; justify-content:center; padding:56px 20px;
  }
  main { width:100%; max-width:460px; }
  h1 { font-size:22px; font-weight:800; letter-spacing:.01em; }
  .sub { color:var(--dim); font-size:13px; margin:6px 0 26px; }
  form { display:flex; flex-direction:column; gap:16px; }
  label { display:flex; flex-direction:column; gap:6px; font-size:13px; color:var(--dim); }
  input, textarea {
    font:inherit; color:var(--ink); background:rgba(255,255,255,.05);
    border:1px solid rgba(255,255,255,.14); border-radius:10px; padding:11px 13px; width:100%;
  }
  input:focus, textarea:focus { outline:none; border-color:rgba(122,160,255,.6); }
  textarea { resize:vertical; min-height:52px; }
  .row { display:flex; gap:12px; }
  .row > label { flex:1; }
  button {
    margin-top:4px; font-size:15px; font-weight:700; color:#0b0e1a; padding:12px 0; border:none;
    border-radius:10px; cursor:pointer; background:linear-gradient(180deg,var(--accent-hi),var(--accent));
    transition:filter .15s ease, transform .1s ease;
  }
  button:hover:not(:disabled) { filter:brightness(1.08); }
  button:active:not(:disabled) { transform:scale(.99); }
  button:disabled { opacity:.55; cursor:default; }
  #status { margin-top:18px; min-height:22px; font-size:14px; }
  #status.ok { color:#9fe8bf; }
  #status.err { color:#ff9c9c; }
  code { color:var(--dim); font-size:12px; }
  .hint { color:var(--faint); font-size:12px; margin-top:24px; }
</style></head>
<body>
<main>
  <h1>NotchSPI 管理后台</h1>
  <p class="sub">给指定设备手动补充题数额度。仅限运营/客服使用。</p>
  <form id="f" autocomplete="off">
    <label>管理员密钥
      <input id="key" type="password" placeholder="ADMIN_TOKEN" required>
    </label>
    <label>设备 token
      <input id="device" type="text" placeholder="dev_…" required spellcheck="false">
    </label>
    <div class="row">
      <label>题数
        <input id="questions" type="number" min="1" max="100000" step="1" placeholder="例如 100" required>
      </label>
    </div>
    <label>备注（可选，用于对账）
      <textarea id="note" placeholder="例如：补偿掉单 / 客服赠送"></textarea>
    </label>
    <button id="go" type="submit">加题</button>
  </form>
  <div id="status"></div>
  <p class="hint">题数只增不减。每次提交独立记账（provider=admin），可在数据库 topups 表查审计。</p>
</main>
<script>
  const $ = (id) => document.getElementById(id);
  const KEY_STORE = 'nspi_admin_key';
  // Remember the admin key locally so it need not be retyped (it never travels in the page HTML).
  try { $('key').value = localStorage.getItem(KEY_STORE) || ''; } catch (e) {}

  $('f').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const st = $('status');
    st.className = ''; st.textContent = '';
    const key = $('key').value.trim();
    const device = $('device').value.trim();
    const questions = parseInt($('questions').value, 10);
    const note = $('note').value.trim();
    if (!key || !device || !(questions > 0)) { st.className='err'; st.textContent='请填写密钥、设备 token 和正整数题数。'; return; }
    try { localStorage.setItem(KEY_STORE, key); } catch (e) {}

    const btn = $('go');
    btn.disabled = true; btn.textContent = '处理中…';
    // A fresh idempotency key per click; the disabled button blocks accidental double-submits,
    // and the server treats a repeated key as a no-op.
    const idem = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
    try {
      const r = await fetch('/admin/grant', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-admin-token': key },
        body: JSON.stringify({ device_token: device, questions, note, idempotency_key: idem }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        st.className = 'ok';
        st.textContent = '已加 ' + questions + ' 题。该设备当前余额：' + j.balance_questions + ' 题。';
        $('device').value = ''; $('questions').value = ''; $('note').value = '';
      } else {
        st.className = 'err';
        st.textContent = '失败（' + r.status + '）：' + ((j.error && j.error.message) || '请检查密钥与设备 token');
      }
    } catch (e) {
      st.className = 'err'; st.textContent = '网络错误：' + e;
    } finally {
      btn.disabled = false; btn.textContent = '加题';
    }
  });
</script>
</body></html>`;
}
