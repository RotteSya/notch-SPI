# NotchSPI 工程交接

- `role`: 本仓库的工程交接入口。
- `repo_root_resolution`: 包含本文件、`Package.swift` 与 `VERSION.env` 的目录。用 `git rev-parse --show-toplevel` 确认。
- `conflict_policy`: 代码和测试表示当前行为。本文件指出事实所在的文件，不复制配置值和接口字段。专项文档不另写启动步骤。
- `last_verified_commit`: `d7571384c7de6d9a137028a77bb4ee2b59f9c260`

NotchSPI 是 Apple Silicon 上的 macOS 学习助手。热键或菜单截取题目，经官方服务、自定义 API Key 或本机 CLI 流式展示讲解，合格的成功结果进入本机最近查题。三条通道都是现有功能。源码版本以 `VERSION.env` 为准。已发布客户端和生产服务各自记录版本；本次交接验收没有重新核对线上部署。

## 1. 阅读规则与当前边界

`AGENTS.md` 与 `CLAUDE.md` 只指向本文件。产品介绍见 [README.md](README.md)。

已实现：刘海窗口、Carbon 热键、截图与题组、三通道路由、流式答案、公式、Ghost 等待、本机最近查题、官方账户与题包、72 小时每日 400 次体验、中日英界面。行为细节见 [docs/client-behavior.md](docs/client-behavior.md)。

QA：Plus 每日 600 次预览、完整答案窗口、离线设计样例。入口和未实现边界见 [docs/prototypes.md](docs/prototypes.md)。

已从产品入口移除：本地题库。旧文件留在 Application Support，应用不再读取。

源码里的调度 cron 为空。这是仓库默认值。线上定时任务以部署证据为准，见 [docs/cloudflare-scheduler.md](docs/cloudflare-scheduler.md)。

## 2. 五分钟启动

合格工具链：macOS 14+、arm64、Xcode 命令行工具与 Swift 5.9+、npm，以及 `server/package.json` 的 `engines.node`。`scheduler/package.json` 必须声明同一下限。

```sh
./scripts/bootstrap.sh --run
```

成功时，loopback 的 `/healthz` 为 mock、sqlite、stub。脚本接着打开 bundle `com.rottesya.notchspi.dev`，传入 `http://127.0.0.1:<端口>` 和官方通道。该开发包在读取凭证、账户、设置和网络之前使用进程内临时凭证；本次启动传入的官方通道用于这一进程。直接打开该 App 时，进程提示通过 `./scripts/bootstrap.sh --run` 启动，并在服务初始化前退出。退出应用后，脚本只停止它启动的服务。正式 App、`./scripts/run-local.sh` 和 `./scripts/design-qa.sh` 按各自入口运行。该包使用独立偏好和 ad-hoc 签名。

准备会联网安装两个 npm 锁文件并编译调试客户端。运行不需要模型密钥、生产数据库或 Developer ID。已有 NotchSPI（含正式包、QA 包或开发包）运行时，`--run` 在准备前及启动前拒绝继续并显示 PID；先从该 App 菜单退出再重试，避免两个实例响应同一全局快捷键。脚本不会关闭现有 App，默认准备和 `--check` 仍可运行。端口被占用时退出并显示端口，不结束占用进程。安装前的脚本测试只使用自带样例。工作区的 `node_modules` 在 `npm ci` 之后、`./scripts/bootstrap.sh --check` 和 `./scripts/verify.sh` 里核对。`npm ci` 失败时保留安装错误并停止后续构建。

`./scripts/bootstrap.sh --check` 只核对工具链和锁文件，不安装、不启动。已有账户的本机运行用 `./scripts/run-local.sh`。只起服务用 `./scripts/dev.sh --server-only`，无界面检查用 `./scripts/dev.sh --smoke`。引导样例用 `./scripts/onboarding-qa.sh --mock`，离线界面样例用 `./scripts/design-qa.sh`。

## 3. 运行架构与入口

| 运行单元 | 入口 | 职责 |
| --- | --- | --- |
| macOS 客户端 | `Sources/NotchSPI/App/main.swift` → `AppDelegate` → `NotchController` | AppKit、Carbon 热键、截图、三通道、流式展示、本机历史 |
| Node/Fastify | `server/src/index.ts`；Vercel 为 `server/api/index.ts`，根目录 `server` | 账户、准入、图片验证、供应商、计费、支付、官网、管理 |
| Cloudflare 调度器 | `scheduler/src/index.ts`；候选 `scheduler/src/candidate.ts` | 鉴权调用独立 reap，处理到期恢复 |

主链路：热键或菜单 → 截图与题组 → 官方服务 / 自定义 API Key / 本机 CLI → 流式解析与结算回执 → 刘海答案 → 合格成功结果进入最近查题。

`server/src/storage.ts` 按环境选择 Postgres（`POSTGRES_URL` 或 `DATABASE_URL`）、Serverless 内存或本地 SQLite。三者是条件存储，各自有适配实现。SwiftMath 与 `Vendor/BotAvatarsKit` 随客户端交付，版本以 `Package.swift` 和 `Package.resolved` 为准。`Resources/NotchSPI.png` 是未打包运行时的更新窗口图标。

## 4. 修改导航与事实所有权

| 要修改什么 | 唯一位置 | 必跑测试 |
| --- | --- | --- |
| 版本号 | `VERSION.env` | `scripts/package.sh` 读取它；`repo-health` |
| Swift 平台与依赖 | `Package.swift`、`Package.resolved` | `swift test`、arm64 Release |
| Node 下限与服务依赖 | `server/package.json` 与 lock；scheduler 声明必须一致 | `npm run typecheck`、`npm test` |
| 环境变量 | `server/src/config.ts` 与 `server/.env.example` | `repo-health` |
| HTTP 契约 | `docs/official-api.md` 的路由清单与 `server/src/routes.ts` | `server/test/route-inventory.test.ts` |
| 存储接口 | `server/src/db.ts` 与三个 `db-*.ts` | `db`、`quota-migration` |
| 人格与 objective fixture | `Tests/Fixtures/*/manifest.json` 与 RUNBOOK | 对应 attestation / personality 测试 |
| 评测预算 | `docs/evaluation-budget.json` | `evaluation-budget` |
| 生产模型日预算 | `deploy/production-model-budget.json` | 输出策略测试 |
| 打包 | `scripts/package.sh` | 该脚本的 fail-closed 检查 |
| 回归 | `scripts/verify.sh` | 见第 6 节 |

客户端行为见 [docs/client-behavior.md](docs/client-behavior.md)。兼容字段见 [docs/compatibility.md](docs/compatibility.md)。Objective 放量、停止与回滚的当前规则在 [Tests/Fixtures/objective-v1/RUNBOOK.md](Tests/Fixtures/objective-v1/RUNBOOK.md) 第 4 节。历史调整从 [docs/history/index.json](docs/history/index.json) 进入对应提交。

## 5. 不变量与兼容性

- `INV-BILL-001`：官方成功问答扣 1 题；真实失败不扣。
- `INV-BILL-002`：并发预扣不得产生负余额。
- `INV-AUTH-001`：瞬时 401 保留设备令牌。
- `INV-STREAM-001`：SSE 序列为 `delta`×N → `usage`×1 → `DONE`。
- `INV-CAPTURE-001`：Release 排除本应用的软件截图。
- `INV-DEPLOY-001`：服务端新增契约字段先于客户端部署。
- `INV-STATE-001`：自动模式、人格连续题和截图缓存的生命周期互不泄漏。
- `INV-SECRET-001`：厂商密钥、管理员密钥和数据库凭证不进入 Git 或日志。
- `INV-RESULT-001`：Objective 机器协议不进入可见正文、剪贴板或辅助功能。
- `INV-RESULT-002`：`ready/review` 具有可用答案；`retake` 和无可用结果不扣题。
- `INV-TELEM-001`：产品事件只有固定键和枚举。
- `INV-TELEM-002`：关闭匿名可靠性数据后立即删除队列。
- `INV-PROVIDER-001`：未携带 `result_protocol` 的流量走 `OFFICIAL_PROVIDER`；`objective_v1` 才走 treatment。

热键、体验、旧字段和迁移门槛见 [docs/compatibility.md](docs/compatibility.md) 与 [docs/client-behavior.md](docs/client-behavior.md)。新注册仍有 fixed30 初始赠送。领取体验时替换未用的初始赠送，已购余额保留。旧余额第一次访问建立 `legacy_unknown`。

## 6. 验证及故障定位

`./scripts/verify.sh --quick`：仓库健康检查、检查器测试、服务端类型检查、调度器类型检查、隔离 smoke。

`./scripts/verify.sh` 在此之上运行服务端测试、调度器测试和两份 dry-run 构建、带污染环境变量的 smoke、`NSPI_QA_EPHEMERAL=1` 的串行 Swift 测试（warnings-as-errors）、arm64 Release、资源与不可变证据的固定字节摘要、路由清单、`git diff --check`。

每项写入 `output/verification/<run-id>/`，字段为 name、status、duration_ms、exit_code、test_count、skip_reason、log_path。status 为 passed、failed、skipped 或 blocked。Postgres 在未设置含 `test` 的 `TEST_POSTGRES_URL` 时记 skipped。物理快捷键、录屏权限和签名公证记为 blocked 或 skipped，不计入通过。任一必需项失败则退出码非零；不依赖该失败的检查继续执行。

CI 的平台、Node 与 Postgres 版本矩阵以 `.github/workflows/ci.yml` 为准，覆盖 macOS 串行 Swift 与 Release、AL2023、Vercel 函数包和 Cloudflare scheduler。Node 下限以 `server/package.json` 为准。

隔离 smoke 期望 mock、内存 SQLite 和 stub payments。服务从空环境启动，调用方壳层里的生产变量不会进入进程。

## 7. 尚未验证的事项

- `last_verified_commit` 指向被测源码提交，之后的文档证据更新不改变该源码。结果与交付 PR 见 [docs/handover-acceptance.md](docs/handover-acceptance.md)。
- 已验证无项目构建目录和 node_modules 的 GitHub 克隆；全局下载缓存仍保留。完全无缓存或新机器的准备耗时取决于网络和工具链。
- Postgres 矩阵、AL2023 打包和 Vercel 函数包的验证结果见交付 PR 的 CI；本机验证不替代这些平台。
- 物理全局快捷键、屏幕录制允许、拒绝与返回、带刘海与外接屏、真实悬停，需要人在机器前验收。
- 线上部署版本、真实付款和付费模型效果未在本次重新核对。
- `scripts/run-objective-diagnostic.mjs` 直接调用供应商，不经过评测预算模块。见 [docs/prototypes.md](docs/prototypes.md)。
