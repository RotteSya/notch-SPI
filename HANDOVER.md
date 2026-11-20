# NotchSPI 工程交接

本文件是唯一工程入口；README、AGENTS、CLAUDE 只负责导航。命令均在包含本文件、`Package.swift`、`VERSION.env` 的 Git 根目录运行，用 `git rev-parse --show-toplevel` 确认。
代码、锁文件和测试定义行为与数值；领域文档说明契约。日期证据不代表当前线上状态，也不授予新的安装、付款、迁移、推送或部署权限。默认只做本地工作。

## 当前边界

- Mac 原生：Apple Silicon / macOS 14+，AppKit/Carbon；截图与题组、官方/自定义 API/本机 CLI 三通道、流式答案、公式、Ghost、最近查题、中日英界面。见[客户端行为](docs/client-behavior.md)。
- Windows：本仓库 Electron 实现及共享规则；Windows 10 2004+ 交互桌面。源码实现、Mac Electron smoke、Windows 实机验收是不同证据，见[平台入口](docs/windows/README.md)。
- 源码版本读取 `VERSION.env`，Swift 下限读取 `Package.swift`。本次核对主线为 3.2.0 build 44；3.2.0 双架构发布及验收边界见[兼容账本](docs/compatibility.md)。3.0 build 27 的[发布记录](docs/release-3.0-execution-2026-10-20.md)仅为历史证据。
- Intel 兼容实现由独立源码维护，不在主树 arm64 构建中；3.2.0 Intel build 45（独立分支 `codex/release-3-2-intel`）支持 macOS 12.3+。Catalina build 29（10.15.7+）及旧 Intel build 28 是冻结历史版本；来源及实机边界见[兼容账本](docs/compatibility.md)。不能用主树重做这些包。
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

Mac 打包 `scripts/package.sh`，仅 arm64/macOS 14+；release 位于独立候选目录，并校验 DMG 内 App，见[Mac 追溯](docs/windows/mac-provenance.md)。正式签名、公证、发布另需授权。获发布授权后由Codex执行 `node scripts/release.mjs publish vX.Y.Z`，夸克仅同步双平台DMG并下载验摘要，校验清单留在GitHub/内部；前置条件与失败恢复见Mac追溯。
交付时运行 `node scripts/repo-health.mjs --delivery`：检查 Git index，拒绝遗漏新文件及未暂存改动。同仓库已注册的独立嵌套工作树使用各自 index，不作为主仓库漏交付文件；检查精确根路径、实时仓库身份及已跟踪路径不重叠，不豁免同目录下的普通新文件、未注册仓库或符号链接。交付文档仍不能依赖工作树中未交付的文件。本地普通检查包含未忽略的新文件，不代表已提交可克隆。未获提交要求时可在隔离临时 index 验证交付集合，保留用户原 index。

## 专项操作与历史

引导样例 `./scripts/onboarding-qa.sh --mock`；离线设计样例 `./scripts/design-qa.sh`，完整答案窗口追加 expanded-answer。设置内存预览及 Plus 沙箱边界见[QA 参考](docs/prototypes.md)。
官网隔离预览 `node scripts/preview-site.mjs`，回环 4173；不加载账户、数据库、支付或模型配置。行为和素材来源见官网参考。
[Linux 运行验证](docs/linux-runtime-verification.md)、[Vercel 包验证](docs/vercel-bundle-verification.md)、[延迟参考](docs/latency.md)、[反馈操作](docs/feedback-operations.md)、[阅读评测](docs/reading-evaluation.md)按任务加载。付费运行器不由验证/CI 执行；旧预算、候选及许可不构成新调用授权。
[文档映射](docs/guide-map.json)记录分类、来源和结构化操作依赖；tracked 材料必须属于交付集合，生成物需声明生成入口，外部材料需明确获取契约。Windows 清单读取本次候选 manifest，不沿用日期报告的包名或摘要；[历史索引](docs/history/index.json)按路径和提交区分，[归档说明](docs/history/README.md)提供回读方法。归档正文不是当前操作步骤。
发布工作树、冻结 Intel/Catalina 源码、签名安装包、本机业务/音频和不可变评测证据保留。不得用清空 output/.build 或整树 git clean 代替源码清理；旧包和旧验收不能改挂新源码。

## 本地治理记录（2026-11-13）

以下是本机治理快照，不代替生产状态或硬件验收。权威入口仍是本文上方的构建、交付和兼容说明。清理证据在本机 output 下，未纳入 Git；迁移电脑时须一并保全，不能仅依靠克隆仓库恢复安装包。

### 已完成的治理与检查修复

缓存清理与嵌套工作树快照/夹具修复见b2bc7aa，delivery修复见401cd05。完整验证、后续quick及delivery通过；测试计数和Postgres/硬件/签名限制详见这两个提交与各轮output证据。未扩大忽略规则或降低检查标准。

### 旧 Intel 可靠性草稿退役

`778e141` 记录移除 `tmp/intel-reliability-20261112`。旧 HEAD `212f094a308dcb93706aa45f38364ff7bbb60c14` 是正式 Intel `f1c9346` 的祖先。五个草稿中 OfficialAPI及测试整个文件同时等于主线/正式Intel，VERSION.env和desktop生成版本等于正式Intel；HANDOVER仅首段不同，正式说明更完整。原文件及补丁保全后，定点restore并验证补丁可重新应用，再用非强制worktree remove退役；分支后续已删除，来源仍在正式Intel历史中。

保全目录 `output/intel-worktree-retirement-20261113/` 内：`inventory-before.json` 是文件SHA-256/权限/链接清单，`draft.patch`及`draft-files/`保全草稿，`payload/`原样保存旧树 `.build/`、`dist/`、`output/`，共7,098个普通文件。五个候选目录的十份DMG（每目录两份相同）及App摘要匹配manifest；五个候选的 hdiutil verify、codesign --verify --deep --strict 通过。原验收缺口不变，未声称Intel真机或升级通过。旧树与保全目录的分配空间差为32,272 KiB（约31.5 MiB，验收日志写入前），不算全盘可用空间增量。

历史 recovery-safety/recovery-latency/reliability-remediation 等记录中的旧路径不改写：将旧根替换为保全目录 `payload/`，见 `path-map.json`。恢复前确认目标路径及同名分支空缺、上述212f094仍可读取；在Git根目录执行以下恢复步骤（不是当前操作）：

```sh
retirement="$PWD/output/intel-worktree-retirement-20261113"
git worktree add -b codex/intel-reliability-20261112 tmp/intel-reliability-20261112 212f094a308dcb93706aa45f38364ff7bbb60c14
git -C tmp/intel-reliability-20261112 apply "$retirement/draft.patch"
cp -a "$retirement/payload/." tmp/intel-reliability-20261112/
```

该草稿不等于正式build43来源。退役时工作树10→9、分支15不变，其他工作树及引用不变；quick治理95/95及delivery通过，报告 `output/verification/20261113T062103Z-5002/results.json`。首次文档超限失败日志保留；通过合并重复记录解决，未提高预算。

### 剩余八树核验与收口

核验基点 `778e141`；八树工作区均干净。检查提交归属、标签、发布报告、运行脚本和CI引用、全项目外部符号链接及活动构建进程；最近聊天清单未显示其他活动NotchSPI任务，此项不等同于历史任务均已完成。未发现指向三个退役树的外部符号链接或挂载DMG。以下为当时保留及后续退役状态。

下表路径均相对 `output/`，本地分支统一省略 `codex/` 前缀。

| 工作树 | 分支 / HEAD | 本轮决定与依据 |
| --- | --- | --- |
| mac-release-3.1-20261108/apple-silicon | mac-3-1-candidate / 6e9bf1e | 已退役；源码被v3.1及v3.1.5覆盖，发布记录已闭环，证据保全。分支以 `git branch -d` 删除。 |
| mac-release-3.1-20261108/intel | intel-auto-update / 304419b | 已退役；被正式Intel f1c9346包含，v3.1-intel-build31精确指向旧来源。标签保留；分支后续已非强制删除。 |
| release-3.0-execution/source | release-3-0 / 84d6870 | 已退役：恢复保护8文件补丁等同main祖先696883f；历史及发布证据保全。 |
| release-3.1-execution/source | release-3-1 / dd3a45a | 已退役：已合并；历史脚本原文保留，复现前按固定HEAD恢复source及依赖。 |
| release-315-arm64-prep-20261113/source | release-3-1-5-arm64-prep / a005b09 | 已退役：最终权限恢复、升级及发布闭环；标签、全部候选和验收材料保留。 |
| release-315-both-20261113/channels | release-3-1-5-channels / 7366e21 | 已退役：渠道源码已在main，发布报告记录部署和下载核验完成。分支以 `git branch -d` 删除。 |
| release-315-both-20261113/intel | release-3-1-5-intel / f1c9346 | 11-20退役：常驻Intel改为3.2；标签、分支保留。 |
| windows-2022-flight-branch | windows-2022-flight-diagnostics / e2a54b4 | 暂留：3个独有诊断提交；108次运行未复现原故障，根因未闭环。 |

本轮保全根为 `output/worktree-review-20261113/`；`baseline.json`、`refs-before.txt`记录原路径、完整HEAD、分支、状态与占用，`path-map.json`映射旧根到 `mac31-arm64/payload`、`mac31-intel/payload`、`channels315/payload`。三份 `*-inventory.json`记录完整旧树；`retirement-journal.json`记录迁移和非强制移除。所有非Git文件（含历史构建产品、依赖、.vercel部署材料及原文件权限/链接目标）迁移前后逐项相同，未删除独有材料；不将迁移算作缓存瘦身。原父目录的发布报告、公证记录、源码归档、回滚包及private材料均未动。历史文档/manifest继续表达当时路径，查阅时按path-map替换根；未把旧证据改挂新源码。

四个Mac3.1候选的DMG/App与各自manifest匹配，hdiutil verify和严格codesign检查通过；其中正式Apple Silicon包摘要84442f…、正式Intel包52b27b…与发布记录一致。ad-hoc候选与正式包均保留，不混淆验收强度。3.1.5渠道部署材料仅本地保全，不触发重新部署。

恢复任一退役树时，从baseline取完整HEAD和原路径：若分支已删除，先用 `git branch <原分支> <完整HEAD>` 恢复；然后 `git worktree add <原路径> <原分支>`，将对应 `payload/.` 以 `cp -a` 复制回原路径。目标须空缺，分支须仍指向记录HEAD。恢复删除的两分支分别使用6e9bf1e38c9c1d8a38561ef1f993fc933e92c2e8、7366e21372c9f0fda68451491f2b8ac775c9bac0；仍可从main/正式标签到达。其他引用、远端分支均不删除，不推送。未触碰本轮八树之外的本地分支。

本轮计量：工作树9→6（主树及5个保留树），本地分支15→13；迁移保全27,974个普通文件。三个旧树合计2,394,180 KiB，保全目录在最终日志前2,296,348 KiB，差值97,832 KiB（约95.5 MiB）；不是全盘空闲空间变化。

本轮验收：quick全通过（治理95/95），起止摘要一致；报告 `output/verification/20261113T063327Z-22709/results.json`。delivery、文档引用、空白及保全复核通过；5个保留树状态不变。未改产品代码，未重跑硬件验收。


### 其他分支复核

基点f9ff0b5，证据 `output/remaining-branches-20261113/`。从正式Intel工作树用普通 `git branch -d` 删除三个已完全包含于f1c9346、无工作树的旧别名（均为codex/前缀）：intel-3-1-candidate（06183a5）、intel-auto-update（304419b）、intel-reliability-20261112（212f094）。标签及既有保全材料不变；恢复用 `git branch <原名> <branches-before.json中的完整HEAD>`。

四分支核验：公式和legacy别名已删除，预算与预读实验保留；替代关系、独有价值、bundle恢复验证见[分支保全记录](docs/history/README.md#2026-11-13-四分支保全与核验)。

分支先13→10→8，后续8→5；工作树6→3。恢复与验收见[常驻收口](docs/history/README.md#2026-11-13-常驻工作树收口)。未推送main；后经用户确认远端10→3，保留main、Intel及Windows诊断，恢复见归档说明。11-20再非强制退役三树，常驻main、3.2 Intel及Windows诊断；记录见 `output/worktree-review-20261120/`。
