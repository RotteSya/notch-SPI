# NotchSPI 2.15 正式发布 · 2026-10-03

2.15 / build 22 已于 2026-10-03 21:25（Asia/Shanghai）公开发布：[发行页](https://github.com/RotteSya/notch-SPI/releases/tag/v2.15)、[官方下载](https://notchspi-api.vercel.app/dl)。

## 发布内容

移除首次安装及更新后启动时的“匿名可靠性数据”弹窗，以及旧引导流程的弹窗显示记录。设置中的共享开关和遥测行为保持原状。

## 发布绑定与验证

- 标签 `v2.15` 对应 `3db0736a8c42ad48a4f5ae52638da5726be967d0`，版本提交已在 main。
- 干净发布工作树完整 `scripts/verify.sh` 通过：repo-health、类型检查、571 项 Node 测试、隔离服务 smoke、367 项 Swift 测试（4 项条件跳过、0 失败）、arm64 Release 和 diff 检查。
- [CI 37125813101](https://github.com/RotteSya/notch-SPI/actions/runs/37125813101) 10 项全部通过。
- 72 个构建输入摘要在打包后保持一致。DMG 为 3,777,064 字节，SHA-256 `4af9b77abd94fd954f453892c8ef04128b3b1f48666b119d9fe5e2d7d4dde8e2`。
- Apple 公证 Accepted：`0cef3691-5ea0-4475-a86d-ffe713ef6774`；DMG 签名、装订和 Gatekeeper 通过。只读挂载后 App 签名、Gatekeeper、2.15/22 版本与二进制一致性通过。
- GitHub latest 已指向 v2.15；正式 `/dl` 返回文件与本地产物逐字节一致，原始 `/update` 返回 2.15 / v2.15。

## 夸克交付

按用户要求使用本机夸克 CLI 上传同一份 DMG，云端文件名为 `NotchSPI-2.15.dmg`，位于“夸克网盘/来自：ClaudeCode”。CLI 返回一个文件上传成功，文件大小与发布产物一致。未创建分享链接。

本轮仅发布客户端安装包；未部署生产服务、修改数据库或调用付费模型。构建、公证、CI、公开下载与夸克上传回执保存在本机 `output/release-2.15-2026-10-03/`。
