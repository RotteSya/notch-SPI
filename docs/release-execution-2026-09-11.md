# 2026-09-11 实际发布执行状态

当前状态（2026-09-11 11:11 UTC账单核对）：本轮969次实际派发已完成，同一campaign累计上限27 CNY，包含此前139次。保守预留合计26.915840元，仍保留原始金额；账户余额从27.20降到26.13，账户级差额约1.07元。余额按分显示且包含账户其他活动，不冒充逐请求精确账单。没有追加付费调用、重置预算或释放历史预留。两份预算政策SHA仍为 `5dcbcf34b0ff59a4f7020cebb39fcff7d86a598976977bc55f5d9737a68d16df`。

Objective同模型240+240比较完整通过：treatment可作答准确率94.6078%、ready精确率97.0238%、retake召回100%、V1合法率100%；平均token比legacy增加4.38%，p95降低9.76%。完整阅读408题和80解释也已执行结束，但新范围质量未通过。独立诊断确认单选原评分器不接受“标签＋完整选项文字”，造成98条格式误判：冻结得分1/100保留，另档内容等价诊断99/100。排序存在真实错序，不能把所有失败都归于评分格式；80条解释的独立AI复核已完成：61/80同时正确、一致且无无关推断；正确性单项70/80，一致性62/80，10条严重矛盾、5条静默改写、材料/协议泄漏0。全部父答案为ready/v1，其他状态路径覆盖仍不足；本配置不能开放该profile解释。

真实阅读响应还暴露了软件缺陷：`browser-risk-cropped` 的有效retake JSON附带了模型误写的FINAL，原解析把“无法确定”的文字降级为可收费fallback并扣1题。已在独立 `codex/retake-no-charge` 工作树修复：矛盾封包以failed结束，无可用答案、完成态无复制正文并释放额度；协议违规仍保留，不计为合法V1或retake召回通过。544项Node测试通过，Swift 321项中317通过、4项按条件跳过（2个系统截图探针、2个模型/旧记录评测），warnings-as-errors及arm64 Release编译通过。既有截图路径未改，先前8846e61实际截图证据仍按原候选保留。独立反例45种和408条原响应重放确认，仅该失败条目的扣题判断改变，其余407条不变。原 `1364899` 工作树及原响应不动，继续用于冻结评分重放。此前已公证的8846e61安装包不包含此新修复，不可作为最终新候选发布。

Stripe已通过临时受保护服务端诊断核验实际继承的项目密钥：Checkout Sessions读200；Charges、Refunds、Disputes、Balance Transactions均403。已定位notchSPI现有受限密钥checkout（尾号4uoQ）；所需Balance、Charges and Refunds、Payment Disputes三项只读授权正在等待浏览器操作当场确认，尚未选择或保存。生产部署仍为 `dpl_BStwrGFdwhRC7FP3g2m6snSpcgfC`，未公开发布。

以下带“启动/续跑”的段落保留历史时点，不能当作当前仍有模型进程运行。

用户已批准小用户量发布流程：内部必要验收通过即可向现有用户开放，七天费用与28天产品观察在上线后计算，不等待四档各72小时或200次请求。执行细则见 [发布调整](small-user-release-2026-09-11.md)。

## 当前已验证

- 发行提交 `8846e6141953c93584ab2157f267dfcaa0047af6` 的 CI `34586015021` 全部10项成功；完整 verify 通过，Node533项、Swift320项。显式真实截图测试正常路径和备用路径各三次通过。
- 当前代码的实际QA已完成断线后已结算答案恢复、解释完成和正常退出，未重复扣题。三次截图编码约319/163/181ms。受控回答用于界面与结算检查，不当作模型正确率。
- 新DMG SHA `b75f1e557dccbffe22d1bb91f61512041ffac270d386e914f9785ef421edcdff`；Apple公证 `fa6e7103-d2ae-40e4-942a-964d2325f7a4` Accepted，装订和Gatekeeper通过，尚未公开。
- Cloudflare候选定时器第三笔持有测试在到期约30.313秒后自动释放；账本只有一次hold/release、余额恢复30；真实日志processed=1，下一次processed=0。候选cron继续每分钟运行，生产cron仍为空。这不代表官方全局事件已经恢复。
- 用户更新DeepSeek密钥后，09:57 UTC余额和型号查询均HTTP200；账户有27.20元人民币，deepseek-flash可用。实时官方页面确认当前V4.1 Flash支持图片，高峰输入/输出价格为2/8元每百万token。
- 最终408题、457图经独立AI四项静态授权并通过当前完整corpus loader。manifest SHA `a6e6d5e7678b0a590146b0dc0fb88710433f7fb0d714b7bbf6b7c77f29f16fe0`；授权SHA `f33508571bda98e082c151146a1427c552e1be18474a07f91a347db2395109ab`。此授权不代表模型成绩或发布通过。

## 隔离评测启动与续跑历史

27元方案实际进展：已解除有记录的操作员暂停，保留原139条费用记录。精确候选的Objective treatment 240题完整通过：V1合法率100%、可作答准确率94.6078%、ready精确率97.0238%、retake召回100%；平均1041.4625 token、p95为2405ms。同模型legacy 240题仍在执行，未提前宣布相对性能门槛通过。工具提交4199b94的CI 34589187229已成功。

阅读续跑工具已实现，只接续原105个已完成答案后面的303题及48个辅助请求，保留139条响应原字节和旧价格。独立审查发现并修复复制档案可重复续跑的问题；唯一续跑者现在由同一费用账本按原run ID锁定。续跑属于评测工具变化，候选服务器、模型配置与已公证DMG输入保持8846e61。

27元方案后续：独立复核已验证当前固定请求的阅读8192/单图基线4096输入工程上界、既有解释768输出限制和当前周末空闲未命中1/4元价格。保留139次旧预留9.109504元后，剩余303答案、46解释、2拒绝检查与480次基线的整轮保守总额为26.927104元，余0.072896元。该价格方案最晚于2026-09-12 09:04:49 UTC失效，禁止自动延用。按操作预留、请求类型校验与运行中降低上限的保护已实现；相关43项测试、完整Node538项与类型检查通过。后续先执行独立的240题对比，阅读续跑仍需保证保留旧结果且不重复派发。

同一CI的551个Linux函数文件核验摘要后部署到隔离Preview `dpl_3197uLrymm6LH4YEEV7VoEhsn4sa`。双provider为deepseek-flash，支付关闭，独立EVAL库、访问保护、版本与测试账户均核验。以零金额admin账本补入970题，测试余额1000；不涉及用户账户。

完整计划408题、80解释、2拒绝检查、240 treatment和240同模型legacy，共970次。逐次保守上界0.065536元，最低整轮预留63.56992元；同一100元campaign和原政策摘要未变。实际费用与保守预留分开；没有自动充值或预算重置。

阅读整轮约10:04 UTC启动，真实响应、解释和每次费用预留持续写入私有档案，须等完整结果和独立解释复核。现有候选worker指向402服务器，整个server/src与884候选完全一致，共用隔离EVAL库，继续处理到期恢复。

## 发布仍需完成

生产仍为 `dpl_BStwrGFdwhRC7FP3g2m6snSpcgfC`。实际模型质量、支付资源核验、停流备份与兼容迁移、最终支持目录及生产开关尚待完成。生产密钥的实际服务端权限已核验，见本文顶部；本地值401不能用于推断生产密钥失效。

原始私有证据位于 native/.release-evidence/2026-09-11 下的 lean-release-current-ui、lean-scheduler、formal-composition、cheap-candidate 和 stripe-read-check；不进入App或公开发布资产。

## 本轮完成证据索引

以下均为私有本地证据，不随App分发：

- `cheap-candidate/budget-completed-1789125071525.json`：最终969次、27元政策、26.13元账户余额的只读查询；无新增模型调用。
- `cheap-candidate/objective-pair-execution.json` 与 `objective-eval-output/2026-09-11T10-35-13.458Z-legacy-comparison.json`：完整240+240同模型比较。
- `cheap-candidate/reading-continued-27/completion.json`：408答案、80解释的完整执行；原档案和原评分不覆盖。
- `cheap-candidate/answer-format-independent-diagnostic.json`：单选98条格式误判的来源绑定诊断；不是另一个预注册评测。
- `cheap-candidate/partial-review-remaining-46.json`：补完46条解释并汇总全80；SHA `c7c1c59472a2b27956b8b958a747711bf5839ecb703c07cccc39109a4ebd82b3`。
- `cheap-candidate/retake-fix-offline-replay-v2.json`：最终修复对408条已存响应的离线回归；旧成绩和历史扣题事件不被重写。
- `cheap-candidate/retake-fix-v2-node-full.log`、`retake-fix-v2-swift.log`、`retake-fix-v2-release-build.log`：完整本地检查日志。
- `stripe-read-check/actual-server-permissions.json`：服务端实际支付密钥的5种只读资源检查。

费用测算勘误（2026-09-12）：原`historical-usage-cost-feasibility.json`的1.362435元错误地把两条缺失usage的0/0当作零费用。独立复核逐条绑定969次派发、响应和当时价格后，966条正用量向上取整合计1.351171元，另外3条未知保留原上界0.060416元，正确的保守合计为1.411587元。原错误报告保留为历史，不用于费用准入；账户级差额约1.07元也不作为逐请求账单。审计结算执行前，账本仍保留全部26.915840元原预留，累计上限始终27元。工具和后续实际执行状态见[费用结算记录](evaluation-settlement-2026-09-13.md)。
