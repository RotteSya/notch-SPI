# 3.0 build 27 发布准备完成记录

2026-10-19。当前本地发版候选为 **3.0 build 27**，替代 10 月 17 日的 build 26；旧候选只作历史证据。尚未正式发布，未部署生产、修改 Stripe、开启 Plus、推送标签或更新公开下载。

## 已完成

- 基于源码提交 `3c47cf928e29d931359d87e66ab5d1dd9d8e08cd`，只将 VERSION.env 的 build 从 26 调整为 27；包括最新设置五页改版、Plus 日期修正及 100 题/无限自动连答。
- 重新构建 arm64 Release，使用 Developer ID `TZ2T95MG29` 与 hardened runtime 签名。Apple 公证 Accepted，票据装订及验证通过。
- 公证 ID：`82a1726f-e801-4ef6-81d7-4d054f82e9c8`。
- 安装包：`output/release-3.0-build27/NotchSPI-3.0-build27.dmg`。SHA-256：`7759d26f03fa10e60edf3c51b8500196da37328aafd9f609701146a2f0de00d6`。
- 挂载 DMG 后核对版本、build 与可执行文件一致性；App 严格签名校验和 Gatekeeper 通过（Notarized Developer ID）。
- 下载公开版 2.17，与候选核对 Bundle ID、Team ID、designated requirement、最低系统和既有 URL scheme，升级身份兼容通过。此检查不替代系统权限的真实覆盖升级验收。
- 该源码 CI 11 个任务全部通过，涵盖 macOS、Node 22/24、Postgres 16/17 四组合、Cloudflare、AL2023 与 Vercel Linux 函数包。[CI 证据](https://github.com/RotteSya/notch-SPI/actions/runs/39145400435)。本地此前全量为 Swift 582 项（4 跳过）、服务端 683 项。
- build 27 本轮 `verify.sh --quick` 全通过：工程检查器 51 项、两端类型检查、隔离 smoke；记录 `output/verification/20261019T053745Z-38650/`。仅修改版本资源，无新增业务代码，未重复全量测试。
- 冻结跟踪源码及逐文件 SHA-256，归档该提交 CI 已验证的 Vercel Linux 函数包、候选清单、发布说明、更新 JSON 预览与本地 Release 草稿。源码快照记录打包时的文件状态；后续发布交接文档不在此冻结快照中。
- Windows 共享后端与平台实现边界见 [Windows 交接](windows-port-handoff.md)。

## 归档与后续发布使用

所有本地产物位于 `output/release-3.0-build27/`。`release-notes.md` 为上线后使用的文案，Plus 尚未上线时不能对外发布该文案。`update-preview.json` 仅供核对；生产 `/update` 实际从 GitHub latest Release 生成，并不读取此文件。正式上传 DMG 的资产名须为 `NotchSPI.dmg`，以符合现有下载配置。

公开版目前仍为 2.17；旧版没有新安装器，需手动安装一次 3.0。GitHub 中仍有未发布的 2.18 草稿，本轮未修改；正式发 3.0 时应避免误发该旧草稿。

## 留待实机与正式上线阶段

1. 使用此 build 27 验证正式覆盖升级后的设置、历史、余额与录屏授权保留；最低 macOS 14、外接屏热插拔/缩放/Spaces/唤醒。已有沙箱回跳、取消续费与截图权限用户确认仍有效，但不替代这些项目。
2. 验证重启后订阅状态、延后领取体验与计时，以及最新签名包的原生使用流程。已有三语设置页面验收与沙箱生命周期记录可复用；不能扩展为所有硬件通过。
3. 生产基线须在上线前重新读取。当前 Plus API 仍为 404；按 [生产方案](plus-3.0-production-plan.md) 分离环境凭据、确认密钥权限、部署兼容后端并完成迁移、补齐 webhook 和默认门户、验证签名投递。保持旧题包与已付权益兼容。
4. 最终授权后启用 Plus、发布 Release/公开下载，再核对 `/update`、`/dl` 与安装链路。先后端、后客户端。客户端回退保留旧安装包；Plus 已有付款后不能直接回滚成不认识 Plus 的后端。
5. 全产品财务合并面板与 Plus 退款自动撤销权益尚未实现；现阶段使用 Stripe 独立对账和人工处理订阅/退款，不作为已完成特性宣传。

结论：可在此冻结基线上开始 Windows 开发；macOS 本地打包签名公证和发布材料已准备，实机验收与生产上线步骤仍待完成。
