# 同模型服务选项免费核查

本轮只读官方文档与本地源码，没有模型请求、部署或配置变更。此前协议前置候选未解决other/ready错误，不继续用重复提示词当作已证明的优化。

## 已核查选项

- [Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode/)：minimal映射low，当前low已是最低启用思考档；temperature在思考模式不生效。改minimal或temperature没有文档支持的提速依据。关闭思考是不同推理行为，不能当作等价配置偷偷启用。
- [Context Caching](https://api-docs.deepseek.com/guides/kv_cache/)：缓存自动开启，依赖匹配前缀，best-effort而非必命中；缓存输入不等于缓存答案，输出仍需推理。当前system/task在图片之前，不存在需要补开的缓存开关；不为凑命中追加付费预热或复用旧答案。
- [Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)未发现service_tier或priority字段；[Responses guide](https://api-docs.deepseek.com/guides/responses_api/)明确service_tier不支持。只能说明公开文档未提供适用优先级参数，不能断言供应商不存在未公开企业服务。
- [Rate Limit & Isolation](https://api-docs.deepseek.com/quick_start/rate_limit/)的扩容针对并发，user_id用于隔离，并非单次推理时延保证；当前串行诊断不支持将扩容视作瓶颈修复。其保活机制也不提供10秒完成保证。现有SSE解析忽略注释，不把保活当答案。

真实Q9/Q11上游请求至首答案13.698/8.681秒，首推理至首答案12.366/7.373秒。后者仍包含上游生成、排队及传输间隙，不能称纯GPU时间。即使减少本地截图与连接开销，也没有证据可保证这两样本小于6秒。绝对最长10秒不是当前共享远程API能够由客户端保证的性质；超时报错不能算可用答案。

## 已被用户排除的隔离实验备选（不执行）

用户明确选择“继续保持low，不研究关闭思考”。以下仅保留历史提案，不是当前计划或授权；不实现、不运行关闭思考的对照，产品与实验继续固定low。

同deepseek-flash，比较当前thinking enabled/low与thinking disabled（省略reasoning_effort），所有原legacy system/task、32768输出上限、原图与完整长文保留，不改生产。关闭思考可能损伤复杂题质量，不能预先承诺等价；只有作为离线候选筛查才有意义。

建议最多12次：六张原始完整日常题图各基线/实验一次，按题AB/BA交替。答案逐项人工核对，协议、完整性、真实冲突、结束原因校验不变；任何错误、截断或质量失败立即停止、不重试，所有慢样本保留。即使六题通过也不是全题型质量保证，更不是快捷键端到端验收；必要边界与复杂题尚需后续独立验证，不能直接发布。

按已核对高峰输入2元/百万、输出8元/百万，每次6000输入+32768输出估算12次¥3.289728，拟预留¥4。使用现有本地密钥，不充值、不扣NotchSPI题数、不部署。本方案同时需要推理模式实验和新增费用授权；执行器尚不支持该模式，批准后须先完成本地预算绑定与测试再请求模型。若不允许改变实验推理模式，应保持当前配置，不虚构其它无损提速开关。
