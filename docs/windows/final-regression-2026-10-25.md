# 材质与动效修改后的整体回归 — 2026-10-25

分支 `codex/win-mac-parity-review`。保留此前授权的未提交改动；正式 Mac 产品体验未改，未推送、合并、发布或安装工具。

## 本轮发现并修复

日常视图每次刷新会重新生成按钮，原恢复逻辑仅按 `data-action` 查找：第二张题图 `preview/daily-1` 会跳到第一张 `preview/daily-0`；单图和多图查题也共用 `capture`，存在同类跳错风险。

先在真实 Electron renderer 中加入复现，确认断言失败且实际焦点为 `daily-0`，再修改 `desktop/ui/app.mjs`：按 action 和 value 同时定位，排除 disabled、inert 及没有布局框的控件，不把焦点恢复到另一个同类按钮。引导原有主按钮回退保留。

`desktop/test/daily-smoke.mjs` 增加精确焦点、按钮中心命中、GPU 丢失后预览等回归。没有改材质公式、业务流程、窗口透明、鼠标穿透或截图排除模块。

## 实际验证

- 新版正式 Mac 当前设置仍为五页新版界面。隔离原生参考程序的两图流程完成后，点击第二张确实打开「截图 2 / 2 · 预览」；Esc 返回后两张题图仍在。没有操作正式账户或修改正式设置。
- 同一错误状态重复刷新，第二张题图焦点仍为第二张，单图查题焦点仍为单图；保留修复前失败日志和修复后通过日志。
- 中文、日文、英文的答案、处理中、流式、待确认、错误、取消、重拍、解释失败、自动连答及 0/1/2/4 张收集状态：检查按钮显隐、禁用、卡片边界；新增浏览器实际命中测试，确认每个可用按钮中心没有被材质或其他层遮挡。
- 独立预览打开、Esc/Delete/窗口关闭、倒计时暂停恢复；停止自动连答、取消整轮、减少动态效果静止检查继续通过。
- 实际使 WebGL 上下文丢失，确认降级标记出现；随后按钮仍可点击，第二张题图仍打开正确预览。仅在隔离测试 renderer 中模拟，不影响系统 GPU 设置。
- 设置回归检查账户按钮显隐和更新时焦点、弹窗返回、人物像方向键与编辑、快捷键录入/退出；引导和截图飞入继续运行回归。

证据：`output/verification/final-regression-20261025/`（before-focus.log 为修复前失败）。完整检查：`output/verification/20261025T045840Z-78997/summary.tsv`。截图及几何结果在 `desktop/test-output/` 对应的 daily-parity、settings-parity、guide-parity、motion 目录。此前材质对照页 `NotchSPI-material-20261025/comparison.html` 保留；本轮修复的是刷新后焦点，不以静态截图代替交互验证。

## Windows 实机待验收

本轮完整结果：Mac arm64 Release 编译通过；桌面 322 项、服务端 684 项、调度器 17 项、仓库规则 61 项通过；Swift 604 项零失败，保留 4 项原有条件跳过。设置、日常、引导和飞入运行回归均通过。整体流水线仍失败于 scheduler 的 undici 已安装 7.29.1、锁文件要求 7.30.1；未安装或改锁。Postgres 未配置，硬件检查受环境限制，签名/公证未执行。编译通过、自动检查通过和 Windows 实机验收不能互相替代。

上述 Electron 运行环境是 Mac arm64，不能替代 Windows 实机。Windows DPI/字体、系统焦点、全局快捷键、GPU 驱动、透明合成、鼠标穿透、真实截图排除、休眠唤醒和实际动画帧率仍待验收。没有宣称完全一致或已满足 Windows 发布条件。

复现：`npm --prefix desktop run check`；`npm --prefix desktop run smoke:daily`、`smoke:settings`、`smoke:guide`、`smoke:motion`；`./scripts/verify.sh`。既有依赖版本不一致不通过安装、改锁或放宽检查处理。
