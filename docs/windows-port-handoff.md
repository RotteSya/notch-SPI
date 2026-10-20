# Windows 版本开发交接基线

2026-10-19。macOS 3.0 候选 build 27；应用源码基于 `3c47cf928e29d931359d87e66ab5d1dd9d8e08cd`，本次仅调整构建号和发布交接材料。冻结源码及逐文件摘要位于 `output/release-3.0-build27/`。macOS 尚未正式发布，生产 Plus API 尚未上线。

## 可以复用的部分

- `server/`：账户、体验、题包、Plus、支付、流式问答、用量结算与数据存储。Windows 无需再实现一套收费后端。
- `docs/official-api.md`：HTTP/SSE 契约；`docs/client-behavior.md`：客户端行为；`docs/compatibility.md`：升级与旧账户兼容约定。
- `Tests/Fixtures/` 与 `server/test/`：协议、计费、答案质量的既有验收资料。
- 产品规则保持一致：成功结果扣 1 次；失败不扣；回看不扣；体验 → Plus → 题包的消费顺序；体验主动领取后计时；Plus 北京时间零点重置。

## Windows 必须单独实现和验收的部分

- 系统截图、全局热键、多显示器与 DPI、浮层定位、取消/失败恢复。
- 安全凭据存储、账户恢复和支付浏览器回跳注册；不能直接照搬 macOS Keychain/URL scheme 安装实现。
- 流式答案、公式、最近查题本机存储和隐私清理；三语言与键盘可访问性。
- Windows 安装、卸载、代码签名和更新回退。macOS 的 Developer ID、公证与 DMG 不适用。
- Swift/AppKit/Carbon/ScreenCaptureKit 界面与系统桥接需要重写；本文件不预设 Windows 技术栈。

## 开发边界

使用独立开发配置和 mock/沙箱，不复用生产支付凭据或生产数据库。保持 macOS 候选源码快照不变；后续共享后端变更同时验证两个平台契约。正式发布执行顺序见 `docs/plus-3.0-production-plan.md`，不能因 Windows 开始开发而将待验收事项记为通过。
