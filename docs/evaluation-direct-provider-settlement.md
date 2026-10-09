# 直接供应商诊断的预算核销

2026-10-05 在用户明确允许独立子代理复核后，为本次 5 CNY 查题延迟评测补齐核销支持。此流程只处理本地评测账本，不涉及用户题数、支付或生产账务。

直接调用 `provider.stream` 的诊断脚本先 `reserve`，返回后保存结果并 `observeUsage`，不会经过官方 HTTP 评测适配器，原账本 outcome 因而保持 `unknown`。不能伪造官方 HTTP 200/SSE DONE 回执，也不能改写历史 outcome 来适配旧核销规则。

新增 `direct_provider_result` 收据读取原始聚合 `rows` 中的指定索引，或原始单次 wrapper JSON。核销要求：

- 收据文件摘要、dispatch 全行摘要及历史价格对象与独立审核批次一致；仅支持 answer/baseline。
- 唯一 dispatch ID、匹配的 fixture（若提供）、model/purpose（若提供）、无错误、非空可见输出、有效首段/完成时序，以及与账本一致且处于原上限内的正输入/输出用量。
- 审批明确列出该批全部直接调用 ID；普通历史审批不能隐式批准新收据类型。
- 审核批次还绑定计划、执行脚本、执行日志、供应商适配器、价格/币种证明和实际运行的预算/核销校验代码，执行前重新核对这些文件的摘要。

这些证据证明的是已审查脚本的 `provider.stream` 正常返回完整正用量。原记录没有保存供应商原始 HTTP 状态、响应 ID、finish_reason 或 DONE，不能声称验证了这些字段，亦不等同于供应商发票。

原有官方回执仍必须满足 `response_received`；只有独立逐条批准的新收据允许保留原 `unknown` 后追加不可改写的核销记录。失败、零用量、空输出或有歧义的记录保留最高预留。原始预留、dispatch、预算上限和 campaign 不变；仍使用原事务、幂等、并发准入及不可修改约束。

本次独立审核 76 条，精确批准 75 条；裁切题只产生 4096 个思考 token、无可见输出的一条保留 65536 micros。75 条按历史峰值价格保守核销为 244768 micros；核销后占用 310304 micros，剩余 4689696 micros。随后新调用继续逐次在同一 5 CNY 账本中预留。原 76 条逐字段未变，SQLite integrity_check=ok。

证据位于 `output/latency-2026-10-04/settlement-{batch,review,independent-dry-run,applied,after-verification}.json` 与 `settlement-independent-audit.md`。核销及预算测试 27/27、完整 Node 597/597、类型检查通过；含证据篡改、selector 混淆、缺少独立逐条审批、校验器漂移、错误/空输出、幂等、回滚及并发验证。


## 新增 71 条独立复核及落账（147 次派发）

同一独立复核者随后逐条检查原 76 次之后的新 71 次调用，批准精确新增集合：34 条聚合诊断、37 条客户端 wrapper，正用量、可见输出、原派发/回执/计划/脚本/价格边界均按现有适配校验；没有改适配器。新增批次 `additional-147-batch.json` SHA256 为 `9e6a9a1f67376ac0da328ad0bde50244331e1888d500fef288ca7dd2564e29a1`，独立审批 `additional-147-review.json` 为 `1a3a8ada336e3befdbb11a71eaedcb2c8e25e854de539ef11c36c0a74f50b8b5`。原批次和审批保持不变。

根代理重新核验摘要和只读 dry-run 后按精确批次 apply。新增核销 248164 micros，释放保守预留 4404892 micros；当前原 5 CNY campaign 总占用 **558468 micros（0.558468 CNY）**，剩余 **4441532 micros（4.441532 CNY）**。147 条原派发逐字段不变，原 75 条核销逐字段不变，累计 146 条核销；原空输出调用继续保留 65536 micros，未改历史 outcome。见 `additional-147-applied.json`。

独立审计明确历史 QA 二进制已被后续构建替换、两份旧解析源码摘要变化的复现限制；绑定的供应商读取计量代码/实际输出仍可核验，不能把新包当旧包，也不能声称厂商原始 HTTP/DONE 或最终账单已验证。候选多选误答、超时和缺失绘制仍按原验收失败保留；发生模型质量错误并不意味着供应商用量不存在。完整独立说明在 `additional-147-audit.md`。
