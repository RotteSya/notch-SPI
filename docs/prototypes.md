# 预览与 QA 边界

启动命令统一在 [HANDOVER](../HANDOVER.md#专项操作与历史)。这些工具用于隔离验收，不代表生产能力或发布授权。

## 当前入口

- `ExpandedAnswerWindow.swift` 仍由 `DesignVisualQA` 和测试调用；日常齿轮菜单不提供该窗口。
- `scripts/design-qa.sh` 组装独立设计 QA bundle；`scripts/onboarding-qa.sh` 提供 mock 引导。
- `server/tools/settings-preview.ts` 是回环地址上的内存预览，模拟账户和 Plus 状态；禁用外部 fetch。它与真实 Stripe 沙箱是不同用途，保留类型检查。
- `scripts/plus-sandbox/` 验证正式 Plus 的沙箱支付与独立回跳 scheme；需要既有沙箱授权，不使用真实账户或生产付款。
- `scripts/run-objective-diagnostic.mjs` 直接调用供应商，输出到 `objective-eval-output/diagnostics`，不经过评测预算模块。验证与 CI 不运行它。

## 已退役

30 天、不自动续费的旧月票原型已成组移除，原文和源码保存在 [历史归档](history/README.md)。正式 Plus 仍由 `PlusSubscriptionPage.swift` 与 `server/src/plus-*.ts` 实现；规则以 [API 契约](official-api.md) 为准。免费体验、题包、完整答案 QA 和迁移路径不受此次退役影响。
