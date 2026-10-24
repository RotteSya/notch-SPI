# 跨屏飞入、完整 Ghost 与共享 UI 扩展

> 验收记录始于 2026-10-19，后续更新以各段日期和关联记录为准。本文的运行状态、测试计数和待验收项属于各次记录时点；2026-10-23 的提交整理没有执行 Windows 实机验收。

2026-10-19；Mac 基线 3.0 build 27 / `8b4f3f0`。本轮优先项已进入可运行产品代码，原生 Mac 默认路径也已接入共享模块。未修改已签名的 `output/release-3.0-build27/`。

## 实现

- **飞入**：每块显示器有独立透明、穿透点击、不可聚焦、置顶的动画窗口。全局 DIP 轨迹跨屏连续，每屏独立处理像素缩放。屏幕矩形与 Win32 DWM 窗口矩形提供真实来源；未知来源与减少动态效果按 Mac 的 180 ms 淡入。680 ms 三次缓动、30 pt 上抬、±2.2° 旋转、4 pt 边框形成、8 pt 圆角、阴影与动态落点均来自共享代码。
- **生命周期**：每张图有稳定 ID，独立飞入；截图录入、倒计时和服务请求不等动画。删除/取消/显示器移除/分辨率变化/系统挂起会清理对应动画；丢失目标有超时释放。预览不会改变图片归属。实际窗口原点参与坐标映射，修复了 macOS 33 pt 菜单栏偏移。
- **卡片交接**：128×80 收集槽、52×30 完成参考卡、原图比例、220 ms 落地轻摆/重排和320 ms参考条转换统一。全部飞行完成且有内容后才转紧凑条；目标与真实绘制卡片一致。缩略图提升至 480 px，对齐 Mac 默认解码精度。
- **Ghost**：完整眨眼/单眼眨眼、漂移、呼吸、弹性、3D 旋转、厚度与光照，思考 1.4 s、点阵1.05 s、完成1.25 s。过渡支持打断，完成从当前姿态衔接；减少动态效果使用静止姿态，隐藏时停止帧调度。原 Mac 的 Swift 绘制器保留，JS 引擎和 Notch 状态编排两端共用。
- **共享阅读**：结论、解释、复核提示、生成/失败状态、三语文本和字号层级来自 `shared/ui/reading.mjs`。Mac 完整答案与历史详情默认消费同一结构，保留原生可选文字、SwiftMath、滚动锚点、焦点和窗口尺寸策略；桌面端以转义 DOM/KaTeX 绘制。
- **完整引导**：欢迎→本地练习页→真实截图→首题结果→多图练习/收集→真实查题成功→主动体验领取；权限/失败/返回/关闭与检查点恢复齐全。只有可用结果推进，练习不写历史、不自动复制；两端共享检查点规则。体验状态以服务端回执为准，未隐式领取。
- **系统边界补全**：原服务的 `notchspi://plus` / `notchspi://account` 回跳进入账户并刷新服务端状态；不信任 URL 中的支付结论。Windows CLI 中止改为所属 PID 的进程树终止，不通过 shell 执行。

## 已验证的证据

| 项目 | 结果/证据 |
|---|---|
| 完整工程回归 | `output/verification/20261019T082735Z-55887/summary.tsv`：Swift 585（4 原有环境跳过）、服务683、scheduler17、工程51；Release/资源/路由通过 |
| 最后卡片/阅读/Ghost专项 | `output/windows-final-visual-regression.log`：92 项通过；原生 Release 再构建成功 |
| 引导共享迁移回归 | 最后44项Mac引导/边界/辅助功能/共享UI测试通过：`output/windows-onboarding-native-regression.log`；最终arm64 Release通过 |
| 原引擎逐帧对照 | 3 个种子 × 2,400 帧；混合24/60 fps步长、快速状态反转、睡眠唤醒与随机事件；全部17个数值字段与权重误差 < 1e-9 |
| 桌面回归 | `output/windows-node-tests.log`：68 项，包含既有真实本地服务端 E2E、几何、取消、删除/重排、准确落点、共享阅读、回跳和进程树参数 |
| 实际透明窗口 | `desktop/test-output/motion/result.json`：macOS/1512×982/2×，实际合成层有非透明题图像素；落地后窗口隐藏；取消无残留 |
| 实际人工式操作 | Mac完整答案长解释滚动；桌面4图删除第2张→3图重排→撤销恢复4图；Ghost工作/完成与飞入触发；本地账户0→主动领取400→单图真实截图→首题结果→两图真实截图→4秒自动提交→结果→体验已开启→完成引导 |
| 共享 UI 改动证明 | 隔离副本等待时间4→5、阅读字号15→16；真实Node组件与Swift组件消费新值；`output/shared-change-proof/result.json`，源项目不改值 |
| Windows 包 | x64 ZIP重新生成，全部所属源文件逐字节对照ASAR，依赖与fixture排除检查通过；`output/windows-delivery/manifest.json` |

实际截图：

- [Mac 共享完整答案](evidence/mac-shared-full-answer.png)、[Mac 滚动后的解释](evidence/mac-shared-reading-scroll.png)
- [桌面4图收集布局](evidence/desktop-shared-tray-four.png)、[Ghost工作状态](evidence/desktop-shared-ghost-working.png)
- [实际透明飞入层](evidence/desktop-flight-overlay.png)、[桌面完成状态](evidence/desktop-shared-ghost-completion.png)
- [引导欢迎](evidence/desktop-guide-welcome.png)、[首题结果](evidence/desktop-guide-first-answer.png)、[多图成功](evidence/desktop-guide-multiple-success.png)、[服务端体验状态](evidence/desktop-guide-trial-active.png)
- `evidence/native-ghost/` 为原生绘制器按不同尺寸和状态生成的真实像素回归样本。

所有桌面截图来自 **macOS Electron 宿主**，没有冒充 Windows 截图。飞入层截图只含该透明层，不包含桌面其他应用。动效 smoke 使用明确标注的练习题 fixture，不调用生产或付费模型。

## 维护和剩余验证

构建/运行命令统一在 [HANDOVER](../../HANDOVER.md)。常规修改 `shared/ui/` 后生成源文件，Mac使用生成的 JavaScriptCore代码/原生绘制，Windows直接使用同一模块；同一CI分别执行原生回归、桌面motion smoke与构建。无需复制Ghost/飞入/阅读结构的第二份实现。

Windows实机仍须验证：混合DPI/多物理屏幕下的Win32坐标与DWM合成，WGC截图排除/权限、60/120/144 Hz帧时间、键盘/IME、DPAPI、真实CLI进程树、协议回跳、NSIS安装与签名升级。当前Mac只有单物理屏，跨屏坐标覆盖由负坐标/竖排/混合比例用例验证，尚无跨物理屏录像。系统字体、文字栅格化、阴影和材质仍由对应平台绘制。

设置与引导保留平台视图；共享层覆盖阅读、卡片、动效及引导检查点。完整多阶段引导现已实现并在本机操作验证。检查中修复了引导被通用悬停计时器自动收起、体验已开启时仍展示领取提示的问题。引导测试使用实际屏幕捕获与HTTP/SSE，服务模型明确为本地mock；不等同于真实模型识别准确性验证，也没有把自动化模拟键等同于物理全局快捷键验收。
