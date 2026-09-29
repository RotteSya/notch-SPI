# DeepSeek 思考模式候选准备

原 `deepseek-flash` 非思考候选在新增阅读范围出现真实排序错误和解释矛盾。先比较同模型低强度思考是否改善这些问题，再决定是否投入完整评测；本记录不是质量放行。

新增两项服务器配置：`OFFICIAL_DEEPSEEK_REASONING_EFFORT` 默认 `none`，`OBJECTIVE_RESULT_V1_DEEPSEEK_REASONING_EFFORT` 空值继承前者；各自接受 `none/low/high/max`。明确设置 Objective 参数只影响 treatment 通道。拼写错误使对应 DeepSeek 通道拒绝服务，不静默退回默认模型行为。

`none` 保持原请求的 disabled 和 temperature=0；其余值明确开启 thinking 并发送 reasoning_effort，省略思考模式不支持的 temperature。请求仍取配置和操作输出上界中的较小值。适配器仅转发 content，不展示 reasoning_content；费用只记录供应商 completion_tokens 总量一次，不再叠加 reasoning_tokens 明细。

配置语义依据 2026-09-13 查阅的 [DeepSeek 思考模式文档](https://api-docs.deepseek.com/guides/thinking_mode/)；总生成量和 usage 字段依据 [Chat Completion API](https://api-docs.deepseek.com/api/create-chat-completion/)。这只证明接口用法；4096 答案、768 解释的总输出额度能否留足正文，以及实际延迟，必须由新候选测试。

本地完整 Node 553/553、相关定向测试 21/21、类型检查通过。独立 AI 代码复核未发现阻断，报告在 `native/.release-evidence/2026-09-13/deepseek-thinking/`。模型别名相同不能复用旧质量结果：下一次候选证据必须包含两个最终生效的 effort、精确源码和新配置版本。

2026-09-13 00:13 上海时间的只读供应商检查为 HTTP 200，CNY 余额仍 26.13，deepseek-flash 可用，没有新增模型请求。累计测试预算仍为 27 元；经审计结算后的保守消耗 1.411587 元、剩余 25.588413 元。新候选尚未部署，未开启生产思考模式，尚无付费对照结果。

小范围对照应固定同一组诊断题、none/low 两个配置、完整输出上界、原图片与提示词，并同时记录正确性、终态、耗时、完整 token 与解释矛盾。已看过答案的题只作诊断，不写成新独立留出集；有改善后才按新候选冻结完整评测。当天价格、请求上界和隔离环境通过费用准入后才派发，禁止重跑旧的一次性启动脚本。
