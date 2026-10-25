# 匿名诊断统计对齐 — 2026-10-25

## 基准和范围

按当前 Mac 的 `Cloud/ObservationJournal.swift`、`Cloud/ProductTelemetry.swift` 与 `Notch/NotchController.swift` 的实际运行逻辑实现；同一份场景数据同时调用原生 Swift 日志和桌面 JS 日志验证。没有修改 Mac 产品代码或用户的正式诊断偏好。本轮没有更改 UI，因此采用可复现的事件/回执检查，而不以重复截图证明后台统计。

分支 `codex/win-mac-parity-review`，保留此前的未提交 UI 对齐修改；未推送、发布、安装依赖或工具。

## 已完成

- **自动连答会话**：开始一次记 `auto_session_started`；从活动状态退出只记一次 `auto_session_ended`。快捷键切换、截图快捷键、停止按钮分别记 `user_toggled`、`capture_hotkey`、`stop_button`；题数上限、额度耗尽/官方凭证拒绝、运行失败、空闲超时、连续截图指纹失败分别记 `question_cap`、`quota_exhausted`、`run_failed`、`idle_timeout`、`hash_failures`。答案待确认暂停时的超时也经过同一结束钩子。只记录 `trigger=auto`、配置版本和实验分组等允许字段，不记录画面或题目。
- **观察区间**：事件序号从 0 递增，区间使用左闭右开 `[sequence_from, sequence_to)`。队列未清空不准备新覆盖证明；已收到完整事件回执且无缺失时才报 `complete`，有缺失时报 `partial`。空闲且已观察的区间也按 Mac 周期推进。完整/部分状态还由真实服务端独立核验。
- **持久化回执**：覆盖证明先写入同一个原子日志，再发送；断网、响应丢失或重启复用原观察 ID、区间和序号。验证回执 ID、epoch、序号后才推进游标；旧回执不能抹掉新事件、新缺失原因或新丢失计数。
- **缺失记录**：队列上限与 Mac 一致为 100，保留最近 7 天，未来超过 5 分钟的数据丢弃并记录。保留累计与当前区间两份丢失计数，区间确认后只清本区间数。覆盖队列丢失、事件拒收、时间异常、未正常结束的采集/崩溃重启、存储失败、旧日志迁移、账户切换、偏好冲突、序号缺口和服务端禁用。
- **偏好及发送**：退出共享立即清事件、采集 ID 和待传证明、中止旧请求；未改变偏好时不会反复增加 epoch。账户切换隔离旧队列；本地丢失状态遵守远端退出共享，远端开启时使用新 epoch 防止复用旧序号。旧 consent epoch 的采集结束不会进入重新开启后的日志。
- **调度**：启动后 1 秒同步，普通事件/空闲 30 秒；采集结束或队列达到 20 时尝试发送，批大小遵守配置且最多 50，剩余批次 0.1 秒后继续。失败退避 60/300/1800 秒，请求超时 8 秒。HTTP 回执状态与 Mac 一致（事件 202，偏好/区间 200）。零事件回执按 Mac 记服务端禁用和丢失；非零但数量不完整则保留原批次重试。
- **统计修正**：首次账户注册完成后再固定采集统计身份，避免开始/结束分属不同账户；可用结果按实际解析路径判定，不把所有显示出来的文字一律计作可用答案。

## 涉及文件

`desktop/core/observation-journal.mjs`：观察日志状态转换；`reliability.mjs`：持久化、偏好、发送和回执；`sessions.mjs`：自动会话结束通知；`official.mjs`：诊断调用可指定预期 HTTP 状态；`main.mjs`：事件接入、调度和退出处理。没有改透明窗口、穿透或截图排除模块。

## 验证证据

- 共用数据：`desktop/test/fixtures/observation-journal.json`，10 组场景由 `ObservationJournalParityTests.swift` 与 `observation-journal.test.mjs` 分别执行，包括正常区间、丢失恢复、新缺失不被旧回执清掉、正常/异常重启、未结束采集、拒收、过期/未来时间、待传证明复用、退出共享。
- `auto-reliability.test.mjs` 覆盖八种停止原因、重复停止不重记，以及待确认暂停超时。
- `reliability.test.mjs` 覆盖失去回执后重启重试、批次未清空禁止证明完整、时钟偏差和退避、切换账户时中止旧请求、开启/关闭 epoch、存储失败、事件白名单和禁止 QA 发送。
- `official.test.mjs` 使用项目已有本地回环真实服务端和隔离账户，确认自动会话事件 accepted=2、rejected=0；服务端区间回执为 complete，确认后本地待传证明清空；随后关闭共享，查询确认服务端偏好为 false。没有访问正式账户或发送正式诊断。
- 完整检查：`output/verification/20261024T180830Z-51855/summary.tsv`。Mac arm64 Release 编译通过，Swift 604 项零失败、4 项原有条件跳过；服务端 684 项、调度器 17 项通过。流水线内桌面为当时 314 项；最终代码与补充测试另跑桌面 check，318 项全部通过、无跳过，结果见本轮汇总目录。
- 最终桌面与实窗日志：`output/verification/diagnostics-parity-20261025/`。设置、引导和日常流程冒烟运行在 Mac 宿主 Electron，均禁止诊断网络发送。

复现：`npm --prefix desktop run check`；`NSPI_QA_EPHEMERAL=1 swift test --disable-automatic-resolution --skip-update --filter ObservationJournalParityTests`；`npm --prefix desktop run smoke:daily`、`smoke:settings`、`smoke:guide`。

## 未验收边界

Windows 实机的进程终止、磁盘写入、休眠唤醒及真实自动连答操作仍待验收；本地测试不等于 Windows 实机证明。正式服务端和真实账户诊断未执行。完整流水线仍因 scheduler 的 undici 已安装 7.29.1、锁文件要求 7.30.1 而失败；未安装、改锁或放宽检查。Postgres 环境未提供，签名/发布与硬件交互不在本轮自动检查范围。
