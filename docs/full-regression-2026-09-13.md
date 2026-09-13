# 2026-09-13 全量回归与正式发布状态

用户明确批准原题全量回归后正式发布，累计测试费用仍不得超过27 CNY。本轮94b2d17的408题、80解释和2拒绝请求已全部完成，独立档案/结果复核可重放；质量聚合thresholds_failed，未正式发布。

401可作答题的冻结分数：单选100/100、填空100/101、多选76/100、排序97/100；另7条风险/未标注探针。多选的24条失败经逐图独立复核为16格式、2协议冲突、5真实漏选、1无答案。即使另档修正全部16格式，多选ready最多92/97=94.85%，仍低于97%。整体协议合法396/408=97.06%，重拍识别2/3、多目标识别1/2，未达到蓝图门槛。原分数、题图和模型输出未改，也没有择题重跑。

解释79/80通过，1条2048 token后无可用输出；严重矛盾/静默改写/泄漏均0，两类禁止解释入口均实际拒绝。原生恢复所需状态核对通过：唯一传输失败请求在服务端已settled/扣1，can_recover=true，评测端未收到的结果仍计失败；账户held=0。

同一账本1523派发、保守占用16.075267/27 CNY；这是费用上界记账而非账单实扣。后续240+240对照未启动，付费执行暂停，等待对实际质量门槛的明确对齐；不将本轮已见材料称为新盲测。

发布包已Apple Accepted、staple与App/DMG Gatekeeper通过。5c6dfbf修复真实Stripe py_付款编号问题，800 JPY收款/32费用/768净额实际核对成功；CI34742428452全部10项通过，Node各571、数据库四组合各693、Swift317通过和4条件跳过。551个Linux文件摘要均匹配，模型/原生输入与94b2d17不变。

生产仍7ba96db部署，healthz200，未迁移数据库或公开DMG。恢复分支演练显示实际Neon owner不能自设NOLOGIN，SQL改密加抽样终止后端也不能证明已认证池连接全部退出。所有演练已回滚/恢复，下一步须验证平台支持的旧写入隔离，再做最终备份恢复、兼容迁移、生产分钟回收及每日20元核验。

详细本地证据位于native/.release-evidence/2026-09-13/下：progress-record-credentials-restored.md、full-regression/verified-quality-report.json、complete-review-basis.md、multiple-choice-failures-independent-review.json、release-decision.json、terminal-state-check.json、final-finance-build/ci.log、artifact-integrity.json及production-access/isolation-findings.json。凭证与题目材料留在受控本机目录，不进入Git。
