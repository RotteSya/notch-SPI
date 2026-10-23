# Win/Mac 开发闭环验收

本清单由 [HANDOVER](../../HANDOVER.md) 引用，记录尚未完成的目标；完成定义不能缩减为本机测试通过。

## 完成条件与当前证据

| 要求 | 可接受的证据 | 当前状态 / 下一步 |
| --- | --- | --- |
| 规则单一来源 | 同一源变更抵达两个实际运行时；参数、协议、状态规则有共用用例 | 已有 shared/、生成器、prove-shared-change；人物像参数/解析/会话/完成提交策略、自动连答状态机、体验快照校验已迁入 shared/，两端执行同源规则。取消隔离、终态结算、SSE 事件已有共用用例；独立协议规则及界面完成效果仍需继续审计，共用用例不等于实现已迁移 |
| 两端行为一致 | 相同输入及事件序列下的结果、请求次数、取消/账户隔离一致 | `Tests/Fixtures/auto-session/`、`capture-isolation/`、`settlement/`、`official-stream/`、`persona-session/`、`personality-parser/`、`personality-completion/` 被 Swift 和 desktop 共同消费；不是所有功能均覆盖 |
| 自动验证闭环 | 当前提交的双平台 CI 成功记录，必要检查作为合并要求 | 本地完整验证已有；远端 CI 和分支保护仍需重新只读核实，禁止推送限制继续生效 |
| Windows 实机 | 绑定具体候选、系统、DPI、屏幕布局的验收记录 | 未完成。按 manual-acceptance.md 检查截图、热键、焦点、多屏、凭据与支付回跳；Mac/Electron smoke 不能替代 |
| 视觉与性能一致 | 同素材成对截图/录像，明确帧时间及允许差异 | 共享引擎和参数已有；Windows 成对视觉与帧时间证据缺失 |
| 交付可追溯 | 包内源码身份、同候选包摘要、CI 标识、验证及实机证据绑定 | Windows 入口已补候选独立目录、源码指纹与 ZIP 内核验，并完成本机离线构建验证；Mac 入口已增加包内来源与 DMG 内容对照，实际 ad-hoc DMG 正向与旧包反向检查通过；不可拿旧包附上新提交 |
| 安装与升级 | 已签名候选安装、升级保留数据、错误签名拒绝及回退记录 | Windows 未完成；正式签名、更新源和发布仍需对应授权 |

## 推进顺序

1. 确保新增行为共享用例留在常规双端测试入口，并审计剩余流/结算和人物像边界。
2. 完成 Windows 与 Mac 源码—候选—验证证据绑定，拒绝源码漂移、陈旧包和错误证据。
3. 核实远端双端 CI；在授权边界内准备变更，不能用本地工作流文件代替实际运行记录。
4. 补 Windows 实机、视觉、安装升级证据。缺硬件或授权时保留未完成，不能标记总体闭环。

当前限制：不安装新工具，不推送，不发布；没有 Windows 实机验收条件。可在已有工具下继续实现和验证共同逻辑、追溯及本地候选。

## 2026-10-23 本地追溯验证

- `output/verification/20261023T074049Z-8856/summary.tsv`：完整自动验证通过；589 项 Swift 测试中 4 项按条件跳过，Postgres、硬件、签名保留未执行状态。
- `output/cross-platform-closure/windows-candidate-offline.log`：禁止网络条件下复用本机 Electron ZIP，构建与实际 ZIP 内容核验成功；实际 ZIP 的错误内容反向检查也被拒绝。
- GitHub Desktop workflow 只读查询再次 TLS 超时；远端运行状态仍未确认。
- 本轮不构成 Mac 包追溯或 Windows 实机/安装/签名验收完成的证据。

## 2026-10-23 Mac 追溯验证

- `output/verification/20261023T075446Z-20373/summary.tsv`：完整自动验证通过；589 项 Swift 测试中 4 项跳过，真实硬件/安装/更新验收仍未完成。
- `output/cross-platform-closure/mac-candidate.log`：ad-hoc App 严格签名校验、DMG 只读挂载、包内内容摘要对照全部通过。
- `output/cross-platform-closure/mac-negative-check.json`：已有旧 DMG 被拒绝，原成功 manifest 保留，临时挂载已卸载清理。
- `dist/NotchSPI.dmg` 旧包保留；release 新包进入独立候选目录。未使用正式签名或 Apple 公证，未推送或发布。

## 2026-10-23 终态结算共用回归

- `Tests/Fixtures/settlement/cases.json` 的 20 个快照同时由 Swift `SettlementSnapshot` 和 desktop `validSettlement` 验证，覆盖结算/释放/辅助操作、版本字符串、累计用量和可选体验字段。
- 修复前 desktop 错误接受其中 6 个无效快照；修复后双端全部通过。Windows 终态查询复用账户校验，拒绝数字版本号、无效累计用量和体验数据；Mac 实现未修改。
- `output/verification/20261023T081434Z-34293/summary.tsv`：完整自动验证通过，desktop 119、server 684、scheduler 17、Swift 590（4 项跳过），arm64 Release 构建通过。
- 此证据限于终态快照校验，不代替完整 SSE 事件序列、实机或新候选包验证；此前生成的候选仍对应各自旧源码身份。

## 2026-10-23 SSE 字节与事件共用回归

- `Tests/Fixtures/official-stream/cases.json` 保存 20 组实际字节序列，双端断言已交付内容、回执数、协议完整性及服务错误；涵盖断流、重复/乱序事件、错误结算、UTF-8 损坏、BOM/CRLF/多行、恢复和字段类型。
- desktop 按 1 字节、7 字节、整块输入验证。修复前 6 组失败，修复后全部通过；分帧改为逐事件交付，避免同块后续编码错误丢弃已验证回执，并在 DONE 后停止读取。解释能力及错误消息/代码恢复严格类型检查。
- 行、事件和流的大小上限另有边界回归。Swift 生产实现未变，既有解码器测试保留。
- `output/verification/20261023T082513Z-45451/summary.tsv`：完整验证通过，desktop 140、server 684、scheduler 17、Swift 591（4 项跳过），arm64 Release 通过；硬件、签名及 Postgres 仍保留各自未执行边界。
- 这是共用契约测试，尚不等于 SSE 两端实现已统一；此前候选包也不代表本次新源码。

## 2026-10-23 人物像会话时序

- `Tests/Fixtures/persona-session/cases.json` 的 8 组时序由双端真实会话实现消费，覆盖完成/失败刷新时钟、精确过期、手动重置、scope 切换、失败屏障和 5 条记录窗口。修复前 desktop 6 组失败，修复后双端通过。
- Windows 以完成/失败时间刷新活动时钟；重置保留捕获序号，失败屏障固定记录对应序号，避免后续 begin 改变其指向。
- `shared/product.json.personalitySession` 统一保留时长、记录数和上下文字节上限，经现有生成器供 Swift 与 desktop 使用。隔离副本中的参数变更已在两端实际会话实现验证，见 `output/shared-change-proof/result.json` 及其源码/日志摘要；人物像解析和双端任务隔离适配仍需继续审计。
- `output/verification/20261023T083526Z-55885/summary.tsv`：完整验证通过，desktop 148、server 684、scheduler 17、Swift 592（4 项跳过），arm64 Release 构建通过。未生成新候选、推送或发布，实机与签名边界未变。

## 2026-10-23 共享参数变更实证

- `node scripts/cross-platform/prove-shared-change.mjs` 已执行真实隔离变更，5 个步骤全部通过，包含 Swift 的 3 个人物像参数行为测试；`result.json` 绑定被证明源码和各步骤日志摘要，主树源码不变也作为硬性断言。
- 原有截图等待时间与阅读字号变更证明继续通过；人物像参数在副本变为 901 秒、2 条、1024 字节，主树仍为 900 秒、5 条、8192 字节。
- `output/verification/20261023T084458Z-65593/summary.tsv` 快速工程检查通过。本轮仅调整证明工具与文档，不替代上一轮产品全量验证，也不构成 Windows 实机或新候选验收。

## 2026-10-23 人物像解析单一来源

- `shared/protocol/personality.mjs` 成为人物像纯解析规则来源，生成 desktop 模块和 Mac JavaScriptCore 源码；两端原重复解析实现已移除，Swift 保留 Codable 类型与调用适配。
- `Tests/Fixtures/personality-parser/cases.json` 的 14 个用例在两端断言完整结果，包含可见文本、最终/临时选项、上下文、错误序号及协议诊断。既有 Mac 解析、连续题和评估测试保留。
- 字符上限统一按 grapheme 计数。旧 Windows 实现在复杂 emoji 的 summary/choice 两个用例错误丢弃上下文，已用旧源码复现并由共享实现修复。
- `output/verification/20261023T085150Z-73976/summary.tsv` 完整验证通过：desktop 162、server 684、scheduler 17、Swift 593（4 项跳过），arm64 Release 构建通过。新解析器尚未进入新的配对候选包；实机、签名及远端 CI 证据仍未补齐。

## 2026-10-23 自动连答状态机单一来源

- `shared/protocol/auto-session.mjs` 统一计数/停止、暂停超时、截图失败、画面差异与稳定判定；Swift 通过 JavaScriptCore、desktop 通过生成模块执行同一状态机。截图、时钟与触发效果由平台适配。
- 原 `auto-session/cases.json` 增加渐变亮度场景：旧 Windows 实现过早累计稳定帧而提前触发，修复前复现失败；现在六组共用场景及 Mac 27 项专项均通过。
- 网格宽高与差异阈值从同一源生成，Windows 截图适配与 Mac 灰度采样读取共享网格尺寸。此接线不证明两平台实际截图像素或焦点轮询已通过实机验收。
- `output/verification/20261023T090440Z-86713/summary.tsv` 完整验证通过：desktop 163、server 684、scheduler 17、Swift 593（4 项跳过），arm64 Release 通过；截图适配补改后再次通过 desktop 163 项及语法检查。
- 尚未制作包含本轮源码的新候选；人物像会话及 SSE 独立实现、远端 CI、Windows 实机与安装升级仍保留未完成状态。

## 2026-10-23 人物像会话单一来源

- `shared/protocol/persona-session.mjs` 统一 token/generation、上下文裁剪、失败屏障和过期；Swift 保留 Codable/JavaScriptCore 适配，Windows 完成回调显式传入开始时 token，原 generation 检查保留。
- `persona-session/cases.json` 扩充至 11 组，共用验证下一题后旧成功、旧失败以及重置后的旧成功均不能修改当前上下文；三个场景已在旧 Windows 会话代码复现差异。上下文数据验证复用共享人物像规则文件。
- 原有 Mac 人物像会话、完成流程和解析测试保留；两端请求完成后的展示/复制/会话提交策略还需继续审计，不能因底层会话统一就宣称整个完成流程一致。
- `output/verification/20261023T091554Z-98388/summary.tsv` 完整验证通过：desktop 166、server 684、scheduler 17、Swift 593（4 项跳过），arm64 Release 通过。未生成新候选、推送或发布；硬件和签名边界不变。

## 2026-10-23 人物像完成提交策略

- 完成优先级与会话提交决策迁入共享会话引擎；Swift `PersonalityCaptureRun` 与 Windows 完成入口共同调用。传输/终止错误先判定，之后才允许写入有效上下文。
- 修复 Windows 先记录再报错导致终止错误上下文残留的问题；旧调用顺序已复现记录数从 1 变 2，而预期为 1。空回复/无选项的传输失败保留此前上下文；已收到选项的传输失败写入连续性屏障。取消按该请求已收到的内容走相同策略。
- `Tests/Fixtures/personality-completion/cases.json` 10 组用例双端验证优先状态、实际会话变更和历史内容；包含矛盾终止回复、空失败、部分结果、旧 token 及 scope 变化。旧 token 被拒绝时不再误报屏障已写入。
- `output/verification/20261023T092552Z-7631/summary.tsv` 完整验证通过：desktop 176、server 684、scheduler 17、Swift 594（4 项跳过），arm64 Release 通过。各平台状态文案/窗口效果尚未据此认定一致；SSE、最终候选及实机证据仍待完成。

## 2026-10-23 SSE 前置体验快照校验

- 审计 SSE 时发现 Windows 的体验回执校验弱于 Mac；先将 `FreeTrialSnapshot.isValid` 的额度、策略版本、72 小时有效期和重置时间约束迁到 `shared/protocol/free-trial.mjs`，两端共同执行。仅验证服务端快照，不授予本地权益或修改服务端计费。
- `Tests/Fixtures/free-trial/cases.json` 的 22 组用例覆盖四类状态、时间/额度边界、偏移时区和小数秒格式。迁移前原生校验与预期全部一致；旧 Windows 错误接受其中 12 组无效快照，新实现双端通过。
- `output/verification/20261023T093743Z-16359/summary.tsv` 完整验证通过：desktop 198、server 684、scheduler 17、Swift 595（4 项跳过），arm64 Release 通过。SSE 状态机迁移仍未完成，不能把此前提修复记为整条 SSE 链路已共享。
