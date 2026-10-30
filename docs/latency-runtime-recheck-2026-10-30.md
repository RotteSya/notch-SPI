# 当前真实客户端两题诊断与路由纠正

用户授权Q9/Q11各一次、最多扣2题、预留¥6，并授权CGEvent自动按键。两次完成，无重试。余额722→720，无部署，原生产别名仍指向dpl_6SdECThsrbnkc7mxYDXVWMwUNS5p；服务日志hnd1/nodejs24.x。两个隔离客户端和题图进程完成后已停止。

| 秒 | Q9 | Q11 |
| --- | ---: | ---: |
| 快捷键到首次反馈绘制 | 0.170 | 0.168 |
| 快捷键到提交 | 0.508 | 2.222 |
| 快捷键到首答案绘制 | 15.626 | 12.026 |
| 快捷键到完整绘制 | 15.911 | 12.197 |
| 系统截图调用 | 0.115 | 1.833 |
| 调用前主线程排队 | 0.062 | 0.031 |
| 上游请求到首答案 | 13.698 | 8.681 |
| 首推理片段到首答案 | 12.366 | 7.373 |

两题答案分别D（P充実/Q閲覧/R導入）、B（イだけ），人工与完整题图核对一致，needsReview=false。n=2不报告P95，不作为六题验收。Q11慢截图发生在系统API等待区间，非调用前排队；该区间包含异步等待和恢复，不声称是独立纯系统执行时间。Q9截图快，主要耗时在上游。此次没有通过改变图像、模型或推理参数缩短耗时。

客户端URLSession记录代理连接，实际上传连接reused=true，无重定向；这不能证明服务端到供应商的连接复用。服务端收到首答案至转发分别约0.402ms、0.058ms，没有秒级流式缓冲证据。不要把上游等待全算作纯推理或纯网络。

## 关键纠正

同一现有账户只读GET /v1/client-config返回200，screen_query.enabled_profiles仅[reading_practice]；objective_result_v1已启用。隔离客户端明确general（此前同样默认general），NotchController.makeRunSnapshot要求该profile在enabled_profiles才创建screenQuery，因此实际为nil。OfficialAPI仅在非nil时加入response_contract/profile等字段。服务端screen=false保留客户端system/task，而不是调用officialScreenPrompt。

结论：真实测试走旧objective_v1提示词路径，非screen_query_v1；前几轮直连使用的screen-query基线与实际请求不一致。以前“请求体一致”的免费检查只证明手工选择screen-query分支后的构造一致，不能代表实际路由。本次已在四份先前报告附纠正说明，原始样本未改写。此前v2部署前后E2E变化及Q11失败不能归因于该screen-query候选。

使用隔离客户端原Prompts.swift和SharedProduct.generated.swift在无网络进程中导出实际tutor/brief/objective模板与单图analyzeTaskText，只存私有/tmp；公开文件latency-actual-prompt-2026-10-30.json仅含摘要和字节数。实际旧模板与直连基线system和task均不同。其语言分支在本模式不参与objectiveBriefPrompt，本地L10n只提供测试客户端实际zh值，不改提示文本。

没有擅自切到reading_practice、扩大enabled_profiles、修改生产配置、降低输出上限或取消校验。下一步先以实际旧模板作为性能实验基线；如考虑启用已有reading_practice路径，必须说明支持范围/语义变化并单独授权，不能用测试配置偷换日常流程。

原始阶段证据在/tmp/notchspi-runtime-recheck-20261030/{Q9.log,Q11.log,server-evidence.json,account-config.json}，公开数值见同名samples.json。Vercel日志首次尚未检索到、后一次连接器暂时传输失败，继续读取同一captureId后成功；没有重新发题。免费未认证config返回401后改为现有令牌经内存管道的只读请求，未显示、存储或更换凭据。

## 本地诊断防错补丁

OfficialTransportTiming新增requestContract白名单事件；OfficialAPI在实际提交前根据构造请求所用的screenQuery/resultProtocol记录legacy或screen_query_v1、objective_v1/absent/other。未知字符串不输出，保持原DEBUG及双环境开关；不解析或打印请求体、提示词、图片、答案或令牌，也不修改请求行为。这不是耗时优化。

OfficialStreamTransportTests增加协议区分与未知内容脱敏测试。Swift构建通过（9.22秒）；启用NSPI_LATENCY_TRACE=1及NSPI_QA_EPHEMERAL=1后6项本地测试全部通过，无跳过，覆盖延迟流体、Unicode和一次结算、连接中断。git diff --check通过。测试只连接loopback，无模型请求、扣题或部署。实际协议日志尚未经过新的线上请求验证；未来实验必须使用已导出的legacy模板与实际请求路径核对，不能复用screen-query实验结论。
