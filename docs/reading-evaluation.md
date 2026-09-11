# 阅读练习执行与独立复核

本工具链实现蓝图 §13.2 的新合约评测，输出用于 `independent-quality-v1` 的逐题摘要和单独的解释复核报告。它不生成授权、标准答案、评审签名或真实模型结果，也不自动开放支持目录。单元测试中的合成 diagnostic 数据只用于软件验证。

## 输入与冻结

结构权威是 [`reading-evaluation.mts`](../scripts/lib/reading-evaluation.mts) 的 `ReadingManifest` / `ReadingCase` 和 [`reading-runner.mts`](../scripts/lib/reading-runner.mts) 的 `ReadingCandidate`。JSON 必须完整匹配字段，引用文件以原始字节 SHA-256 绑定。

| 输入 | 内容和约束 |
|---|---|
| manifest | schema 1 或 2、dataset ID、holdout/diagnostic、范围版本、声明组合、每题型解释抽样数、家族/授权文件引用及有序 cases |
| case | 唯一 ID、family ID、题型、语言、布局、预期、风险、标准答案集合、JPEG/PNG MIME、1–4 个有序图片引用、最后一图上的单目标 scope |
| 答案真值 | 仅 answerable 有非空 `accepted_answers`；retake、范围外、多目标及 unlabelled 不填猜测答案。保留单位、符号、完整选项及顺序 |
| schema 2 评分 | manifest 必需 `answer_scoring_version=reading-answer-v2` 与 `answer_scoring_sha256`；每题必需 `answer_scoring`，answerable 使用下表中的显式规则，其他预期必须为 null。版本、代码摘要、规则和金标都进入授权摘要 |
| 图片 | 每文件不超过 6 MiB；相对路径不得越过题集目录，禁止最终符号链接、管道及损坏图片。完整解码沿用生产校验，保留原字节摘要和页序。完全相同图片集合与 scope 不能重复计样本 |
| family split | schema 1、dataset ID、`development_families`、`holdout_families`；两组各自唯一且不相交，holdout 集合必须正好覆盖 manifest 的家族 |
| corpus review | schema 1、reviewer、UTC reviewed_at/expires_at、`manifest_subject_sha256`，以及 authorized_materials、external_model_processing、labels_reviewed、family_split_verified 四项明确 true |
| candidate attestation | schema 1、base_url、model、40 位 commit、app_version、scope_version、config_revision、isolated=true、verified_by、verified_at/expires_at、verification_sha256 |
| candidate evidence | 原始隔离部署核验材料，摘要必须匹配 verification_sha256。应证明实际部署代码/模型配置、隔离设备、版本及目标入口；由工程师依据真实部署信息准备，不能用自报字符串替代核验 |
| cost bound | [`EvaluationCallBound`](../scripts/lib/evaluation-budget.mts) 规定的币种、价格、输入/输出最大 token、换汇上界及来源。与模型和候选地址完全一致；核验有效期最多 24h |

授权复核人必须与 executor 不同。`readingManifestSubject` 对去掉 `authorization_review` 引用后的完整规范化 manifest 求摘要，避免授权文件循环引用；最终 manifest 字节摘要仍绑定该授权文件。源文件复核包括向外部模型传输的授权，普通 feedback-v2 导出授权不满足这个条件。

### schema 2 的逐题评分语义

[`reading-answer-scoring.mts`](../scripts/lib/reading-answer-scoring.mts) 只服务新题集。schema 1 沿用原匹配器，现有 240 题的 fixture、评分程序和 FINAL/JSON 生产协议均不改变；不能通过升级评分规则重写历史跑题结果。schema 2 的实时评分与离线原始响应重放使用同一规则。

| mode | 必需字段 | 规则 |
|---|---|---|
| literal | mode | Unicode/空白/完整 Markdown 外壳归一化后逐字匹配；不推测“或”两侧可交换 |
| label_set | mode、labels | labels 为题面允许的大写 A–Z 标签；全部选中项相同即可，不看顺序，重复、漏选、多选及 OR 表达均拒绝 |
| label_sequence | mode、labels、prefilled | 顺序必须完整一致；prefilled 是固定的零基 position/label 列表，无预填时填空数组。可接收完整排列或全部未预填空位，按固定位置展开后比较；不能改动预填项或省略其他项 |
| number | mode、unit_aliases、unit_optional；可选 unit_prefix_aliases | 用 BigInt 有理数精确比较，不设误差容忍；单位只能是审定的同单位拼写别名。前缀只接受 unit_prefix_aliases 声明的既有别名；不声明则不接受前缀 |
| number_sequence | mode | 按位置比较至少两个精确数值；不排序、不删除重复值；只用于无单位数值序列 |
| quantity_sequence | mode、items | items 为2至32项逐位置单位规则（unit_aliases、unit_optional，可选 unit_prefix_aliases）；每项数值与该位置单位同时匹配，不可缺项或调换 |

标签允许紧凑字母、空格、逗号、顿号或分号；多选另允许 AND/和/及/と，排序另允许箭头。数值/数量序列的换行、分号、箭头和逗号加空格可保留项内千位逗号；裸逗号相邻整数可能构成千位分组或存在前导零时拒绝，要求明确边界。空项、尾分隔符和不完整括号不能获得正确分数。

指数/下标不先做 NFKC 拼接为整数；`10²` 不等于 `102`。数值规则不执行数学表达式、科学记数法、比较符或单位换算。不同单位排序须逐项审查 quantity_sequence；只有答案框已印单位等题面依据时才允许省略。不能把 m/cm 或 hour/minute 当拼写别名。完整 Markdown 外壳可去除，单位大小写仍有意义。超过长度上限、零分母、非法千位分组及无法解析的金标在调用前拒绝。

新规则可表达评分政策，不自动证明某题的单位、预填空位、允许省略或完整标签集正确。正式策展必须逐题选择并独立复核；政策变更会改变授权摘要，旧签署不可沿用。

`readingAnswerScoringDigest()` 绑定评分器、阅读评分集成及所用生产 objective/screen-query 解析文件的真实字节。加载或离线重放遇到算法摘要不符会拒绝，应使用原执行版本复现；不能只改摘要后沿用旧授权。该字段不改变既有 schema 1 档案。

当前评分版本为 `reading-answer-v2`，新增逐项数量、显式前缀和换行语法。旧 schema 2 的 reading-answer-v1 档案须回到原代码版本复现，不能直接换版本/摘要后沿用授权；schema 1 与原240基线保持原行为。

holdout 在调用前要求：声明组合中至少 400 个已标注样本、四题型各至少 100、每题型×语言组合至少 50；覆盖 web/PDF/practice_ui/multi_page、retake/out_of_scope/multiple_targets，以及 missing_context/cropped/unreadable/ambiguous；每题型解释计划至少 20。新增公开语言须补足各格样本。diagnostic 允许小题集，其结果不能作为新增范围放行依据。

candidate 时间为规范 UTC ISO（含毫秒），最多 24h，URL 只允许 HTTPS 或本机 HTTP，禁止凭证、查询与重定向。摘要验证证明内容未变，不认证填写的评审身份，也不能从 `/healthz` 推断实际部署 commit/model；独立复核仍须检查冻结的部署核验材料。

## 执行入口

先执行 `node scripts/evaluation-preflight.mjs`。该命令只读题集、核验文件及既有本地预算账本；它不访问候选 HTTP、不调用模型，也不会创建或重置预算账本。报告即使输入完整，仍保留真实 HTTP 准入与独立质量评审待执行状态。

付费执行器是 `node scripts/run-reading-eval.mjs`。以下环境必须由受控环境明确提供；不要把 token 放进聊天、Git、日志或终端历史：

| 环境变量 | 用途 |
|---|---|
| `NSPI_RUN_READING_EVAL=1` | 明确启用完整题集执行 |
| `NSPI_READING_EVAL_MANIFEST` | 已授权 manifest 路径 |
| `NSPI_EVAL_EXECUTOR` | 本次执行身份 |
| `NSPI_EVAL_CANDIDATE_ATTESTATION` / `NSPI_EVAL_CANDIDATE_EVIDENCE` | 候选签署与实际核验材料路径 |
| `NSPI_EVAL_DEVICE_TOKEN` | 专用于隔离候选的官方设备 token；该工具不需要本机直接持有厂商 key |
| `NSPI_EVAL_VERCEL_SHARE_TOKEN` | 可选；受保护 Vercel 预览地址的临时访问 token，仅用于传输鉴权 |
| `NSPI_EVAL_COST_BOUND` | 绑定该候选的有效成本上界文件 |
| `NSPI_READING_EVAL_OUT` | 尚不存在的私有输出目录 |

受保护预览使用同一个 `evaluation-access.mts` 入口取得 Cookie，供账户准入、答案和解释请求使用。交换最多等待 15 秒，不跟随重定向；Cookie 只可发送至已绑定的同一 origin，过期立即停止。访问 token/Cookie 不进入候选声明、费用账本或评测归档。生产域名或未保护的诊断服务省略该变量。此入口同时用于 Objective treatment 和 legacy 基线，不能为了运行基线关闭部署保护。

执行器先 GET account、client-config、healthz：余额须能覆盖全部答案、持有为 0，设备已分到 objective_v1，阅读合约能力/范围/配置修订匹配；holdout 拒绝 mock 和降级 provider。此检查不能替代真实隔离部署核验。之后按 manifest 原顺序运行一次，每题固定新 UUID，实时保留失败，不自动重试或恢复。

每题重新检查授权有效期与实际图片摘要，使用生产 `screen_query_v1` 请求形态。JSON 与官方客户端统一为 4 MiB，包含兼容字段重复题图；首个候选 HTTP 请求前检查整份题集，并为可能的解释预留 512 个 Unicode 字符的 JSON 最坏编码长度，发送前再次复核。超限不压图、不丢页、不消耗前面题目的模型预算；每次响应最多 2 MiB、单 SSE 事件 512 KiB、合成原文 64 KiB；严格检查 UTF-8、事件顺序、完整 DONE、绑定 ID/operation 与结算。传输中断、非法流及非 SSE MIME 记 failed，继续剩余题；候选拒绝、预算失效或输入变化停止后续调用，归档完整/部分状态。

对每题型，按 manifest 顺序选前 N 个有可用答案且真值为 answerable 的父请求，立即使用原材料和实际规范化答案发一次解释，不以答案判对与否挑选。解释失败仍占抽样位置。首次实际 retake 和 no_result 父请求另各测一次解释入口，要求 409 binding_mismatch。没有出现足够 ready/review/fallback 父请求时，报告如实列出缺口，不能人为制造模型输出补齐。

所有调用共用 [预算政策](evaluation-budget.json) 中同一整轮累计预算；用户于2026-09-11将上限从100 CNY下调为 **27 CNY**，已发生的预留全部保留。完整计划预估为题数 + 4×每题型解释数 + 2 次拒绝检查；HTTP 拒绝也保守占用上界。每次发送前事务预留，断网、异常、未知 usage、重启均不返还估算差额。超过核验 token 上界时停整个 campaign。归档包含预算政策、价格上界原件、计划、逐次 dispatch ID 和费用上界，便于与真实账单核对。禁止删除账本、换 campaign 或挑选成功重跑来重置额度或覆盖失败。

成本上界可以声明 `explanation_output_token_upper`，但必须由实际候选解释端点的输出限制提供证据，不改变产品配置。声明后计划分别计算答案和解释（包括解释入口拒绝检查），将数量写入 `purpose_calls`；离线工具按逐条操作重算预留。旧上界与旧档案仍使用原单价计算方式。将solve误标为explain会在HTTP前拒绝；解释实际usage超过较小上界同样会永久暂停campaign。运行中的预算实例会读取持久化的新低上限，不能继续沿用缓存的较大额度。按时段核定价格时，证据有效期必须落在已核实的价格窗口内，每次派发重新检查有效期。

## 原始归档与离线重算

输出目录 0700、文件 0600，独占创建并同步落盘。它包含 manifest、家族/授权文件、候选签署和核验原件、成本政策、冻结 `run.json`、`responses/*.dispatch.json` / `*.json`、`results.json`、`quality-draft.json`、`completion.json`。原题图片仍在受控题集目录，标准答案和模型原文仅在私有评测归档中；不放入 App、遥测、公共发布资产或管理员质量摘要。

`node scripts/prepare-reading-quality.mjs --run "$NSPI_READING_EVAL_OUT"` 只读归档并打印答案复核 subject、解释复核 subject、抽样及成本摘要。逐文件限量重读，单次仅保留一份原始响应，重用生产解析/答案匹配逻辑重新评分，并检查：

- 所有源文件与计划、结果索引、draft 和完成记录的摘要及时间关系。
- 价格上界的历史有效期与每次预留金额。
- 答案按冻结顺序完整/部分执行，无重复 ID、隐藏响应、孤立 dispatch 或跳过后补抽解释。
- 原始响应到评分的确定性一致，解释与父请求的顺序、状态和材料语义由冻结计划与实际请求实现共同绑定。

无法核对的孤立 dispatch 可能对应已计费调用；工具拒绝转换，保留现场交由费用/执行核对，不能删除文件后把它当完整运行。部分运行可以如实复核并录入，缺失项保留在计划分母，不能声称完整或替换正式 holdout 结果。没有任何答案记录时不生成质量提交。

## 独立签署与输出

答案复核文件字段为 schema_version=1、reviewer、reviewed_at、subject_sha256、labels_reviewed、results_reviewed、complete_run、no_selection_reruns、authorized_materials、family_split_verified。subject 必须是离线重算得到的答案 subject，complete_run 与真实完整/部分状态一致。工具把该文件真实字节摘要写入 attestation_sha256，并通过服务端同一个 `parseQualitySubmission` 再验证。

解释复核文件字段为 schema_version=1、reviewer、reviewed_at、subject_sha256、results_reviewed=true、cases。每条 case 必须覆盖一个实际解释调用，并包含 capture_id、response_sha256、correct、consistent、no_unrelated_inference、material_leak、silent_answer_rewrite、severe_contradiction；后六项为独立审阅原图、原答案与解释后的布尔判断。subject 绑定整个解释及拒绝检查集合，不能遗漏失败样本。工具不代填判断，不生成评审签名。

提供 `--review`、可选 `--explanation-review` 及新的 `--out` 目录后，同一 prepare 命令离线写出 `submission.json`、`report.json`、`provenance.json`，不会上传。答案摘要可用既有 [质量上传工具](quality-evidence.md) 单独录入；解释报告及签署原件保存在受控评测档案，当前质量 API 不接收原文或解释判断文件。

解释读数单列实际样本、各题型、ready/review/fallback 覆盖、Wilson 95% 区间及严重矛盾/泄漏/静默改写。至少 80 个、覆盖四题型与三种路径、准确性至少 95%、两类拒绝检查通过、严重矛盾/泄漏/静默改写为 0，并且完整独立复核，才报告该解释读数过线；未知判断保持 null。所有已发现严重矛盾必须修复或停用对应解释功能。

费用报告区分答案、解释、入口拒绝检查，列出保守预留 CNY 上界及已知 token，缺失不填零。它不是供应商实际账单，也不是观察到的解释使用率加权商业成本。解释/恢复调用不得混入原 240 题同模型单调用 Token 比较。

任何局部 thresholds_met 都不是发布批准。准确候选的 240 题同模型对比、原生机器行/剪贴板/辅助功能零泄漏、真实平台验收、灰度观察及经济窗口仍须分别完成，输出始终保留 `release_ready=false`。
