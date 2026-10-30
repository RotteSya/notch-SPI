# 上游等待免费检查与局部候选 — 2026-10-30

## 结论

目标仍是用户日常 Q1/Q2/Q8–Q11 六题从实际快捷键到首段可用答案平均严格低于 6 秒。现有六题平均 9.773 秒；后续仅 Q2/Q11 两题平均 7.491 秒，不能替代六题验收。免费检查阶段无收费请求、无生产部署、无依赖安装或系统配置修改；后续获批的单文件部署见文末。

最近 Q11 上游请求至首答案 8.305 秒，其中首推理片段至首答案 6.940 秒。服务端首答案收到至 delta 发出仅 0.049 毫秒；上游已流式，未发现等待完整生成才转发答案。provider 实例在应用上下文创建，stream 内使用运行时 fetch，未创建逐请求独立连接池；这不等于已证明每次上游连接都复用。客户端连接复用与上游连接复用不可混同。

检查路径：capture-service.ts → OpenAIProvider.stream → fetch → readVendorSSE → delta → beginSSE。请求没有多模型竞速、自动重试、重复 OCR 或二次解题调用。生产诊断用的 deepseek-flash/low 已是现有 thinking 模式最低 effort；本次不改变 thinking、max_tokens、温度、图片或提示词。

## 已落实的本地候选

`server/src/http.ts`：beginSSE 写好响应头后立即 flushHeaders，不再把响应头留到首个答案字节才发送。它让客户端及中间层提前知道流已开始，不增加伪答案或状态正文，帧序列仍为 delta、usage、DONE。发生在原有准入校验之后，不绕过鉴权、额度或错误处理。

`server/test/sse.test.ts`：使用真实 loopback HTTP 连接，服务端只有在客户端收到响应头后才允许发出第一段答案；客户端收到答案后才允许服务端结束。旧实现卡住并触发 1 秒测试保护，新实现通过，证明头与答案没有等待不必要的后续事件。该保护超时不是生产延迟测量；没有证据说明生产首答案能因此节省多少秒。主要可能收益是将响应头处理与模型生成重叠，不能消除模型本身等待。

隔离生产候选位于 `/tmp/notchspi-upstream-20261030/candidate`；81 个源文件，按前轮已验证生产清单比较，仅 server/src/http.ts 摘要变化。候选保留线上特有月票页面及 tsconfig，排除测试和本地其他未提交改动。部署前必须重新核对线上基线，未经本轮批准不部署。

## 检查后未采用

- `[DONE]` 后立即取消 HTTP body：本地可消除等待 EOF，但可能破坏连接复用，且最近 Q11 首答案到 provider 完成仅 3.599 ms。原始记录没有 DONE/EOF 分段，不能证明线上存在可观尾部等待。已撤回该实验，保留原上游读取策略、所有用量和错误处理。
- 压低推理强度、输出上限或图片清晰度：不能证明质量等价，不采用。
- 前缀缓存：官方说明默认开启且尽力命中，只复用输入前缀，输出仍需计算。代码已有稳定 system/task 在前、图片在后；不添加付费预热，不缓存旧答案，不裁剪长文来制造命中。图像复用和本账户命中率尚未测量。
- 修改地区、出口或路由：当前 region 元数据无法单独证明执行与网络瓶颈；未改生产区域、代理或服务商。
- 调整提示词：可能改变解题行为，尚无质量等价证据；保留完整性、歧义、单位、全部选项及机器协议校验。

## 证据边界与下一步

本地可复现传输缺陷已经修复，但本次没有真实端到端性能收益数字，也没有找到保持所有约束下可靠减少数秒的方案。不要把响应头提前到达当作首答案达标。

若批准部署，范围仅 server/src/http.ts，沿用现有模型、计时开关、环境配置，保留当前生产回退版本；先只做公开健康检查与无凭据拒绝检查，模型请求 0 次、扣题 0。收费六题验收需另行列明预算并批准；当前不建议仅为这一小改动立即花费六题。

参考（2026-10-30 只读核查）：[DeepSeek 缓存](https://api-docs.deepseek.com/guides/kv_cache/)、[思考模式](https://api-docs.deepseek.com/guides/thinking_mode/)、[Node HTTP flushHeaders](https://nodejs.org/api/http.html#responseflushheaders)。

最终验证：TypeScript 检查通过；121 项相关测试全部通过、0 失败（21.920 秒），覆盖 SSE、供应商参数/错误、准入、重复请求、取消、超时和扣费。`git diff --check` 通过。原实现的两个实验回归失败记录与最终测试日志位于 `/tmp/notchspi-upstream-20261030/`；最终只保留响应头改动及其测试，DONE 取消实验未进入候选。


## 获批单文件部署结果

用户随后明确批准仅部署 server/src/http.ts 与免费检查，不包含收费六题验收。执行前重新读取生产 `dpl_271UcGFmA4tVic4ogYUWphehxRJP`，状态 READY，81 个源文件摘要与原基线全部匹配；新候选仅 server/src/http.ts 增加 flushHeaders 和注释。未变更环境变量、项目设置、模型、提示词、图像、校验和扣费。

新生产部署：`dpl_CLut1zmd63QEyNCvybi18z4akxPV`，URL `notchspi-fcr2a4crh-rottesyas-projects.vercel.app`，READY。正式域名 `notchspi-api.vercel.app` 回查已指向该部署；新部署 81 个源码路径与 SHA-1 全部匹配批准候选。测试文件及其他本地未提交改动不在上传清单内。

免费检查：GET /healthz 返回 200、ok=true、provider=deepseek；不携带凭据和题图的 POST /v1/captures 空 JSON 返回 401 invalid_token。模型请求 0 次、扣题 0，没有重试收费请求。健康端点不证明模型或数据库业务成功，未认证请求不经过 SSE 路径，因此线上首答案收益和真实流式行为仍待另行授权验收。

回退版本 `dpl_271UcGFmA4tVic4ogYUWphehxRJP` 仍 READY，URL `notchspi-lxxd4nq20-rottesyas-projects.vercel.app`；没有实际切换回退。部署证据保存于 `/tmp/notchspi-upstream-20261030/production-baseline.json`、`candidate-files.json`、`deployment-verification.json`。未安装本机依赖、提交或推送 Git，`git diff --check` 通过。


## 六题结束后的上游参数复核（2026-10-30）

重新阅读 capture-service.ts、screen-query.ts、providers/openai.ts、providers/types.ts 与 providers/index.ts：screen_query_v1 服务端重建 system/task，不把客户端提示词再拼接一次；请求只有一条 system 和一条 user，稳定任务文本在图片前。没有工具调用、历史 reasoning 回填或先解释后作答的第二次模型调用。未知供应商参数不应凭其他厂商接口名称添加。

免费重读官方 Chat Completions、Thinking Mode、Context Caching 文档：缓存默认开启且依赖已持久化完整前缀匹配；minimal 映射 low；推理模式 temperature/presence_penalty/frequency_penalty 不生效。本次阅读的官方 Chat Completions 参数表未发现 service_tier/priority 延迟保证选项（不等于证明供应商没有未公开服务）。不能将其他供应商的 priority 参数移植后宣称加速。图像 low 会降采样到 512×512，不适合在完整长文质量未经证明时使用。

未更改请求参数、提示词、模型或部署。现有证据没有给出能保证把 8.056 秒降到 6 秒以下的等质量局部实现。可继续的关键方向是受控提示词候选与质量对照，但这会改变模型行为，必须先明确实验范围并获得用户对该取舍的确认；任何新增实际调用预算仍需独立批准。不要反复使用相同六题抽取更快一批，也不要把固定题答案写入缓存用于验收。

文档：https://api-docs.deepseek.com/api/create-chat-completion/ 、https://api-docs.deepseek.com/guides/thinking_mode/ 、https://api-docs.deepseek.com/guides/kv_cache/ 。
