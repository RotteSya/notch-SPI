# 2026-10-14 本机查题失败诊断

用户报告完整答案窗口本机更新后查题提示「答案生成服务暂时出了点问题」。本轮未修改生产、凭证、思考档位或预算。

## 可复现证据

- 线上仍为 `dpl_2jgC7Pc3ednm2FR7BgYxei9y7CGF`。运行日志显示原请求到达 `/v1/captures`；HTTP 200 只是 SSE 连接，不能视作答案成功。
- 当前 Release 的 objective prompt + 固定中文多选 fixture：4.148 秒返回正确 A,C、usable，扣 1 题。余额 826→825、held=0。
- 当前 Release 的同一 prompt + 用户最后失败的原题图（椭圆综合解答题）：19.112 秒，正文为空，input_tokens=1314、output_tokens=4096；返回 upstream_error、terminal_state=failed、settlement_status=released、questions_charged=0，余额保持825、held=0。
- 复现独立于展开窗口，说明该原图在服务调用层即可触发失败。4096恰等于现有默认输出上限，且无可见正文，支持推理耗尽输出额度的判断；服务未透出厂商finish_reason，不能进一步声称拿到了厂商截断原因。
- 本轮固定测试成功不代表复杂题已经恢复，也不构成实际快捷键全流程验收。

## 后续修复边界

应在保留用户选择的思考模式下验证更高输出预算对复杂题的改善，同时明确区分输出额度耗尽、超时、供应商错误和未扣题状态。需要结合90秒期限与成本上界，不能只改一句错误提示便宣布恢复。生产调整未执行。

平台环境变量读取返回403权限错误；运行日志可读取。没有绕过权限或取得生产数据库记录，因此不能断言用户之前每一次失败的最终扣题状态。本轮重放的未扣题状态有正式usage与账户前后值支持。

本地诊断结果：`output/answer-failure-2026-10-14/probe.json`、`output/answer-failure-2026-10-14/user-replay.json`。凭证未写入结果文件；原图没有复制进仓库。


## 2026-10-14 修复已上线

用户随后明确要求解决问题，并重新连接 Vercel 权限。已先创建生产环境候选版本，验证后 promote 到正式域名。当前部署 `dpl_H1vRguN5pkCGXX3b7USzkNFS73sQ`，状态 READY，正式地址 https://notchspi-api.vercel.app。生产基线为上次线上源码，平台可列出的65个server文件SHA全部与本地基线相符；只带入6个服务端修复文件，没有发布3.0其他功能。

修复内容：

- 正式查题输出上限4096→32768，解释2048→8192；保留deepseek-flash、low、90秒答案总期限、45秒解释期限、每日120 CNY和每次3 CNY预占。更高上限不是固定生成长度，简单题可提前自然结束。
- OpenAI兼容适配器保留finish_reason；length及其他非正常终止不能作为完整结果收费，解释/恢复也拒绝看似完整的截断响应。成功结果按原机制结算一次，没有增加自动重试或用户点击。
- 明确区分model_output_limit、upstream_timeout；先完成释放结算再告知未扣题。新增失败日志只记录终止类型、token计数和结算状态，不记录题图、正文或隐藏推理。
- 本机客户端已补齐中日英提示，完成arm64 Release、Developer ID签名与验签并通过scripts/run-local.sh启动；原快捷键和自动提交流程不改。

验证：主代码Node645项、单独配置成本边界1项、类型检查通过；生产基线601项与类型检查通过；Swift427项（4跳过、0失败，warnings-as-errors）。此前601项测试的工作目录缺少离线资料文件导致失败，补齐原基线测试资源后全量通过；不是跳过失败测试。

原图真实重放：候选版14.653秒/1856 token及28.809秒/4646 token，正式域名31.782秒/7314 token，全部返回相同三个小问结果；本轮验收累计消耗3题，余额825→822，held=0。后一组两次输出已超过旧4096上限。未执行真实收费失败注入；截断不扣题通过Memory/SQLite真实HTTP回归验证。当前部署最近10分钟error/warning日志查询无记录，不代表未来永久无故障；没有新建持续监控任务。自动化发送全局快捷键未触发实际截图，不能声称硬件快捷键实机验收通过。

资料依据：[DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)的finish_reason/length契约；[思考模式](https://api-docs.deepseek.com/guides/thinking_mode/)的reasoning_content与content分离。推理文本从未转发给客户端。

证据保存在 `output/answer-failure-2026-10-14/repair-verification.json`、三份candidate/production重放结果和`production-hotfix.patch`，日志 `/tmp/notch-output-{node,stage-tests,typecheck,stage-types,swift,run-local}.log`。本次未推送Git、未发布新客户端安装包。正式服务修复已生效。

回退：可promote上一部署`dpl_2jgC7Pc3ednm2FR7BgYxei9y7CGF`（恢复服务前先判断旧上限会再次触发本问题）；若重新构建旧代码，解释上限必须同时恢复2048，否则旧校验不接受8192。查题两个输出环境变量的旧值4096。不要回退预算/思考设置、修改账本或发布主分支全部未发布功能。

外部模型仍可能遇到超时、厂商故障或更高的输出上限，不能承诺任何题永不失败。此次落实的是避免旧4096限额过早截断、明确识别截断，以及截断结果不收费的防回归机制。
