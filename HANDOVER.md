# NotchSPI 工程交接

本文件是唯一工程入口；`AGENTS.md`、`CLAUDE.md` 和 `README.md` 指向这里。命令均在包含本文件、`Package.swift`、`VERSION.env` 的 Git 根目录运行；用 `git rev-parse --show-toplevel` 确认。

代码、锁文件和测试定义当前行为；本文只指定事实所有者。日期记录是当时的证据，不是新的执行指令。生产、推送、安装依赖均须有对应授权，默认只做本地工作。

## 当前边界

- Mac 原生主开发树：Apple Silicon / macOS 14+，AppKit/Carbon，截图与题组、官方服务/自定义 API Key/本机 CLI 三通道、流式答案、公式、Ghost、本机最近查题、中日英界面。行为见 [客户端契约](docs/client-behavior.md)。
- Windows：Electron 客户端与共享源码在本仓库；实现、签名和实机验收边界见 [Windows 入口](docs/windows/README.md)。不要删除共享生成文件。
- 仓库发布记录：Mac 3.0 build 27 和 Plus 已发布；[发布记录](docs/release-3.0-execution-2026-10-20.md)保存来源、证据、剩余验收和回退要求。本机开发树不是该发行快照，也不证明当前线上状态。
- Intel/旧 macOS：主开发树已撤回兼容实现，见 [撤回记录](docs/intel-retirement-2026-10-22.md)。现有 build 28 下载入口保留；Intel/Catalina 冻结源码、安装包与证据仍归档。对应系统下限和发布事实以 [Intel 记录](docs/intel-release-2026-10-21.md)、[Catalina 记录](docs/catalina-compatibility.md) 为准，不能用主树重新制作这些包。
- 当前源码版本读取 `VERSION.env`；Swift 编译下限读取 `Package.swift`。开发引导限定 macOS 14+ arm64，不能把它的主机限制当成 Intel 发布包的系统下限。
- 旧月票 QA 原型已退役；正式 Plus、题包、免费体验与旧用户兼容保持。完整答案窗口和其他 QA 入口仍保留，见 [QA 边界](docs/prototypes.md)。本地题库已从产品移除，旧用户文件不清理。

## 五分钟本地启动

目标：工具链和锁定依赖已具备时，五分钟内完成隔离构建、启动和一次 mock 交互。新机器安装和网络下载时间单独计算；不自动安装工具。

### Mac 原生

主机需要 macOS 14+ arm64、Xcode 命令行工具、Swift 5.9+、npm；Node 下限由 `server/package.json` 定义，scheduler 声明必须一致。

```sh
./scripts/bootstrap.sh --check
./scripts/bootstrap.sh --no-install --run
```

`--check` 只读检查工具链及已安装依赖。`--no-install` 复用锁文件匹配的 npm 依赖及已有 Swift checkout，禁止自动解析/下载 Swift 依赖；缺项就停止并显示原因。没有依赖时，先获得项目局部安装授权，再使用不带 `--no-install` 的准备入口；依赖已匹配时不会重复执行 npm ci。

开发包 `com.rottesya.notchspi.dev` 使用独立偏好、临时凭证和 ad-hoc 签名，启动参数固定官方通道及 loopback 服务。`/healthz` 应为 mock、sqlite、stub。在引导中试题，确认流式结果后从菜单退出；父脚本停止它启动的服务。该 mock 不识别真实题图。

已有任何 NotchSPI 实例时，`--run` 会在准备前及启动前拒绝继续并列出 PID；它不会关闭现有 App。端口占用也直接报错。直接双击开发包会在服务初始化前退出并提示使用引导脚本。

仅准备用 `./scripts/bootstrap.sh --no-install`；仅本地服务用 `./scripts/dev.sh --server-only`；无界面隔离检查用 `./scripts/dev.sh --smoke`。`./scripts/run-local.sh` 使用现有账户，不属于隔离新手路径。

### Windows

Windows 10 2004（build 19041）或更新版本的正常交互桌面；Node 下限读取 `desktop/package.json`。服务端与 desktop 的依赖必须已经安装并匹配各自锁文件；缺项时先获得局部安装授权。

```sh
node scripts/lib/lock-check.mjs server
node scripts/lib/lock-check.mjs desktop
npm --prefix desktop run check
npm --prefix desktop run dev
```

开发入口启动隔离 Fastify、内存数据库、mock 模型、stub 支付，购买禁用；客户端显示 `Local mock server`。端口占用保留原进程，退出客户端后停止本次服务。可通过题图文件 `desktop/test/fixtures/question.jpg` 验证流式结果和历史；实际截图仍需要系统权限。

`npm --prefix desktop start` 使用实际官方服务和持久凭据，不属于 mock 路径。自定义 API 和受账户 `cli_enabled` 约束的 CLI 仍保留。

## 架构与修改导航

| 运行单元 | 入口及事实所有者 | 验证 |
| --- | --- | --- |
| Mac 原生 | `Sources/NotchSPI/App/main.swift` → `AppDelegate` → `NotchController` | 串行 Swift 测试、arm64 Release |
| Windows | `desktop/main.mjs`；系统适配在 `desktop/platform/` | desktop check、平台 smoke |
| 服务端/官网 | `server/src/index.ts`；Vercel 为 `server/api/index.ts` | server typecheck/test、路由清单 |
| 调度器 | `scheduler/src/index.ts`；独立候选 `candidate.ts` | 两个入口的测试与 dry-run |
| 共享产品/提示/UI | `shared/`；客观题解析源为 `server/src/objective-result.ts` | 生成一致性、双端回归 |
| 版本与依赖 | `VERSION.env`、各 package manifest/lock、`Package.resolved` | repo-health、lock-check |
| 环境变量 | `server/src/config.ts`、`server/.env.example` | repo-health、配置测试 |
| HTTP/SSE | `server/src/routes.ts` 与 [API 契约](docs/official-api.md) | route-inventory |
| 存储/迁移 | `server/src/db.ts`、三个 db 适配、[迁移规则](docs/quota-migration.md) | db、quota-migration |
| 预算/证据 | `deploy/production-model-budget.json`、`docs/evaluation-budget.json`、`Tests/Fixtures/` | 对应预算和 attestation 测试 |

`storage.ts` 按环境选择 Postgres、Serverless 内存或本地 SQLite，三者均为活跃实现。SwiftMath 与 BotAvatarsKit 随 Mac 客户端交付，保留资源和许可证。调度周期以 `scheduler/wrangler.jsonc` 为准；部署事实及 `/healthz` 与 `/readyz` 的区别见 [调度说明](docs/cloudflare-scheduler.md)。

共享修改流程：

```sh
node scripts/cross-platform/generate.mjs
npm --prefix desktop run check
./scripts/verify.sh
```

源文件和生成文件一起交付。Mac 的 `Sources/NotchSPI/Shared/` 与 `desktop/generated/` 是编译输入；各平台不需要安装另一平台工具链。需要验证规则变更确实抵达双端时，在 Mac 运行 `node scripts/cross-platform/prove-shared-change.mjs`；该操作使用隔离副本，详见 [共享架构](docs/windows/architecture.md)。

## 兼容与安全不变量

- `INV-BILL-001/002`：官方成功问答扣 1 题；真实失败不扣；并发预扣不产生负余额。
- `INV-AUTH-001`：瞬时 401 保留设备令牌。
- `INV-STREAM-001`：SSE 为 `delta`×N → `usage`×1 → `DONE`。
- `INV-CAPTURE-001`：Release 排除本应用的软件截图。
- `INV-DEPLOY-001`：服务端新增契约字段先于客户端部署。
- `INV-STATE-001`：自动模式、人格连续题和截图缓存生命周期互不泄漏。
- `INV-SECRET-001`：厂商、管理和数据库凭证不进入 Git 或日志。
- `INV-RESULT-001/002`：机器协议不进入可见正文、剪贴板或辅助功能；`ready/review` 有可用答案，`retake` 和无结果不扣题。
- `INV-TELEM-001/002`：事件只含固定键和枚举；关闭匿名可靠性数据即删除队列。
- `INV-PROVIDER-001`：未携带 `result_protocol` 的流量走 control；`objective_v1` 才走 treatment。

保留 [兼容账本](docs/compatibility.md) 中的旧账户、凭证、热键、协议和数据库迁移。删除兼容路径仍须满足其退役条件。正式 Plus 使用自然月续费；回退新购应关闭开关并保留已付权益、webhook、门户及取消能力，不能回退到不识别 Plus 的旧服务或恢复数据库覆盖付款。

## 验证与交付

测试前阅读 [网络隔离说明](docs/test-network-isolation-2026-10-21.md)。当前 XCTest 目标依赖 `Tests/NetworkIsolation`；历史源码副本不会自动获得此修复。`NSPI_QA_EPHEMERAL=1` 单独使用并不足以阻止生产网络。

```sh
./scripts/verify.sh --quick
./scripts/verify.sh
```

quick：健康检查、检查器测试、共享生成检查、server/scheduler 类型检查、隔离 smoke。完整检查另含三个 npm 依赖锁检查、desktop 测试、server/scheduler 测试、两个 Worker dry-run、隔离 Swift 测试、arm64 Release、资源、不可变证据、路由清单和差异空白。Swift 使用现有 checkout 并禁止自动解析依赖；命令不安装依赖。

结果写入 `output/verification/<run-id>/`。失败、跳过、阻塞分别记录；未配置含 `test` 的 `TEST_POSTGRES_URL` 时跳过 Postgres；硬件和签名不计入通过。CI 平台矩阵以 `.github/workflows/ci.yml`、`.github/workflows/desktop.yml` 为准。

desktop 图形验收：`npm --prefix desktop run smoke`、`smoke:motion`、Windows 上的 `smoke:capture`；先退出其他实例，要求真实交互桌面。混合 DPI、多屏、远程桌面、系统凭据、安装/升级和支付回跳按 [实机清单](docs/windows/manual-acceptance.md) 验收，Node 测试不替代这些结果。

Windows 打包用 `npm --prefix desktop run pack:win`，版本读取 `VERSION.env`；Windows x64 产出 NSIS/ZIP，Apple Silicon 仅 ZIP。签名发行需要 `CSC_LINK`、可选 `CSC_KEY_PASSWORD`、`NSPI_WINDOWS_PUBLISHER` 和 HTTPS `NSPI_WINDOWS_UPDATE_URL`，否则候选禁用自动更新。打包器固定 `--publish never`。Mac 打包用 `scripts/package.sh`，仅产出 arm64 / macOS 14+；Intel/Catalina 的复现材料留在各自冻结归档，不再提供主树兼容打包入口。

提交交付前运行 `node scripts/repo-health.mjs --delivery`：校验 Git index 对应的文件集合，拒绝遗漏新增源码/文档及未暂存改动。平时健康检查包含未忽略的新文件，不等于已提交可克隆。当前清理验证及源码快照见 [治理验收](docs/governance-acceptance-2026-10-21.md)；旧克隆耗时只对 [2026-10-17 验收提交](docs/handover-acceptance.md) 有效。

## 专项操作与历史

引导样例用 `./scripts/onboarding-qa.sh --mock`，离线设计样例用 `./scripts/design-qa.sh`，完整答案窗口追加 `expanded-answer`。正式 Plus 的隔离支付沙箱仍保留：已有本机 Stripe 沙箱授权时用 `python3 scripts/plus-sandbox/prepare.py` 构建，再用 `node scripts/plus-sandbox/control.mjs` 加 `start`、`status` 或 `stop` 子命令管理；构建可能需要已有 Swift 依赖，不能未经授权下载。该沙箱不属于五分钟 mock 路径。

付费诊断、反馈、质量评测分别见 [QA 边界](docs/prototypes.md)、[反馈操作](docs/feedback-operations.md)、[质量证据](docs/quality-evidence.md)。`run-objective-diagnostic.mjs` 直接调用供应商且不经过评测预算模块，验证和 CI 不运行它。

历史从 [索引](docs/history/index.json) 和 [归档说明](docs/history/README.md) 查询。发布工作树、Intel/Catalina 冻结源码、签名产物及不可变评测证据均保留；不能用清理输出目录代替历史归档，也不能把旧验收结果记为当前源码通过。
