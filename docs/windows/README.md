# Windows 实现与验收入口

构建、开发与运行统一从 [HANDOVER](../../HANDOVER.md#windows) 进入。Electron 客户端、共享规则和回归位于本仓库；Windows 10 2004+ 为截图排除边界。Mac 宿主 Electron 通过不等于 Windows 实机通过。

- [共享架构与候选追溯](architecture.md)
- [Mac 包追溯](mac-provenance.md)
- [实机操作清单](manual-acceptance.md)
- [总体闭环条件](closure-plan.md)
- [本轮 macOS 3.1 对齐表](macos-alignment.md)
- [历史提交、截图来源及交付报告](../history/index.json)

源码提供截图/多图、流式答案、自动连答、人物像、历史、三通道、账户与付款回跳、系统凭据、更新和本地报告。各能力的验证强度不同；正式签名、安装升级、DPI、多屏、真实截图排除与支付回跳需要绑定候选的 Windows 证据。

产物从打包器的独立候选目录及 delivery-manifest 取得，不使用历史报告中的旧平铺 ZIP 路径。发布需要独立授权；本地测试包不会自动上传报告。
