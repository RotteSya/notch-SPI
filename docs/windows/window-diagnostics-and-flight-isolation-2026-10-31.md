# R4 反馈：窗口诊断与动画失败隔离

2026-10-31。本地修改，未安装依赖、推送、合并或发布。Windows 实机未验证，不能据此宣称 Y7000P 上刘海消失已修复。

## 问题与处理

R4 报告有一次 10.440 秒截图准备等待，以及一次“截图已就绪、解题尚未开始”的失败。窗口隐藏、最小化、恢复等缺少记录，消失原因尚未确定。原始分析与时间线保存在 `output/windows-r4-feedback-2026-10-31/`。

1. 本地测试报告新增窗口角色、show/hide/minimize/restore/focus/blur/unresponsive/responsive/closed、可见/最小化/焦点/销毁布尔状态，以及主刘海的预期可见状态。记录隐藏快捷键、托盘恢复、第二实例恢复入口；渲染退出带窗口角色，另记录 GPU 子进程退出固定原因。仅本地报告构建启用，不上传。
2. Mac-host Electron 的真实检查发现：hide() 后 isVisible() 已 false，但没有收到 hide 事件。增加每 250ms 状态核对，仅状态变化时写日志；原生事件已记录的状态不重复写，窗口关闭后停止。短于采样间隔且没有原生事件的变化仍可能漏记；这不是录屏或帧率测量。
3. 实际查题不再 await `flights.prepareEvidence()`。这是动画取证读回步骤，正常飞入队列本身会等待 renderer 和目标位置就绪才开始计时。保留原有动画参数、队列生命周期和取证方法。没有启动异步预热任务，因此不存在取消后由预热回调补发旧动画的问题。
4. 飞入入队异常单独记 `flight_failed`，题图继续进入原有解题/多图路径。动画窗口仅在保护与穿透初始化成功后进入队列；初始化失败清理窗口，页面加载 Promise 拒绝也被处理，避免变成未处理拒绝。
5. 托盘显示主刘海时同步 `state.visible=true`，与第二实例恢复保持一致。不做强制显示循环，不覆盖用户主动隐藏。

没有修改 Mac Swift 产品代码、光效或飞入动画时长、透明、穿透与截图排除策略。日志不读取窗口标题或 URL，不保存题图、答案、路径、原始异常文本。原有网站未提交改动保留。

## 回归与验收边界

新增回归覆盖：动画取证挂起/拒绝不被用户路径调用、飞入失败后仍可继续及下次入队、取消无迟到入队、renderer 就绪后才启动动画时钟；窗口事件与角色经 ZIP 导出、敏感字段过滤、无原生事件时状态变化仍记录、稳定状态不重复写、关闭后停止采样。真实 Electron smoke 还检查隐藏/再显示的状态记录。

新增真实 smoke 最初失败，因为仅靠原生 hide 事件漏记；修复的是诊断实现，最终断言仍要求“隐藏状态已记录、恢复状态已记录、窗口实际恢复”。没有延长现有 smoke 总超时或降低现有像素、动作断言。

最终桌面检查：364 tests passed，0 skipped。日常交互 smoke、最终动效 smoke、最终本地报告窗口 smoke 通过。均在 Mac-host Electron，不能替代 Windows 合成器/任务栏/焦点/像素验收。完整验证和其已知依赖失败见下方结果补记。

Windows 待验收：原浏览器截图步骤下是否仍卡顿/消失；窗口预期和实际状态、最小化/恢复及 GPU 退出记录；透明、鼠标穿透、截图排除连续像素；动画节奏、任务栏恢复、多 DPI。截图准备的 10.440 秒发生在动画预热之前，本轮不宣称这段耗时已优化。没有制作新 Windows 安装包或发布构建。

## 涉及文件

- `desktop/main.mjs`：接入窗口诊断、恢复入口状态与非阻断飞入、离线 smoke。
- `desktop/core/local-test-report.mjs`、`window-diagnostics.mjs`：白名单日志与状态观察。
- `desktop/core/capture-flight.mjs`、`desktop/platform/flights.mjs`：动画入队失败隔离和窗口清理。
- `desktop/test/capture-flight.test.mjs`、`window-diagnostics.test.mjs`、`window-diagnostics-smoke.mjs`：新增回归。

## 最终验证结果

- 完整验证：`output/verification/20261031T041638Z-74263/summary.tsv`。server 698、scheduler 17、Swift 616、工程检查器 61 项通过；类型检查、生成一致性、隔离 smoke、两个 scheduler 构建、Mac arm64 Release、资源、不可变证据、路由清单与空白检查通过。
- 完整验证启动时 desktop 为 363 项。之后完成无事件状态核对回归与动画窗口失败清理，最终单独重跑 desktop check 为 364 项全部通过；最终 motion 和 local-report smoke 也重跑通过。没有把较早全量运行描述成最终每个文件的全量复测。
- 完整验证唯一失败：scheduler 锁定 undici 7.30.1，本机为 7.29.1。保持失败，不安装、不修改锁文件或检查器。Postgres 因原有 TEST_POSTGRES_URL 未设置条件未运行；硬件 blocked，签名不在此命令范围。未新增测试跳过。
- `repo-health --delivery` 未通过：本轮文件未暂存/未提交，以及已有两处网站修改不在 index。普通 repo-health 和 diff 空白检查通过。未擅自暂存、提交或处理网站改动。
- 本地证据：`output/windows-r4-feedback-2026-10-31/desktop-check-final.log`、`daily.log`、`motion-final.log`、`local-report-smoke-final.log`、`window-diagnostics-smoke.zip`。早期新 smoke 失败日志也保留，没有覆盖成通过。
- 编译成功不等于 Windows UI 验收。没有新 Windows 包；透明/穿透/排除策略未改，实际 Windows 连续截图像素、焦点、动画和刘海消失复现仍待验收。
