# 旧路径协议前置候选

仅本地准备，未部署、未调用模型。针对上一批开放问答other/ready/none的invalidStateCombination，将原system末尾从FINAL=answer开始的协议约束原样复制到最前；随后仍为v1候选完整原文。未删除、弱化或改写任何原指令，task不变；模型deepseek-flash、low、32768及原题图不变。

这可能使模型更早遵守已有状态约束，但也可能增加输入及推理耗时；不能预先声称质量或性能改善。不会因Q11上次快1.419秒就部署，也不会用拒答速度替代正常题答案速度。

拟最多3次：原开放问答B一次先执行，若通过再Q11 A/B各一次。旧路径完整性和冲突门槛不变，开放问答要求other/review/unsupported，Q11要求ready/none且正确可见B选项；任意错误、截断或质量失败立即停止，不重试。原裁切题失败保留，此轮不重跑或把它改为通过；三次通过也不足以证明六题端到端达标或全部质量等价。

执行器增加legacyProtocolPlan及独立CLI模式，基线和候选摘要、原图摘要、顺序、具体质量门槛绑定许可；旧许可不能匹配。24项离线测试通过，免费预检通过（proposed_calls=3、approved_calls=0、model_calls=0），git diff --check通过。无依赖安装、无产品代码修改。

按本会话已核对官方高峰未命中输入2元/百万、输出8元/百万，每次6000输入+32768输出估算三次¥0.822432，拟预留¥1。此前5次额度已用完，需要新费用批准；不充值、不扣NotchSPI题数、不部署。日志在/tmp/notchspi-legacy-protocol-tests-20261030.log，预检在/tmp/notchspi-legacy-protocol-preflight-20261030.json。

## 获批后的真实结果

用户批准最多3次、¥1后执行。第1次开放问答再次返回other/ready/none，解析器报告invalidStateCombination，转legacy_fallback/review。执行器按预定规则停止，Q11 A/B均未发出，不重试、不自动使用剩余2次额度。候选未通过质量筛查，不采用或部署。

首内容16.597秒、完整答案行17.088秒、完整响应17.954秒；首推理0.756秒，首推理至首内容约15.840秒。输入968、输出3468 token，按高峰未命中2/8元每百万估算¥0.029680，非账单。没有NotchSPI扣题或部署。本次重复协议约束未解决已知错误；只有一个边界样本，不能据此推断日常六题性能，更不能宣称达标。

随后免费用原冻结计划、当前OpenAIProvider序列化器及本地fetch替身验证：完整候选确实在messages[0]的system角色，任务在user消息中，模型/low/32768按计划构造。无网络和模型请求。这是当前序列化路径核验，不是先前请求的网络抓包，也不证明服务端模型遵从了system内容。证据见同名samples.json；原始输出仅在/tmp/notchspi-legacy-protocol-v2-20261030/run。
