# NotchSPI 工程交接

> 本工作树为 3.1.5 build 43 Intel 发布候选，基于已发布 Intel `304419b`，在 3.1.4 来源 212f094 上回移本次引导动效、本地练习、首次录屏授权恢复及恢复记录失败保护，并保留对应测试。此候选的平台为 x86_64 / macOS 12.3+；`scripts/package.sh` 只构建 x86_64，并记录相应平台。下文主线 arm64/macOS 14+ 描述不适用于此候选的构建目标。旧系统截图、动画、登录项及更新保护保留。测试保留 TestNetworkIsolation。未完成 Intel 实机验收，不得将编译或当前 arm64 主机上的测试写成 Intel 运行通过。历史冻结源码与安装包未修改。

本文件是唯一工程入口；README、AGENTS、CLAUDE 只负责导航。命令均在包含本文件、`Package.swift`、`VERSION.env` 的 Git 根目录运行，用 `git rev-parse --show-toplevel` 确认。
代码、锁文件和测试定义行为与数值；领域文档说明契约。日期证据不代表当前线上状态，也不授予新的安装、付款、迁移、推送或部署权限。默认只做本地工作。

## 当前边界

- Mac 原生：Apple Silicon / macOS 14+，AppKit/Carbon；截图与题组、官方/自定义 API/本机 CLI 三通道、流式答案、公式、Ghost、最近查题、中日英界面。见[客户端行为](docs/client-behavior.md)。
- Windows：本仓库 Electron 实现及共享规则；Windows 10 2004+ 交互桌面。源码实现、Mac Electron smoke、Windows 实机验收是不同证据，见[平台入口](docs/windows/README.md)。
- 源码版本读取 `VERSION.env`，Swift 下限读取 `Package.swift`。主树不是已发布 Mac 3.0 build 27 的冻结快照，发布事实见[历史记录](docs/release-3.0-execution-2026-10-20.md)。
- Intel/旧 macOS 兼容实现已退出主树；现有下载行为、冻结源码和安装包保留。build 28 为 Intel/macOS 12.3+，build 29 为 Catalina 10.15.7+，来源及实机边界见[兼容账本](docs/compatibility.md)。不能用主树重做这些包。
- 旧月票 QA 原型、本地题库入口已退役；正式 Plus、题包、体验及旧账户兼容保留。旧用户题库文件不清理，QA 工具见[边界](docs/prototypes.md)。

## 五分钟本地启动

前提是工具链及经授权准备好的锁定依赖已具备；首次安装、下载和系统授权单独计时。默认启动不安装、不下载、不读取生产配置。

### Mac 原生

需要 macOS 14+ arm64、Xcode 命令行工具、Swift 5.9+、Node/npm。Node 下限读取 `server/package.json`；启动仅需 server npm 依赖及 `Package.resolved` 对应的干净 Swift checkout，不要求 scheduler/desktop 依赖。

```sh
./scripts/bootstrap.sh --run
```

开发包 `com.rottesya.notchspi.dev` 使用独立偏好、临时凭证和 ad-hoc 签名，固定官方通道和 loopback mock。引导中点“试一道题”，出现流式 fixture 结果后从菜单退出；父脚本停止本次服务。mock 不识别真实题图；健康响应应为 mock、sqlite、stub。
发现现有 NotchSPI 实例或端口占用就停止，保留原进程；启动前后各检查一次实例。直接双击开发包会提示从引导脚本启动。
`./scripts/bootstrap.sh --check` 只检查工具链、server 锁及 Swift checkout；无参数只准备、构建和 smoke。`--no-install` 是默认离线模式的兼容别名；只有已获得局部安装授权时才可用 `--install` 准备 server npm/Swift 依赖，不安装系统工具。
仅本地服务用 `./scripts/dev.sh --server-only`，无界面检查用 `./scripts/dev.sh --smoke`。`./scripts/run-local.sh` 使用现有真实账户，不属于隔离新手路径。

### Windows

Node 下限读取 `desktop/package.json`；server、desktop 依赖分别匹配锁文件。入口先检查版本、依赖和共享生成文件，缺项停止，不自动安装。

```sh
npm --prefix desktop run dev
```

入口启动隔离 Fastify、内存存储、mock 模型和 stub 支付，真实购买禁用；客户端标记 `Local mock server`。导入 `desktop/test/fixtures/question.jpg` 检查流式结果与历史，实际截图需系统权限。退出后停止所属服务；端口占用不关闭原进程。
`npm --prefix desktop start` 使用实际官方服务和持久凭据；自定义 API 和受账户 `cli_enabled` 约束的 CLI 也是真实通道。它们不属于 mock 路径。

## 架构与修改导航

```text
Mac AppKit ─────┐
               ├─ Official HTTP/SSE → Fastify → provider / store
Windows Electron┘                         └─ Postgres / SQLite / memory
Cloudflare Worker → authenticated reap → 服务端恢复
shared 源码 → 生成器 → Swift / Electron 编译输入
```

| 修改目标 | 事实所有者 | 验证入口 |
| --- | --- | --- |
| Mac 生命周期/捕获 | `Sources/NotchSPI/App/main.swift` → `AppDelegate` → `NotchController` | Swift tests、arm64 Release |
| Windows 窗口/系统适配 | `desktop/main.mjs`、`desktop/platform/` | desktop check、实机 smoke |
| HTTP/SSE/账户/计费 | `server/src/index.ts`、`routes.ts`、Vercel `server/api/index.ts` | server tests、[API 契约](docs/official-api.md) |
| 配置/存储/迁移 | `server/src/config.ts`、`server/.env.example`、`storage.ts`、三个 db 适配 | config/db 测试、[迁移规则](docs/quota-migration.md) |
| 调度及就绪探针 | `scheduler/src/index.ts`、`candidate.ts`、各 Wrangler 配置 | scheduler tests/dry-run、[调度说明](docs/cloudflare-scheduler.md) |
| 提示/协议/UI 规则 | `shared/`；客观题解析源 `server/src/objective-result.ts` | 共用 fixtures、生成一致性、[共享架构](docs/windows/architecture.md) |
| 版本/依赖 | `VERSION.env`、三个 npm manifest/lock、`Package.resolved` | repo-health、lock-check、swift-check |
| 预算与评测 | `deploy/production-model-budget.json`、`docs/evaluation-budget.json`、`Tests/Fixtures/` | 预算/attestation 测试、[质量证据](docs/quality-evidence.md) |
| 官网/媒体 | `server/src/site.ts`、`site-media.ts`、`server/public/media/` | [官网参考](docs/website.md)、site tests |

`storage.ts` 的 Postgres、serverless memory、本地 SQLite 均为活跃实现，按环境动态导入。SwiftMath 字体 bundle、BotAvatarsKit 与许可证随 Mac 交付，不能按未显式调用删掉资源。

共享修改流程：编辑源文件，再生成、验证并一起交付源文件和生成文件。

```sh
node scripts/cross-platform/generate.mjs
npm --prefix desktop run check
./scripts/verify.sh
```

`Sources/NotchSPI/Shared/` 和 `desktop/generated/` 是编译输入，不手改生成文件。各平台不需要安装另一平台工具链。需要证明规则确实抵达两个运行时，在 Mac 运行 `node scripts/cross-platform/prove-shared-change.mjs`；它使用隔离副本，来源与限制见共享架构。

## 兼容与安全不变量

- `INV-BILL-001/002`：成功官方问答扣 1；真实失败不扣；并发预扣不产生负余额。覆盖 billing、charge-on-failure、capture-admission 测试。
- `INV-AUTH-001`：瞬时 401 保留设备令牌。覆盖 OfficialAccountState/UpgradeCompatibility、desktop official 测试。
- `INV-STREAM-001`：SSE 为 delta×N → usage×1 → DONE。覆盖两端 official-stream 共用 fixtures。
- `INV-CAPTURE-001`：Release 排除本应用的软件截图。自动检查不能替代实际像素与权限验收。
- `INV-DEPLOY-001`：服务端新增契约字段先于客户端部署；本地整理不授予部署权限。
- `INV-STATE-001`：自动模式、人格连续题和截图材料互不泄漏。覆盖 auto-session、persona-session、capture-isolation。
- `INV-SECRET-001`：厂商、管理、数据库凭证不进入 Git 或日志。
- `INV-RESULT-001/002`：机器协议不进入正文/剪贴板/辅助功能；ready/review 有答案，retake/无结果不扣题。
- `INV-TELEM-001/002`：事件只含固定键/枚举；关闭匿名数据即删队列。覆盖 telemetry/observation 测试。
- `INV-PROVIDER-001`：无 result_protocol 走 control，objective_v1 才走 treatment。覆盖 provider-routing/objective-routes。

[兼容账本](docs/compatibility.md) 定义旧账户、Keychain、热键、协议和迁移的保留条件。Plus 自然月续费；关闭新购时仍保留已付权益、webhook、门户及取消能力，不回退到不识别 Plus 的服务，不恢复数据库覆盖付款。

## 验证与交付

测试前按[网络隔离要求](docs/test-network-isolation.md)检查。当前 XCTest 必须链接 `Tests/NetworkIsolation`；`NSPI_QA_EPHEMERAL=1` 单独使用不足以阻止生产网络。历史副本不会自动获得隔离修复。

```sh
./scripts/verify.sh --quick
./scripts/verify.sh
```

quick：健康/治理测试、共享生成、server/scheduler 类型和隔离 smoke。完整检查另含三个 npm 锁、desktop/server/scheduler 测试、离线延迟工具测试、两个 Worker dry-run、Swift 测试、arm64 Release、资源、固定证据、路由及空白检查。不安装依赖，Swift 禁止自动解析。
每步有有界超时，Wrangler 子进程关闭 banner 更新检查和 metrics。结果位于 `output/verification/<run-id>/`：原日志、summary.tsv、results.json，绑定起止源码摘要、dirty 状态、退出码、计数和跳过原因。必需失败/超时非零退出，skipped/blocked 不算通过。
未配置含 test 的 `TEST_POSTGRES_URL` 时 Postgres 跳过；硬件 blocked，签名 skipped。CI 平台矩阵读取 `.github/workflows/ci.yml`、`.github/workflows/desktop.yml`。完整通过不等于 Windows 实机、真实模型或签名更新已验收。
Desktop 图形检查为 `npm --prefix desktop run smoke`、`smoke:motion`、Windows 上 `smoke:capture`；先退出其他实例。DPI、多屏、系统凭据、安装/升级、付款回跳见[实机清单](docs/windows/manual-acceptance.md)，总体缺口见[闭环条件](docs/windows/closure-plan.md)。
Windows 打包 `npm --prefix desktop run pack:win`，固定 `--publish never`；Windows x64 产出 NSIS/ZIP，Apple Silicon 仅 ZIP，位于独立候选目录。签名/更新需要独立授权和配置，见[候选包源码身份与 ZIP 核验](docs/windows/architecture.md#候选包源码身份与-zip-核验)。
Mac 打包 `scripts/package.sh`，仅 arm64/macOS 14+；release 位于独立候选目录，并校验 DMG 内 App，见[Mac 追溯](docs/windows/mac-provenance.md)。正式签名、公证和发布不属于本地 verify。
交付时运行 `node scripts/repo-health.mjs --delivery`：检查 Git index，拒绝遗漏新文件及未暂存改动。本地普通检查包含未忽略的新文件，不代表已提交可克隆。未获提交要求时可在隔离临时 index 验证交付集合，保留用户原 index。

## 专项操作与历史

引导样例 `./scripts/onboarding-qa.sh --mock`；离线设计样例 `./scripts/design-qa.sh`，完整答案窗口追加 expanded-answer。设置内存预览及 Plus 沙箱边界见[QA 参考](docs/prototypes.md)。
官网隔离预览 `node scripts/preview-site.mjs`，回环 4173；不加载账户、数据库、支付或模型配置。行为和素材来源见官网参考。
[Linux 运行验证](docs/linux-runtime-verification.md)、[Vercel 包验证](docs/vercel-bundle-verification.md)、[延迟参考](docs/latency.md)、[反馈操作](docs/feedback-operations.md)、[阅读评测](docs/reading-evaluation.md)按任务加载。付费运行器不由验证/CI 执行；旧预算、候选及许可不构成新调用授权。
[文档映射](docs/guide-map.json)只记录分类和来源；[历史索引](docs/history/index.json)按路径和提交区分，[归档说明](docs/history/README.md)提供回读方法。归档正文不是当前操作步骤。
发布工作树、冻结 Intel/Catalina 源码、签名安装包、本机业务/音频和不可变评测证据保留。不得用清空 output/.build 或整树 git clean 代替源码清理；旧包和旧验收不能改挂新源码。
