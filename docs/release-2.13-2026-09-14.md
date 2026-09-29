# NotchSPI 2.13 正式发布 · 2026-09-14

2.13 / build 20 已公开发布：[发行页](https://github.com/RotteSya/notch-SPI/releases/tag/v2.13)、[官方下载](https://notchspi-api.vercel.app/dl)。本次为客户端更新，服务端、模型、额度与生产配置未变。

## 发布绑定

- 发布标签：`v2.13`，提交 `80cc512616c30f93e52d9c98f65c6da923dd7a37`，PR #10 已合并。
- 经过 CI 的源码：`8d21c638ffd3c5ea7bec5f3742c3c550c164e48a`；合并提交的完整 tree 与其一致。
- 独立发布目录：`native-release-2-13`，基于 2.12 发布源码，只加入本次客户端改动。
- DMG：3,573,753 字节，SHA-256 `48e684a6e080944866df5cecc0785a1eb54544779e90f8c4d499befa3f9a2f1e`。
- Apple 公证 Accepted：`4c04387c-714e-49e9-8cb4-3ac55511fc85`；装订、DMG Gatekeeper、挂载后的 App 签名与 Gatekeeper 均通过，70 个构建输入摘要与候选一致。

## 验证

最终 CI `34767207622` 的 10 项全部通过；本地完整 `scripts/verify.sh` 通过，Swift 344 项、4 项条件跳过、0 失败，Node 571 项。最初 CI 的旧 SDK NSImage Sendable 错误已修复：后台传递 CGImage，在主线程创建 NSImage；最终包已重新构建和公证。首轮打包因 rebase 改变文件时间戳中止，未发布该产物。

正式 `/dl` 下载文件与公证产物 SHA-256 完全一致。`/update?release=2.13` 已返回 2.13 / v2.13；原 `/update` 首次仍命中 2.12 的 600 秒缓存，正常过期后刷新，不修改生产来绕过缓存。GitHub latest 已更新。

核心流程的实机与自动测试边界见 [一键捕获说明](direct-target-capture.md)。真实多屏动效、物理全局组合键投递和完整录屏仍未新增核验，不将发布验证当作这些场景的验收。

本地验证日志保存在 `/tmp/notchspi-213-*`；原工作区保留，SDK 兼容补丁与版本号已同步回原 native。当前正在运行的本地测试进程不会自动变为新安装版。
