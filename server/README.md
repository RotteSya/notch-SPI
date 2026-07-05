# NotchSPI 官方按量计费服务（服务端）

实现 macOS 客户端契约 [`../docs/official-api.md`](../docs/official-api.md) 的后端：代持模型厂商
密钥、代理调用、按 Token 计量、扣减余额、处理充值。客户端只持有一个匿名设备令牌，永远拿不到
厂商 Key。

> 这是 [`RotteSya/notch-SPI`](../) 主 App（Swift/macOS）配套的服务端；两者通过 `docs/official-api.md`
> 契约对接，独立部署、独立进程。

## 技术栈

- **Node.js ≥ 22.5 + TypeScript**（用 Node 内置类型剥离直接运行 `.ts`，无构建步骤）
- **Fastify** HTTP 框架
- **SQLite**（Node 内置 `node:sqlite`）经 `Store` 接口封装，生产可整体替换为 Postgres
- 零原生依赖，`npm install` 只拉 Fastify

## 快速开始

```sh
cd server
npm install
npm start          # 默认 mock 厂商 + 本地 SQLite，开箱即跑，无需任何密钥
# 或 npm run dev    # --watch 热重载
```

启动后：

```sh
# 注册设备（领试用额度）
curl -s -X POST localhost:8787/v1/devices -H 'content-type: application/json' \
  -d '{"platform":"macos","app_version":"1.7"}'
# → {"device_token":"dev_…","balance_cents":500,"currency":"CNY"}

# 截图问答（SSE）
curl -N -X POST localhost:8787/v1/captures -H "Authorization: Bearer dev_…" \
  -H 'content-type: application/json' \
  -d '{"system":"你是老师","task":"讲解","image_base64":"<JPEG base64>","image_media_type":"image/jpeg"}'
```

`npm test` 跑单元 + HTTP 集成测试（25 个用例，覆盖定价、SSE 解析、扣费原子性、401/402、充值恢复）。
`npm run typecheck` 做类型检查。

## 端点（对齐契约）

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| POST | `/v1/devices` | 无 | 匿名注册，赠试用额度 |
| GET | `/v1/account` | Bearer | 余额 + 累计用量 |
| POST | `/v1/captures` | Bearer | SSE 流式问答，按 Token 计费；余额 ≤ 0 前置返回 402 |
| GET | `/topup?device=<token>` | 无 | 充值网页 |
| POST | `/topup/stub-complete` | 无 | **仅开发桩**：网页按钮直接入账（生产用签名 webhook 替换） |
| GET | `/healthz` | 无 | 健康检查 |

SSE 事件序列：`data: {"type":"delta",…}` × N → `data: {"type":"usage",…}`（含
`cost_cents`/`balance_cents`）→ `data: [DONE]`；流中出错发 `{"type":"error",…}` 后结束。

## 上线前要填的两个「接缝」

1. **厂商密钥**：设 `OFFICIAL_PROVIDER=anthropic`（或 `openai`）并注入对应 API Key（环境变量）。
   缺 Key 时会自动回退到 mock 并打印告警，服务始终能启动。模型、定价、`max_tokens` 全部 env 可配。
2. **支付**：仓库只带一个**开发用支付桩**（点击即入账，`ALLOW_STUB_TOPUP=0` 可关闭）。接入
   Stripe / 支付宝 / 微信时，实现 `src/payments.ts` 里的 `PaymentProvider` 接口、在支付成功的签名
   回调里调用 `store.credit(...)` 入账即可，其余代码无需改动。

所有配置见 [`.env.example`](.env.example)。

## 目录

```
server/
  src/
    index.ts            Fastify 引导（buildApp 供测试复用）
    config.ts           环境配置（全部默认值安全）
    routes.ts           四个端点 + 统一错误处理
    auth.ts             Bearer 令牌校验
    http.ts             错误体 + SSE 帧工具
    db.ts               Store 接口 + SQLite 实现（原子扣费、令牌存哈希）
    pricing.ts          Token → 分（纯函数）
    payments.ts         PaymentProvider 接口 + 开发桩
    providers/
      types.ts          Provider 接口 + 厂商 SSE 解析
      anthropic.ts      Anthropic Messages API 代理
      openai.ts         OpenAI Chat Completions 代理
      mock.ts           无密钥 mock（默认）
  test/                 单元 + HTTP 集成测试
```

## 部署形态

常驻长进程（本项目选型），SSE 长连接与计费事务最稳，可部署到任意 VPS / 容器 / Railway 等。
生产建议：把 `Store` 换成 Postgres 实现、置于反向代理之后（保留 `X-Accel-Buffering: no` 以免缓冲
SSE）、`OFFICIAL_PROVIDER` 指向真实厂商、接入真实支付并 `ALLOW_STUB_TOPUP=0`。
