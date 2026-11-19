# 模型初筛数据准备

核查日期：2026-11-17（Asia/Shanghai）。本文件只记录本地材料检查，不批准付费调用、外部传输、发布或新的模型支持范围。清单见 [40 槽位配置](experiments/model-comparison-20261117-cases.json)。本轮未新造题目、金标、授权或模型结果，未复制原图、题干或用户截图到新增文件。

## 旧截止日期的准确含义

本机旧归档中的 `corpus-review.json` 记载 `reviewed_at=2026-09-13T05:57:17.612Z`、`expires_at=2026-09-14T00:55:00.000Z`。它绑定完整 manifest 的摘要，并同时声明 `authorized_materials`、`external_model_processing`、`labels_reviewed` 为 true，`family_split_verified` 为 false。

[验证代码](../scripts/lib/reading-evaluation.mts) 的 `validateCorpusReview` 核对摘要、独立复核者、材料/标签/家族声明和时间；`readingImages` 每次取图前再次检查同一有效期。[既有操作说明](reading-evaluation.md) 明确，复核包括外部模型处理，普通反馈导出许可不等于这一许可。

所以该日期是**这份题集联合复核凭据的执行有效期**，其中包括外部模型处理；它不是原始数据集版权许可或本地保有权的统一截止日期，也不是价格核验有效期。旧文件没有列供应商名单、端点、保留政策或本次 campaign。不能从日期推断所有原始材料已不可用，也不能把旧 true 字段推断为允许向这次三个模型外发。本轮本地清单与哈希核对属于当前授权；未来外发需对确切图片字节、用途、接收供应商和评分政策重新确认，不能仅修改旧文件日期。

来源许可应逐项判断。归档保存了 ARC 的 CC-BY-SA-4.0 声明、GSM8K 的 MIT LICENSE、ScholarBench 的 CC-BY-ND-4.0 声明及部分上游组件权利问题、STA 文档逐份许可和自编材料来源。这些历史证据不会仅因联合复核日期经过而自动失效，但本轮没有重新作完整权利链或供应商条款审查，也没有取得新的外发授权。尤其不能把 ScholarBench 数据集声明替代原文内第三方组件许可，或推定所有 STA 年份文件具有同一许可。

## 已有资产与可靠性

| 资产 | 题型、语言与质量 | 金标/已见题 | 当前使用边界 |
| --- | --- | --- | --- |
| [Objective 240 题](../Tests/Fixtures/objective-v1/manifest.json) | 单选、多选、排序、短填各60；中日英各80；生成器包含清晰卡片、标签歧义、极端裁切及缩小模糊 | 算法生成 accepted_answers；旧回归已见题，同一模板高度相关；不是独立人工金标或真实 SPI | 本地回归可用；向新供应商外发待本轮确认。不得把生成器运行当作新真实题策展 |
| 本地408题全量回归集 | 全英文；单选102、多选101、排序100、短填102、other3；401 answerable，其余为边界或未标注；457张唯一图片；质量标签覆盖有限 | ARC/GSM8K/ScholarBench/STA/Wikibooks、自编和浏览器派生材料混合；已参与开发；旧标签不是本轮独立复核 | 本地可核对；旧联合复核已过有效期。原始来源权利逐项保留，不作全部不可用的判断 |
| 其中158道自编材料 | 英文虚构阅读与排序；部分人工分页；未反映真实学生截图分布 | 原始答案及独立 AI、非盲审记录；明确无人工签署；结构重复、干扰项相关 | 可做已见题回归，不得称真实题或独立留出集 |
| 6张日常截图及4张边界截图 | 日常实际截图诊断包；质量/权利不能由文件存在推断 | 5题为人工参考、1题无可靠金标；不能用协议通过代替准确率 | 本轮未读取图片内容、未选入40槽位，不重新传播用户材料 |
| [人格35条夹具](../Tests/Fixtures/Personality/manifest.json) | 全合成人格行为材料 | 合法选项、上下文和连续性检查 | 不混入本轮客观题正确率；本轮未扩大人格实现范围 |

原始来源文件与图片只保留引用。Objective 的来源和变换依据为 [生成器](../scripts/generate-objective-fixtures.py)。本轮没有运行该生成器，也没有安装它的依赖。

## 40槽位清单的实际完成度

固定目标是文字10、计算10、图表10、边界10。清单有40个稳定 slot ID；其中**28个可作本地准备、12个明确缺题**，不是40道已获外发许可的真实题。

| 槽位 | 已选来源 | 覆盖与缺口 |
| --- | --- | --- |
| `text-01`…`text-10` | 408题 manifest 顺序中前10道 `authored-reading-*`；逐项核对原始 source 的 paragraphs 字段和记录ID | 10道英文虚构段落，多选，包含1道双图；不能替代日文文字理解。图片质量标 unknown，未以文件扩展名推定清晰 |
| `calculation-01`…`calculation-10` | 日文 Objective：单选3、多选3、排序2、短填2 | 10道合成算术、质数或数值排序；金标保持原 accepted_answers，使用既有 literal 评分，不把它们称为真实 SPI 计算题 |
| `chart-01`…`chart-10` | 缺题；source、images、expected 均留空 | 未选出同时有图表实物、可靠金标和可复核来源的日文图表题；不能用“文字引用了图”替代实际图表 |
| `boundary-01`…`boundary-06` | 日文 Objective 的三种题型，各选 `18`、`19` | 3道生成器极端模糊、3道极端裁切；原金标只要求 retake，reason 保持 null；零基 seed 变换只描述图片质量，不升级为精确协议原因金标。极端不可读不代表可读但低质的小字截图 |
| `boundary-07`…`boundary-08` | 408题中的 missing-context、unreadable 派生浏览器夹具 | 历史 retake 标签；本轮新增视觉隐私核查，但不升级为独立金标。原始材料与变换权利需保留。无答案，不混入答题准确率 |
| `boundary-09`…`boundary-10` | 缺少当前契约金标；保留旧 multiple-targets、outside-scope 来源作审查线索 | 首轮冻结 tutor brief＋objective_v1；旧 screen-query 的 NSPI_NO_RESULT 金标不适用。旧预期放 source_expected，expected 为 null，图片只留 source_images，不调度或评分 |

这28个可用槽位共20道可作答回归题、8道 retake；语言为日文16、英文12。活跃引用29张唯一图片，原始字节 SHA-256 全部核对一致，顺序原样保留；其中16张来自已跟踪 Objective，13张来自本地忽略归档。另两道不同契约的来源图片也核过摘要，但不进入执行列表。没有对现有图片重编码、裁切或生成新质量版本。

共同缺口：真实日文文字与计算、日文图表、自然低清但仍可作答的截图、可靠歧义 review 金标、真实家族隔离。所选材料均为已见题，不能以槽位数代替独立样本量。补图表后也不能宣称日文任务覆盖已完整；用户已选择仅做现有28项已见题回归预筛；12个缺口继续保留。不得静默把英文/合成题重命名成日文/真实题。

## 本机归档的获取契约

以下是被忽略的本机历史证据，不随 Git 克隆交付。清单为它们记录精确路径与摘要；文件缺失、字节变化或旧 scoring digest 不匹配必须报为缺口，不下载、不重新生成、不接受同名替代。另一台电脑需要由材料所有者提供授权副本，并重新完成独立复核。

| 归档引用（相对 Git 根） | 用途 |
| --- | --- |
| `.release-evidence/2026-09-13/full-regression/corpus/manifest.json` | 408题的实际字节/顺序/预期/评分政策；此次12条活跃来源及2条不同契约审查线索 |
| 同目录 `corpus-review.json`、`family-provenance.json` | 日期约束和已用于开发的明确声明；不作为本次有效许可 |
| `.release-evidence/2026-09-10/authored-reading/curation-v3.json` | 10道文字题的来源、段落、独立AI非盲审及无人工签署边界 |
| `.release-evidence/2026-09-10/material-audit/replacements/source-cases.json` 和 `authored-reading/batch-01/source.json` | 自编文字材料原始结构；清单只记录来源摘要，不复制正文 |
| `.release-evidence/2026-09-09/public-corpus/` 下的 source-provenance、GSM8K LICENSE、STA document-licences | 历史来源/许可证据；未经本轮重新全面审核 |
| `.release-evidence/2026-09-10/authored-reading/scholar-license-reassessment/report.md` | 旧审查区分数据集许可、上游组件问题和具体操作；不是本轮法律结论或自动审批 |

本轮离线核对不更新上述历史归档、签名、来源许可或有效期。清单中的每项 `external_processing` 都保持 `pending_new_campaign_review`。


## 本轮28项外发授权清单

下表只提出这28项的外发范围。每项拟发送给OpenAI的 `gpt-6-astra` Standard与 `gpt-6.1-terra`，以及DeepSeek的 `deepseek-flash`；目前全部待批准。只发冻结业务提示词与原始图片，不发金标、来源审查、路径、旧模型回复或日常截图。逐张尺寸、字节数、发送顺序和SHA-256见[机器可核验清单](experiments/model-comparison-20261117-materials.json)。

| 槽位 | 精确来源ID | 金标状态 | 图片数 | 拟接收方 |
| --- | --- | --- | ---: | --- |
| `text-01` | `authored-reading-locker-01` | 旧自编答案＋非盲AI复核，无人工签署 | 1 | OpenAI两模型／DeepSeek Flash |
| `text-02` | `authored-reading-exhibition-01` | 旧自编答案＋非盲AI复核，无人工签署 | 1 | OpenAI两模型／DeepSeek Flash |
| `text-03` | `authored-reading-delivery-01` | 旧自编答案＋非盲AI复核，无人工签署 | 1 | OpenAI两模型／DeepSeek Flash |
| `text-04` | `authored-reading-garden-01` | 旧自编答案＋非盲AI复核，无人工签署 | 1 | OpenAI两模型／DeepSeek Flash |
| `text-05` | `authored-reading-museum-access-06` | 旧自编答案＋非盲AI复核，无人工签署 | 1 | OpenAI两模型／DeepSeek Flash |
| `text-06` | `authored-reading-project-freeze-07` | 旧自编答案＋非盲AI复核，无人工签署 | 2 | OpenAI两模型／DeepSeek Flash |
| `text-07` | `authored-reading-news-correction-08` | 旧自编答案＋非盲AI复核，无人工签署 | 1 | OpenAI两模型／DeepSeek Flash |
| `text-08` | `authored-reading-tool-return-09` | 旧自编答案＋非盲AI复核，无人工签署 | 1 | OpenAI两模型／DeepSeek Flash |
| `text-09` | `authored-reading-bookclub-thread-10` | 旧自编答案＋非盲AI复核，无人工签署 | 1 | OpenAI两模型／DeepSeek Flash |
| `text-10` | `authored-reading-cafe-trial-11` | 旧自编答案＋非盲AI复核，无人工签署 | 1 | OpenAI两模型／DeepSeek Flash |
| `calculation-01` | `ja-single_choice-01` | 旧生成器算法答案 | 1 | OpenAI两模型／DeepSeek Flash |
| `calculation-02` | `ja-single_choice-02` | 旧生成器算法答案 | 1 | OpenAI两模型／DeepSeek Flash |
| `calculation-03` | `ja-single_choice-03` | 旧生成器算法答案 | 1 | OpenAI两模型／DeepSeek Flash |
| `calculation-04` | `ja-multiple_choice-01` | 旧生成器算法答案 | 1 | OpenAI两模型／DeepSeek Flash |
| `calculation-05` | `ja-multiple_choice-02` | 旧生成器算法答案 | 1 | OpenAI两模型／DeepSeek Flash |
| `calculation-06` | `ja-multiple_choice-03` | 旧生成器算法答案 | 1 | OpenAI两模型／DeepSeek Flash |
| `calculation-07` | `ja-ordering-01` | 旧生成器算法答案 | 1 | OpenAI两模型／DeepSeek Flash |
| `calculation-08` | `ja-ordering-02` | 旧生成器算法答案 | 1 | OpenAI两模型／DeepSeek Flash |
| `calculation-09` | `ja-short_fill-01` | 旧生成器算法答案 | 1 | OpenAI两模型／DeepSeek Flash |
| `calculation-10` | `ja-short_fill-02` | 旧生成器算法答案 | 1 | OpenAI两模型／DeepSeek Flash |
| `boundary-01` | `ja-single_choice-18` | 旧retake标签，非独立复核 | 1 | OpenAI两模型／DeepSeek Flash |
| `boundary-02` | `ja-single_choice-19` | 旧retake标签，非独立复核 | 1 | OpenAI两模型／DeepSeek Flash |
| `boundary-03` | `ja-multiple_choice-18` | 旧retake标签，非独立复核 | 1 | OpenAI两模型／DeepSeek Flash |
| `boundary-04` | `ja-multiple_choice-19` | 旧retake标签，非独立复核 | 1 | OpenAI两模型／DeepSeek Flash |
| `boundary-05` | `ja-ordering-18` | 旧retake标签，非独立复核 | 1 | OpenAI两模型／DeepSeek Flash |
| `boundary-06` | `ja-ordering-19` | 旧retake标签，非独立复核 | 1 | OpenAI两模型／DeepSeek Flash |
| `boundary-07` | `browser-risk-missing-context` | 旧retake标签，非独立复核 | 1 | OpenAI两模型／DeepSeek Flash |
| `boundary-08` | `browser-risk-unreadable` | 旧retake标签，非独立复核 | 1 | OpenAI两模型／DeepSeek Flash |

文字题来源为本机408题回归manifest中的自编英文虚构阅读；计算题及前6道边界题来自已跟踪Objective生成夹具。boundary-07是自编缺上下文浏览器夹具；boundary-08是公开ARC-Easy题 `Mercury_7084438` 的受控模糊派生图，父题及变换已在本机capture-index和ARC源记录中对应。它讨论天文常识，原标签只要求retake；历史归档保存CC-BY-SA-4.0声明，本轮不能将该声明或用户同意等同于新的完整法律审查。其来源与摘要已补入机器清单，需在这次28项范围内明确纳入授权。

隐私核查：已在本地逐张查看29张图片，并检查EXIF/XMP/IPTC；未观察到真实姓名、账户、邮箱、证件等直接个人标识，未发现上述图片元数据。英文阅读出现的是自编虚构人物名；模糊图另核对可读父题。该结论是本地视觉与元数据检查，有模糊/裁切识别局限，不是穷尽OCR或法律保证。未把6张日常用户截图及其诊断包纳入，未向供应商发送任何材料。授权应限于下述28个槽位及其29张冻结图片，不覆盖整个历史题库。
