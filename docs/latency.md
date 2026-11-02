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

离线测试注入 mock provider，覆盖质量、计量、截断、失败停止、许可重用拒绝和调用次数边界，属于完整 verify/CI。候选检查器按需要显式运行；不要为了通过预检擅自重写冻结基线或批准旧 permit。

真实模型、请求上限、推理强度、图片和生产配置的变更必须有对应授权。直接供应商诊断不等于官方扣题或端到端验收；样本有限时不报告稳定 P95，不把不合格答案计为“可用答案”。
