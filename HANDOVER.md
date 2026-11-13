# NotchSPI 工程交接

本文件是唯一工程入口；README、AGENTS、CLAUDE 只负责导航。命令均在包含本文件、`Package.swift`、`VERSION.env` 的 Git 根目录运行，用 `git rev-parse --show-toplevel` 确认。
代码、锁文件和测试定义行为与数值；领域文档说明契约。日期证据不代表当前线上状态，也不授予新的安装、付款、迁移、推送或部署权限。默认只做本地工作。

## 当前边界

- Mac 原生：Apple Silicon / macOS 14+，AppKit/Carbon；截图与题组、官方/自定义 API/本机 CLI 三通道、流式答案、公式、Ghost、最近查题、中日英界面。见[客户端行为](docs/client-behavior.md)。
- Windows：本仓库 Electron 实现及共享规则；Windows 10 2004+ 交互桌面。源码实现、Mac Electron smoke、Windows 实机验收是不同证据，见[平台入口](docs/windows/README.md)。
- 源码版本读取 `VERSION.env`，Swift 下限读取 `Package.swift`。本次核对主线为 3.1.5 build 42；3.1.5 双架构发布及验收边界见[兼容账本](docs/compatibility.md)。3.0 build 27 的[发布记录](docs/release-3.0-execution-2026-10-20.md)仅为历史证据。
- Intel 兼容实现由独立源码维护，不在主树 arm64 构建中；3.1.5 Intel build 43 支持 macOS 12.3+。Catalina build 29（10.15.7+）及旧 Intel build 28 是冻结历史版本；来源及实机边界见[兼容账本](docs/compatibility.md)。不能用主树重做这些包。
- 旧月票 QA 原型、本地题库入口已退役；正式 Plus、题包、体验及旧账户兼容保留。旧用户题库文件不清理，QA 工具见[边界](docs/prototypes.md)。

## 五分钟本地启动

“五分钟”指依赖已准备、支持的平台上，从阅读入口到看到 mock 流式答案；首次下载、编译和系统授权另记实际耗时，不保证冷构建五分钟完成。默认启动不安装、不下载、不读取生产配置。

### Mac 原生

需要 macOS 14+ arm64、Xcode 命令行工具、Swift 5.9+、Node/npm。完整 Node 范围（含上限）读取 `server/package.json`；启动仅需 server npm 依赖及 `Package.resolved` 对应的干净 Swift checkout，不要求 scheduler/desktop 依赖。

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
Electron Mac 本地审核用 `npm --prefix desktop run pack:mac`，统一版本与独立候选身份，核验 arm64 App bundle；它不替代原生 Mac 发行包，见[审核候选](docs/windows/architecture.md#electron-mac-本地审核候选)。

Mac 打包 `scripts/package.sh`，仅 arm64/macOS 14+；release 位于独立候选目录，并校验 DMG 内 App，见[Mac 追溯](docs/windows/mac-provenance.md)。正式签名、公证和发布不属于本地 verify。
交付时运行 `node scripts/repo-health.mjs --delivery`：检查 Git index，拒绝遗漏新文件及未暂存改动。同仓库已注册的独立嵌套工作树使用各自 index，不作为主仓库漏交付文件；检查精确根路径、实时仓库身份及已跟踪路径不重叠，不豁免同目录下的普通新文件、未注册仓库或符号链接。交付文档仍不能依赖工作树中未交付的文件。本地普通检查包含未忽略的新文件，不代表已提交可克隆。未获提交要求时可在隔离临时 index 验证交付集合，保留用户原 index。

## 专项操作与历史

引导样例 `./scripts/onboarding-qa.sh --mock`；离线设计样例 `./scripts/design-qa.sh`，完整答案窗口追加 expanded-answer。设置内存预览及 Plus 沙箱边界见[QA 参考](docs/prototypes.md)。
官网隔离预览 `node scripts/preview-site.mjs`，回环 4173；不加载账户、数据库、支付或模型配置。行为和素材来源见官网参考。
[Linux 运行验证](docs/linux-runtime-verification.md)、[Vercel 包验证](docs/vercel-bundle-verification.md)、[延迟参考](docs/latency.md)、[反馈操作](docs/feedback-operations.md)、[阅读评测](docs/reading-evaluation.md)按任务加载。付费运行器不由验证/CI 执行；旧预算、候选及许可不构成新调用授权。
[文档映射](docs/guide-map.json)记录分类、来源和结构化操作依赖；tracked 材料必须属于交付集合，生成物需声明生成入口，外部材料需明确获取契约。Windows 清单读取本次候选 manifest，不沿用日期报告的包名或摘要；[历史索引](docs/history/index.json)按路径和提交区分，[归档说明](docs/history/README.md)提供回读方法。归档正文不是当前操作步骤。
发布工作树、冻结 Intel/Catalina 源码、签名安装包、本机业务/音频和不可变评测证据保留。不得用清空 output/.build 或整树 git clean 代替源码清理；旧包和旧验收不能改挂新源码。

## 本地治理记录（2026-11-13）

核对基点为 `7366e21372c9f0fda68451491f2b8ac775c9bac0`；本节是本机快照，不代表重新核验生产。主线原有状态仅 `?? tmp/`，Git 根目录为外层 NotchSPI 下的 `native/`。发布事实对照兼容账本、版本文件、服务端渠道配置及本机 `output/release-315-both-20261113/report.md`；最后一项为本机发布证据，不是克隆仓库的必备文件。

| 对象 | 决定、依据与恢复方式 |
| --- | --- |
| 本文件的版本和平台入口 | 修正仍以 3.0 为主要发布参照的说明，区分当前独立 Intel 维护与历史冻结版；旧文可从上述基点的 `HANDOVER.md` 恢复。 |
| Swift debug ModuleCache；Xcode out 下 ModuleCache.noindex、CompilationCache.noindex、SDKStatCaches.noindex | 已逐文件记录摘要后清理；内容为 swiftmodule/pcm、编译缓存索引及 SDK stat cache。由现有 Swift/Xcode 工具链重新生成；不属于交付 manifest、签名包或验收日志。未删除 checkout、repositories、Products、dSYM 和打包 App。 |
| 15 个本地分支、10 个注册工作树 | 全部保留。10 个非主线分支有主线之外的提交；其余候选来源/渠道工作树即使已合并也承担追溯用途。没有删除远端或本地引用。 |
| `tmp/intel-reliability-20261112` | HEAD `212f094`，仍有 HANDOVER、OfficialAPI、OfficialCaptureRunTests、VERSION.env、desktop/generated/product.mjs 五个未提交修改，标注为 3.1.5 build 43；不得因版本号相同就认定等于已发布来源 `f1c9346`。未提交补丁另存本次证据目录，原树及材料保留。 |
| 发布、Windows 和外层旧副本 | 保留全部 output/dist 候选、签名包、安装升级证据及外层 release-worktrees 三份未注册副本；尚未证明没有独有文件或外部任务依赖。Intel 真机启动、截图、升级仍待验收。 |
| 活跃代码、配置和生成物 | 保留 Postgres/SQLite/memory 动态加载、官方/自定义 API/CLI、旧账户兼容、scheduler 两套 Worker、共享生成输入、SwiftMath 字体及第三方许可；没有足以删除的新证据。现有领域文档由 guide-map 管理，不再另建治理说明文件。 |

本机审计证据位于 `output/governance-20261113/`：清理前状态、缓存逐文件摘要、原 Intel 补丁及交接备份。缓存回退指用原工具链重建，不承诺逐字节恢复缓存。未安装工具、修改全局环境、提交、推送或发布。

清理前 `scripts/verify.sh --quick` 在 verification-report 的 sourceSnapshot 阶段报 EISDIR：Git 将未忽略的嵌套 Intel 工作树列为目录，快照器按文件读取。原日志在 `output/governance-baseline-20261113.log`。该失败是本轮清理前基线，后续修复见下段；未扩大忽略规则。独立检查结果与清理后计量记录在本次证据目录。

待后续决策：旧 Intel 未提交候选如何合并或退役；历史发布副本及对应分支何时停止保留。操作前需补齐逐文件差异、任务依赖与恢复来源，再明确目标清单；本轮不提出强删、远端删除或生产变更。

验证结果：repo-health（含文档链接/映射）、共享生成、server/scheduler 类型检查、隔离 smoke、Swift checkout、不可变证据与空白检查通过。Swift 661 项：653 通过、8 条件跳过、0 失败；arm64 Release 及资源 bundle 检查通过。治理测试 67 通过、1 失败（bootstrap 副本初始化同样把嵌套工作树当文件，未执行该套件内部用例）；完整 verify 未通过，未做交付 index 验证、Windows/Intel 实机或生产验收。9 个非主工作树的 HEAD、状态与补丁摘要均未变。

计量：清理时移除 1,593 个缓存文件，原分配占用 869,760 KiB；回归重建后 `.build` 从 3,385,600 KiB 降至 2,596,876 KiB，净减少 788,724 KiB（约 770.2 MiB）。这是构建目录净变化，不是全项目或磁盘可用空间增量；本次证据和日志另占少量空间。分支/工作树数量未变。

后续修复嵌套工作树处理：`scripts/lib/verification-report.mjs` 对 Git 返回的目录验证其独立仓库根身份，递归记录 HEAD、dirty 与源码摘要，并纳入父快照一致性判断；普通文件、删除、符号链接继续受检查，未知目录/特殊文件报错。bootstrap 测试夹具仅复制所属仓库文件，显式区分已验证的嵌套仓库，避免复制独立发布工作树或其 Git 管理指针；完整验证报告仍绑定该工作树内容，不会静默排除其变化。回归覆盖嵌套 dirty 内容再次修改、新文件、删除、HEAD 变化、原有忽略缓存边界、悬空符号链接及异常目录。未修改任何忽略规则、工作树或产品代码。验证证据位于 `output/nested-worktree-fix-20261113/`，最终结果另记于下。

后续修复验收：定向测试 28/28 通过；完整 `scripts/verify.sh` 于本轮退出 0，报告 `output/verification/20261113T055241Z-54572/results.json` 的 `automation_passed` 与 `source_consistent` 均为 true。治理 92/92 通过；Desktop、server、scheduler、Worker dry-run、Swift 661 项（8 条件跳过、0 失败）、arm64 Release、资源、不可变证据、路由与空白检查通过。未配置 TEST_POSTGRES_URL，Postgres 跳过；硬件 blocked，签名 skipped，不计作完成。旧 Intel 补丁字节一致，全部工作树注册信息及 9 个非主工作树的状态/补丁摘要保持不变。前段 67/1 与 EISDIR 为修复前结果，已被此次验收替代。仅在验证结束后追加本结果说明，再运行文档健康及空白检查。

交付检查后续修复：`checkDelivery` 仅区分 Git 已注册且实际属于同一 common-dir 的独立工作树，使用 NUL 分隔注册信息和精确路径匹配，不新增忽略规则或路径前缀豁免。工作树自身的 dirty 内容仍由验证快照绑定；主仓库的新文件、未暂存修改/删除、未注册仓库、符号链接和失效注册替换继续报错。回归包含带空格/换行的工作树路径、未完成文件、相邻交付文件与文档依赖。证据目录为 `output/delivery-worktree-fix-20261113/`。本轮只修复治理检查，不改变产品行为；验证完成后单独本地提交，不推送。

交付修复验收：定向测试 25/25 通过，quick 治理测试 95/95 通过，全部 quick 步骤通过，报告 `output/verification/20261113T060413Z-72573/results.json` 的 automation_passed/source_consistent 均为 true。真实仓库暂存本轮三文件后 `node scripts/repo-health.mjs --delivery` 通过，保留的 Intel 未提交工作树不再误报。仅修改治理检查/测试/文档，未重复运行上轮已通过且未受影响的产品全量测试或硬件验收。提交前后核对非主工作树 HEAD、状态及补丁，保持原状。
