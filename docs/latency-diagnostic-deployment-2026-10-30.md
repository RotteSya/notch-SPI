# 服务端分段计时部署 — 2026-10-30

用户已明确批准：完成线上源码基线核对、保留可回退版本后，仅部署无内容的服务端计时补丁；不包含新增收费请求。此次未安装本机依赖、创建密钥、修改权限、提交或推送 Git。

## 基线和范围

恢复后的既有 CLI 凭据成功读取完整 Vercel 文件清单。旧生产部署为 `dpl_71B75SR3aR6MxeUBF4bQj4hHCNcW`，80 个源文件逐一按平台 SHA-1 核验。78 个匹配本地 HEAD；旧部署额外保留 `server/src/month-pass-page.ts`，且 `server/tsconfig.json` 不包含 tools 目录。这两文件从部署 API 读取、解码并验证摘要后原样保留，没有把本地主树差异带入生产。构建输出 `/out/api/index` 不作为源文件上传。

在 `/tmp/notchspi-daily-20261029/server-diagnostic-candidate/production-candidate/` 重建生产源码，仅覆盖 `server/src/capture-service.ts`、`server/src/providers/openai.ts`、`server/src/providers/types.ts`，新增 `server/src/capture-timing.ts`。共 81 个源文件；测试副本、node_modules 链接、客户端和桌面端改动均不在部署清单内。

生产环境新增普通开关 `NSPI_SERVER_LATENCY_TRACE=1`（环境项 ID `FAhYywpoXehSMxq8`）。日志仅含固定阶段名及单调时钟偏移，合法 capture UUID 用于关联；不记录截图、题目、答案、推理正文或密钥。请求、模型参数、提示词、校验、超时、结算顺序均未改变。

## 执行与验证

- 隔离生产候选使用本机已有依赖：TypeScript 检查通过；计时、DeepSeek provider、capture admission 合计 110 项测试全部通过，0 失败，22.539 秒。供应商调用为测试替身，HTTP 测试使用 loopback，不是线上模型测试。
- 文件上传连接器出现传输错误后，使用同一既有 CLI 凭据调用官方 `/v2/files` 上传四个变更文件，全部 HTTP 200；未修改认证文件。
- 新部署 `dpl_4xWeCnSWfUvA7gyW7WhSjwxRRxVe`，URL `notchspi-2t488vxqt-rottesyas-projects.vercel.app`，状态 READY；正式域名 `notchspi-api.vercel.app` 已解析至该部署。Vercel 托管构建沿用既有锁文件和构建流程，日志显示依赖 up to date、构建约 9 秒。
- 重新读取新部署清单，81 个源文件的路径及摘要与候选完全一致，无额外、缺失或摘要不符项。
- 公开 GET `/healthz` 返回 200，provider/objective_provider 仍为 deepseek，数据库类型 postgres。该端点明确不检查数据库连接，不能把它当作真实模型或数据库业务验收。
- 无 Authorization 的空 JSON POST `/v1/captures` 返回 401 `invalid_token`。生产日志关联 ID `s9jqh-1793290307358-a2df7ab416d5`：`captureTiming={handlerStarted:0,handlerFinished:1.0010780000011437}`，请求总时间约 2.610 ms。鉴权在任何模型调用或扣费前失败；未携带题图、账户令牌，也未新增付费调用。
- 新旧客户端响应关联 ID 均带 `hnd1::iad1`，运行日志 region 均为 hnd1；部署元数据 regions 为 iad1。保留各来源原始含义，不把这些字段混同成精确的网络耗时或执行区域归因。

原始清单、比对、测试和冒烟证据保存在上述临时候选目录。当前六题首段可用答案平均仍以先前 9.773 秒为准，目标未达成；此次没有新的端到端性能结果。

## 回退与下一步

旧部署仍为 READY，保留原 URL `notchspi-1m58n18p8-rottesyas-projects.vercel.app`。需要回退时将项目生产流量回退到 `dpl_71B75SR3aR6MxeUBF4bQj4hHCNcW`，随后复查正式域名与健康状态；旧代码不读取新计时开关。没有实际触发回退演练，以免扰动生产。后续若撤销诊断，还需移除或关闭生产计时环境项，并确认后续部署采用预期配置。

真实细分数据仍需新增模型请求授权。拟先重复已有固定 Q2 与 Q11 各一次（短题与最长等待题），相同完整上下文、deepseek-flash/low、客户端及网络路径；最多两题、预留 ¥6，无自动重试。此小样本用于定位瓶颈，不用于宣称六题平均低于 6 秒。

## 同日修正：流结束前写日志

随后完成获批的 Q2/Q11 两次真实诊断，详见 [实测报告](latency-diagnostic-2026-10-30.md)。发现日志在 SSE 结束后的异步清理完成时才输出，handlerFinished 包含后响应延迟。修复沿用原计时补丁授权，仅改 capture-service.ts 和 capture-timing.ts，增加流结束前 responseFinishing 日志且保证只记录一次。

再次读取当时生产 `dpl_4xWeCnSWfUvA7gyW7WhSjwxRRxVe`：81 个源文件均匹配上一候选，新候选只这两个文件摘要变化。TypeScript 通过，110 项相关测试通过（21.918 秒）。新增回归断言在旧实现上失败、新实现上通过。未安装依赖、修改环境项或任何业务参数。

修正部署 `dpl_271UcGFmA4tVic4ogYUWphehxRJP`，URL `notchspi-lxxd4nq20-rottesyas-projects.vercel.app`，READY；正式域名回查指向该版本。81 个源码摘要全部匹配新候选。免费健康检查 200/deepseek，未认证 captures 请求 401/invalid_token。上一计时部署仍 READY，可回退至它；最初无计时生产版本亦保留在上文。没有实际回退。证据为临时候选目录下 `deployment-files-v2.json`、`v2-baseline-verification.json`、`deployment-status-v2.json`、`deployed-source-verification-v2.json`、`focused-tests-v2-final.log`。

修正后的真实 SSE 线上时序尚未新增付费验证；只在本地 mock 流验证日志先于响应结束。2 次收费额度已耗尽，此次修正部署验证没有调用模型。不将该诊断修复计为性能优化收益。
