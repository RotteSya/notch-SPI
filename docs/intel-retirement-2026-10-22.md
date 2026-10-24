# Intel / 旧 macOS 主开发树撤回

2026-10-22，按用户确认的范围撤回本地主开发树兼容实现。Mac 主开发路线恢复 Apple Silicon / macOS 14+；现有 Intel 下载入口、历史冻结源码、签名安装包和发布证据保留。没有下架、安装、推送或部署。

## 源码边界

- 主包与 BotAvatarsKit 恢复 macOS 14 下限；保留 XCTest 网络隔离目标和依赖。
- 移除 macOS 12/13 CoreGraphics 截图后端、旧系统定时动画适配器、头像 hosting 兼容分支和登录项降级说明；恢复原生显示同步、现代计时与颜色解析 API。
- 主树更新逻辑恢复 arm64 开发基线；历史 Intel 包内的手动更新保护保持不变。
- 移除 `--intel-compat` 及该轮兼容打包扩展，打包入口和治理检查恢复 arm64 基线。历史输出目录仍保持忽略，避免误入 Git。
- 移除 `CompatibleDisplayLink.swift` 和其四项专项测试所在的 `LegacyCompatibilityTests.swift`。现有共享产品、共享 UI、Windows 客户端及测试网络隔离修复保留。

## 保留材料

本地历史材料 `docs/intel-release-2026-10-21.md`、`docs/intel-compatibility.md` 和 `docs/catalina-compatibility.md` 继续保留，未随本次独立提交纳入版本控制。官网 `/dl/intel` 与其重定向、三语言下载内容和测试不改动。

撤回前工作区快照及逐文件 SHA-256 保存在 `output/intel-retirement-2026-10-22/before-source.tar.gz` 与 `before-manifest.json`。该快照包含当时尚未提交的开发内容。变更清单、差异和实际验证日志保存在同目录；旧日期的验证结论不作为本次源码验收。

## 本次验证

完整检查 `./scripts/verify.sh` 通过，结果目录为 `output/verification/20261022T123725Z-12338/`。Swift 共执行 587 项，583 项通过、4 项按条件跳过、0 失败；网络隔离 7 项均通过。server 684 项（含 Intel 下载入口）、desktop 88 项、scheduler 17 项和治理检查器 56 项通过。共享生成、类型、锁文件、隔离 smoke、资源、不可变证据和路由检查通过。

arm64 Release 构建通过；`lipo` 确认仅含 arm64，`vtool` 确认最低 macOS 14.0。旧 `--intel-compat` 参数在构建与签名前被拒绝。

保留范围内的 server、desktop、shared、Mac 共享源码及测试网络隔离目录共 240 个文件与撤回前 SHA-256 一致。build 27、Intel build 28、Catalina build 29 三个历史 DMG 与发布记录的 SHA-256 一致。原有本地治理提交 `b195c76` 和暂存条目不变；本次撤回只修改工作树，没有新增提交。

4 项 Swift 跳过项是需显式启用的实机截图和人格评测。未配置测试 Postgres，未执行硬件交互验收、签名或公证；没有安装、推送、部署或线上状态复验。

## 2026-10-23 独立提交边界

Intel/旧 macOS 实现此前没有提交到 Git；撤回后相关源码已回到既有基线，因此本次提交只记录平台边界与撤回证据，不制造额外源码差异。Windows、共享开发、测试网络隔离、官网现有下载入口实现和其他未提交内容继续留在本地工作区。上文测试结果属于 2026-10-22 完整工作区，不代表本次独立提交包含这些开发改动；本提交的 Swift 测试安全限制仍以 HANDOVER.md 为准。
