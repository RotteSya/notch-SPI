# R6 反馈修复：单图忙碌交互、隐藏恢复与等待计时

2026-11-02。本轮仅修改 Electron 客户端及对应回归；未安装、推送、合并或发布。现有 R6 ZIP 不含本轮改动，未自动生成新包。

## 行为

- 普通单图作答中再次按截图键：保留原 AbortController 和请求，恢复刘海、展开，按中/日/英显示 Mac 发布基准源码中的“正在作答，请稍候”。不重新提交、不自动重试、不扣第二题。截图准备中重复单图按键直接忽略，防止同时截两次。
- 开始解题时恢复隐藏的刘海。开始后用户再次主动隐藏仍有效，不通过后续状态回调强制显示。显式取消按钮保留。
- 这轮忙碌策略限定 `single`。多图、人格、自动模式的其余入口沿用已有逻辑；不能据此宣称全部入口已与 Mac 一致。
- 忙碌按键不再提前清空当前反馈快照。等待提示在内容到来、结束或取消时清理，避免盖住后续状态。

Mac 依据是此前归档的已发布 3.0 build27 冻结源码：NotchController.screenshotTapped 的 running 门禁，以及 runTapped 开始时恢复窗口。此次没有再次运行 Mac 原生 UI；Mac 产品代码未改。Windows 的两处新增行为在 Mac-host Electron 通过实际主进程路径的离线 GUI 回归，原 Windows 设备仍待验收。

## 耗时记录

仅本地报告构建记录 `wait_timing`，每次请求独立随机 timing_id；时间为主进程单调时钟相对 solve 入口的累计毫秒，各阶段只记首次：

- request_sent：完成准备、即将进入请求适配器。
- response_headers：官方 HTTP fetch 返回响应头；不等于开始生成答案，自定义 API/CLI 未提供该阶段。
- first_delta：收到首个非空内容增量。
- first_content：解析后首次得到可见答案/推导/解释；不是证明答案已经正确或完整。
- waiting_frame / content_frame：主刘海 renderer 两次 requestAnimationFrame 后向主进程回报，并检查窗口仍可见、请求标识和阶段仍匹配。仅为绘制时机近似值，不证明已在 Windows 显示器合成出像素。取消后或新请求开始后旧回报不接受。
- finished / canceled：客户端流程结束或取消。失败也有 finished，错误类型继续使用 solve_failed。

记录仅有固定阶段、随机标识、毫秒，不含文本、题图、窗口标题、URL 或原始异常。可用“response_headers-request_sent”估计请求到响应头等待，“first_content-response_headers”估计首个可见内容等待，“content_frame-first_content”估计 IPC 与绘制回报等待。服务端分阶段、网络传输与模型生成的进一步归因仍需要更多证据。不会为了缩短数字自动重发收费请求。

## 验证

最终 desktop check：366 项通过，0 skipped。真实回环服务测试断言响应头回调先于内容并保留原有计费/结果断言；新增计时测试覆盖阶段去重、跨请求隔离及 ZIP 隐私过滤。
离线 daily smoke 覆盖三语重按单图键保持当前请求、隐藏恢复、显式取消、solve 开始恢复以及再次主动隐藏；local-report smoke 覆盖 renderer 的 waiting_frame 回报。未延长现有总超时或降低现有断言。
完整验证和最终日志见 `output/windows-r6-feedback-2026-11-02/`，最终结果补记在下方。

涉及 desktop/main.mjs、core/official.mjs、core/local-test-report.mjs、core/wait-timing.mjs、ui/app.mjs、ui/i18n.mjs 及对应 desktop/test 回归。此前窗口日志/动画隔离未提交改动继续保留。透明、穿透、截图排除与原动效参数未修改。

Windows 待验收：原 Y7000P 相同浏览器步骤下的重按提示、当前请求完成、隐藏恢复、主动隐藏、收费、透明/穿透/排除，以及响应与首内容阶段分布。没有以本机测试代替实机体验结论。

### 最终结果

完整验证：`output/verification/20261102T132233Z-46369/summary.tsv`。桌面 366 项通过；Swift 执行 616 项、原有条件跳过 6 项、0 失败；scheduler 17 项及其构建、Mac arm64 Release、类型检查、生成一致性、资源与不可变证据通过。没有改跳过条件。
未通过：scheduler 的 undici 安装 7.29.1 / 锁定 7.30.1；server 702 项中 1 项路由清单失败（701 通过），以及独立路由检查同因失败：注册的 GET /media/:name 没有列入 docs/official-api.md。本轮未修改 server 或该清单，不扩大到网站修复。Postgres 环境未配置、硬件及签名原有边界仍保留。

最终 daily smoke 为 `daily-evidence.log`，包含新增三语实际等待提示截图（desktop/test-output/daily-parity/busy-wait-zh.png、ja、en）。首次加入主动隐藏场景后，下一场景未复位窗口导致 capturePage/总看门狗失败；修正离线测试 setFixture 的窗口复位，原总超时与断言不变，后续完整回归通过。原失败日志 daily-final.log 保留。

最终计时/诊断 smoke：report-smoke.log 中 NSPI_WAIT_FRAME_OK / NSPI_WINDOW_DIAGNOSTICS_OK。完整验证期间后续改动仅为计时结束顺序和离线 fixture/证据完善；最终 desktop check 366、daily smoke 和计时 smoke 已分别验证，没有把早先全量运行称为最终每个文件的全量复测。

普通 repo-health 与 diff 空白检查通过；delivery 检查因本轮及前轮文件未暂存/提交未通过，没有擅自暂存或提交。未打新 Windows 包，旧 R6 不包含本轮修复。Mac 原生实际忙碌交互未重新操作，Windows 原设备及双端体验验收未完成。

### 两项检查问题收尾

用户随后明确允许恢复项目内依赖。已校验 npm 本机缓存包的 SHA512 与锁文件 integrity 一致，仅将 `scheduler/node_modules/undici` 从 7.29.1 恢复为 7.30.1；旧目录备份位于 `output/check-closure-2026-11-02/`，恢复记录见 dependency-restoration.json。没有联网下载、运行安装脚本、全局安装，manifest 与锁文件无改动。

`docs/official-api.md` 补入已存在的 `GET /media/:name` 和媒体返回约定，没有修改服务端行为。收尾验证：scheduler lock-check、类型检查、17 项测试、两个离线 dry-run 构建通过；服务端完整 702 项测试和路由专项 13 项通过；普通 repo-health 与 diff 空白检查通过。原失败检查的结果日志保留，本次通过证据位于 `output/check-closure-2026-11-02/`。没有重复运行不受这两处修改影响的 Swift/桌面全量，也没有把本次专项通过声称为一次新的全仓 verify 全绿。未提交、推送、合并或发布。
