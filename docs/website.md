# 官网与本地预览

唯一启动入口见 [HANDOVER](../HANDOVER.md#专项操作与历史)。当前页面由 `server/src/site.ts` 组合 site-design、site-polish、site-continuation 和演示脚本；媒体由 site-media 及 `server/public/media/` 提供。

预览只绑定回环地址，不加载账户、数据库、模型或支付凭据。下载按钮仍指向实际下载入口；预览不是生产部署，也不验证安装包或付款。

## 行为与素材

页面提供中/日/英、单图与自动模式真实演示媒体、功能/价格/FAQ、键盘阶段及对照滑杆。保持现有 CSP、减少动态效果、手机/平板排版、实际功能开关及价格来源，不从历史精修报告恢复旧设计。

Mac 界面素材来源包含 `docs/windows/evidence/mac-build27-answer.png` 等原生隔离 QA 截图；Electron 图片是在 Mac 宿主上取得，不能称为 Windows 实机图。场景/设备图是示意素材，不是实时识题或线上结果。详细生成和精修原文见[历史索引](history/index.json)。

## 回归与发布来源

site、site-demo、v3-site 和 intel-download 测试覆盖页面、CSP、媒体 HEAD/Range、语言、开关、价格与下载兼容。删未用素材时，用相同输入比较各语言/入口/开关组合的 HTML 字节摘要。

[2026-11-02 部署证据](website-release-2026-11-02.json)记录冻结生产源加官网覆盖层的历史部署；其文件摘要不应重写为当前主树摘要。当前源码和生产后端不能据此视为完全一致。部署、模型、支付和下载包发布均需要独立授权。
