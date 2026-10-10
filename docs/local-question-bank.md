# 本地题库

用户导入自己的题库后，可以在本机搜索并查看答案。普通单图、讲解、简要模式优先查本地。身份已经由用户核对、题库允许自动使用、并且启用题库之间没有不同答案时，直接显示答案。其余情况沿用所选模型服务，并使用已经取得的那一张图。

当前版本号保持 2.17 / build 24。这份能力在本地可验证，尚未进入正式发行包。

## 使用

1. 打开设置，进入「题库 / 問題集 / Question Banks」。
2. 选择 `.nspibank.json`、普通 `.json`，或先点「模板」得到固定列的 CSV。
3. 在预览中确认题库名称、语言、有效题、失败行和替换影响，再提交。提交使用当时选中的名称和语言。CSV 的语言列留空时，采用预览里的语言。导入结束后，页面保留成功、部分失败或全部拒绝的结果，失败原因留在详情里。
4. 用关键词搜索。结果按页显示，每页 50 条。点开后可查看题干、选项、答案和解析，并复制答案。
5. 每个题库有「启用检索」和「允许自动使用」。新导入的题库启用检索，自动使用关闭。
6. 单题可以标记「此题不再自动使用」。停用或移除题库后，下一次展示前不再使用它的答案。

截图查题只在同时满足这些条件时查本地：讲解模式、简要深度、一张图、不是自动模式、不是多图或框选、不在引导中，并且已经知道有启用的题库。其他入口保持原来的模型路径。

第一次见到的图片排列会先给出最多 3 个候选，或在没有足够候选时进入模型。核对按钮是「核对无误，使用此题答案」。确认同时表示题面、条件和当前选项对应这一条库内题目。取消回到待机。选择「使用模型重新求解」时，用冻结的原图进入原来的模型准备，不重新截图。

答案卡显示「本地题库 · 用户提供」，以及题库名称和版本。旁边有「查看原题/来源」和「使用模型重新求解」。后一个动作才进入所选通道，并按该通道原来的额度规则计费。

本地命中不创建官方请求，不改变余额、累计问答或 Token。官方服务的成功问答仍扣 1 题。题库没有解析时显示「此题库未提供解析」。

## 文件

标准后缀是 `.nspibank.json`，选择器同时接受 `.json`。根对象 `schema_version` 固定为 1。必填字段为 `bank_id`、`title`、`version`、`language`、`questions`。语言取 `zh`、`ja`、`en`。版本是三段非负整数。题目类型为 `single_choice`、`multiple_choice`、`short_fill`。选择题答案引用本题存在的选项 ID；短填答案是文本，单位可选，界面用一个空格连接。

未知字段、重复键、错误类型和未知 schema 会拒绝对应层级。根对象错误使整包失败。单题错误记入报告，其余有效题可以提交。有效题为 0 时不创建题库。JSON 和 CSV 都最多 10,000 题；超出时整份拒绝，不写入部分题目。文件上限 20 MiB，UTF-8，允许 BOM，只接受普通文件。

CSV 固定列：

```text
id,type,language,stem,option_a,option_b,option_c,option_d,option_e,option_f,answer,unit,explanation,source
```

选择题标签为连续的 A–F，导入后选项 ID 为 `o_a` 至 `o_f`。多选答案用分号，例如 `A;C`。短填的选项列留空，答案按原文保存。

同一文件再次导入且内容未变时不新增题库。外部 `bank_id` 相同只提示可能是更新，由用户选择要更新的本地实例。同版本内容变化不覆盖原库。更高版本在一个事务里替换该库成员，并保留启用开关；内容有变化时自动使用回到关闭。更低版本拒绝覆盖。调整预览的标题或语言时，JSON 里原有的版本、作者、说明、来源和许可保留。同题不同答案同时保留。自动匹配看到多个答案时返回冲突。用户明确选定其中一个来源后，可以展示这一次答案，来源行标明与其他已启用题库不一致；这次展示不记为自动可信，下一次仍是冲突。

作者、`bank_id` 以及文件里的任何字段都不授予官方来源或自动信任。来源类型和自动使用由本机根据导入操作写入。

三道合成题示例：

- [sample-bank.nspibank.json](../Tests/Fixtures/QuestionBank/sample-bank.nspibank.json)
- [sample-bank.csv](../Tests/Fixtures/QuestionBank/sample-bank.csv)

设置里的模板与这份 CSV 是同一组示例，用于格式验收。

## 数据

日常数据库位于：

`~/Library/Application Support/com.rottesya.notchspi/QuestionBank/questions.sqlite`

路径由 `FileManager.applicationSupportDirectory` 求出。`NSPI_QA_EPHEMERAL=1` 和 XCTest 使用临时目录，测试注入自己的库文件。

schema 使用 `PRAGMA user_version`，当前为 1。打不开、版本更新或迁移不能完成时保留原文件，设置页显示错误，查题继续走模型路径。

移除应用数据时，删除上述 `QuestionBank` 目录即可去掉已导入题库。这不影响账户钥匙串或模型设置。

## 查题规则

可复用的自动答案同时要求：这组图片此前由用户核对过，题目和答案仍是当时看到的版本，题库启用且允许自动使用，该题未被屏蔽，启用题库中没有不同答案，选项映射完整且唯一，并且当前请求的代次和用户选择没有改变。

确认时，写入别名的同一事务会比较用户看到的身份、题目修订和目录修订。题干、答案或选项已经变化，或题目已删除时，关闭这次核对并提示「题目已变化，这次核对已关闭。」，不写入别名，也不展示更新后的答案。

已保存的当前标签映射会随后来的候选和冲突一起返回。核对页提交的是用户最后选择的「当前标签 → 稳定选项 ID」。映射要一一对应且覆盖全部选项；缺少当前选项时不能确认。

OCR 文本与库内相同，只产生候选。识别使用系统 Vision。从前台查题入口起，语言读取、图片别名、OCR 和候选查询共用 350 毫秒。到期即解除前台等待，数据库锁和导入排队也算在这段时间里。同一时刻只保留一个底层识别任务；超时后下一次请求看到忙碌就跳过。迟到结果不改写已经进入的下一步。

选项顺序变化时，答案显示当前标签。原解析含旧标签时，重排后改为说明「原解析使用旧选项顺序」。重复选项，或选项依赖「以上」「以下」这类位置关系时，不建立可复用的重排映射。

启动时异步读取是否有启用题库。这次读取完成前，快捷键查题沿用模型路径。

## 后续接入

官方内置题库使用同一校验器。`built_in` 来源由应用内的资源清单确定，安装到同一个 SQLite，并与用户导入的实例分开。用户的停用选择在应用更新后保留。发行时再把资源复制写进 `scripts/package.sh`，并在实际 `.app` 里测试。当前包不附带题库。

链接导入的后续入口是：粘贴 HTTPS 文件地址，下载到临时文件，再进入现有预览。下载完成后离线使用。传输哈希只说明文件完整。

## 验证

命令从 `native` 目录执行，Swift 测试串行，并带 `-warnings-as-errors`。`NSPI_QA_EPHEMERAL=1` 避免打开用户的题库和钥匙串。

`NSPI_QA_EPHEMERAL=1 swift test -Xswiftc -warnings-as-errors`：423 项，4 项跳过，0 失败。其中 QuestionBankTests 为 28 项。`swift build -c release --arch arm64` 完成。`git diff HEAD --check` 通过。服务端 `npm run typecheck` 通过，`npm test` 为 625 项、0 失败。

`./scripts/verify.sh` 会在 repo-health 停止。已记录的输出是 `repo-health: 2270 issue(s)`，断链位于已提交的 `.release-evidence`。本次没有改这些历史文件。完整 verify 不记为通过。

性能样本来自本次单独的 QuestionBankTests，机器为 Apple M1 Pro、16 GB、macOS 27.0。数字只描述这组测试输入上的导入和检索：

| 项目 | 结果 |
|---|---|
| 10,000 题 JSON 导入 | 2.245 秒 |
| 中文、日文、英文子串各 1 次 | 2.2 毫秒、1.8 毫秒、1.7 毫秒 |
| 「中文甲」再搜 21 次 | p50 1.6 毫秒，p95 1.7 毫秒 |
| 锁库、actor 排队和 1 秒脚本识别 | 前台在 0.7 秒内返回超时；识别进行时下一次为忙碌；引擎结束后再次查找为 miss，底层调用增加 1 次 |

截图查题的整体耗时还包括人工确认、Vision 冷启动和答案首绘。这三项本次没有测量。控制器测试确认本地答案的 `route` 为 `local_bank`，模型准备入口计数为 0。空语言 CSV 按预览语言导入、切换语言后立即提交、以及导入结果在列表刷新后保留，分别由 `testCSVLimitAndBlankLanguageImport`、`testImportSheetAppliesTheSelectedLanguageImmediately` 和 `testImportResultSurvivesTheFollowingReload` 覆盖。

核对窗口在测试中置前：有序题的确认按钮关闭，Esc 是第一响应者。设置页加载模板题库后搜索「偶数」得到 1 条，导入和复制答案按钮存在，直接子视图位于页面边界内。窗口的 `sharingType` 排除软件截图，这次没有替换正在运行的应用。

### 验收

| ID | 结果 | 证据 |
|---|---|---|
| A01 | 通过 | `testSamplePackageAndCSVKeepChoiceIDsAndFillUnits` |
| A02 | 通过 | `testCSVQuotesNewlinesBOMAndBrokenRows` |
| A03 | 通过 | `testRejectsUnknownSchemaDuplicateKeysMissingOptionsAndTrustFields` |
| A04 | 通过 | `testEmptyOversizedDowngradeAndCrossBankConflict`；`testCSVLimitAndBlankLanguageImport`：10,000 题 CSV 可导入，10,001 题返回 `too_many_questions` 且题库列表仍为空 |
| A05 | 通过 | `testImportLifecycleSearchConflictAndReopen`；删除其中一个库后另一库仍可搜到 |
| A06 | 通过 | `testManualConflictSelectionCanBeShownOnce`：手动选定一个来源后展示该答案，来源行标明不一致，`userTrusted` 为否；自动复核为空，下一次查找仍是 conflict |
| A07 | 待验证 | 同版本内容变化返回 `version_conflict`，降级返回 `downgrade_refused`，重开后题数仍在。写入中断后的事务回滚和磁盘不可写仍待故障注入 |
| A08 | 通过 | `official` / `verified` 是未知字段 |
| A09 | 通过 | `testSwappedAliasKeepsTheCurrentAnswer`：人工确认的 A=12、B=18 在再次核对和开启自动使用后仍是「B  18」 |
| A10 | 通过 | `testReviewSubmitsThePopupMapping`：下拉改为 A→o2、B→o1 后，确认回调、答案显示和再次提交都是这一映射。当前选项为空时确认按钮关闭 |
| A11 | 通过 | `testIdentityKeepsDigitsSignsUnitsNegationAndSuperscripts`；换一个数字的识别结果为 miss |
| A12 | 通过 | `testOCRMatchIsCandidateUntilAConfirmedAliasExists` |
| A13 | 待验证 | 别名 ready 与 miss 的模型准备入口计数已有测试。未注册、零额度、断网、缺配置下的本地命中，以及所选渠道恰好一次兜底时的账户和计费副作用，仍待分别测量 |
| A14 | 待验证 | 启用题库时预热次数为 0，本地答案先显示。三个真实 runner 尚未分别探测 |
| A15 | 待验证 | miss 时模型准备入口为 1，并使用已准备的图片。三个真实 runner 的副作用仍待分别测量 |
| A16 | 通过 | `testLookupBudgetCoversLanguageAliasOCRAndALockedDatabase`：锁库、0.8 秒 actor 占用和 1 秒识别都在 0.7 秒内返回 timeout；识别未结束时为 busy，结束后下一次为 miss |
| A17 | 待验证 | 展示前有代次、深度和所选服务复核。核对中换题、切账号和材料过期的完整控制器场景仍待覆盖 |
| A18 | 通过 | `testConfirmRejectsAQuestionChangedDuringReview`、`testConfirmRacesABankUpdate`：核对期间题干、仅答案、选项变化或删除后不写入别名；并发更新若留下别名，题目仍是核对时看到的那一版 |
| A19 | 待验证 | 本地答案的 `resultState` 为空，`parserPath` 为 none，来源行是用户提供。官方答案切到本地答案后的旧 snapshot、恢复入口和反馈状态仍待完整控制器验证 |
| A20 | 通过 | `testProtocolWordsInExplanationStayContent` |
| A21 | 待验证 | `user_version` 为 2 时保留文件，查询不可用。`testDamagedDatabaseFileIsKept` 对损坏字节打开失败并保留原文件。写入中断回滚和撕写恢复仍待故障注入 |
| A22 | 通过 | `testEligibilitySkipsLocalForTheOriginalPaths` |
| A23 | 通过 | 临时库与注入根目录；计时跟踪只在 DEBUG 且 `NSPI_QA_EPHEMERAL=1` 时写本地记录 |
| A24 | 待验证 | 中文核对窗口可见，有序题确认按钮关闭，Esc 为第一响应者；设置页搜索「偶数」和按钮边界已检查。三语、长题干、长选项和完整设置页导入链路的视觉与辅助功能仍待验收 |
| A25 | 通过 | 没有启用题库时查找次数为 0，并走原来的预热 |

A11 覆盖的是这组数字、符号、单位、否定和上下标反例。模型准备次数来自注入的准备入口，A13–A15 仍待真实 runner 的账户与计费测量。

三个实现约束与已通过的测试一致：识别文本相同只进入核对；本地命中发生在注册、额度、预热和模型运行之前；文件中的作者或 official/verified 字段不成为信任来源，更新一个实例不会改写其他题库。


### 2026-10-09 第二轮验收问题修复

已修复 R1–R3，并增加 4 项有断言的回归测试：

- `testConflictAliasCanSwitchSourcesAndIgnoreDisabledBank`：同图可在冲突来源间重新选择；每个题库按自己的 option ID 重建映射；停用的库不再出现在候选中，重新启用后仍阻止冲突答案自动使用。重新确认在同一事务中校验题目版本并重绑别名。
- `testLanguageDefaultsRemainEditableAcrossCompletedPreviews`：预览补填的语言保留“原文件未指定”的来源，反复切换后逐题语言与最终选择一致；文件显式语言保持不变。
- `testSessionDeadlineIncludesFinalCheckAndIgnoresLateAnswer`：查找和最终复核共用前台预算，350ms 到期只兜底一次；迟到的结果不展示，查库完成计时包含最终复核。
- `testRuntimeFinalCheckTimesOutOnStorageQueueAndLock`：使用真实 SQLite 锁和存储 actor 队列验证最终复核的期限；自动复核沿用原查找 deadline，人工核对后的复核使用新的预算。

本轮全库 Swift 427 项（4 跳过、0 失败），题库测试 32 项，arm64 Release 构建及 diff 检查通过。独立复跑第二轮验收探针，旧候选仍返回 stale，重排截图始终输出 B 18，冲突来源数为 2 且可重选，语言 ja→en 后逐题均为 en。锁库最终复核本机约 0.331 秒返回，属于软期限和调度开销下的一次测量，不是整体截图时延承诺。复用过期 deadline 的后续调用会立即返回 nil；另有新 deadline 的存储排队测试覆盖。

完整日志和探针位于项目上一级 `output/local-question-bank-fixes-2026-10-09/`。本轮仅针对剩余三个问题落地；上表尚待验证的真实 runner 计费副作用、完整账号/过期状态、三语长文本视觉及存储故障场景仍保持待验证。没有发布或替换正常运行包。


### 2026-10-09 本地答案与长文本核对修复

本地答案以结构化数据直接绘制答案卡，按纯文本保留换行、FINAL/NSPI_ 和 Markdown 字符；显示与复制使用同一原文，解析同样按普通内容显示。渲染和高度测量共享此入口。

核对窗口支持调整大小，完整题干、选项、映射及答案放在可滚动区域中；映射下拉框下方显示所选选项全文，底部三个操作按钮保持可见。切换候选时移除旧映射标签并回到顶部。

新增多行协议/Markdown 原文展示与复制一致性、长文本滚动和布局不重叠回归，Swift 全库 429 项（4 跳过、0 失败）。实际隔离 AppKit 窗口核验 30 行题干、六个长选项及末项映射/答案滚动；完整三语端到端、真实 runner 等前述待验项目仍待完成。证据在项目上一级 output/local-bank-display-fix-2026-10-09/。
