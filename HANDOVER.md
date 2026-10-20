# NotchSPI 工程交接

- `role`: 本仓库的工程交接入口。
- `repo_root_resolution`: 包含本文件、`Package.swift` 与 `VERSION.env` 的目录。用 `git rev-parse --show-toplevel` 确认。
- `conflict_policy`: 代码和测试表示当前行为。本文件指出事实所在的文件，不复制配置值和接口字段。专项文档不另写启动步骤。
- `last_verified_commit`: `00975d2de609bb2515059e4214de2b9d1e3aa19b`

NotchSPI 是 Apple Silicon 上的 macOS 学习助手。热键或菜单截取题目，经官方服务、自定义 API Key 或本机 CLI 流式展示讲解，合格的成功结果进入本机最近查题。三条通道都是现有功能。源码版本以 `VERSION.env` 为准。已发布客户端和生产服务各自记录版本；本次交接验收没有重新核对线上部署。

## 1. 阅读规则与当前边界

`AGENTS.md` 与 `CLAUDE.md` 只指向本文件。产品介绍见 [README.md](README.md)。

已实现：刘海窗口、Carbon 热键、截图与题组、三通道路由、流式答案、公式、Ghost 等待、本机最近查题、官方账户与题包、72 小时每日 400 次体验、中日英界面。行为细节见 [docs/client-behavior.md](docs/client-behavior.md)。

3.0 候选：Plus ¥69/月自动续费、每日 400 次，包含购买、取消续费、账单管理和每日权益账本。生产入口由 PLUS_ENABLED 控制；待发布确认。

QA：Plus 离线设计样例、完整答案窗口。入口和未实现边界见 [docs/prototypes.md](docs/prototypes.md)。

已从产品入口移除：本地题库。旧文件留在 Application Support，应用不再读取。

源码里的调度 cron 为空。这是仓库默认值。线上定时任务以部署证据为准，见 [docs/cloudflare-scheduler.md](docs/cloudflare-scheduler.md)。

## 2. 五分钟启动

合格工具链：macOS 14+、arm64、Xcode 命令行工具与 Swift 5.9+、npm，以及 `server/package.json` 的 `engines.node`。`scheduler/package.json` 必须声明同一下限。

```sh
./scripts/bootstrap.sh --run
```

成功时，loopback 的 `/healthz` 为 mock、sqlite、stub。脚本接着打开 bundle `com.rottesya.notchspi.dev`，传入 `http://127.0.0.1:<端口>` 和官方通道。该开发包在读取凭证、账户、设置和网络之前使用进程内临时凭证；本次启动传入的官方通道用于这一进程。直接打开该 App 时，进程提示通过 `./scripts/bootstrap.sh --run` 启动，并在服务初始化前退出。退出应用后，脚本只停止它启动的服务。正式 App、`./scripts/run-local.sh` 和 `./scripts/design-qa.sh` 按各自入口运行。该包使用独立偏好和 ad-hoc 签名。

准备会联网安装两个 npm 锁文件并编译调试客户端。运行不需要模型密钥、生产数据库或 Developer ID。已有 NotchSPI（含正式包、QA 包或开发包）运行时，`--run` 在准备前及启动前拒绝继续并显示 PID；先从该 App 菜单退出再重试，避免两个实例响应同一全局快捷键。脚本不会关闭现有 App，默认准备和 `--check` 仍可运行。端口被占用时退出并显示端口，不结束占用进程。安装前的脚本测试只使用自带样例。工作区的 `node_modules` 在 `npm ci` 之后，由 `./scripts/bootstrap.sh --check` 和 `./scripts/verify.sh` 核对。

Plus 支付回跳的本机隔离沙箱：`python3 scripts/plus-sandbox/prepare.py` 从 output 下源码副本构建专用 bundle；已配置本机 Stripe 沙箱授权后，`node scripts/plus-sandbox/control.mjs start` 启动，`status` 检查，`stop` 停止服务。双击入口与测试步骤位于 `output/plus-native-sandbox/`。该包持久化独立测试账户、只连 loopback、使用独立回跳 scheme；不替代正式签名升级验收。生产修改方案见 [docs/plus-3.0-production-plan.md](docs/plus-3.0-production-plan.md)，尚未执行。

`npm ci` 失败时保留安装错误并停止后续构建。

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

热键、体验、旧字段和迁移门槛见 [docs/compatibility.md](docs/compatibility.md) 与 [docs/client-behavior.md](docs/client-behavior.md)。启用 3 天体验时，新注册不再赠送 fixed30 额度；用户主动开始后计时 72 小时。旧 fixed30 账户仅保留兼容，领取体验时替换未用的初始赠送，已购余额保留。旧余额第一次访问建立 `legacy_unknown`。

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

### 2026-10-17 设置面板本机迭代

- 通用页改为编号分区、三档思考选择、双列捕获设置与日常偏好。自定义选项支持方向键、空格/回车以及单层键盘焦点边框。
- 账户页移除截图查题按钮和大块卡片；统一体验、订阅、额外用量、恢复四节。新体验账户明确呈现 3 天/72 小时与每日 400 次，刷新按钮裁切和题包重复货币标识已修复。
- `FREE_TRIAL_ENABLED=1` 下新注册初始赠送为 0；关闭开关的旧部署保留旧策略。未变更线上开关或发布。
- 本机入口：`output/settings-product/启动本机体验.command`。截图：`output/settings-editorial/`。完整客户端 565 项（4 跳过、0 失败），最终设置/订阅回归 11 项通过；服务端 683 项通过。

### 设置控件统一（2026-10-17）

通用、外观、服务及账户页使用自绘下拉框/开关，行动按钮和思考选项共享悬停与键盘响应基类。保留 NSPopUpButton 原生菜单、选择和辅助功能行为；开关保持 checkbox 语义。整行开关使用位置与勾号表达选中，焦点为单层系统焦点色边框。验证：客户端 567 项（4 跳过、0 失败），最终设置与订阅回归 13 项通过，Release warnings-as-errors 构建通过。深浅色截图及日志位于 `output/settings-editorial/`。本机预览已更新，未发布。

### 剩余设置页统一（2026-10-17）

快捷键、外观、人物像、服务与模型页均采用编号分区和统一控件表面。新增自绘原生滑杆表面、文本/安全输入框表面及人物像行选择；保留 AppKit 编辑、滑杆和安全输入行为。快捷键录制在切页/关闭窗口时取消。服务页固定标题，通道重建后保留焦点。

本轮客户端全量 570 项（4 跳过、0 失败），最终设置回归 12 项通过，Release warnings-as-errors 构建通过。本机验证录制取消、字号联动、延迟禁用、人物像中文编辑/启用、模型编辑、服务切换、快速往返切页及深浅色。截图与日志在 `output/settings-editorial/`；体验启动入口沿用前述路径。预览内留有「本机体验示例」人物像，服务模式已恢复官方。未发布、未改生产。

### 设置完整验收（2026-10-17）

本轮修复：语言切换重建后恢复语言控件焦点，重建前执行页面离开清理；移除旧页面前把仍留在旧内容上的焦点移回目标侧栏；供应商切换重建后恢复下拉框焦点。外观页重新进入时同步字号滑杆与三个开关，通用页同步自动连答上限。服务输入补齐辅助功能名称。人物像示例和名称占位提示完整支持中英日，并提高深色下说明文字对比度。

新增四个回归测试覆盖语言焦点/窗口位置、外观缓存状态、三语言×双主题×六页文字适配、供应商重建和切页焦点附着。客户端全量 575 项（4 跳过、0 失败）；最终设置回归 16 项通过，Release warnings-as-errors 构建通过。实机完成 36 个页面组合截图检查，方向键快速切页、Tab/Shift-Tab、滑杆键盘调整、供应商切换、24 行中英日混排人物像的编辑/切页/进程重启保存。账户底部长说明三语言均另行检查。截图与验收说明在 `output/settings-editorial/acceptance/`。

本机体验使用独立 bundle，测试修改已还原（中文、字号 13、推理默认展开关闭、官方服务，人物像示例还原）。未发布。真实付款、模型请求与逐帧性能分析不属于此次设置验收。

### 设置选项精简（2026-10-17）

移除外观页强调色选择及专用色块组件。外观页只保留阅读（字号、默认展开推理）和展开与收起（延迟、鼠标离开前保持展开）。自动复制移至通用页的捕获与作答分区，沿用既有持久化键和值。16 项设置回归通过，包含三语言双主题文字适配及自动复制迁移后的保存/切页行为；Release warnings-as-errors 构建通过。本机预览已更新，未发布。

### 外观合并至通用（2026-10-17）

移除外观侧栏与独立控制器，设置共五页。通用采用固定页眉与滚动正文，依次为思考方式、捕获与作答、阅读与展示、日常偏好四组；原外观选项沿用持久化值，自动复制仍归捕获与作答。返回页面同步所有选项并保留滚动位置。共享按钮、下拉框和滑杆获焦点时自动滚动到可视区域；语言重建递归恢复嵌套控件焦点。

17 项设置回归通过（含三语言双主题布局、五页导航、缓存状态、滚动保留与焦点可见性），Release warnings-as-errors 构建通过。本机检查中英日长文案、深浅色、字号变化、保持展开对延迟的禁用、切页保留状态与滚动、切换语言恢复焦点。测试字号与开关已还原，中文浅色预览运行中。截图位于 output/settings-editorial/general-merged-*.png。本轮未重跑全量客户端或真实模型/付款，未发布。

### 通用页分组整理（2026-10-17）

通用页从四组收敛为作答方式、答案呈现、应用偏好三组。思考档位与捕获行为合组；截图目标、自动连答上限和界面语言采用一致的左右行布局。答案区的字号/延迟滑杆及数值列对齐，保持展开放在延迟之前。保留滚动、持久化与焦点恢复行为。17 项设置回归通过；本机检查中英日标签、段落和滚动布局，中文预览可直接体验。未发布。

### 参照早期 UI 调整（2026-10-17）

对照 output/settings-craft/01-general-before.png 与账户早期截图，保留五页产品逻辑。通用恢复三个浅色分组容器，内缩内容并压缩思考控件高度；共享分区标题移除编号及通栏线。未恢复旧额度、强调色或截图动作。17 项设置回归通过，覆盖三语言双主题布局与状态焦点；本机检查通用上下区域、账户标题、深浅色和保持展开/延迟联动。中文浅色预览运行中，截图 output/settings-editorial/general-grouped-return.png。未发布。

### 其余设置页分组统一（2026-10-17）

账户四个内容区、快捷键两组、人物像资料库/编辑区、服务通道/连接/更新均使用共享分组底面。底面不接管点击，不改变现有持久化、订阅或服务逻辑。订阅底面随内容高度更新，后续分组保持同步移动；人物像空状态跟随原控件隐藏分组底面。修正账户首组后的分区间距及人物像编辑区内边距。17 项设置回归通过，包含三语言双主题布局、状态保存、导航与焦点；本机检查四页、账户底部说明与自定义服务展开后恢复官方。未发布。

### 分组设置完整验收（2026-10-17）

完成中英日 × 深浅色 × 五页 30 个本机页面组合截图，位于 output/settings-editorial/grouped-acceptance/；包含模拟体验激活、订阅待付款、生效、取消续费截图。新增账户整体布局回归，反复切换未开通/有效/待付款/付款异常/取消续费/到期，验证订阅底面跟随高度、后续间距恒定、文档高度不累积漂移。修复订阅状态隐藏当前操作后的焦点、异步禁用/恢复控件后的焦点，以及体验开始按钮消失与取消续费弹窗返回的焦点恢复。用户已切换页面或控件时不抢回焦点。

全量客户端 578 项（4 跳过、0 失败），随后针对最后焦点修正的设置与订阅回归 24 项通过；Release warnings-as-errors 构建通过。本机最终确认体验开始后焦点落到刷新，Tab/Shift-Tab 可往返。本机模拟不涉及真实付款或模型调用；未发布。

### 自动连答扩展上限（2026-10-19）

通用页新增 100 题、无限（中英日）。持久化沿用 autoMaxQuestions：-1 表示无限，0/未设置仍默认 20，有限值上限扩至 100。无限会话进度显示 n/∞，只取消题数上限，仍遵循手动停止、额度/凭证、失败及空闲停止规则。44 项自动连答与设置回归通过；本机预览已更新并验证两个菜单选项与切页保存，验收后恢复原 20 题选择。未发布。

### 设置与 Plus 合并前复核（2026-10-19）

本轮检查并准备提交设置五页改版、账户恢复/题包保护、Plus 客户端与服务端、隔离预览工具及 3.0 候选文档。修复 Plus 非法日期导致空白到期提示，兼容 ISO 时间无小数秒；统一引导、额度提示、官网及支付返回页的「账户与订阅」指引。生产开关仍默认关闭，Vercel Git 自动部署禁用，不创建发布标签、不执行部署或 Stripe 生产操作。

`./scripts/verify.sh` 通过，证据 `output/verification/20261018T162610Z-30828/summary.tsv`：Swift 582 项（4 跳过、0 失败）、服务端 683 项、调度器 17 项、工程检查器 51 项，类型检查、隔离 smoke、arm64 Release、资源和路由检查通过。最后客户端文案修正后专项 40 项通过。此轮未配置 TEST_POSTGRES_URL，Postgres 留待 CI；硬件权限与签名公证未执行。

### 3.0 build 27 发版准备（2026-10-19）

最新源码重新生成 Developer ID 签名、公证及装订的 arm64 DMG，Gatekeeper 和公开版 2.17 升级身份检查通过。VERSION.env 升至 build 27，旧 build 26 仅为历史证据。CI 11 项任务全绿；本轮 quick 检查通过。安装包、源码快照、后端 CI 构建、发布文案及本地更新预览位于 output/release-3.0-build27/。未正式发布或修改生产。详见 [发布准备记录](docs/release-3.0-build27.md) 与 [Windows 开发交接](docs/windows-port-handoff.md)。硬件/权限覆盖升级及生产 Plus 配置仍待对应验收。

### 2026-10-20：3.0 发布推进

数据库仍阻塞发版，详见 [发布记录](docs/release-3.0-execution-2026-10-20.md)。
