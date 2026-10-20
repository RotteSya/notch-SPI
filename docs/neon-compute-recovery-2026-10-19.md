# Neon 恢复与节流记录（2026-10-19）

## 状态

`neon-rose-lens` 是 NotchSPI 正式 API 的 Postgres。当前数据库仍因本月配额耗尽不可用；尚未获得付费升级确认，没有升级套餐或付款。优化不能退回已使用的 CU-hours。

## 已发布

- Vercel 部署 `dpl_BiBGvjAazTWsmMqfUsgLWzuTBa6s`，已 promote，正式地址 `https://notchspi-api.vercel.app` 回读新探针字段。
- 严格使用 10 月 16 日已核对 SHA1 的 71 文件生产快照，仅变更 6 个存储/路由/启动源码文件；保留线上 400 题试用功能。
- Serverless 实例不启动维护计时器；本地常驻服务间隔改为 15 分钟。
- Cloudflare `notchspi-reaper` 从每分钟改为 `*/15 * * * *`。保存并重新加载控制台，显示 Every 15 minutes。配置可能需要传播；修改后日志仍有旧时间点调用，不能据此宣称已实测完整的 15 分钟间隔。
- `/healthz` 为零数据库访问的存活/配置检查，明确标注 `scope: process`、`database: not_checked`。
- `/readyz` 使用现有 CRON_SECRET 鉴权，只执行 SELECT 1，不执行 schema 初始化；连接及查询各限 3 秒，失败返回 503、禁止缓存、不泄漏错误细节。仅按需调用或与维护时段对齐，不能用高频深度检查保活。
- 请求结算及支付 webhook 路径未改变；补偿处理最迟可能延后至下个 15 分钟维护时段。

## 验证

- 发布快照服务端 619 项测试全部通过，TypeScript 通过；scheduler 17 项测试及类型检查通过。
- 就绪探针测试覆盖无凭证零数据库访问、数据库失败/恢复、服务启动不创建 interval、真实 TCP 连接停滞超时。
- 候选部署及正式地址均验证 /healthz 200（not_checked）、未授权 /readyz 401、授权 /readyz 503；/stats 仍为 500，不能宣称业务已恢复。
- 主工作区已同步同等修复，保留原有 Windows/客户端改动。全量 685 项初跑仅路由清单漏写 /readyz 失败；补齐清单后复测相关用例。
- 隔离分支移除了基线中与实际生产源码不兼容的旧 month-pass-preview 测试；主工作区未删除该测试。

## 费用和待执行步骤

已核对 Vercel Neon 安装提供的 Launch `launch_v3`：计算 $0.106/CU-hour，存储 $0.35/GB·月，无固定月费。官方说明：https://neon.com/blog/new-usage-based-pricing 和 https://neon.com/blog/major-compute-price-reduction-on-neon 。升级为整个 Neon integration installation，其他项目也会按量计费。

当前主计算固定 0.25 CU，默认 5 分钟休眠（API suspend_timeout_seconds=0，官方含义为默认值，不是关闭休眠）。只有每 15 分钟维护、没有其他流量时，理论计算约 60–62 CUh/月、$6.36–6.57/月；若全天活跃，则约 $19.08–19.72/月。这仅是单个生产计算节点估算，不含其他项目、存储/历史、超额流量和税费，不是硬性账单上限。

等待用户明确同意付费升级；之后验证计划、SELECT 1、/readyz、真实只读业务接口，再验证维护任务与空闲休眠。当前免费配额下一周期为 2026-11-01 00:00 UTC（北京时间 08:00）。

证据位于 output/neon-recovery-2026-10-19/（staged-verification.json、production-verification.json、neon-endpoints-verified.json、deploy-dry.json）。
