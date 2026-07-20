# 性格测试模式稳定性：开发计划（修订版）

## 目标

修复性格测试模式的三个问题：

1. 降低 AI 对练习/自我评估问卷的拒答与说教输出
2. 提高答案与设定人物像的方向性贴合和整页一致性
3. 让连续题可靠获得紧邻上一题的题意、情景和已选答案

本计划把“稳定性”拆成两类目标：

- **客户端确定性保证**：上下文不会串 session、机器数据不会进入 UI、三通道请求形状一致、无效协议不会污染后续题。
- **模型行为指标**：拒答率、人物像贴合率和连续题正确率通过固定题库评估。Prompt 关键词存在不再视为行为验收。

## 非目标（本轮不做）

- 人物像 UI 大改 / Big Five 表单 / 保存时由 LLM 展开 trait card
- 重传上一张截图作为第二张图；本轮仍使用由上一响应生成、客户端校验后的文本上下文
- 服务端改 prompt；官方服务继续透传客户端生成的 `system` / `task`
- Tutor 模式的 prompt、`FINAL:` 契约、展示和复制行为变更
- 自动重试拒答；在计费、首轮流式文本和截图生命周期没有设计清楚前，不做“静默重试”
- session 持久化到磁盘；连续题上下文仅保存在当前应用进程内

---

## 成功标准

### A. 客户端确定性验收

| # | 验收项 |
|---|--------|
| A1 | Personality system prompt 明确限定为练习/自我评估场景，人物像和 session context 以“不可信数据”区块注入 |
| A2 | 每个成功 personality 响应都尝试生成版本化机器记录；客户端只接受通过 schema、长度和选项一致性校验的数据 |
| A3 | 下一请求的 `immediate_previous` 精确对应上一成功 capture；若上一题上下文无效，明确标记 unavailable，绝不退回更早情景冒充“上题” |
| A4 | 任意流式 chunk 切分下，`NSPI_CONTEXT_V1:` / `NSPI_ERROR_V1:` 的完整行和半截前缀都不进入 notch 面板；半截编号选项可作为 provisional 内容正常展示 |
| A5 | 成功状态下 UI 只显示通过校验的编号选项行；拒答、解释、JSON 和协议噪声不作为答案正文展示 |
| A6 | official / customKey / CLI 三通道收到同一个已冻结的 `CapturePrompt`，第二次 personality 请求均含同一份 session context |
| A7 | 切 tutor、切人物像或修改 active 人物像、切截图目标、切服务通道、手动开始新问卷、超时都会开始新 generation |
| A8 | 请求期间发生任何 scope 变化时，旧请求可以完成展示，但不得写入新 generation |
| A9 | session 仅驻内存；正文不写日志、不进 UserDefaults；总上下文有硬上限 |
| A10 | 完整 `swift test` 通过，现有 Tutor `FINAL:`、brief 展示和剪贴板测试不回归 |

### B. 模型行为验收

使用固定、脱敏的 personality fixture 集，在发布所用官方模型上执行发布门槛；对可用的 customKey / CLI 基线模型记录非阻塞基线：

| 指标 | 首轮目标 |
|------|----------|
| 合法选项输出率 | ≥ 95% |
| 有效 `NSPI_CONTEXT_V1` 率 | ≥ 95% |
| 基准集中拒答/说教 | 0 次 |
| 连续题正确使用 `immediate_previous` | ≥ 90% |
| 相反人物像在关键题上的方向性区分 | ≥ 85% |

这些指标只对本产品控制的官方发布模型构成首发硬门槛，不是数学上的永久保证。customKey / CLI 允许用户选择任意模型，因此只要求协议兼容测试通过并记录已知基线，不因某个外部模型未达标阻塞发布。官方模型未达标时，先调整 prompt / 协议；不得用“prompt 中包含 never refuse”代替行为验证。

---

## 根因与现有约束

当前每次 capture 都是无状态单轮：

```text
NotchController.runTapped
  → CLIRunner / APIKeyRunner / OfficialAPI.run
      → Prompts.systemText(...) + Prompts.taskInstruction(...)
      → 当前截图，无历史
```

另有四个实现约束：

1. 三个 runner 各自构造 prompt，容易出现某一通道漏传参数。
2. `model.answer` 同时承担流式原文和 UI 数据；Personality 目前不解析协议，直接显示正文。
3. `runTapped` 内存在截图、注册、CLI 探测等 await；请求期间设置页仍可修改人物像或通道。
4. 模型输出不可信：可能漏字段、加 Markdown、输出拒答、在分隔符中写任意文本，或在机器行结束前中断。

因此，本轮不能只“加一段 prompt + 全局数组”，而要增加：请求快照、session generation、严格输出解析和统一 prompt payload。

---

## 目标架构

```text
hotkey
  │
  ├─ freeze RunSnapshot
  │    mode / depth / persona snapshot
  │    capture target / channel identity
  │
  ├─ PersonalitySession.begin(scope)
  │    → SessionToken(generation, sequence, contextBlock)
  │
  ├─ Prompts.capturePrompt(snapshot, contextBlock)
  │    → CapturePrompt(system, task)       ← 只构造一次
  │
  └─ runner(prompt, image)
       ├─ rawBuffer += delta
       ├─ PersonalityAnswer.compose(raw, streaming: true) → UI
       └─ onDone
            ├─ 严格解析 rawBuffer
            ├─ token/generation/scope 仍匹配 → record
            └─ 不匹配或协议无效 → 丢弃/写 unavailable boundary
```

核心原则：

- UI 展示、session 记录和网络传输使用同一个请求快照，但使用不同的数据视图。
- session 不直接从 `TutorModel.answer` 读取；每次 personality 请求持有自己的局部 raw buffer，并在 `onDone` 写入任何占位文案之前解析它。
- “上一题”只指 `immediate_previous`。历史条目只能用于题面明确引用编号或同一场景时，不能替代缺失的上一题。

### 原文与展示职责（硬约定）

| 字段/消费者 | Personality | Tutor |
|-------------|-------------|-------|
| 请求局部 `rawBuffer` | 保存当前请求完整模型原文，包含机器行；供完成校验与 session record 使用 | 可不新增，维持现状 |
| `model.answer` | 保存同一份 raw 流，不做 strip、不回写 compose 结果 | 保存 raw，维持现状 |
| UI / 测高 | 始终读取 `PersonalityAnswer.compose(model.answer, streaming: ...).visibleChoices` | 继续走现有 `AnswerComposer` / `FINAL:` 路径 |
| session | 只解析请求局部 `rawBuffer`，不得解析 UI 字符串或占位文案 | 不适用 |

禁止把 strip、归一化或 compose 后的 Personality 文本写回 `model.answer`；否则会永久丢失机器行，并使完成阶段无法提取 context。

---

## 协议设计

### 可见答案

成功响应的可见部分仍为编号选项，每题一行：

```text
1. 当てはまる
2. Bに近い
```

模型的目标输出只包含编号选项行、可选机器错误行和一个上下文机器行。客户端解析应适度容错：

- 允许空行、首尾空白和常见 Markdown 装饰，例如 `**1. 当てはまる**`。
- 归一化后只把合法编号选项放进 `visibleChoices`。
- 非选项 prose 记为 violation 并从 UI 隐藏；只要至少存在一条合法选项，不因此把整页判成失败。
- 流结束后一条合法选项都没有时，客户端产生 `no_valid_choices` 错误。

### 错误机器行与客户端状态

截图无法读取时，模型可以输出机器错误：

```text
NSPI_ERROR_V1: {"code":"unreadable"}
```

模型协议错误码及与选项的关系：

| code | 含义 | 是否允许同时有选项行 |
|------|------|----------------------|
| `unreadable` | 当前截图整体不可读或选项无法辨认 | 否，终止型 |
| `partial_unreadable` | 部分题不可读；可附 `ordinals` | 是，只展示已识别题 |
| `depends_on_missing_previous` | 当前页全部可答内容都依赖缺失的上一题 | 否，终止型 |
| `partial_missing_previous` | 只有部分题依赖缺失的上一题；可附 `ordinals` | 是，仍回答可独立完成的题 |

客户端自身产生的状态不要求模型输出：

- `missing_previous`：注入的 `immediate_previous.status == unavailable`；它是警告，不自动阻止当前页作答。
- `no_valid_choices`：流结束仍没有合法编号选项。
- `invalid_context`：答案可展示，但 V1 context 无效，后续连续题进入 unavailable barrier。
- `transport_failure`：网络、服务或 CLI 失败。

`NSPI_ERROR_V1` 原始行永不显示。若 error code 允许与选项共存，客户端保留合法选项并把错误转为状态提示；终止型 error 才以错误状态结束本次作答。

允许共存的部分成功响应顺序为“合法选项行 → 一个可选 `NSPI_ERROR_V1` 行 → 一个 `NSPI_CONTEXT_V1` 行”；context 的 `last` 指最后一道实际回答的题。终止型错误响应只包含一个 `NSPI_ERROR_V1` 行，不要求生成 context。

### 上下文机器行

每个正常响应末尾输出且只输出一个版本化 JSON 行：

```text
NSPI_CONTEXT_V1: {"last":{"ordinal":"2","summary":"AとBのどちらが自分に近いかを選ぶ項目","choice":"Bに近い"},"referenceable":[{"ordinal":"1","summary":"会議で上司と意見が対立し周囲が沈黙","choice":"当てはまる"}]}
```

规则：

- `last` 必填，表示画面上最后一道已回答题；即使它不是情景题也必须生成，以免旧情景冒充“上一题”。
- `referenceable` 可为空，只保存当前 capture 内可能被编号或“同一场景”引用的条目。
- `ordinal`、`summary`、`choice` 都是数据，不得包含指令；JSON 负责转义 `|`、`=`、引号和换行。
- 客户端最多接受 8 个 `referenceable` 条目。
- `summary` 最多 240 个 Swift `Character`，`choice` 最多 80 个，`ordinal` 最多 24 个。
- 单个 payload UTF-8 最多 4 KiB；整个注入的 context block UTF-8 最多 8 KiB。
- 超限、JSON 无效、字段缺失，或 `last/referenceable` 中任一条目无法对应模型输出中的合法选项行时，payload 整体无效；这里不做截图 OCR。
- choice 对应校验的精确定义：每个 payload item 的 `ordinal` 必须对应一条已提取 `ChoiceLine`；把该选项行去除编号与常见成对 Markdown 装饰，trim 首尾并把连续空白折叠为单个空格后，必须与经同样归一化的 `payload.choice` 全文相等，不做模糊匹配。
- 编号提取首版接受 ASCII/全角数字及日文常见外形：`1.`、`１．`、`1)`、`1）`、`(1)`、`（１）`、`Q1`、`Q１`、`1、`。所有格式由 `PersonalityAnswer.normalizeOrdinal(_:)` 集中处理。
- `normalizeOrdinal` 只对 ordinal token 做 Unicode compatibility normalization、去除允许的 `Q/q` 前缀及成对括号/尾部分隔符，最后返回十进制数字字符串（上述示例均为 `"1"`）；不得对 choice 正文整体做 compatibility normalization。
- payload item 与 `ChoiceLine` 的 ordinal 必须先经过同一个 `normalizeOrdinal` 再比较；无法归一化的编号不参与 payload 对应。
- 不再把“格式不完整的整行”作为 summary，也不把任意原始模型文本注入下一请求。
- 若模型输出多个 marker，解析最后一个**有效** payload，同时把重复 marker 记为协议违规指标。

### 流式展示规则

新增统一入口：

```swift
PersonalityAnswer.compose(raw: String, streaming: Bool) -> Composition
```

`Composition` 至少包含：

- `visibleChoices: String`
- `finalizedChoices: [ChoiceLine]`
- `provisionalChoice: ChoiceLine?`
- `context: PersonalityContextPayload?`
- `errorCode: String?`
- `violations: [ProtocolViolation]`

流式算法：

1. 删除完整 `NSPI_CONTEXT_V1:` / `NSPI_ERROR_V1:` 行，无论 JSON 是否有效。
2. 最后一行的判定优先级固定为“机器 marker 前缀 → provisional choice → prose”。若去除允许的前导空白/Markdown 装饰后，它是 `NSPI_CONTEXT_V1:` 或 `NSPI_ERROR_V1:` 的任意真前缀，只执行 marker withholding，绝不能作为 `provisionalChoice`。
3. 对命中的 marker 前缀应用与 `FINAL:` 相同的 withholding：只要仍可能扩展成机器 marker，就暂不展示。
4. 未命中 marker 前缀时，从其余文本提取编号选项行；允许空行、上述编号形式和常见 Markdown 装饰，其他 prose 只记 violation，不进入 UI。
5. 流式中最后一条未换行、但已经形成合法编号前缀的行作为 `provisionalChoice` 逐 token 展示；尚未形成完整编号前缀的短前缀可以暂存。
6. `provisionalChoice` 参与 `visibleChoices` 和高度测量，但在换行或流结束前不进入 `finalizedChoices`，也不参与 context choice 校验。
7. 尚未出现合法或 provisional 选项时保持“作答中”；流结束仍无合法选项则显示客户端 `no_valid_choices`。
8. 渲染和高度测量都使用同一次 compose 的 `visibleChoices`，避免显示文本与面板高度不一致。

---

## PersonalitySession 设计

**建议文件：** `native/Sources/NotchSPI/Notch/PersonalitySession.swift`

Session 是 capture/UI 管线状态，不属于某一个 CLI，因此不放在 `CLI/` 或 `Settings/`。

```swift
struct PersonalitySessionScope: Equatable {
    let personaID: String
    let personaName: String
    let personaText: String
    let captureTargetID: String
    let channelID: String
}

struct PersonalitySessionToken: Equatable {
    let generation: UInt64
    let sequence: UInt64
    let scope: PersonalitySessionScope
    let contextBlock: String
}

@MainActor
final class PersonalitySession {
    init(now: @escaping () -> Date = Date.init,
         maxRecords: Int = 5,
         maxAge: TimeInterval = 15 * 60)

    func begin(scope: PersonalitySessionScope) -> PersonalitySessionToken
    @discardableResult
    func record(_ payload: PersonalityContextPayload,
                token: PersonalitySessionToken) -> Bool
    func markPreviousUnavailable(token: PersonalitySessionToken)
    func reset(reason: ResetReason)
}
```

### Scope 与 generation

- `personaID + personaName + personaText` 共同代表人物像版本；修改 active 人物像任一 prompt 字段都会改变 scope。
- `captureTargetID` 至少区分整个屏幕与目标 app bundle ID。
- `channelID` 区分 official、custom provider + endpoint/model、CLI backend。切换供应商时旧上下文不会跨供应商发送。
- `begin(scope:)` 发现 scope 改变、超时或手动新问卷时，先递增 generation 并清空旧记录。
- 每次 `begin` 都递增 sequence、把它设为当前 active sequence，并返回含当时 context 快照的 token；`begin` 本身不追加 record、空 record 或 barrier，也不改变已有成功历史。
- `record` 必须同时匹配 generation、scope 和当前 active sequence；新的 `begin` 会使同 generation 下更早的 token 失效。校验失败时返回 `false`，静默丢弃旧请求结果。
- 时间由闭包注入，过期测试不依赖真实等待。

### 顺序语义

- 每次有效 capture 生成一个 record，包含 `last` 和 `referenceable`。
- `contextBlock()` 明确拆成 `immediate_previous` 与 `older_referenceable`。
- 有效选项 + 有效 context 才提交正常 record；失败 capture 永远不能 append 空 record。
- 有效选项但 context 无效时，调用 `markPreviousUnavailable` 写入独立、带 sequence 的 continuity barrier；它不是 record，下一题不得用更早条目冒充上一题。
- 已经展示至少一条 finalized choice 后发生部分流/传输失败时，同样写入 barrier，因为用户可能已使用该答案。
- 尚未产生有效选项的 transport failure、终止型 `unreadable` 或 `depends_on_missing_previous` 不追加 record，也不写 barrier；此前最后一个成功 record 继续作为 immediate previous，便于用户重试当前页。
- 成功提交新的 record 后清除旧 barrier；barrier 和 records 分开存储，`contextBlock` 只由成功 records 加当前可选 barrier 生成。
- 最多保留 5 个 capture record，但先受 8 KiB 总上限约束；裁剪时从最旧记录开始。

### Reset 时机

必须 reset 或改变 scope：

- personality → tutor
- active 人物像切换、删除、首次自动激活，或 active 名称/正文修改
- 截图目标改变
- service channel、custom provider/endpoint/model、CLI backend 改变
- 15 分钟无活动
- 用户点击“开始新问卷 / 清空连续题上下文”

在设置/人物像编辑期间不要求每个按键直接调用 session；请求完成时通过 scope/generation 校验即可阻止旧结果写入。下一次 `begin` 发现人物像文本变化后自动开启新 generation。

### 隐私

- records 只驻内存，不写 UserDefaults、文件、崩溃诊断或普通日志。
- DEBUG 日志只记录 generation、记录条数、字节数和协议状态，不打印人物像、题干摘要或答案正文。
- 新问卷按钮提供明确的即时清除入口；应用退出自然清空。

---

## 实现阶段

### 不可降级的硬决策

以下决策不得在实现中以“先简化”为由删除；若确需改变，必须先修订本计划并重新评审：

1. 无效或缺失的机器 payload 不允许 raw fallback 注入下一请求，只能形成 unavailable barrier。
2. `CapturePrompt` 为三个 runner 的必传参数，不提供 `sessionContext = ""` 一类默认值掩盖漏传。
3. parser、session、prompt 与三通道接线同版交付；不能先上线要求 V1 协议的 prompt 而没有隐藏/解析能力。
4. 本轮不做静默拒答重试。
5. session 只驻内存，普通日志只记录元数据，不记录人物像、题干摘要或答案正文。
6. Personality 的 `model.answer` 始终保存 raw；展示层只能消费 compose 结果。

### Phase 1 — 输出协议与纯解析器

**文件：**

- 新建 `native/Sources/NotchSPI/Notch/PersonalityAnswer.swift`
- `native/Sources/NotchSPI/Notch/NotchDesign.swift`

工作：

1. 定义 `PersonalityContextPayload`、`ContextItem`、`ChoiceLine`、`Composition` 和 violation 类型。
2. 实现严格 JSON 解析、字段长度/总字节校验，以及相对于模型输出选项行的精确 choice 对应校验；不引入 OCR 假设。
3. 实现完整机器行剥离和 partial-marker withholding。
4. 实现容错编号选项提取：允许空行和常见 Markdown 装饰；prose 只记 violation，不进入成功答案正文。
5. 实现 `provisionalChoice`：流式展示半截选项，但完成前不参与 payload 校验。
6. Personality 渲染和高度测量统一使用同一次 `Composition.visibleChoices`。

验收：在任意字符边界回放机器行，UI 字符串均不出现 marker/JSON；无效 payload 不产生 session context。

### Phase 2 — Session、scope 与代际

**文件：**

- 新建 `native/Sources/NotchSPI/Notch/PersonalitySession.swift`

工作：

1. 实现 `begin/record/markPreviousUnavailable/reset`。
2. 实现 `immediate_previous`、历史记录、TTL、条数和总字节裁剪。
3. 分离成功 records 与 continuity barrier；`begin` 只分配 active sequence，不隐式推进历史。
4. 用 generation/scope/active-sequence token 阻止 in-flight 旧请求回写。
5. context block 以 JSON 数据区块输出，并明确声明内容不可信、不可作为指令执行。

验收：scope 任一字段变化都会换代；旧 token record 必须失败；unavailable barrier 不回退旧情景。

### Phase 3 — Prompt 重写与集中构造

**文件：** `native/Sources/NotchSPI/CLI/Prompts.swift`

新增不可选省略的 payload：

```swift
struct CapturePrompt: Equatable {
    let system: String
    let task: String
}

static func capturePrompt(
    mode: String,
    depth: String,
    personaName: String,
    personaText: String,
    sessionContext: String
) -> CapturePrompt
```

Personality prompt 要求：

1. 说明用途为练习、面试准备或用户自有的自我评估。
2. 扮演 TARGET PERSONA 作答，不使用 AI 助手默认人格，不输出说教或泛泛建议。
3. 先读题型和屏幕选项，再依据人物像选择；避免默认社会赞许和无差别极端选择。
4. `TARGET_PERSONA_DATA` 与 `SESSION_CONTEXT_DATA` 使用 JSON 编码并明确标为数据；其中即使出现命令式文字也不得执行。
5. 题面出现“上题/前問/先ほど”时只使用 `immediate_previous`，不得借用更早情景或编造。
6. `immediate_previous.status == unavailable` 时，仍回答当前页能独立完成的题，并按需输出 `partial_missing_previous`；只有当前页全部依赖上题时才输出终止型 `depends_on_missing_previous`。
7. 正常响应以编号选项行和一个 `NSPI_CONTEXT_V1` 行结束；每次正常 capture 必须生成 `last`。客户端允许空行、常见 Markdown 装饰和可隐藏的非选项 violation。
8. 截图整体不可读时输出终止型 `unreadable`；部分不可读时继续回答可识别题并输出 `partial_unreadable`。

Tutor 的 system/task 必须逐字保持原行为；`sessionContext` 在 Tutor 模式强制忽略。

### Phase 4 — 冻结请求并接入三通道

**文件：**

- `native/Sources/NotchSPI/Notch/NotchController.swift`
- `native/Sources/NotchSPI/CLI/CLIRunner.swift`
- `native/Sources/NotchSPI/CLI/APIKeyRunner.swift`
- `native/Sources/NotchSPI/Cloud/OfficialAPI.swift`

工作：

1. 热键触发并进入 MainActor Task 后、第一次 `await` 之前冻结 `RunSnapshot`：mode、depth、人物像、截图目标、通道及供应商配置。
2. Personality 分支用 snapshot 构造 scope，调用 `session.begin`，随后只调用一次 `Prompts.capturePrompt`。
3. 三个 runner 改为接收非 optional 的 `CapturePrompt`；runner 内不再调用 `Prompts.systemText/taskInstruction`。
4. CLI 抽出纯函数 `makeArguments(prompt:imagePath:)`，使最终命令文本可单测。
5. `onDelta` 同时追加到当前请求的局部 `rawBuffer` 和 `model.answer`；两者都保存 raw，包含机器行，且只在主线程修改。禁止把 compose/strip 结果写回 `model.answer`。
6. UI 刷新与测高只读取 `PersonalityAnswer.compose(model.answer, streaming: ...).visibleChoices`；Tutor 继续读取现有 `AnswerComposer` 结果。
7. `onDone` 在写占位文案之前解析请求局部 `rawBuffer`：
   - `ok + 有效选项 + 有效 payload`：尝试按 token record。
   - 有效选项但 payload 无效：保留选项展示，标记 context unavailable，并在状态栏显示本地化的“连续题上下文未保存”。
   - 允许共存的 `NSPI_ERROR_V1`：保留合法选项并显示状态提示；终止型 error 才以错误结束。
   - 尚无有效选项的网络/CLI 失败或终止型模型错误：不推进 session history，不写 barrier，保留此前成功 context 供重试。
   - 已有 finalized choices 后发生部分流/传输失败：不记录部分 payload，写 continuity barrier。
   - 流正常结束但无有效选项：显示客户端 `no_valid_choices`，不记录原始 prose，也不 append 空 record。
8. 完成时重新计算当前 scope；与 snapshot 不同则不 record，避免旧人物像结果污染新 session。
9. Tutor hotkey 在开始 Tutor capture 前 reset personality session。
10. `PersonalitySession.begin/record/markPreviousUnavailable/reset` 只能在 MainActor 调用；`Task.detached` 只做文件读取、编码和网络工作，禁止直接访问 session 或 `TutorModel`。

截图仍按现有路径在请求最终结束后删除；本轮不保留上一图。

### Phase 5 — 最小 session 控制与本地化

**文件：**

- `native/Sources/NotchSPI/Notch/NotchController.swift`
- `native/Sources/NotchSPI/App/L10n.swift`
- 必要时 `native/Sources/NotchSPI/Settings/MainSettingsWindow.swift`

工作：

1. 在现有齿轮菜单 `NotchController.buildQuickMenu()` 中，当当前 mode 为 personality 时加入“开始新问卷 / 清空连续题上下文”；不改变 personality 胶囊当前“打开人物像设置”的点击行为，也不新增 long-press。
2. 增加 unreadable、partial error、missing previous、协议错误、上下文未保存等本地化状态。
3. 因人物像、截图目标、service channel 或手动操作导致 generation 改变时，在状态栏一次性提示“连续题上下文已清空”；不得静默改变后续题语义。
4. 完成状态不得靠多次顺序赋值覆盖；先计算一个 `CompletionOutcome`，再按固定优先级映射主文案：
   1. 终止型模型错误 / transport failure
   2. `invalid_context` / 连续题上下文未保存
   3. partial error / `missing_previous` 警告
   4. 正常完成
5. 官方剩余额度、低额度和“已复制”等信息只能作为主状态后缀追加，不得覆盖高优先级文案，例如“连续题上下文未保存 · 剩余 42 题”。
6. reset 后不删除当前已展示答案，只影响下一请求的 context。

这不是人物像 UI 大改，而是明确 session 边界所需的最小控制。

### Phase 6 — 自动化测试与行为评估

详见下一节。只有确定性测试全部通过、固定题库达到行为门槛后才视为完成。

---

## 测试计划

### 单元测试

#### `PersonalityAnswerTests.swift`

- 合法 JSON、Unicode、转义字符、多题 payload
- 缺字段、错误类型、空 choice、超长字段、总 payload 超限
- `last/referenceable` 每个 item 的 ordinal 对应输出编号，choice 与该选项正文经相同空白/Markdown 归一化后精确相等；不相等时拒绝 record
- CRLF、前导空格、大小写/全角冒号、常见 Markdown 装饰
- `normalizeOrdinal` 覆盖 `1.`、`１．`、`1)`、`（１）`、`Q1`、`Q１`、`1、`，并验证 payload/ChoiceLine 使用同一 canonical ordinal
- 多个 marker：最后有效 payload 生效并产生 violation
- 在 marker 的每一个字符位置切分流，所有中间 UI 字符串均不泄漏机器文本
- `N`、`NS`、`NSPI_...` 及带允许装饰的 marker 真前缀优先进入 withholding，绝不被识别为 provisional choice
- 半截编号选项作为 provisional 内容展示、参与测高，但在完成前不参与 context 校验
- 拒答/解释 prose 不进入 `visibleChoices`；已有合法选项时只记 violation，不把整页判失败
- 终止型与可共存型 `NSPI_ERROR_V1` 按 code 表执行，且均不显示原始 JSON
- 客户端派生的 `no_valid_choices/invalid_context/missing_previous` 不依赖模型 error 行

#### `PersonalitySessionTests.swift`

- immediate previous 与 older referenceable 顺序
- 无效上一题形成 unavailable barrier，不回退旧场景
- 最多 N 条、8 KiB 总上限、TTL 裁剪
- 注入 clock 后精确测试 15 分钟边界
- reset 清空并递增 generation
- persona 内容、target、channel 任一变化触发换代
- 旧 generation / 旧 sequence / 旧 scope record 均失败
- `begin` 只递增 active sequence，不追加 record/barrier；第二次 begin 使第一次 token 失效
- 无选项 transport failure 不推进历史；有效选项 + invalid context 或 finalized partial failure 只写 barrier，不写空 record
- barrier 与 records 分离；成功 record 清除 barrier，context block 仅由成功 records + 可选 barrier 组成
- context block 中内容只位于 JSON data 区块且不超限

#### `CapturePromptTests.swift`

- Personality 同时包含 persona 数据、session 数据和 V1 输出契约
- 在引入 `CapturePrompt` 前先生成并提交 Tutor golden fixtures；重构后各 depth/language 输出与 fixture 完全相同，且忽略 session context
- 人物像或 summary 含 `</...>`、引号、换行和命令式文本时仍被安全 JSON 编码

现有 `testPersonalityHasNoContractButStreamsSafely` 等 personality 弱字符串断言应删除或改写：输出解析与流式行为迁到 `PersonalityAnswerTests`，prompt 契约迁到 `CapturePromptTests`，session 行为迁到 `PersonalitySessionTests`。`AnswerComposerTests` 继续只保护 Tutor `FINAL:` 契约。

#### 三通道请求测试

- `CLIRunner.makeArguments` 的最终 prompt 含同一 context block
- `APIKeyRunner.makeRequest` 的 user task 含同一 context block
- `OfficialAPI.makeCaptureRequest` 的 `task` 含同一 context block
- Tutor 请求不含 `SESSION_CONTEXT_DATA`
- 不允许以 `sessionContext: String = ""` 默认参数掩盖漏传；三个 runner 都必须接收 `CapturePrompt`

#### 协调器/时序测试

- 模拟请求中途切人物像：旧结果不写新 session
- 模拟请求中途切 channel/target：旧结果不写新 session
- 成功但空输出、部分流后失败、协议无效均不会把占位文案或 raw prose 记录为 context
- 连续两次 capture 时，第二个已构造请求包含第一个的 payload
- `model.answer` 在 Personality 完成后仍保留原始机器行，UI/测高只出现 compose 后的选项
- session 与 `TutorModel` 的访问保持 MainActor 隔离；后台 detached 工作不直接触碰二者
- `CompletionOutcome` 的主状态优先级固定；`invalid_context` 不会被 partial/正常完成覆盖，额度和复制只作为后缀
- 覆盖“partial + valid context”“invalid context + official quota”“terminal error + partial raw text”等组合

### 完整回归

必须运行完整测试，不只运行 filter：

```bash
cd native
swift test
```

开发中可以使用 filter 加速，但提交前的验收记录必须来自完整测试。

### 固定题库评估

Fixture 评估是独立交付物，不视为“代码完成后顺手跑一次”。发布负责人或本次变更作者负责执行，并由第二位审核者复核需要人工判断的人物像方向性结果。

建立脱敏 fixture 清单，至少包含：

1. 10 组容易触发拒答/说教的练习问卷截图
2. 10 组能区分两种相反人物像的 Likert / A-B 题
3. 10 组“当前情景 → 下一页引用上题”的连续题
4. 多题同屏、编号重置、日文“前問/先ほど/同じ場面”等边界案例
5. 模糊截图和缺失选项，用于验证 `NSPI_ERROR_V1`

存放与版本管理：

- 完全合成、无隐私和版权风险的图片、人物像及期望元数据放在 `native/Tests/Fixtures/Personality/`，随 Git 提交；`manifest.json` 为稳定 fixture ID 和评分规则的唯一来源。
- 不能进入 Git 的真实脱敏集放在仓库外的私有目录，通过 `NSPI_PERSONALITY_FIXTURES_DIR` 指定；仓库只保留 manifest schema 和运行说明，不保留真实内容或绝对路径。
- 原始运行结果默认写入 `native/.eval-results/personality/<date>-<commit>.jsonl`，不进入普通运行日志且默认不提交；脱敏汇总可写入 `native/docs/evals/personality/<date>-<commit>.md` 随发布记录提交。
- commit 5 必须在仓库根 `native/.gitignore` 加入 `/.eval-results/`，并用 `git check-ignore native/.eval-results/personality/sample.jsonl`（从上级目录执行）或等价测试确认原始结果不会被误提交。

每条 JSONL 至少记录：`fixture_id`、commit、app version、channel、provider/model、raw protocol status、合法选项数、context 是否有效、拒答/说教标记、连续题得分、人物像方向性得分、执行人与审核人。不得增加 raw completion/persona/question 文本字段，也不得记录真实用户数据。

门槛规则：

- 官方发布模型必须达到“模型行为验收”中的全部首轮目标，才允许发布。
- customKey / CLI 因模型由用户选择，只要求请求形状和协议兼容测试通过；对选定基线模型记录结果，但结果不作为首发阻塞条件。
- fixture 或评分规则变化必须更新 manifest 版本，不能与旧结果直接混算。

---

## 文件清单

| 文件 | 变更 |
|------|------|
| `Sources/NotchSPI/Notch/PersonalityAnswer.swift` | 新建：V1 协议、严格解析、流式 compose、可见选项提取 |
| `Sources/NotchSPI/Notch/PersonalitySession.swift` | 新建：scope、generation、TTL、上下文窗口 |
| `Sources/NotchSPI/CLI/Prompts.swift` | Personality prompt 重写；集中生成 `CapturePrompt` |
| `Sources/NotchSPI/Notch/NotchDesign.swift` | Personality 渲染/测量统一使用 compose 结果 |
| `Sources/NotchSPI/Notch/NotchController.swift` | RunSnapshot、局部 raw buffer、session begin/record/reset、最小清空入口 |
| `Sources/NotchSPI/CLI/CLIRunner.swift` | 接收 `CapturePrompt`，抽出可测试的 arguments builder |
| `Sources/NotchSPI/CLI/APIKeyRunner.swift` | 接收 `CapturePrompt` |
| `Sources/NotchSPI/Cloud/OfficialAPI.swift` | 接收 `CapturePrompt` |
| `Sources/NotchSPI/App/L10n.swift` | 协议/上下文错误与清空入口文案 |
| `.gitignore` | 忽略 `/.eval-results/`，防止评估 JSONL 被误提交 |
| `Tests/NotchSPITests/PersonalityAnswerTests.swift` | 新建 |
| `Tests/NotchSPITests/PersonalitySessionTests.swift` | 新建 |
| `Tests/NotchSPITests/PureLogicTests.swift` | Prompt、三通道 payload、Tutor 回归 |
| `Tests/NotchSPITests/AnswerComposerTests.swift` | 现有 Tutor FINAL 契约保持不变 |
| `Tests/Fixtures/Prompts/*` | 新建：重构前 Tutor golden fixtures |
| `Tests/Fixtures/Personality/manifest.json` | 新建：合成 fixture 索引与评分规则 |
| `docs/evals/personality/*` | 发布时可提交的脱敏评估汇总 |

新文件位于现有 `Sources/NotchSPI` / `Tests/NotchSPITests` 树下，SPM 自动收录，通常无需修改 `Package.swift`。

`PersonaStore.swift` 原则上无需直接依赖 `PersonalitySession`；session 通过冻结的 persona snapshot/scope 判断换代，避免 Settings 层反向依赖 capture 状态。如果实现时需要立即通知 UI，可新增通用 change notification，但不得在 `PersonaStore` 中直接持有 session singleton。

---

## 实现顺序与提交粒度

1. **commit 0：Tutor golden baseline** — 在任何 prompt 重构前锁定各 depth/language 的现有输出
2. **commit 1：协议与 parser** — `PersonalityAnswer` + 流式/严格解析测试
3. **commit 2：session** — scope/generation/TTL/barrier + 测试
4. **commit 3：prompt payload** — `CapturePrompt` + prompt 测试，Tutor golden 必须保持不变
5. **commit 4：三通道与 controller** — RunSnapshot、raw buffer、请求形状测试
6. **commit 5：最小清空入口、本地化、`.eval-results` gitignore、完整回归与 fixture 评估记录**

不要先单独上线“强硬 anti-refusal prompt”再等待 session/parser；新的 prompt 会要求机器协议，必须与解析和隐藏逻辑同一版本交付。

### 工作量预估

- 一名熟悉代码库的开发者完成实现和单元测试：约 3–5 个工作日。
- 合成/整理 fixture、跑官方模型、记录和复核评估：另计约 1–2 个工作日。
- customKey / CLI 基线受本地模型、登录状态和外部服务可用性影响，可在不阻塞官方发布的前提下补齐记录。

这是计划排期依据，不是承诺；fixture 制作、模型访问或人工复核受阻时应单独报告。

---

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| 模型漏写/写坏 context | 严格拒绝、写 unavailable barrier、状态提示；固定题库追踪有效率，不注入 raw fallback |
| 机器行流式闪现 | partial-marker withholding + 每字符切分测试 |
| 多题截图的“上一题”歧义 | payload 强制 `last`；历史条目单列，prompt 禁止用历史替代 immediate previous |
| 人物像/设置在请求中变化 | RunSnapshot + scope + generation token；完成时二次校验 |
| 同一人物像开启新问卷串台 | 必需的“开始新问卷”入口 + TTL + target/channel scope |
| 上下文被发送到另一供应商 | channel identity 纳入 scope，切换即清空 |
| prompt injection / 分隔符破坏 | JSON 编码、严格 schema/长度、数据区块声明、拒绝 malformed raw fallback |
| session 或日志泄露敏感内容 | 仅内存；日志只记元数据；显式清空入口 |
| 上下文过长 | 字段、条数、payload 和 contextBlock 四层硬上限 |
| prompt 仍偶发拒答 | 用行为指标决定后续策略；不声称 prompt 能覆盖供应商政策 |
| 自动重试重复计费 | 本轮不做；未来必须先设计计费与 UI，再单独评审 |

---

## 手测清单

1. 设置明确人物像，连续回答普通 Likert、A-B、多题同屏，UI 始终只出现编号选项。
2. 截情景题后再截“上题情景…”，确认第二请求使用 `immediate_previous`，答案依赖正确情景。
3. 让上一响应缺失/损坏 context，再截“上题…”，应报告上下文不可用，不能借用更早情景。
4. 在请求流式过程中修改 active 人物像；旧答案可完成显示，但下一题不带旧 context。
5. 切人物像、Tutor、截图目标、official/customKey/CLI 后，确认 generation 改变、旧 context 不发送，并能看到一次性的“连续题上下文已清空”状态提示。
6. 点击“开始新问卷”，当前答案保持展示，下一次 personality 请求无旧 context。
7. 从现有齿轮菜单执行“开始新问卷”；personality 胶囊仍按原行为打开人物像设置。
8. 人工回放逐字符机器行，面板无 `NSPI_`、JSON 或高度跳动；半截编号选项可以自然流式显示。
9. Tutor brief/guided/full/hint 各走一次，`FINAL:` 卡片、推理折叠和自动复制行为不变。
10. 环境允许时 official / 自定义 key / CLI 各完成两次连续 personality capture，并核对第二请求形状。
11. 在尚无有效选项时制造 transport failure，再重试同一页；此前成功的 immediate previous 应保留。已有 finalized choice 后中断则应形成 unavailable barrier。
12. 验证 `invalid_context + official quota`、partial warning 和正常完成的状态优先级；额度/复制只能作为后缀，不能覆盖关键警告。

---

## 后续阶段：拒答重试（不属于本轮）

只有固定题库仍未达到拒答指标时再立项。新计划必须先回答：

- 首轮拒答已经流进 UI 后如何回收或隔离
- official/customKey 的首轮费用是否已产生，是否允许再次收费
- 是否需要服务端返回“不计费重试”语义
- 截图在重试结束前如何安全保留和最终删除
- 如何防止重试循环及两次 completion 同时回调

未解决以上问题前，不实现关键词检测后的“静默自动重试”。

---

## 范围冻结

- **做**：V1 结构化协议、严格 parser、流式隐藏、session scope/generation、统一 `CapturePrompt`、三通道注入、最小清空入口、自动化和 fixture 验收。
- **不做**：上一图重传、人物像表单结构化、服务端 prompt 改动、自动拒答重试、session 落盘、Tutor 行为变更。
