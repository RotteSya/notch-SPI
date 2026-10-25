# Windows 引导对齐记录（2026-10-24）

## 本轮范围

基线分支 `codex/win-mac-parity-review`，修改前 HEAD `952e459b6a7bdb24152cb7b8d10eed9cbbb28ae7`，工作区干净。按用户确认先修 P0，再对齐引导布局与动效。没有修改 Mac 原生产品行为、安装依赖、推送、发布或修改系统设置。

实际安装运行的 Mac 是 `/Applications/NotchSPI.app` 3.0（27）。已实际核对欢迎、截图说明和“修改快捷键”跳转；安装版受保护窗口的截图是白图。另用当前源码的既有离线 `guide-walkthrough` QA 入口取得可截图的原生参考。这个参考不替代安装版二进制来源证明，也不代表 Windows 实机。

## 已改内容

- 引导专用头部：保留品牌和顶部右侧“稍后继续”；不再混入普通刘海的状态、作答档位、收起、设置菜单。
- 底部按步骤放置语言、返回、主操作和修改快捷键。账户入口不再贯穿引导。截图键帽是被动提示，不再伪装成可点击截图按钮。“修改快捷键”打开 shortcuts 页。
- 返回按步骤处理：处理中、收集中和成功页不提供普通返回；失败后单图回 capture、多图回 multiple；multiCapture 回 multiple；multiple 回 welcome；权限页回原练习。
- “稍后继续”与取消分离：收起正在处理的引导不 abort 请求；收起多图收集中取消本轮，避免离开后自动提交。Esc 使用同样语义。Tab/Shift-Tab 按 Mac 的引导控件顺序循环。
- 多图说明区区分张数、截图中、预览中、满四张；快捷键帮助依状态显隐。
- 体验页区分检查、领取、失败、不可用、成功、过期和不符合条件；成功后保留确认页，再开始使用。恢复到体验检查点会刷新状态，旧异步结果不能覆盖新的引导会话。
- 引导插画换成屏幕、题图、权限和日历；对齐主按钮颜色、键帽、标题／正文层级和左右操作位置。换页文案 240ms、插画 560ms；操作区随刘海高度变化，重绘保留动画进度，尊重减少动态效果。
- Mac 原生源码未改变布局或流程。共享生成 Swift 只新增未被原生产品调用的控件契约函数；新增 XCTest 使用它核对原生控件。

## 文件

运行代码：`desktop/main.mjs`、`desktop/ui/app.mjs`、`desktop/ui/onboarding.mjs`、`desktop/ui/style.css`、`shared/ui/onboarding.mjs`；共享生成文件同步。

验证：`desktop/test/guide-presentation.test.mjs`、`desktop/test/guide-smoke.mjs`、`Tests/NotchSPITests/NotchOnboardingTests.swift`；`desktop/package.json` 新增 `smoke:guide`，无依赖变更。

`desktop/platform/`、原有透明窗口参数、鼠标穿透和截图排除实现没有修改。

## 验证与复现

- `npm --prefix desktop run check`：267/267，通过，无跳过。
- 原生 `NotchOnboardingTests`：23/23，通过。新增共享契约覆盖 11 步骤 × 8 体验状态 × 4 交互状态，直接核对 Mac 控件，而非仅核对两份声明。
- `npm --prefix desktop run smoke:guide`：通过。33 个中日英步骤组合的渲染、按钮边界与重叠；体验状态禁用；处理中收起不 abort；收集中退出取消；成功确认完成；高度改变时的连续帧检查。结果位于 `desktop/test-output/guide-parity/results.json`、`motion.json`，各步骤 PNG 同目录。
- `npm --prefix desktop run smoke:motion`：通过，`NSPI_DESKTOP_MOTION_OK`。这是 macOS 宿主上的 Electron 动效／飞入回归，不是 Windows 像素排除证据。
- 全仓验证：`output/verification/20261024T145939Z-3349/summary.tsv`。Swift 600 项、0 失败、4 项原有条件跳过；server 684 项、scheduler 17 项、仓库检查器 61 项，以及类型检查和资源检查通过。arm64 Release 编译通过。
- **全仓 verify 总结果失败**：scheduler 已安装 undici 7.29.1，而锁文件为 7.30.1。未安装、未放宽校验；desktop 的独立依赖校验通过。Postgres 未配置导致原有跳过；硬件标记 blocked；签名不属于本次检查。没有新增跳过或放宽现有断言。

手动操作复现：运行隔离 `electron . --qa onboarding`，欢迎页点击“试一道题”，确认截图指引只有返回、被动键帽和修改快捷键；点击修改快捷键应直达快捷键页；返回欢迎页后验证语言选择；Esc 收起引导。该离线预览不连接正式账户，不用于验证真实领取。

## 图片与边界

截图按用户默认目录保存于 `~/Desktop/Screenshot/NotchSPI-parity-20261024/`：

- `mac-source-welcome.png`、`mac-source-capture.png`：当前 Mac 源码的独立离线参考，中文、600pt 卡片、2×截图。
- `electron-welcome.png`、`electron-capture.png`：Windows 共用界面在 Mac 宿主的实际渲染，中文、600 CSS px 卡片、2×截图。

图片包含不同截图边界／阴影留白，不按原图外框比较窗口尺寸。主流程已对齐，材质、阴影、文字栅格化和最终像素外观尚不能宣称完全一致。

待验收：Windows 10/11 原生合成下的透明、鼠标穿透、窗口激活、Tab/Esc、DPI／多屏、截图飞入、截图排除，以及双端同显示条件的录像。真实领取与账户网络流程未在本次用正式账户执行。正常答案、多图、自动连答等全流程视觉精修仍需另按已批准清单逐项验收，本轮不宣称整个 Windows 客户端完全对齐。
