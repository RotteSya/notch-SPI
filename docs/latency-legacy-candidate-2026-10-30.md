# 实际旧版客观题路径候选

本轮仅本地准备；付费调用0、部署0。目标仍为日常六题快捷键到可用答案平均小于6秒、每个样本不超过10秒，尚未达到。

## 基线与具体差异

`experiments/latency-legacy-objective-grounding-v1.json`绑定真实general/tutor/brief/objective_v1、单图请求。system/task来自实际Swift Prompts构造；不是server screen-query模板。固定模型deepseek-flash、low、32768，图片、必要长文及校验不变。

候选只在system最前新增可见选项与原文证据约束：仅使用题图实际选项，逐项依据所给长文判断，不添加不存在的选项或原文陈述。原system完整保留，原task逐字不变，包括完整性优先、歧义与所有分支、全部小问、排序双读法、单位、校验和输出协议。

假设：约束虚构选项或无依据的解释分支可能减少上游冗余推理。这不是实测结果；新增文字也可能增加耗时或影响判断。不能据此部署或声称质量等价。

## 免费验证

`node scripts/check-latency-legacy-prompt.mjs`通过：共享源、此前真实Swift导出的摘要、候选基线一致，候选保留原指令，task不变。另直接编译当前工作树SharedProduct.generated.swift和Prompts.swift，在/tmp/notchspi-legacy-candidate-check-20261030中调用真实capturePrompt及analyzeTaskText，与候选基线逐字比较通过。无依赖安装或模型调用。

## 后续质量与时延实验要求

- 必须使用legacy objective_v1判定，不再复用screen_query_v1的multiple_targets/unsupported_scope专用协议。旧协议允许同一题全部小问，unsupported输出review，不应强制另一条路径的no-result格式。
- 先确认缺少必要长文、裁切选项、真实歧义、开放问题的基线和候选行为；保留FINAL与JSON语义一致容忍，拒绝真正矛盾、遗漏小问、截断与错误结束。
- 完整六题沿用冻结题图及完整长文，按题交替AB/BA。记录响应头、首推理、首答案行、完整输出；任何错误或质量失败停止，不重试；保留所有慢样本。
- 直连结果只证明该路径的候选表现，不能替代真实客户端验收。上线与真实快捷键复测需分别批准；不得用切换题型、服务协议或模型规避当前目标。

已在run-latency-prompt-quality.mjs增加独立legacy预检和执行模式，绑定提示词、原图manifest、具体质量预期摘要与5次上限。拟执行Q11基线/候选各一次，缺长文、裁切选项、开放问答候选各一次。执行器不根据首字母放过错误选项文字；旧协议开放问答要求other/review/unsupported，缺失内容要求retake。finish_reason非stop或质量失败立即停止，独占许可与输出目录禁止重放。

22项离线测试全部通过，包含选项语义兼容、真实冲突、错误选项文字、缺上下文、旧协议unsupported、遗漏小问、截断后停止。免费--preflight-legacy通过，输出approved_calls=0/model_calls=0/proposed_calls=5；尚未生成调用许可或发起真实请求。已有screen-query试验额度不得复用。
