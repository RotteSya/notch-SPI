# 延迟诊断与实验边界

启动与验证入口见 [HANDOVER](../HANDOVER.md)。本参考只描述当前工具；历史指标、失败样本、部署与预算批准均见[历史索引](history/index.json)，不构成新的调用授权。

## 测量所有者

- Mac：CaptureLatency、OfficialTransportTiming；NSPI_LATENCY_TRACE=1 只在本地 QA 隔离条件下启用，不新增匿名事件或用户内容。
- 服务端：capture-timing、capture-service、providers；首字节、首个内容、完整结果与快捷键到可用答案是不同指标，不能互换。
- 离线汇总：`scripts/report-capture-latency.mjs` 读取显式 QA 日志，不联网。
- 质量运行器：`scripts/run-latency-prompt-quality.mjs` 默认离线预检，真实运行需要完整摘要绑定、尚未使用的独立许可和明确 provider 输入；失败停止，不重试。

## 固定输入与验证

`docs/experiments/` 是候选配置；`latency-actual-prompt-2026-10-30.json` 是离线检查器消费的实际旧提示词快照，保持路径和字节。它们均不代表已上线应用提示词。

```sh
node --test scripts/fixtures/latency-prompt-quality.test.mjs
node scripts/report-capture-latency.mjs <QA-log>
```

旧命令默认目标仍为2000ms。本次完整答案均值6000ms、单题10000ms的计时检查必须显式指定：

```sh
node scripts/report-capture-latency.mjs --target-ms 6000 --single-limit-ms 10000 --draw-stage renderCompleted <QA-log>
```

`renderStarted` 在逐字绘制之前记录；`renderCompleted` 在同一可见最终答案的CoreText及附件绘制之后记录，仍不测WindowServer合成/屏幕扫描。旧日志不能补算绘制结束；旧默认命令保留开始点，报告明确输出endpoint_stage和endpoint_is_draw_completion。新的6秒验收必须指定renderCompleted，缺失结束点保留为缺失，不能回退到开始点。

官方QA传输日志的firstEvent是首个已解码SSE事件，uptime_ms与QA的key_posted_uptime_ms使用同一系统单调时钟，可按capture_id关联直接及预读请求；不是上游首字节或首段可见答案。旧nativeJob.firstEvent仅为usage/delta回调，不能混为新首事件。

`complete_answer_timing_targets_met_in_sample` 要求所选绘制点均值不超过目标、最大值不超过单题上限，且没有失败或缺失。它只判断计时资格，仍需核对冻结计划、全部正常题答案正确完整和独立质量记录。首段文字、完整响应和完整答案绘制分别汇总；日志没有首事件时不会推算该时间。超过时限的比例以有完整绘制的样本为分母，同时报告失败、缺失及全部触发中未在目标内完成的比例；两个P95字段均在少于20个完整样本时留空。

离线测试注入 mock provider，覆盖质量、计量、截断、失败停止、许可重用拒绝和调用次数边界，属于完整 verify/CI。候选检查器按需要显式运行；不要为了通过预检擅自重写冻结基线或批准旧 permit。

真实模型、请求上限、推理强度、图片和生产配置的变更必须有对应授权。直接供应商诊断不等于官方扣题或端到端验收；样本有限时不报告稳定 P95，不把不合格答案计为“可用答案”。
