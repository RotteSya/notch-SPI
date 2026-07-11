# 官方服务部署手册（Vercel 生产环境）

当前生产环境：**https://notchspi-api.vercel.app**（Vercel 项目 `notchspi-api`，
team `rottesyas-projects`，framework 自动识别为 Fastify，Fluid compute，SSE 流式已验证）。
客户端 2.0.1 起默认连接此地址（可用 `defaults write com.rottesya.notchspi official.baseURL <url>` 覆盖）。

`/healthz` 会如实自报当前配置状态，随时可查：

```sh
curl https://notchspi-api.vercel.app/healthz
# {"ok":true,"provider":"mock","db":"memory","payments":"disabled","webhook":"n/a"}
#            ^^^^ 目标: anthropic   ^^^^ 目标: postgres  ^^^^ 目标: stripe + configured
```

## 上线三步（只有运营者本人能做——涉及密钥，均在 Vercel 项目 Settings → Environment Variables 粘贴，然后 Redeploy）

### 1. 真实模型（提供答案）

| 变量 | 值 |
|---|---|
| `OFFICIAL_PROVIDER` | `anthropic` |
| `ANTHROPIC_API_KEY` | 你的 Anthropic API Key（console.anthropic.com） |

### 2. 持久化数据库（设备与题数不再随实例丢失）

任选 Postgres 提供商（推荐 Vercel Marketplace → Neon，免费档即可，2 分钟）：

| 变量 | 值 |
|---|---|
| `POSTGRES_URL` | 提供商给的 **pooled** 连接串 |

表结构首次访问自动创建，无迁移步骤。配置前 `/healthz` 显示 `db:"memory"`（数据易失，
仅够冒烟）；配置后显示 `db:"postgres"`。

### 3. 真实支付（Stripe Checkout）

1. Stripe Dashboard → Developers → API keys → 创建 **Restricted key**（只勾
   Checkout Sessions: Write）。
2. Developers → Webhooks → Add endpoint：
   - URL: `https://notchspi-api.vercel.app/webhooks/stripe`
   - 事件: `checkout.session.completed`
   - 复制 Signing secret（`whsec_…`）。
3. 粘贴环境变量：

| 变量 | 值 |
|---|---|
| `STRIPE_SECRET_KEY` | `rk_live_…`（restricted key） |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` |
| `CURRENCY` | 与你 Stripe 账户结算币种一致（`JPY` / `CNY` / `USD`） |
| `PACKS_JSON` | 题包目录，金额单位为该币种最小单位（JPY 无小数：`680` = ¥680） |

设置 `STRIPE_SECRET_KEY` 后支付自动切换为 Stripe 模式（充值页按钮变为真实购买），
无需改代码。支付宝/微信支付：在 Stripe Dashboard → Payment methods 里开启即可，
代码用的是动态支付方式，自动展示给可用的用户。

## 安全设计（已内置）

- webhook 按原始字节验签（HMAC-SHA256 + 5 分钟时间戳容差），签名不符一律 400。
- 入账以 Checkout Session id 为幂等键——Stripe 重复投递不会重复加题。
- 实付金额/币种与题包目录逐字段核对，不符则记日志且**不入账**。
- 支付失败/取消零费用；答题失败不扣题。
- 开发桩端点（stub-complete）在生产默认 404，Stripe 模式下强制关闭。

## 可选：自有域名

`notchspi.app` 当前可注册（Vercel 查询价 $9.99/年）：
https://vercel.com/domains/search?q=notchspi.app
购买后在 Vercel 项目 → Domains 绑定，再把客户端 `defaultBaseURL` 换回并发版即可。

## 重新部署代码

仓库内 `server/` 即为部署源。改动后可用 Vercel Git 集成（Dashboard 里把项目连到
GitHub 仓库、Root Directory 设为 `native/server`），此后 push 即自动部署。

## 本地开发

```sh
cd server && npm ci
DB_PATH=':memory:' OFFICIAL_PROVIDER=mock ALLOW_STUB_TOPUP=1 npm start
npm test        # 55 个用例（含 Stripe 验签/幂等/金额核对）
```
