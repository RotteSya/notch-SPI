# 2.12 发布切换准备与最终对照

截至 2026-09-13 15:40（上海），生产仍为 `7ba96db` / `dpl_BStwrGFdwhRC7FP3g2m6snSpcgfC`，数据库未暂停、未改密、未迁移，2.12 尚未公开发布。

用户已接受此前披露的阅读回归质量限制并授权正式发布方向。此次新增的耗时门槛偏差尚需对齐；原质量评分不改写，不把已见题集称为新盲测。

## 已完成

- 原 408 题、80 次解释及 2 次解释入口拒绝验证完成。解释 79/80；阅读多选、协议及范围识别的失败事实见完整回归记录，用户已接受其首版限制。
- 当前候选同一 DeepSeek Flash 模型、low 思考配置的 Objective 240 + legacy 240 对照全部完成。原前 78 条保持字节一致，第 79 条失败保留，后续只执行剩余 401 次，无选择性重跑。全部 token 与派发费用已独立核对。
- Objective 可作答正确 200/204（98.0392%）、V1 合法率 98.75%、ready 精确率 98.1928%、retake 召回 35/36；题型/语言精确率均通过旧范围绝对门槛。平均 token 比同模型 legacy 增加 6.7168%，低于 8% 上限。
- 原始 239 对耗时比较增幅 13.0554%，超过 10%。一条缺失耗时仍保留为未知；按 nearest-rank 定义，240 样本真实 p95 必在 8661–8677ms，完整 legacy p95 为 7314ms，因此整组增幅必为 18.4167%–18.6355%。即使缺失值任意变化也不能使门槛通过。约 1.35–1.36 秒差距是本次同模型协议对照结果，不能解释成当前线上 Anthropic 版本的实测差距。
- 累计测试账本保守占用 25.905667 CNY，上限 27 CNY、余量 1.094333 CNY。它是保留未知/未审核调用最高费用后的累计估算，不是厂商实际扣款。无新增付费测试计划、无预算重置或提升。
- `5c6dfbf` 的 10 项 CI 全部成功：Node22/24 各 571 项；Postgres16/17×Node22/24 各 693 项；Swift317通过、4条件跳过、0失败；调度器17项。类型检查和 Release 编译通过。
- Linux 函数包 551 文件摘要全部核对，通过生产目标 prebuilt dry-run。产物 SHA256 `030f9d5da42d24d375f031bb40f68f4c8d1ae388c399d85f9d60f456ae5fcdb4`；其后配置/文档提交未改变运行时代码。
- App 2.12/19 的 Developer ID 签名、Apple 公证、staple 和 Gatekeeper 已通过。最终 DMG SHA256 `f5079b8a195b744872f378c62619a6a05b3c5a31cbc73484a98e05f97e84de11`。未上传为正式 Release。
- Stripe 同项目实际 live 历史订单只读核对通过：800 JPY、手续费32、净额768。`py_` 付款编号兼容修复已包含在当前函数包，无真实收款/退款测试。

## 数据库与费用配置

用户创建的 Neon Project-scoped 密钥已验证仅针对 `neon-rose-lens` 项目。备份分支实测：单独 reset_password 后旧连接仍可写；加入显式 endpoint restart 后，既有管理员直连、普通直连和持久连接池均拒绝写入，旧密码的新直连/池连接均 28P01，新密码可写。临时测试表已清理。一个冗余 start_compute operation 为 skipped，实际重启操作和行为验证通过，未虚称所有 operation finished。

正式切换脚本已准备并独立复核：验证 Vercel 平台级入口保护/暂停 → 330秒排空 → 核对活动事务 → 正式密码重置与计算节点重启 → 核验新旧连接边界 → 最终 pg_dump → 独立分支新库恢复及五张旧表逐行摘要核对 → 当前兼容代码 pause/batch/validate → 新部署与兼容回退 → 核对后 resume/切域名/启用免费回收 → 最后发布客户端。脚本不自动恢复旧密码、覆盖新数据或把旧版接回新账本。当前没有生成允许执行的 qualification.json。

生产模型配置为与评测一致的 DeepSeek Flash、回答4096/解释2048总输出 token；两通道均low。每日20 CNY按上海自然日共享，不自动提高。单次预留3 CNY覆盖整个1M上下文及输出的峰值最坏估算2.129920 CNY；已观察用量正常结算，未知保留上界。题包币种仍为JPY。

评测完成后候选 Cloudflare cron 已关闭，正式 cron 仍为空。上线首周费用复查自动化已经存在，以实际生产启用时间起算七天，无需创建重复任务。

## 私有证据索引

记录位于本机 `native/.release-evidence/2026-09-13/`，不包含在公开发行包或 Git 提交中：

- `full-regression/objective-continuation/summary.json`：原始结果保留 `thresholds_failed`。
- `full-regression/objective-continuation-independent-readout.json`：独立完整性/费用/耗时复算。
- `production-release/latency-and-budget-final.json`：缺失值顺序统计界及最终预算。
- `production-release/independent-script-review-final.json`：修正入口判定后的切换脚本复核。
- `production-access/controlplane-reset-restart-v2-rehearsal.json`：实际备份分支凭据隔离。
- `production-release/prepared-deployment.json`：生产目标部署准备；数据库新凭据待正式切换。
- `final-finance-build/test-summary.json`、`ci.log`：构建与测试证据。

后续先决定是否接受本次新增约1.4秒的p95差距；接受后执行已准备的正式切换，仍保留未达原耗时门槛的事实。


## 正式发布授权与构建入口

2026-09-13 用户明确回复“可以接受，线上线”，接受已披露的延迟偏差并授权正式上线；既有阅读质量限制授权继续有效。原数值门槛与失败事实保留，不再标为待确认。

生产采用通过 CI 校验的 Linux 预构建产物部署并显式 promote。`server/vercel.json` 关闭 Git 自动部署，避免代码推送绕过数据库迁移、固定配置和已验证产物；后续发布沿用显式流水线。此设置只控制 Git 触发，不改变服务路由或运行代码。
