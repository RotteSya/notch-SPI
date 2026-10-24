# Windows 实现与验收入口

2026-10-19，基线 macOS **3.0 build 27 / Git 8b4f3f0**。本轮交付 Windows Electron 客户端源码、x64 ZIP、共享规则生成器、真实本地后端回归和双平台 CI。已继续完成跨屏飞入、完整 Ghost、完整多阶段引导和共享 UI 扩展，见 [本轮实现与验收](motion-and-shared-ui.md)。Windows 安装包仍需实机验收与正式签名。

构建、开发、运行的唯一权威步骤在 [HANDOVER 的 Windows 小节](../../HANDOVER.md#windows)。

- 2026-10-21 ZIP 修复：[连续截图保持刘海可见、飞入连续与截图排除](visible-capture-2026-10-21.md)，替换前一轮的 Windows 隐藏/恢复取帧方案，含新包摘要和验证边界。
- 2026-10-20 ZIP 修复：[刘海收起、截图保护、设置拖动、账户刷新与扣次查询](bugfix-2026-10-20.md)，保留历史验证记录。
- Windows 包：`desktop/dist/NotchSPI-3.0.27-Windows-x64.zip`；摘要：`output/windows-delivery/manifest.json`
- [Mac 基线、界面与动效规格](baseline.md)
- [共享架构、实际共享改动证明及维护边界](architecture.md)
- [检查结果、差异与 Windows 实机验收清单](validation.md)
- [给测试者的逐步操作清单（零基础版）](manual-acceptance.md)
- [Windows 前置基线归档](../history/README.md)

本次未推送、部署、发布、操作生产数据库、付款或修改现有 Mac 发行快照。生产客户端仍指向现有官方 API；开发入口使用隔离本地 Fastify、内存数据库和明确标记的模型 fixture。

## 交付范围

实现了完整单图/多图练习引导、顶部浮层、单图/多图、全局快捷键、窗口/屏幕截图、截图预览/删除/撤销、流式答案与公式、取消、结算查询、显式补取、解释、重新截图、自动连答、人物像及上下文、三语言五页设置、最近查题、账户注册/恢复/主动体验、题包保护、订阅/题包浏览器入口、自定义 API、受账户开关约束的本地 CLI，以及 Windows 登录启动、系统凭据加密和签名更新适配。

这些功能的验证强度不同。查题 HTTP/SSE/结算经过现有真实服务端端到端测试；截图、全局快捷键、Windows 凭据存储、原生 CLI、安装更新和付款回跳需要 Windows 条件或沙箱账户进一步验收。详见验证矩阵，不能把“有实现”或“ZIP 已生成”当成“体验已一致”。

## 后续一次更新如何交付两端

修改 `shared/product.json`、`shared/prompts.json` 或 `server/src/objective-result.ts` 后，运行生成器，提交源文件和生成文件。CI 从同一提交执行两端回归，生成 AppKit Mac 包与 Windows ZIP/NSIS。实际已用等待时间 4→5 秒、阅读字号 15→16 在隔离副本验证两个运行时消费同一改动，主项目保持原值。

**新增共享 UI 来源为 `shared/ui/`：完整 Ghost 仿真与状态编排、飞行几何、截图卡片规格、答案/解释/复核提示结构及层级、引导检查点规则。** Mac 原生完整答案、历史详情与 Ghost 已实际消费它；Windows 使用同一 JS 模块。设置、引导、窗口和底层文字/材质绘制仍由各平台适配，不等于整个 AppKit 界面已改成 Web。
