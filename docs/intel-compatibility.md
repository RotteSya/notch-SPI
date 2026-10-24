# Intel Mac 12.3+ 兼容交付

> 历史记录时点：2026-10-21（另含 2026-10-22 撤回更新）。本文的“当前”“最新”、部署状态、测试计数与待办均指对应记录时点，不代表 2026-10-23 的线上状态；本次整理未重新核对生产。

2026-10-22 状态：主开发树已撤回 Intel/旧 macOS 兼容实现，详见 [撤回记录](intel-retirement-2026-10-22.md)。下文保留原交付证据与冻结源码说明；其中兼容构建命令仅适用于对应归档源码。现有下载入口和安装包未变。

目标：Intel x86_64，macOS 12.3 Monterey、13 Ventura 及以上。12.0–12.2 和更早系统不在支持范围。版本读取对应冻结源码的 VERSION.env；这是现有功能的兼容构建，不是回退到旧业务版本。尚需旧款 Intel 实机验收。

## 2026-10-21 有效产物：正式源码重制版

2026-10-21 已按用户要求从已发布 Mac 3.0 build 27 冻结源码重新制作 **3.0 build 28 Intel**，只加入必要兼容改动，不含 Windows 共享代码。最终包为 `output/intel-compat-v3.0-clean/NotchSPI-3.0-build28-Intel.dmg`，完整源码、补丁、哈希核对与验收记录在同目录。

736 个原始文件通过基线哈希核验，15 个关键功能源码保持原样；完整 Swift 586 项（4 跳过、0 失败）、工程检查器 13 项和双架构 Release 通过。最终 DMG 内符号检查确认没有 SharedProduct、SharedVisual、SharedObjective、SharedGhostSimulation，保留原生 BotAvatarSim。Apple 公证、装订、Gatekeeper 均通过；旧 Intel / macOS 12/13 实机仍待验收。

**此前 `dist-intel-compat/NotchSPI.dmg` 的 build 27 包已被替代，不再作为交付版本。** 后续复现应使用新目录内的 `source/` 或冻结源码包，不能直接从仍含 Windows 开发改动的主工作区打包。

以下本地构建说明与 2026-10-21 初轮验证记录保留为历史；新版复现步骤以 `output/intel-compat-v3.0-clean/README.md` 为准。

## 本地构建

```sh
./scripts/package.sh release --intel-compat --skip-notarization
```

生成 `dist-intel-compat/NotchSPI.dmg`，使用现有 Developer ID 本地签名，不提交 Apple 公证。没有证书时可显式使用 `--unsigned`，该产物仅 ad-hoc 签名。正式分发前按仓库授权规则完成公证、装订和 Gatekeeper 检查。默认 `package.sh release` 仍输出 arm64 / macOS 14+，旧 dist 目录不被兼容构建覆盖。不会安装依赖、运行应用、修改系统或推送远端。

## 实现差异

- macOS 12.3/13 使用 CoreGraphics 截图，排除当前进程所有窗口和指定面板；应用截图验证冻结的窗口 ID、进程和位置，避免误取其他文档。macOS 14+ 沿用 ScreenCaptureKit。
- macOS 12.3/13 动画以最高 60fps 的可暂停定时器刷新；macOS 14+ 保留显示同步。macOS 12 的头像通过 SwiftUI hosting view 展示。
- macOS 12 的开机启动改为提示用户在系统登录项中添加；macOS 13+ 保持原有开关。
- Intel 和 macOS 14 以下不使用当前 arm64 更新通道。自动检查静默跳过，手动检查说明联系开发者获取兼容包；安装入口也拒绝该通道。
- 不修改账户、API、计费和凭证格式。兼容包与正式包沿用同一 bundle ID，属于替换安装，不应同时启动。

## 必须在老机器确认

记录“关于本机”的型号、处理器与完整系统版本。分别在 macOS 12.3+ 和 13 的 Intel Mac 检查：首次启动、录屏授权允许/拒绝后恢复、全屏/指定应用/多屏截图排除自身、无刘海屏幕布局、Ghost/流式动画、单图/多图与自动连答取消、账户恢复与最近查题、手动检查更新。不能用 Apple Silicon 上的编译或 Rosetta 运行代替旧系统验证。

## 2026-10-21 本地验证

- 完整 Swift 测试：587 项，4 项跳过，0 失败；跳过的是两项授权屏幕实拍和两项需显式启用的在线人格评测。
- 最后修改后的专项回归：12 项通过，包括旧系统动画定时器启停、颜色格式、窗口排除和截图超时/取消。
- arm64 Release、x86_64 Release、仓库健康检查、13 项工程检查器测试、脚本语法及 diff 空白检查通过。
- DMG 约 9.3 MB；只读挂载后校验内部 x86_64、Mach-O minos 12.3、Info.plist 最低系统 12.3、版本 3.0 build 27、Developer ID 签名及内容与构建目录一致。挂载已卸载。
- 证据在 `output/intel-compat-2026-10-21/`；经用户授权，Apple 公证已 Accepted、票据已装订并验证，Gatekeeper 为 accepted / Notarized Developer ID。Intel / 旧 macOS 实机尚未测试，不能视为实机兼容认证。

## 公开下载（2026-10-21）

干净源码 build 28 已追加至 [v3.0 Release](https://github.com/RotteSya/notch-SPI/releases/tag/v3.0)。官网 [Intel 兼容版下载](https://notchspi-api.vercel.app/dl/intel) 支持 macOS 12.3 及以上，原正式版入口保留。详见 [发布记录](intel-release-2026-10-21.md)。
