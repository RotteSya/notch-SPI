# 客户端行为

当前 macOS 客户端的稳定行为。修改入口和测试名写在每节末尾。持久化字段的删除条件见 [compatibility.md](compatibility.md)。

## 截图与多图

热键在 `Sources/NotchSPI/Settings/Settings.swift`：⌘⇧1 讲题，⌘⇧2 多图（持久化键名仍是 `context`），⌘⇧9 人格测试，⌘⇧0 自动模式，⌘⇧Space 显隐。⌘⇧3–6 留给系统截图。

一次捕获读取当前目标的完整画面。预览打开时暂停提交，关闭后重新开始 4 秒倒计时。多图收集 2–4 张，最后一张成功后 4 秒提交；只有一张时继续等待。每张可以删除，删除后 8 秒内可以撤销。取消和迟到回调不得把过期图片送出。

测试：`ScreenshotRoundTests`、`ScreenshotIntakeTests`、`CaptureFlowStabilityTests`。

## 引导

启动进入 `NotchController.showOnboardingIfNeeded()`。欢迎页用 `NSPopUpButton` 切换简体中文、日本語、English，辅助功能标签为 `Language / 语言 / 言語`。体验页领取 72 小时、每日 400 次成功求解，北京时间零点重置。已完成或已收起的引导保持原状态，菜单可以重放。减少动态效果由系统设置决定；DEBUG 下 `NSPI_QA_REDUCE_MOTION=1` 强制开启。

`onboardingDone` 与 `onboarding.v3.dismissed` 继续表示完成和收起。

测试：`NotchOnboardingTests`、`OnboardingJourneyTests`、`OnboardingBoundsTests`、`OnboardingAccessibilityTests`、`OnboardingMotionTests`。

## 答案、公式与 Ghost

刘海流式展示答案。公式使用 SwiftMath 1.7.3，字体 bundle 随调试包和正式包交付。等待状态由 `GhostIndicator.swift` 绘制，源码来自 `Vendor/BotAvatarsKit`。长文本在刘海内换行；悬停展开，离开或主动收起后回到刘海。带刘海的机型避开硬件区域。

Release 构建排除本应用窗口的软件截图。DEBUG 只有显式 QA 开关可以放开。

测试：`ManualCollapseHoverTests`、`HardwareNotchLayoutTests`、`AnswerMathTests`、`GhostIndicatorTests`。

## 最近查题

合格的成功结果进入本机最近查题。回顾已保存的题目不再提交新请求。`NSPI_QA_EPHEMERAL=1` 时最近查题和遥测使用开发空间。

测试：`RecentQuestionTests`、`CaptureFileLifecycleTests`。

## 本地题库

本地题库入口、导入、检索和本地答案流程已经移除。Application Support 中的旧题库文件保持原样，当前应用不再读取。截图查题走已选择的官方服务、自定义 API Key 或本机 CLI。

## 三通道

新安装默认官方服务。自定义 Key 与本机 CLI 仍是产品通道。隔离开发包使用独立 bundle、空偏好、`-official.baseURL` 和 `NSPI_QA_EPHEMERAL=1`，从而走 loopback 上的 official mock。

账户、重试、401 和流恢复：`OfficialAccountStateTests`、`OfficialCaptureRunTests`、`OfficialStreamTransportTests`。
