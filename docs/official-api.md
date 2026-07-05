# NotchSPI 官方按量计费服务 — 服务端 API 契约

客户端（`Sources/NotchSPI/Cloud/`）已按本契约实现完毕。服务端参考实现见
[`../server/`](../server/)（Node.js + TypeScript + Fastify + SQLite，`npm start` 开箱即跑）。
上线后无需改动客户端代码（默认地址 `https://api.notchspi.app`，可用
`defaults write com.rottesya.notchspi official.baseURL <url>` 指向测试环境）。

服务端职责：代持真正的模型厂商 API Key、代理模型调用、按 Token 计量、扣减余额、
处理充值（网页端）。客户端永远拿不到厂商 Key，只持有一个匿名设备令牌。

通用约定：

- 认证：`Authorization: Bearer <device_token>`（除注册端点外）。
- 金额一律用**分**（`*_cents` 整数）+ `currency`（`"CNY"` / `"USD"`）。
- 错误响应体：`{"error": {"message": "<用户可读信息>"}}`。
- `401` 令牌无效（客户端会清除本地设备令牌并引导用户在「账户与额度」重新初始化）；
  `402` 余额不足（客户端会把本地余额镜像清零并引导充值）。

## POST /v1/devices — 匿名设备注册（开箱即用入口）

无需认证。首次注册应赠送试用额度。重复调用允许（客户端只在本地无令牌时调用）。

请求：

```json
{ "platform": "macos", "app_version": "1.7" }
```

响应 200：

```json
{ "device_token": "dev_xxxxxxxx", "balance_cents": 500, "currency": "CNY" }
```

## GET /v1/account — 余额与用量查询

响应 200：

```json
{
  "balance_cents": 342,
  "currency": "CNY",
  "total_input_tokens": 182000,
  "total_output_tokens": 45120
}
```

（客户端读取全部四个字段；`total_*_tokens` 会覆盖本地的累计用量镜像，以服务端为准。）

## POST /v1/captures — 截图问答（SSE 流式）

请求：

```json
{
  "system": "<系统提示词，客户端已按模式/深度/人物像构建好>",
  "task": "<用户消息文本>",
  "image_base64": "<JPEG base64>",
  "image_media_type": "image/jpeg",
  "stream": true
}
```

服务端选择模型、调用厂商 API、按 Token 计费。响应为 `text/event-stream`，事件均为
`data: <json>` 行：

```
data: {"type":"delta","text":"答案增量文本"}
data: {"type":"delta","text":"…"}
data: {"type":"usage","input_tokens":1200,"output_tokens":480,"cost_cents":4,"balance_cents":338}
data: [DONE]
```

- `usage` 事件必须在流结束前发出**一次**，客户端据此更新本地余额镜像与累计用量。
- 流中出错：发送 `data: {"type":"error","error":{"message":"…"}}` 后结束。
- 请求前余额已不足：直接返回 HTTP `402`（响应体用通用错误格式）。

## GET /topup?device=\<token\> — 充值网页（非 API）

「账户与额度」面板的「充值…」按钮会用系统浏览器打开此地址。页面自行完成支付流程
（如 Stripe / 支付宝 / 微信）；充值到账后客户端点「刷新」即可通过 `/v1/account` 同步。

## 客户端行为摘要（便于服务端联调）

- 计费拦截只作用于官方模式：本地已知余额 ≤ 0 时在发起截图前拦下并引导充值；
  余额未知时放行，以服务端 `402` 为准。自定义 API Key / 本机 CLI 模式完全不经过
  官方服务，也不受拦截影响。
- 新安装首次启动默认官方模式并自动注册；老安装保持原有模式，不会被改路由。
