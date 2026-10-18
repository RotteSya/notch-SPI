# 预览与 QA 入口

这些入口留在源码里，供 DEBUG 和验收使用。它们有自己的状态，不改变已发布的计费和菜单。

## Plus 月票预览

`Sources/NotchSPI/Cloud/MonthPass.swift` 与 `MonthPassAccountPage.swift` 有 DEBUG 入口。预览页面由 `server/src/month-pass-page.ts` 渲染，本机查看用 `scripts/preview-month-pass.mjs`（`127.0.0.1:43069`）。

历史离线预览：CNY 69.00、30 天、每日 400 次成功求解、360 次提醒、上海时区重置。正式题包价格仍是 `pricing.ts` 里的 300 / 800 / 2200。免费体验是另一套实现：72 小时、每日 400 次，见 [official-api.md](official-api.md)。

购买页模块 `server/src/purchase-page.ts` 只渲染正式题包页。

测试：`server/test/month-pass-preview.test.ts`。

正式 3.0 候选实现位于 PlusSubscriptionPage.swift 与 server/src/plus-*.ts：按自然月自动续费、每日 400 次、付款回执、到期账本、取消续费和账单管理。旧预览仍为离线样例，不接入付款；正式入口是设置中的 NotchSPI Plus。尚未正式部署。

## 完整答案窗口

`ExpandedAnswerWindow.swift` 仍被 `DesignVisualQA` 和测试调用。日常齿轮菜单不再提供这个窗口。离线样例：

```sh
bash scripts/design-qa.sh expanded-answer
```

`scripts/design-qa.sh` 组装隔离 bundle `com.rottesya.notchspi.design-qa`，不连接真实账户。`scripts/onboarding-qa.sh --mock` 只跑引导验收。

## 直接供应商诊断

`scripts/run-objective-diagnostic.mjs` 可以直接运行，结果写到 `objective-eval-output/diagnostics`。它单独调用供应商，不经过 `docs/evaluation-budget.json` 使用的预算模块。验证和 CI 不运行它。
