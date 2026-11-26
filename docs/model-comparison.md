# 28项已见题回归预筛执行单

2026-11-17：本地准备完成，**尚未批准付费或外发**。仅比较 `gpt-6-astra` Standard、`gpt-6.1-terra`、`deepseek-flash`。当前28项＝20道可作答＋8道retake；40槽位清单的12个缺口原样保留。只检查这批已见材料上的兼容性和明显退化，不代表真实日文SPI整体表现，不用于生产替换验收。

## 入口与变更边界

从 Git 根运行，无需安装依赖：

```sh
node scripts/run-model-comparison.mjs
node scripts/run-model-comparison.mjs --mock --out output/model-comparison-mock-<unique-run>
node --test scripts/fixtures/model-comparison.test.mjs scripts/fixtures/model-comparison-live.test.mjs
```

默认dry-run只读，不读取凭据、不建账本。mock使用注入回复，真实网络调用为零。以后只有明确批准本执行单、填写绑定本次配置/材料摘要的[授权记录](experiments/model-comparison-20261117-authorization.json)后，才能使用 `--live --authorization docs/experiments/model-comparison-20261117-authorization.json`。目前记录为pending，不能执行。专用凭据仅在授权有效且预算预留后读取 `NSPI_EVAL_OPENAI_KEY` / `NSPI_EVAL_DEEPSEEK_KEY`；不读生产.env、Keychain或SDK凭据，不把凭据写日志。

实现为[入口](../scripts/run-model-comparison.mjs)、[比较器](../scripts/lib/model-comparison.mts)、[滚动账本](../scripts/lib/model-comparison-budget.mts)、[受控HTTP/SSE](../scripts/lib/model-comparison-transport.mts)、[授权与一次性执行](../scripts/lib/model-comparison-live.mjs)、[客户端计时导入](../scripts/import-model-comparison-latency.mjs)。生产调用链和原同模型比较器未改。原预算工具上一轮提取的整数计算继续复用；本轮不改旧CNY账本。

## 冻结条件

[配置](experiments/model-comparison-20261117.json)保存HEAD和实际依赖字节SHA，包含原有未提交实现；这是本地源码身份，不等同于干净提交或当前部署。历史11月8日Astra/default回执、版本化部署配置、上轮只读健康观察分别记录，不推断最新实际调用。首轮保持本地 `brief + objective_v1 + tutor_result_v1`，无screen-query或人格任务。

三模型使用相同提示词、图片原字节/顺序、金标及评分；多图参考在前、题目最后。不传金标或本地路径，不新压缩图片。都请求low、总输出上限8192。OpenAI用developer/default/store=false/high detail；DeepSeek用system/max_tokens/thinking enabled，保留原省略detail的映射（官方当前auto等同original）。各模型low不意味着相同推理计算量。专属优化不混入本轮。

保留生产首进展20秒、整个逻辑生成90秒、租约120秒和最多一次重试；推理进展与首个答案字分开。429/502/503/504、网络断开、缺DONE和启动超时按现有瞬时错误语义处理；Retry-After大于3秒不重试，计费额度错误、格式错误、普通拒答不重试。90秒不会因重试重置。当前结构化分支缓冲答案，因此瞬时失败可丢弃不完整输出后再试；不追加恢复生成或跨模型回退。生产客户端110秒HTTP超时、结算/状态恢复和UI不在直接供应商执行器中，不能宣称整条生产链等效。

## 预算依据与15美元判断

4,000最初只是没有计量证据的粗略输入假设。上一轮用本地 `estimateAstraWire` 对冻结字节得到8,950–11,824，遂将计划输入取整为12,000；16,000是在最大风险估计上再留4,176余量，**不是已验证总输入上界**。本地估算器把提示词UTF-8字节数当保守代理，图片按patch估计，再乘1.25并加4,096框架余量。这些额外项是经验保护，不能当实际token消耗或厂商保证。

本轮实查：system 2,432字节，单图task 356、多图task 370字节；29张图片只有1280×720、990×1400、993×1404、1200×760四种尺寸。逐图尺寸、摘要和计算记录见[材料清单](experiments/model-comparison-20261117-materials.json)。不是按base64字符计费。

官方资料核对日期2026-11-17：Astra high为32像素patch、最多2500patch、1.2倍，当前每题图片部分估值1,095–3,380，另保留每图1token舍入差；这仅约束图片部分。DeepSeek文档给出每图最多1,024，多图相加；单图/双图分别最多1,024/2,048。Terra模型页确认视觉，但当前图片计量表未明确列出它，不能套用Astra公式。文本token化、消息框架和Terra图片计量均未证明总上界。[OpenAI图片计量](https://developers.openai.com/api/docs/guides/images-vision)、[DeepSeek视觉](https://api-docs.deepseek.com/guides/vision/)。

所有价格为官方USD/百万token，无现有转售渠道报价；Standard、不使用工具，不假设缓存优惠。输入/输出分别为Astra 10/50、Terra 1/5、DeepSeek峰值0.3/1.2；推理已含总输出，不再加一次。OpenAI目前仅列同名别名；DeepSeek公开映射为DeepSeek-V4.1-Flash-1017。账户权限、运行时版本/档位和当日价格仍须执行前核对。[Astra](https://developers.openai.com/api/docs/models/gpt-6-astra)、[Terra](https://developers.openai.com/api/docs/models/gpt-6.1-terra)、[DeepSeek价格](https://api-docs.deepseek.com/quick_start/pricing/)。

| 模型 | 假设每次12k输入＋1k总输出 | 28次预计 | 单次预留（16k＋8192） | 每次都重试一次：新增预计 / 新增预留累计 |
| --- | ---: | ---: | ---: | ---: |
| Astra Standard | $0.1700 | $4.7600 | $1.014400 | $4.7600 / $28.403200 |
| Terra | $0.0170 | $0.4760 | $0.101440 | $0.4760 / $2.840320 |
| DeepSeek Flash峰值 | $0.0048 | $0.1344 | $0.014631 | $0.1344 / $0.409668 |

84次初始预计 **$5.3704**；20%计划余量为 **$6.44448**，不是最坏上界。若84次均额外重试一次，168次按同样平均消耗假设为 **$10.7408**。重试上一次已消耗或未知费用仍计入。

单次预留使用输入/输出费率Astra25/75、Terra2.5/7.5、DeepSeek0.3/1.2。这是沿用的保守会计费率，包含高于当前短上下文Standard费率的余量，不是声称实际账单按此收费。初始预留累计31.653188、含全部允许重试累计63.306376，只说明累计预留量，**不是必须批准的余额**。

滚动规则：串行发送前检查 `保守核销额＋未知/在途预留＋本次预留≤$15`。收到完整、一致、模型/档位合格的终态usage后，将本次预留核销为实际usage×保守费率，释放差额；较低普通费率的费用估值另报，账单实付仍null。失败、缺usage、缺DONE或中断不释放。按12k/1k假设，84次保守核销合计11.6844，离线mock证明可以在15内完成，即使累计预留超过15。若平均输出接近3k、较多重试或未知费用积累，可能提前停止；不保证完成全部84次。

**结论：15美元适合可提前停止的本轮预算设计。它是程序占用/核销的硬封顶，不是未经验证的供应商账单绝对保证。** 若需要真实账单绝不超过15，仍需可证明的逐请求输入/收费上界或供应商侧硬额度；不能用软预算告警替代。授权记录要求明确接受经验上界的这个限制，否则拒绝启动。本轮15美元不是付费批准。

## 速度与工程淘汰

执行器报告上游首进展、首答案，以及包含重试等待的 `evaluatorValidCompleteMs`；它从评测器准备请求后计到收齐并验证完整答案，不含用户触发、截图、客户端上传/结算/UI。retake单列，失败保留耗时和失败原因，不塞入成功p95；有效样本少于20不报p95。

现有原生 `CaptureLatency` 已有triggered至renderCompleted。新增导入器复用[解析器](../scripts/lib/capture-latency.mts)，要求日志摘要、构建摘要、图片摘要、case/model、capture ID及完整答案摘要一一对应。缺最终绘制保留null；合成回放永远标synthetic_replay。取得模型参与的客户端完整答案时间，仍需在隔离客户端用同一输入实际触发、记录这条trace及映射；本轮未进行这项真实模型/设备测量。

导入命令只读本项目output：`node scripts/import-model-comparison-latency.mjs --results output/.../results.json --trace output/.../client.log --mapping output/.../mapping.json`。映射包含config_sha256、trace_sha256、client_build_sha256、provenance及entries；各entry为case_id/model/capture_id/image_sha256/output_sha256。离线测试验证正确关联、错摘要拒绝和缺绘制事件。

严格/平衡生产门槛暂不选择。以下只作本轮工程初筛建议，金标争议先复核再判定，不选择性重跑刷分：

- 20道可作答题：候选净多错≥3道，或Astra答对而候选答错≥4道，列为明显退化候选。
- 8道retake：错误输出答案/未正确retake≥2道，列为边界行为不合格候选。
- 28项中超时/拒答/格式/传输失败≥3项，列为不适配；题目本来要求retake不算技术失败。
- 至少15个共同有效答题对时，候选评测器完整答案中位数同时超过Astra两倍及5秒，触发速度复核；这不是用户端延迟验收。
- 一题等于可作答组5个百分点、retake组12.5个百分点，样本小且模板相关；无置信区间非劣效结论。结果只决定是否值得继续研究。

## 一次确认的执行范围与停止条件

待确认：仅[逐项材料](model-comparison-data.md#本轮28项外发授权清单)中的28项/29张图片，发送冻结提示词和图片给OpenAI两个指定模型、DeepSeek Flash；最多84初始＋84有条件重试；预计5.3704美元、计划余量6.44448美元，滚动封顶15美元，接受上述经验上界限制和提前停止。用途仅已见题回归预筛。尤其明确纳入boundary-08这一ARC公开题的模糊派生图；不授权整个历史题库或日常用户截图。

立即停止：授权/材料/身份漂移、返回模型或档位不符、账号/计费拒绝、usage越界或冲突、预算不足；3次连续技术失败或累计3次未知usage也停。评分淘汰建议在结果复核中应用，不默默改变同批输入。保留所有attempt和未执行项，不把未执行当成功或零费用。

真实执行目录固定 `output/model-comparison-paid-20261117`，一次性许可标记另存 `output/model-comparison-20261117.permit-consumed.json`。无reset/resume/run-ID/额度/账本覆盖参数；第二次启动即拒绝，即使删除或清空账本。中断后不自动补跑，必须先核销旧记录；不能换run ID规避本轮封顶。标记是本地程序防误操作，不声称能抵抗人为同时删除全部审计文件或篡改源码。

## 后续 SPI 与推理强度预筛工具

本节只登记脚本归属，依据脚本自身的头部说明与常量，不是执行单，也不构成新的调用授权。

- `scripts/prepare-spi-screening.py`：离线材料准备，使用本机已有的 Pillow，禁用网络与子进程；从本机 `output/spi-ja-review-20261117` 读取复核结果，向 `output/spi-screening-20261117` 渲染输入，默认只报告，加 `--write` 才写入，已存在的冻结材料不覆盖。
- `scripts/run-spi-screening.mjs`：固定16题活动 `spi-screening-20261117`，默认 dry-run 不解析凭据或传输；`scripts/continue-spi-screening.mjs` 是同一活动经授权后的补完，不新建账本、上限或 run ID。
- `scripts/run-cab-effort-screening.mjs`：固定四图、四配置实验，dry-run 无凭据与传输；`scripts/report-cab-effort-screening.mjs` 只做离线汇总。

输入与结果都在本机 `output/` 下，未纳入 Git，仅凭克隆无法重现。离线回归在 `scripts/fixtures/` 的 spi-screening、spi-screening-supplement、cab-effort-screening 三个测试中。
