# Plus 3.0 Stripe 沙箱验收

日期：2026-10-17（北京时间）。候选：3.0 / build 26。独立空白沙箱：NotchSPI 3.0 QA，`acct_1URPe9DRrnCxrM32`，JP。CLI 已核对 `mode=test`。正式环境没有创建订单、扣款、修改支付配置或部署。

## 通过的流程

| 项目 | 验收结果 |
| --- | --- |
| Checkout 首次付款 | 本地候选 `/v1/plus/checkout` 创建真实沙箱 Checkout；浏览器以 Stripe 4242 测试卡完成 CNY 69 月订阅，后端收到真实 Stripe 通知并开通每日 400 次 |
| 账单门户 | 展示 CNY 69 / 月、已付账单、测试卡及下一账单日；支持付款方式管理及期末取消，禁止变更数量/价格与暂停 |
| 取消续费 | 候选 API 设置期末取消；Stripe 门户显示 11 月 17 日终止，当期 Plus 额度仍为 400 |
| 自动续费 | 测试时钟推进后下一期自动扣款成功，`paid_until` 从 2026-11-17 延至 2026-12-17；日额度未重复增加 |
| 续费失败 | 绑定 Stripe 的失败测试付款方式，下一期 invoice 保持 open、subscription 为 past_due；确认的付费期限没有延长 |
| 补款恢复 | 更换回成功测试卡并支付原失败 invoice，订阅恢复 active，付费期限延至 2027-01-17 |
| 期末终止 | 取消续费后推进测试时钟至期末，Stripe 为 canceled，本地 Plus 额度变为 0 |
| 真实账本到期 | 复制首次 Checkout 产生的 SQLite 账本，在副本上模拟本地时间超过 paid_until：总余额从 430 降至 30，保留初始额度 |
| 重复/乱序通知 | 对真实沙箱 invoice.paid 事件进行受控签名重放（最新、旧事件、再次重复旧事件），均被接收；已终止 Plus 没有重新激活或增加额度 |

## 验证方式与边界

- 本地候选后端监听 loopback，使用独立测试 SQLite；模型为 mock，不调用生产模型或数据库。
- CLI OAuth 代理承载候选 `LivePlusStripe` 发出的真实 Stripe API 请求，使用代码规定的 `2026-08-26.dahlia`；没有导出生产密钥。真实签名 webhook 通过 Stripe CLI 转发到候选原始字节校验入口。此证据验证 Stripe 对象和应用契约，不代表生产密钥权限、Vercel webhook 地址或生产门户配置已经验收。
- Stripe 测试时钟仅推进 Stripe 的时间；本地服务仍使用真实时间。失败扣款不延长期限由真实沙箱验证，准确的本地到期扣减另用真实账本副本及时间模拟验证。
- 并发 webhook 与前台查询触发 generation 保护时，可短暂返回 503 `plus_pending` 或 `sync_failed=true`，避免陈旧状态覆盖。等待通知收敛后刷新即可确认结果。本轮观察到并记录了该过程，测试以最终确认状态断言，没有把未确认状态当成功。
- 最初生命周期脚本在补款后的首次查询读到 `sync_failed=true` 而提前断言；后续改为有界等待确认，并继续完成期末终止与通知重放。生产代码本轮未因此改动。

## 证据

位于 `output/release-3.0-candidate/`：

- `stripe-portal.png`、`stripe-cancellation.png`：真实沙箱门户截图。
- `evidence/stripe-lifecycle.json`：各阶段 Stripe invoice/subscription 与应用账户状态，包含一次尚未收敛的查询。
- `evidence/stripe-expiry-check.log`：真实账本副本到期验证。
- `evidence/stripe-replay.json`：真实通知受控重放结果。
- `evidence/stripe-webhook-deliveries.log`：真实签名通知投递状态，密钥已移除。

沙箱中的测试账单与订阅保留用于复核；测试订阅已取消续费/终止。候选包、生产后端和公开下载均未发布。正式启用仍须检查生产 webhook 事件订阅、门户功能与密钥权限，并完成发布清单上的实机验收。
