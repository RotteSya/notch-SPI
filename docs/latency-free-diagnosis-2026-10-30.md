# 免费截图与生产参数排查 — 2026-10-30

目标：日常六题平均 <6 秒、每题 <=10 秒；尚未实现。本轮模型请求 0、扣题 0、部署 0；生产继续使用恢复后的 CLut1zmd63QEyNCvybi18z4akxPV。没有改变模型、推理强度、输入图像、输出上限或系统权限。

## 参数差异的证据

`deploy/production-model-budget.json` 是 HANDOVER 指定的预算事实来源，记录 2026-10-14 批准的 OFFICIAL_MAX_TOKENS 与 OBJECTIVE_RESULT_V1_MAX_TOKENS 均为 32768，而 CLIENT_CONFIG_REVISION 仍含 low-2048。实验运行器固定 2048，因而此前直连实验与生产预算契约不一致。不是本次部署把上限改大。Vercel 两个变量的只读元数据均有 10 月 14 日 bounded thinking output fix 说明，但 type=sensitive、decrypted=false，不提供数值；当前线上精确值不能仅靠仓库宣称已核验。没有读取密钥或改变量。

调用路径为 config.objectiveMaxTokens → makeObjectiveProvider → OpenAIProvider.max_tokens；查题 req.maxTokens 未单独覆盖。DeepSeek extraBody 仅 thinking/reasoning_effort，无上限覆盖。回执 outputTokens 直接取 completion_tokens。8388 输出回执与 2048 实验条件不符，但不足以单独证明实际线上上限是多少。

修复实验运行器：离线预检读取生产预算白名单字段，输出参数差异、预算文件 SHA-256、非线上已验证标记；把这些纳入完整许可匹配，使预算文件变化或旧许可缺项时不能默默继续。实验自身仍为原 2048，不自动扩大费用或减小生产上限。新增测试覆盖陈旧 revision、objective 优先级、上限不被改写和摘要变化。历史结果不改写为等价实验。

## 截图免费实测

固定本地 Q8 题图，目标窗口相同、长文完整、1568×875 输出。未上传任何图片，没有查题客户端凭据。

第一轮独立进程比较 macOS 当前 screenshot API 与兼容 captureImage API，按 A/B/B/A 重复，12 次、每 API n=6：

| API | 平均 ms | 中位数 ms | 范围 ms |
| --- | ---: | ---: | ---: |
| 当前 captureScreenshot | 76.216 | 74.831 | 66.420–91.694 |
| 兼容 captureImage | 87.498 | 74.813 | 72.363–151.954 |

均返回 1568×875。PNG 字节摘要并非全部一致，不据此主张像素等价；没有切换生产 API。首个未初始化 AppKit 的探针因 CGS_REQUIRE_INIT 断言退出，保留记录；补 NSApplication.shared 后以上 12 次完成。无安装和权限变更。

第二轮在相同隔离 Debug 客户端封装中，移除全部账户初始化/网络查题、请求保留函数恒 false，仅调用真实 ScreenCapture.capture，连续 12 次成功：总耗时平均 263.964 ms、中位数 244.833 ms、范围 214.066–409.949 ms；系统取图平均 100.640 ms、范围 74.653–149.539 ms；进入系统调用前主线程排队范围 0.160–0.480 ms；返回调度 0.162–0.673 ms；编码 6.470–17.410 ms。没有外部硬件事件到屏幕的测量，不代表端到端收益。纯截图路径没有完整查题 UI/网络及当时系统负载，不能以未复现断言原慢样本无效。

已有旧 image.begin→end 区间包含调度与系统调用，因此不能再仅凭该区间断言系统 API 是全部根因。本轮新增 DEBUG image.system.begin/end，仍受 NSPI_CAPTURE_TRACE 与 NSPI_QA_EPHEMERAL 双重开关控制，只含阶段和单调时钟、不含截图或窗口身份。后续可在原完整流程中区分排队与系统取图，未改变操作取消、超时、选择校验、编码及文件生命周期。

## 验证和边界

实验运行器 15 项离线测试通过；CaptureSystemOperationTests 4 项通过，覆盖取消、忙碌、超时、迟到结果和复用；Swift 构建通过。免费预检显式报告 max_tokens 2048 与预算 32768 差异，model_calls=0。git diff --check 通过。

业务文件仅 ScreenCapture.swift 增加 4 行诊断；运行器与其测试修复实验可比性校验；未落地未经证据支持的截图 API 切换或 token 缩减。这是诊断/验证改进，不是已测得的性能优化。目标保持未完成，不能以超时错误、低质量答案或剔除慢样本实现最长 10 秒。

证据在 /tmp/notchspi-capture-probe-20261030/：results.log、samples.json、client-capture.log、client-samples.json、preflight.json、runner-tests.log、swift-tests.log。隔离源夹具恢复测试前内容；临时 App 二进制仍是无网络截图探针，下一轮查题必须重建原夹具，不能直接使用该二进制。固定题图应用随后关闭。

下一步可继续免费在完整 UI 的本地 mock 模式重现截图排队；当前生产精确请求上限若需线上确认，可准备白名单元数据计时补丁，但部署仍需单独授权。无需继续用 2048 条件的付费候选筛查代替生产验证。


## 后续：完整 UI 免费复现及待部署参数诊断

在同一隔离客户端中恢复真实 NotchController 截图、动画、材料收集、解析与绘制，只有模型传输替换为本地固定答案；使用临时 customKey 内存假密钥，无账户凭据，reserveRequest 恒 false，并以 sandbox-exec deny network* 禁止进程网络。通过已有 QA 入口触发 12 次，均成功。与生产路径不同：没有官方账户与网络，触发不是物理按键，假答案不作质量证据。

系统截图 74.707–183.214 ms，平均 107.237 ms；进入系统 API 前排队 0.207–395.918 ms，平均 63.319 ms；编码 6.896–9.503 ms。提交前平均 461.584 ms，范围 327.997–975.234 ms。假答案首绘制平均 520.814 ms，仅本地 UI 性能，不是查题实测。完整 UI 比纯截图出现更长排队，但仍未复现数秒停顿；不能据此宣称根因完全查明或将旧 image.begin→end 全部算作系统 API 耗时。

新增本地生产参数诊断候选：server/src/capture-timing.ts 的 captureRuntimePolicy 仅输出两条通道数字上限、推理强度白名单和是否 deepseek-flash 的布尔值；不扩散任意配置字符串。server/src/index.ts 仅在现有 NSPI_SERVER_LATENCY_TRACE=1 且非测试 provider override 时于启动记录一次。不会改变请求、模型、提示词、上限、账务或 SSE。无需模型请求，部署后的首次免费 /healthz 初始化即可在服务日志核验实际 config。

类型检查及 4 项专项测试通过。另在禁止网络的两个独立服务实例中验证：trace=0 无政策日志，trace=1 恰一条，设置的 32768/16384 数字准确，两次健康接口均 200。日志只有白名单；非白名单 model/effort 字符串测试没有泄漏。该补丁是诊断，不声称提速。

冻结候选 /tmp/notchspi-runtime-policy-20261030/candidate 从原生产 81 文件清单构造，总计四文件差异：index.ts、capture-timing.ts，以及 package.json/package-lock.json 根 engines.node 固定24.x，以避免已发生过的 Node26自动升级。默认提示词恢复为基线，失败候选不包含。依赖版本不变；本地脏树其他内容不部署。原生产恢复版本保留作回退，尚未获准部署。没有实际新费用或部署。

证据：/tmp/notchspi-capture-probe-20261030/full-ui.log、full-ui-samples.json；/tmp/notchspi-runtime-policy-20261030/smoke-0.log、smoke-1.log、request.json、plan.json。完整 UI 临时源已恢复，构建二进制仍是免费探针，查题前须重建。目标继续未完成；不能保证同一远程推理模型绝无 >10 秒样本。

冻结候选验证补充：锁文件一致性检查通过。首次隔离 typecheck 因复制了全部仓库测试却没有其脚本夹具而失败；收窄到本次 capture-timing 专项后，完整候选源码 typecheck 通过，4 项专项测试通过。没有改变被测源码来绕过失败。测试题图进程已停止。


## 已获准诊断部署：线上参数确认

用户明确批准四文件部署后，复核正式域名仍为原基线 CLut1zmd63QEyNCvybi18z4akxPV，76 个平台可见源码摘要一致；其余五个未改 provider 沿用此前完整正文核验。冻结清单 81 文件，仅 index.ts、capture-timing.ts 和两个 package 文件改变，没有将工作树其他改动带入。

新部署 dpl_6SdECThsrbnkc7mxYDXVWMwUNS5p 为 READY，正式域名 notchspi-api.vercel.app 已指向它，build 日志 9s，building→ready 15.800 秒。部署 URL：https://notchspi-9d6lz85wu-rottesyas-projects.vercel.app 。上传后的 76 个可见源码摘要再次全匹配，五个 provider 节点仍被连接器截断，不声称逐项再次读全。原部署保留用于恢复；默认提示词不含已失败候选。

免费 GET /healthz 200（deepseek / objective deepseek / postgres，database not_checked）；未认证 POST /v1/captures 401 invalid_token。GET /healthz 关联的生产启动日志明确 runtime=nodejs24.x，officialMaxTokens=32768、objectiveMaxTokens=32768、两条 modelIsDeepseekFlash=true、reasoningEffort=low。此处是线上实际初始化参数证据，取代此前“仅预算文件已知，线上精确值未知”的状态。

已确认实验设计不一致：直连实验 max_tokens=2048，生产两通道32768。此前输出8388回执与当前生产上限并不矛盾；不能仅靠低上限实验的筛查通过与均值推断生产质量/速度。上限是允许生成的最大值，不表示每次一定生成32768，不能通过直接降上限保证快速正确答案。本次没修改模型参数或费用策略。

本轮模型请求0、扣题0。未进行收费验收，也不将健康检查当作性能达标。原始平台/构建/参数日志保存在 /tmp/notchspi-runtime-policy-20261030/deployment-evidence.json，免费检查在 free-checks.json。目标仍未达，后续实验必须使用已核验的32768上限并重新估算/批准预算，旧2048授权不可复用。

## 对照条件补充：题型配置

继续免费核对发现直连运行器在执行时把模板中的 profile 写死为 reading_practice；隔离端到端客户端 LiveLatencyDefaults 没有注册 screenQuery.profileID，NotchController 在缺省时选 general（界面语言 zh）。这是源码及夹具推导，不将其冒充请求体抓包证据。之前已完整核查原生产环境不存在 SCREEN_QUERY_BRIEF_CALCULATION，默认 false；本轮四文件部署没有改环境或 screen-query.ts，未引入 brief 分支。

实验运行器现将 profile、language 写入完整许可绑定，并只接受服务端允许的固定枚举；执行按许可替换模板。缺项、未知枚举或旧许可在创建输出及任何请求之前拒绝。既有实验仍显式 reading_practice/zh，历史结果不改写，也没有自动切到 general 或扩大 token 上限。后续生产对照须重新冻结 general/zh 与实际32768上限，并单独批准费用。

修改 scripts/run-latency-prompt-quality.mjs 和 scripts/fixtures/latency-prompt-quality.test.mjs；16项离线测试通过，包括 profile/language 变更拒绝旧许可、无效配置零请求、批准值实际进入请求。离线预检成功，model_calls=0，git diff --check通过。此修复防止无效对照，不声称降低真实等待。新增模型请求0，新增部署0。


## 2026-10-30 后续纠正：实际路由

后续使用同一账户只读GET /v1/client-config确认enabled_profiles仅reading_practice，测试客户端profile为general；NotchController因此将screenQuery置nil，OfficialAPI不携带screen_query_v1字段，服务端保留客户端旧objective提示词。先前基于指定screen-query分支的源码或离线请求构造核验，不能证明真实E2E使用该模板，也不能把候选部署前后的E2E差异归因于候选。原始计时/答案/扣题记录保留，解释以docs/latency-runtime-recheck-2026-10-30.md为准。
