# NotchSPI 等待时间优化 — 2026-10-29

后续已完成 4 次真实试测，结论与逐次数据见 [真实端到端记录](latency-live-2026-10-29.md)。下文的“未实测”描述为本轮代码优化交付时的历史状态。

## 范围与结论

本次修改 native 主树的 macOS 客户端。未安装依赖、改系统设置、提交、推送、发布或调用真实收费模型；已有 Windows 打包相关未提交修改保留。服务端及 Windows 仅沿调用契约检查，不宣称完成 Windows 实机性能验收。

已证实并修复的热点是主线程对每个 delta 重扫整份累计答案；已修复的资源问题是自定义 API 的 detached task 原来没有交回控制器，取消/换题/看门狗只能拒绝旧结果，不能取消这条网络任务。真实端到端的最大瓶颈尚不能排名。

## 实际调用链

1. `Settings/Hotkeys.swift` Carbon 事件回调直接执行注册 handler → `NotchController.screenshotTapped`。起点是应用收到事件后的入口时间，不包括键盘硬件到操作系统调度延迟。
2. 同步冻结截图目标、请求绑定、展示捕获状态，并启动现有连接预热。`ScreenCapture` 使用已有 shareable-content 缓存/后台枚举；应用窗口目标仍核对新鲜窗口身份。ScreenCaptureKit 捕获，失败时按已有恢复规则走系统截图；排除自身窗口失败时有隐藏面板和 130 ms 等待。
3. JPEG 编码/尺寸处理/空图检查在现有后台任务中完成，`intakeStore.adopt` 接收素材。单图立即提交，多图保留 2–4 张及 4 秒确认等待；缩略图/飞行动画不阻塞提交。
4. `runTapped` 冻结账户、模式、上下文、模型设置及 generation。缺账户先注册；必要时刷新已耗尽体验额度；CLI 通道才执行 CLI 检测。必要图片与上下文保留。
5. 官方/自定义通道在后台读取图片、base64 与 JSON 编码，通过已有 URLSession 发送。未发现本地 OCR 或服务端单独 OCR 步骤，模型直接接收图片。CLI 通道另由本地进程完成。
6. 官方服务 `routes.ts` → `capture-service.ts` 鉴权/预算预留 → provider.stream → SSE delta。流结束后校验结果，持久化结算，发送 usage 与 DONE；这段结算等待影响完整完成，不能为提速跳过。服务端已有禁用代理缓冲头，实际中间网络行为未测。
7. `OfficialStreamDecoder.consumeBuffered` 已有网络解析与 UI 消费解耦、相邻 delta 合并、完整协议校验。MainActor 回调经过请求身份/generation 校验，再进入本次优化的 `ObjectiveResultStreamFilter`；视图经 NotchType/AnswerComposer、CoreText/SwiftMath 排版绘制。完成回调再次校验原始协议和结果，更新 UI。

## 修改

- `Sources/NotchSPI/Notch/ObjectiveResult.swift`：缓存已完成行的可见文本，只扫描新增内容及尚未结束的末行；跨网络片段 CR/LF 正确合并。每请求独立值类型状态，无跨请求答案缓存。64 KiB 边界仍失败关闭，finish 仍验证原始全文。只有单个超长未换行段时仍需重扫末行，不声称完全消除所有二次工作。
- `Sources/NotchSPI/CLI/APIKeyRunner.swift`、`NotchController.swift`：返回可取消任务，并接入控制器现有任务槽；正常求解与补充解释均覆盖。取消前、流消费及 UI 回调检查取消状态，保留终止事件、stop reason、截断和错误校验。取消无法撤销供应商已发生的计算或费用。
- `CaptureLatency.swift`、`NotchView.swift`、`StreamingAnswerView.swift`、控制器：补充反馈请求、可见状态文字绘制、首个答案卡绘制阶段；不改变视觉动画或模型输出。
- 三个测试文件：逐片段新旧实现对照、超限/请求隔离、可见绘制、保持 HTTP 连接打开时取消与无迟到回调。
- `docs/client-behavior.md`：修正单图倒计时的过时说明。

## 测量口径与隐私

仅 DEBUG 且同时设置 `NSPI_QA_EPHEMERAL=1 NSPI_LATENCY_TRACE=1` 才输出本地 CaptureLatency 日志；`NSPI_CAPTURE_TRACE=1` 可追加现有截图阶段日志。无截图、题目、答案、密钥进入新增记录。未新增网络遥测、常驻任务或跨请求缓存。

| 指标 | 阶段 | 边界 |
| --- | --- | --- |
| 首次界面反馈 | feedbackDraw | 首次可见状态文本 AppKit draw；feedbackRequested 仅为提交 UI 更新，不能代替 draw |
| 首段有意义答案 | firstAnswerDraw | 已解析结论卡首次可见 draw；firstDelta 仅是收到片段，不代表有答案。人格模式或无答案卡输出不强行填值 |
| 完整答案 | renderStarted | 原有成功完成之后的首次可见全文视图 draw；responseCompleted / completed 分别记录回调与业务处理完成 |

AppKit draw 不等同于屏幕扫描输出；长文 draw 不代表用户已滚动看完，解释文字也保留原有入场动画。引导页隐藏状态栏时 feedbackDraw 可缺失。日志起点不覆盖应用尚未启动的时间。已有 captureReady/materialsReady/submitted 可定位大段耗时，但 submitted 在通道调用前，尚不能细分上传、服务端排队和模型计算；这些需服务端/网络测量，不能从 firstDelta 反推。

## 本地 CPU 对比（非端到端）

Apple M1 Pro、arm64、macOS 27.0.1、Swift 6.4，Debug XCTest，同进程原算法对照；合成 12,927 UTF-8 字节、808 个 16 字符片段。只计过滤循环，排除最终验证、网络、模型与绘制。新旧顺序交替，12 组；第 0 组是该进程首次测量，其余是重复使用。它不是 App 冷启动试验。样本不足以报告稳定 P95，提供全部原始值与中位数。

| 样本 | 优化前 ms | 优化后 ms |
| --- | ---: | ---: |
| 0 | 539.102 | 5.422 |
| 1 | 536.321 | 5.397 |
| 2 | 535.061 | 5.545 |
| 3 | 535.263 | 5.428 |
| 4 | 537.528 | 5.420 |
| 5 | 535.885 | 5.356 |
| 6 | 534.056 | 5.390 |
| 7 | 535.925 | 5.273 |
| 8 | 541.708 | 5.439 |
| 9 | 534.734 | 5.237 |
| 10 | 535.001 | 5.399 |
| 11 | 538.154 | 5.462 |

中位数：535.905 → 5.409 ms。这只证明该分段工作负载的主线程计算显著减少，不证明真实用户等待减少同等时长；长行、少量大块以及网络慢的情况收益不同。

复现：`NSPI_QA_EPHEMERAL=1 NSPI_FILTER_BENCHMARK=1 swift test --disable-automatic-resolution --skip-update -Xswiftc -warnings-as-errors --filter StreamLatencyOptimizationTests`。

## 验证记录

- 全套 Debug XCTest：608 项，5 跳过，0 失败，90.96 秒。跳过两项需屏幕权限的真实截图、两项人格外部评测及按需 CPU 基准。
- 最后加入可见反馈绘制与取消前错误回调防护后，针对受影响部分专项：21 项，1 跳过（按需 CPU 基准），0 失败。
- 真实回环 HTTP：取消一个已发送首段但保持不结束的连接，任务退出、无迟到完成；原有 OpenAI/Anthropic 正常结束、截断、缺少终止事件测试通过。
- 初次新增绘制断言暴露固定 25 ms 等待不稳定，改为等待实际阶段；反馈测试需提供真实流程会设置的状态文字。修正后专项通过，未放宽生产可见性条件。
- repo-health 通过；diff whitespace 检查通过。
- Release XCTest 基准尝试失败：既有 AnswerLayoutTests 等测试引用 DEBUG-only QA 接口（如 qaGlyphBirths），Release 无这些接口。未修改无关测试架构，本文基准仅为 Debug；另行执行 `swift build --disable-automatic-resolution --skip-update -c release --arch arm64`：通过，61.91 秒。
- 工具链检查发现 scheduler 已安装 undici 为 7.29.1，锁文件要求 7.30.1；未安装/修改它。因此没有宣称全仓 verify.sh 通过。

## 未验证与后续优先级

1. 真实快捷键→反馈、首答案、完整答案的前后时间：未测。未采集当前屏幕或调用真实供应商，没有相同题图/模型/网络下的生产样本；冷启动/热启动/连续请求端到端中位数、P95 均未知。新增计时用于后续在可控题图、显式选择的通道下采集。
2. 优先测截图枚举/捕获、firstDelta 前等待、模型结束到结算完成。不要无证据改变图片尺寸、模型、服务商、计费保护或必要上下文。
3. 自定义 API 每个 delta 仍等待 MainActor，官方通道已经合并；是否需要通用缓冲应以直接通道实际流量测量决定。
4. Windows 实机、真实 CLI、网络丢包与真实供应商费用行为未验收。回环及控制器回归不是这些外部条件的替代。
