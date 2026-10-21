# 2026-10-21 仓库治理验收

本记录的完整工作区验收包含当时已有的未提交开发内容。随后拆分的独立治理提交不含 Windows/Intel 开发、共享解析迁移及网络隔离修复；对已有未跟踪文件的治理增量、解析辅助函数删除和跨平台验证接线继续留在工作区。本文的 591 项 Swift、88 项 desktop 和 161.32 秒准备结果属于完整工作区，不能转记为独立提交的验证结果。

独立治理候选已单独验证：严格交付检查、56 项治理测试、server/scheduler 类型检查、隔离 mock smoke 和 arm64 Release 编译全部通过。候选由原 HEAD 加治理差异构成，复用现有锁定依赖，没有 Windows/Intel 源码。未运行缺少工作区网络隔离修复的 Swift 测试，也未安装、推送或部署。证据保存在 `output/governance-local-commit-2026-10-21/`；下文保留之前完整工作区的历史验收。

本轮退役旧月票 QA 原型和共享解析迁移残留，保留正式功能、兼容路径、Windows/Intel/Catalina 开发改动及发布证据。未安装、推送、部署或修改生产。

旧交接原文及退役内容保存于 [可校验归档](history/README.md)。开始前整个可交付工作区的文件快照、摘要和差异保存在 `output/governance-2026-10-21/`；它包含既有未提交修改，不是 Git HEAD 的副本。

## 实际变更

- [HANDOVER](../HANDOVER.md) 收敛为唯一工程入口，区分当前源码、冻结发行、平台启动、兼容约束和实际验收范围；README、AGENTS、CLAUDE 只保留入口职责。
- 归档后删除六个旧月票文件：`Sources/NotchSPI/Cloud/MonthPass.swift`、`Sources/NotchSPI/Settings/MonthPassAccountPage.swift`、`Tests/NotchSPITests/MonthPassTests.swift`、`server/src/month-pass-page.ts`、`server/test/month-pass-preview.test.ts`、`scripts/preview-month-pass.mjs`。清除设置页、Notch 和设计 QA 中的原型接线；正式 Plus 不变。
- 归档后删除 `docs/release-3.0-candidate.md`、`docs/windows-port-handoff.md`、`docs/plus-3.0-production-plan.md`、`deploy/plus-3.0-production-plan.json`，修复所有当前文档链接。原 HANDOVER 和 prototypes 原文一并归档。
- 删除 ObjectiveResult 中共享解析迁移后不再引用的私有解析工具；保留共享解析、流式过滤和真实协议。删除 desktop 未使用的直接 prettier 开发依赖声明及锁条目，现有依赖目录保持不动。
- desktop 明确 Node 下限并与 CI、锁文件对齐；server 类型检查覆盖 `tools/`。完整验证纳入 desktop 和共享生成文件。
- bootstrap 增加 `--no-install`，复用匹配锁文件的 npm 依赖，校验已有 Swift checkout 后禁止自动解析/更新。缺失缓存直接停止；现有 App 和端口占用保护仍保留。
- repo-health 增加归档完整性、退役文件回归、交付文件链接和 `--delivery` 检查。CI 使用严格交付检查；普通本地检查仍接纳尚未提交的新源码。

## 本次验证

原始完整运行：`output/verification/20261021T101419Z-29967/`。该次命令退出 1：治理检查器最初有两处失败，分别为依赖复用后的旧测试预期，以及临时目录路径别名使 Swift 预检 CLI 未执行。两处均已修复，并重跑完整检查器套件；原失败日志保留，不能把原始运行改记为全部通过。

| 检查 | 最终结果 |
| --- | --- |
| 治理/引导检查器 | 56 项通过；`final-checker-tests.log` |
| 服务端 | 684 项通过；类型检查通过 |
| desktop | 88 项通过；源码语法与共享生成检查通过 |
| scheduler | 17 项通过；类型检查及两个 Worker dry-run 通过 |
| Swift | 共 591 项，587 项通过、4 项跳过、0 失败；warnings-as-errors |
| arm64 Release | 编译及资源检查通过 |
| 依赖/源码治理 | 三个 npm 锁、Swift checkout、共享生成一致性、路由清单、差异空白通过 |
| 固定评测证据 | 17 份原始证据通过不可变摘要检查 |
| 独立交付副本 | 全部当前交付文件进入临时 Git index 后，`repo-health --delivery` 通过 |

Swift 跳过项是两个需授权实机截图的测试，以及两个需显式启用或人工审阅的付费人格评测测试。未配置测试 Postgres；未做实际热键/截图权限/Windows 图形桌面验收，未签名、公证或发布。

## 五分钟交接验证的边界

独立源码副本执行 `./scripts/bootstrap.sh --no-install`，退出 0，用时 **161.32 秒**。复用本机已有 npm 依赖及锁定 Swift checkout，没有复制已编译 Swift 产物；完成检查器、干净 Debug 编译和隔离 mock `/healthz` 检查。

这证明依赖就绪时可在五分钟内完成源码准备，不代表新机器下载依赖或 GUI 交互已经验收。现有 NotchSPI 实例仍在运行，`--run` 正确拒绝启动第二实例；本轮未退出或替换现有 App。计时与日志见 `source-prepare.json`、`source-prepare.log`、`existing-app-guard.log`。

## 保存和交付

三份签名安装包均与既有发布记录 SHA-256 一致，详细结果保存于 `preserved-releases.json`：

- Mac 3.0 build 27：`7759d26f03fa10e60edf3c51b8500196da37328aafd9f609701146a2f0de00d6`
- Intel build 28：`b365a4e5f5afe40b40870220b709ac81175e58e0b2fdafa33126ffbbb919bc8f`
- Catalina build 29：`48ef38436629ee0f9a9ff94fb18ea7320efb3914805ce6559bf95506ece507ce`

既有 Windows/共享源码、Intel/Catalina 兼容实现、网络隔离修复、冻结发布工作树及发布输出均保留；Windows 清理限于 manifest/lock 和文档链接。以开始前工作区快照为基准的本轮差异见 `cleanup-only.patch` 和 `changes.json`，避免把既有开发改动算作本轮修改。

最终源码交接包 `handoff-source.tar.gz` 及逐文件摘要 `source-manifest.json` 保存于 `output/governance-2026-10-21/`。它包含尚未提交的 Windows/Intel/共享开发内容，排除构建缓存、依赖、凭证及发布输出；不能宣称这些修改已可从远端克隆。原仓库 Git index、提交和远端未改动。临时验证副本在打包校验后删除，开始前快照、最终源码和验证证据保留。
