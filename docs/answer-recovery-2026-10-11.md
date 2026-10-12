# 2026-10-11 查题恢复

## 用户后续决定（覆盖下方临时措施）

用户明确要求正式服务保留深度思考、永久每日120元。已将production的OBJECTIVE_RESULT_V1_DEEPSEEK_REASONING_EFFORT恢复low，MODEL_DAILY_BUDGET_MICROS永久设为120000000，并同步deploy/production-model-budget.json。当天预算行此前已是120元。下方“关闭思考”“午夜回归20”仅为历史操作，不再代表当前配置。新部署dpl_HBrKjCmAfDXnAexdLVGjnz4ALCwx复用上一部署源码，已Ready并绑定正式域名；配置回读确认两个查题通道均为low、每日120000000微元，healthz正常。此前2.687秒测试来自关闭思考设置，不能作为恢复low后的性能或质量证据。

用户授权恢复查题，并明确授权今天额外100 CNY。

- 根因证据：官方返回503 budget_exceeded；账户仍有845题。当天budget_windows原上限20 CNY，保守spent为18.168754 CNY，held为0，下次需预留3 CNY故拒绝。spent包含usage未知时的全额上界，不等于厂商实际账单。
- 近期多次deepseek-flash请求输出4096 token却无可用答案，另有20秒首正文超时。生产objective思考设置为low。关闭思考后厂商测试1.437秒正确返回D；官方完整客户端提示测试2.687秒返回D、ready、完整usage与DONE，扣1题，剩余844。
- 仅将当天2026-10-10T16:00Z至2026-10-11T16:00Z的official/CNY预算行从20提高到120 CNY；次日默认仍20。不修改spent/held或历史成本记录。
- OBJECTIVE_RESULT_V1_DEEPSEEK_REASONING_EFFORT从low改none，重建原生产dpl_4ybnroX8acj2pAwCd8Gh8VEF7xRR，当前正式dpl_E97B5C8NaPp4WyxUqS3Gd6RWFPqf（Ready，正式域名已绑定）。其他模型及解释设置保持原配置。紧急恢复仅验证基础题，未声称复杂题质量回归通过。
- 客户端保留真实服务错误，增加预算错误三语提示；AnswerComposerTests 20/20，Release构建及Developer ID签名验证通过。已备份原Applications包至本目录NotchSPI-before.app，并安装启动修复包（仍2.17/24，本机QA打包显示名NotchSPI (test)）。不是公开版本发布。
- CUA确认本机显示“就绪”，自动化全局快捷键未成功触发截图；真实API答案验证通过，但未确认本机答案卡首绘。

回退：思考设置改回low并重建原部署；本机包可从备份恢复。预算临时变更于上海时间2026-10-12 00:00自然过期。


## 2026-10-12 正式超时修复与实机验收

生产部署 dpl_2jgC7Pc3ednm2FR7BgYxei9y7CGF 已 Ready，正式 alias 已切换。使用 10 月 9 日保存的生产源码，仅修改 capture-service、OpenAI provider 和 Provider 接口及对应回归测试。正式 low 深度思考和每日 120 CNY 已重新读取确认，跨日预算行也为 120，预占为 0。

修复：reasoning_content 的非空流事件现在算作模型启动进度，取消 20 秒首个可见答案定时器；推理内容不转发给客户端，90 秒绝对总时限保留。新增超过 20 秒后回答的 HTTP 回归，以及推理不泄漏测试。主目录 626 项、生产源码 589 项测试全部通过，类型检查通过。生产测试最初误复制主分支较新的事务测试导致不兼容，已按原 SHA 校验恢复生产测试基线，只保留新增回归后重跑全绿。

上线后真实正式接口：中文多选 3.636 秒 A,C；英文多选 3.912 秒 A,C；排序 4.123 秒 B,D,A,C，均与 fixture gold 一致；模糊日文填空 2.316 秒 retake、未扣题，所有请求 held_questions=0。使用安装客户端真实截取 Chrome 自编函数题 f(x)=(x+a)ln x，界面显示正确 B，随后完成引导清除练习状态。该复杂题未保存精确端到端耗时，不编造数值。

证据在 output/reliability-2026-10-12。本次修复服务端已对全部用户生效；本机客户端错误提示修复已安装，尚未公开发布新版客户端安装包。绝对总时限、供应商故障、4096 输出上限及每日预算耗尽仍可能产生失败，不能以这些样本保证任何题目永不失败。
