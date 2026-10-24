# 共享架构与渐进迁移

## 选择

Windows 使用 Electron 主进程 + sandbox preload + HTML/CSS/ES modules。当前 AppKit 保持运行，不整体切换 Mac 界面。选择依据是现有 Node/TypeScript 后端、公式渲染与流式协议可以直接复用，透明置顶窗口、Windows 截图/热键/凭据/安装器有成熟平台接口，而立即把全部 AppKit 重写会扩大 Mac 体验回归范围。

对照其他路线：WinUI 能提供原生系统集成，但无法直接共享 AppKit UI，双份状态机更多；纯 Web 没有桌面截图/全局快捷键；Tauri 仍需要 WebView 与 Rust/Windows 系统层，而且此仓库没有 Rust 基础。Electron 的代价是安装体积、运行内存、Chromium/DWM 与 CoreAnimation 的渲染差异，不能因为用同一 CSS 就忽略这些验收。

## 单一来源与适配边界

| 来源 | 实际消费者 | 后续是否只改一次 |
|---|---|---|
| `server/` | AppKit 与 Windows 同一 HTTP/SSE 后端 | 账户、计费、模型路由、支持范围等服务端行为是 |
| `shared/prompts.json` | 生成的 Swift `SharedProduct` 与桌面 JS | 查题、多图、screen_query、人物像提示词是；输入值只替换一次，不再展开 |
| `shared/product.json` | Swift 捕获轮次/设置/自动连答/几何/动效；JS intake/motion/设置 | 已接入的参数是；未接入的原生外观仍需适配 |
| `server/src/objective-result.ts` | 生成的 JS + Mac JavaScriptCore 包装 | 客观题严格解析、容错组合、FINAL 回退逻辑是 |
| `shared/protocol/personality.mjs` | 生成的 desktop 模块 + Mac JavaScriptCore 类型适配 | 人物像选项、上下文、错误标记、序号归一化和协议诊断只改一次；字符限制统一按 grapheme 计数 |
| `shared/protocol/auto-session.mjs` | 生成的 desktop 状态机 + Mac JavaScriptCore 适配 | 自动连答停止条件、暂停/超时、画面差异和稳定判定只改一次；截图与轮询仍由平台提供 |
| `shared/protocol/persona-session.mjs` | 生成的 desktop 会话 + Mac JavaScriptCore 类型适配 | 人物像 generation/token、上下文裁剪、失败屏障、过期及完成提交策略只改一次；异步请求和界面效果仍分别适配 |
| `shared/protocol/free-trial.mjs` | desktop 账户/回执校验 + Mac JavaScriptCore 快照校验 | 免费体验回执的策略版本、额度与时间不变量只改一次；不授予本地权益，服务端仍为计费权威 |
| `shared/protocol/settlement.mjs` | desktop 流/状态校验 + Mac `SettlementSnapshot` 的 JavaScriptCore 适配 | 终态、收费/可用结果组合、额度与累计用量校验只改一次；Swift 保留字段解码，SSE 顺序规则仍待迁移 |
| `shared/protocol/official-stream.mjs` | desktop `OfficialStream` + Mac `OfficialStreamDecoder` 的 JavaScriptCore 适配 | SSE 事件顺序、回执/错误约束、内容字节上限与完成判定只改一次；字节分帧、异步缓冲及取消仍由平台适配 |
| `Tests/Fixtures/ObjectiveResult/` | 既有 Swift/服务端测试 + 桌面测试 | 同一协议用例跨端回归 |
| `VERSION.env` | 既有 Mac 包；生成 JS app_version；Windows 打包元数据 | 同一提交/版本源；Windows semver 用 major.minor.build |
| `shared/ui/ghost-engine.mjs`、`ghost-motion.mjs` | Mac JavaScriptCore + Electron Canvas | 完整随机仿真、姿态、眨眼、思考与完成编排一次修改 |
| `shared/ui/flight.mjs`、`capture.mjs` | Mac ScreenshotFlight/Tray + Windows 多窗口飞入层 | 轨迹、裁切避让、尺寸、落地/重排参数一次修改；窗口系统分别适配 |
| `shared/ui/reading.mjs` | Mac 完整答案/历史详情 + Electron 答案 | 段落结构、三语复核/错误提示、字号层级一次修改；文本绘制保留平台实现 |
| `shared/ui/onboarding.mjs` | Mac 引导检查点 + 桌面完整引导 | 恢复规则一次修改；截图、权限、试用请求和视图通过平台适配 |
| `desktop/core/` | Electron macOS 开发宿主 / Windows | 桌面两平台可共用；自动连答及人物像会话已调用共享状态机，SSE 事件规则已共享，字节分帧与请求完成效果仍由平台适配 |
| `desktop/ui/` | Electron macOS 开发宿主 / Windows | 桌面两平台共用，当前生产 AppKit UI 不消费它 |
| `desktop/platform/` | Windows 或桌面宿主 | 截图、DPAPI/safeStorage、历史、更新为边界；Mac 原有原生适配保留 |

`main.mjs` 管理窗口、生命周期、任务 generation、owner、快捷键、托盘、权限和 IPC 白名单。renderer 没有 Node/网络权限，凭据留在主进程；仅加载本地页面，禁止任意导航/弹窗。答案转为转义文本、受限格式和 `trust:false` KaTeX，不把模型内容当 HTML 执行。密钥通过系统 `safeStorage` 加密，不写进普通 settings/history。

历史题图是本机用户数据，单独文件保存并按容量回收。开发/QA 使用单独 userData，凭据仅在内存；打包版本拒绝开发 flags。QA 与 smoke 不可连接生产端点。模型 fixture 仅在开发入口与测试内，发行包不包含 fixture/test 目录。

## 实际共享改动证明

`prove-shared-change.mjs` 在 `output/shared-change-proof/source/` 创建独立源码副本，将 `capture.submitDelay` **4→5**，执行同一个生成器，然后运行：

1. 桌面真实 `Intake` 单元回归，验证新时间到达前不能提交，到达后提交。
2. Swift `SharedProductTests`，构造真实 `ScreenshotRound`，验证两张图等待时间跟随 JSON 改变。
3. 将共享阅读 bodySize **15→16**，运行真实桌面 HTML 生成器与 Mac `SharedVisual.reading`/`InformationHierarchy`，断言两者使用 16。
4. 检查主工作区配置保持原值 4 秒/15 pt。

现有脚本还将人物像会话的时长 **900→901 秒**、记录数 **5→2**、上下文上限 **8192→1024 字节**，分别在真实 `PersonaSession` 和 `PersonalitySession` 上验证过期与裁剪行为。SSE 事件规则也在副本中把内容上限从 **65536→4 字节**，重新生成后使用真实 `OfficialStream` 与 `OfficialStreamDecoder` 验证 4 字节 Unicode 内容可完成、分两次到达的 5 字节内容被拒绝；原有正常流基线先于该实验运行。结果保存协议原始/实验摘要，主树仍保持 64 KiB。它检查隔离副本已有 Swift checkout 与锁文件一致，禁用自动依赖解析/更新；缺少缓存时停止，不自动下载。复制输入时替换脚本管理的旧源码副本，保留其 `.build` 缓存。首次准备缓存需要另行处理，不能把脚本当作依赖安装入口。

证明开始时删除旧 `result.json`，每一步执行前删除对应旧日志，只有所有检查通过且主工作区源码摘要未变才写入新结果。结果绑定 Git 提交、源码摘要、dirty 状态及每步日志摘要；脏工作区证据不能当作干净提交证据。

2026-10-19 四项检查 exit 0，结果 `output/shared-change-proof/result.json`，不是只比较生成文本。原生 Mac 全量 585 项测试也通过，原有答案解析 fixtures 覆盖 JavaScriptCore 迁移。

## 已完成的渐进迁移与边界

这次迁移让 Mac 在默认产品路径中执行共享 UI 描述和动画，无关闭的试验开关。原生 Ghost 的绘制器、窗口/命中测试、CADisplayLink、SwiftMath、可选中文字及滚动锚点保持原适配。旧 Swift Ghost 引擎作为独立测试基准保留；生产两端使用同一 JS 仿真，7,200 帧与旧版误差低于 1e-9。

共享阅读返回语义段落（标题/结论/解释/复核/错误），AppKit 保留原 NSStackView/NSTextField，Electron 使用同一段落的安全 DOM。这样阅读内容与层级变更只改一份，系统字体、文字栅格化和原生控件行为依然在适配层。既有长解释持续更新、选择、焦点、滚动与销毁测试均保留并通过。

Windows 飞入层由 `platform/flights.mjs` 管理，每屏一个透明穿透窗口，按真实窗口原点映射全局 DIP，跨屏图片只发送一次。纯队列与几何在 core/shared 层。Win32 DWM 窗口矩形通过固定 PowerShell P/Invoke 转换为 Electron DIP，未知/消失的来源使用原 Mac 定义的淡入路径。截图与请求不会等待飞行动画。

仍需分别适配的范围是设置/引导的视图、窗口系统、截图权限/目标身份、热键、凭据、文本/材质绘制及安装签名。不能将这些平台适配称为已经共用同一套界面代码。常规提示词、解析器、计费后端、已迁移的 UI 结构与动效改动从同一提交进入两个构建，无需复制第二份逻辑。

## 候选包源码身份与 ZIP 核验

Windows 打包入口将每次产物保存在 `desktop/dist/candidates/<candidateID>/`，不覆盖旧候选。
包内 `package.json.buildProvenance` 记录 Git 提交、整个非忽略源码集合的 SHA-256、dirty 标记、构建主机和 CI 运行标识。
构建前后核对源码身份；源码中途变化直接失败。dirty 候选只代表该工作区内容，不能当成可从提交单独复现的发行版本。

打包成功后自动运行 `verify-package.mjs <candidate-directory>`：先比较包内源码与工作区，再直接读取 ZIP 内 ASAR 和 EXE 并与解包目录逐字节摘要对照，拒绝缺失、重复或陈旧条目。
每个候选旁保存 `delivery-manifest.json`；`output/windows-delivery/manifest.json` 仅为最新一次成功核验的索引副本。
验证主机系统与 Windows 实机运行是不同事实，manifest 保留 `executedOnWindows: false`，实机、安装和签名更新明确为未验证。
这些记录证明源码与候选包的绑定，不证明整个安装、截图、签名或升级流程通过。

已有 Electron 缓存可通过单次命令的 `NSPI_ELECTRON_DIST` 指向锁定版本的 Windows x64 ZIP；入口核对文件名并记录文件摘要，不安装运行时或修改全局环境。无缓存时不能把联网下载当作已获安装授权。
