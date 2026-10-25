# 图标、材质与动态光效 — 2026-10-25

基准：正式 Mac 3.0 build 27 当前快捷键页面辅助功能树，以及新版隔离参考程序的错误页实窗。截图保留在用户截图目录 `NotchSPI-material-20261025/comparison.html`；右侧均为 Mac 宿主 Electron，不是 Windows 实机。

## 本轮实际修改

- `desktop/ui/app.mjs`：修正偏窄的齿轮轮廓、键盘按键与圆角轮廓；材质深度和几何弹簧分开推进，沿用 Mac out-cubic 深度变化；阴影由错误的向上投射改为向下，并随展开渐变。完成姿态保留深度，防止下一次状态切换得到无效材质值。
- `desktop/ui/surface.mjs`：移植 Mac 的 96×96 静态噪声算法、黑色底面、底部冷色微光和轮廓高光。噪声仅初始化一次，装饰层不接收鼠标。保持刘海外部透明；Mac 本身也不是对桌面做磨砂采样，因此没有为了“透明材质”加入会改变体验的背景模糊。
- `desktop/ui/light-field.mjs`：把 `NotchLuma.swift` 的光效公式转成 WebGL；保持下部光池、缓慢流动、处理中扫光、流式输出稳定光、错误暖色、截图落地/答案完成脉冲。状态插值系数与 Mac 一致，展开最多 60 Hz、收起过渡最多 30 Hz，隐藏时暂停，收起稳定后停止。减少动态效果使用固定时间且取消脉冲；GPU 不可用时保留黑色材质，不影响按钮或查题。
- `desktop/ui/style.css`：材质层和控制按钮反馈；设置/收起按钮悬停背景及按压时 0.94 缩放、0.72 透明度，对齐 Mac 控制按钮；其他业务按钮不受影响。
- `desktop/test/surface.test.mjs`、`daily-smoke.mjs`：覆盖材质边界、静态噪声、光效状态、高刷新率节奏、反复切换后材质仍有效、真实 shader 编译、装饰层不拦截鼠标，以及减少动态效果下两次实窗截图相同。

Mac 产品实现未修改；窗口创建、穿透和截图排除模块未改，原有保护回归未删除或放宽。没有推送、发布、安装工具。

## 验证与边界

本轮日志：`output/verification/material-parity-20261025/`。设置、日常、引导、飞入运行回归均在 Mac arm64 Electron；飞入连续采集、落地与取消通过。截图确认低亮度颗粒、暖色错误光和图标已实际显示；并不宣称所有渲染像素完全相同。

完整项目检查：`output/verification/20261025T045207Z-70822/summary.tsv`。编译和自动测试结果单列记录；完整检查的既有 dependency-lock 问题不通过安装或改锁绕过。

- 编译：Mac arm64 Release、服务端/调度器类型检查、调度器构建通过。没有 Windows 打包或安装结论。
- 自动测试：桌面 322 项全通过；Swift 604 项零失败、4 项原有条件跳过；服务端 684 项、调度器 17 项、仓库规则 61 项通过。
- 界面与动效：上述实窗回归通过，减少动态效果下的连续截图相同；Windows 原生像素排除检查未运行。
- 完整检查整体失败：scheduler 已装 undici 7.29.1，锁文件要求 7.30.1。Postgres 未配置，硬件检查受环境限制，签名/公证未执行；没有放宽任何检查。

Windows 实机仍待验收：GPU/WebGL 可用性与驱动表现、透明合成、鼠标穿透、真实截图排除、不同 DPI 和字体、帧率及睡眠唤醒。Mac 上 Electron 的通过结果不能替代这些结论。原生 SF Symbols 与自绘 SVG 仍可能存在细微轮廓差异，Metal/WebGL 的色彩合成也需实机对比。

复现：`npm --prefix desktop run check`，`npm --prefix desktop run smoke:daily`、`smoke:settings`、`smoke:guide`、`smoke:motion`，`./scripts/verify.sh`。
