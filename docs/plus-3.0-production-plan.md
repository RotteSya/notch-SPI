# Plus 3.0 生产配置修改方案（尚未执行）

> 2026-10-20 发布推进更新：候选部署、Release 草稿、生产 webhook 与默认门户已经落地；当前状态及剩余放行条件以 [执行记录](release-3.0-execution-2026-10-20.md) 为准。下文保留原核对时点。

对应机器可读清单：[plus-3.0-production-plan.json](../deploy/plus-3.0-production-plan.json)。只准备字段与顺序；本轮不执行其中任何生产写入。目标 live 账户 `acct_1TrsrFDLfLoLVRGJ`，Vercel 项目 `prj_w2DZOa9GeyLV1K2yaRtOr4TS82ib`。

2026-10-20 前置条件：先恢复生产数据库并通过就绪及业务检查，再执行下述 Plus 上线顺序。build 27 旧归档中的后端预构建包已过时，必须保留 10 月 19 日的维护节流和 `/readyz` 修复；本次已准备包含修复的后端源码快照，见 [发版审计](release-3.0-preflight-2026-10-20.md)。

## 正式批准后的执行顺序

1. **保存基线并复查漂移**：重新读取正式部署 ID、生产/预览变量的目标范围、webhook 的完整事件集合与门户配置。确认仍与 10 月 17 日证据一致；不同则重新合并方案。保存数据库备份/恢复点，不把密钥值写进 Git、日志或验收报告。
2. **分离环境凭据**：现有 Stripe 两个敏感变量仅保留 Production target；Preview 使用 NotchSPI 3.0 QA 的受限测试密钥与其对应预览 webhook 签名密钥。部署 Preview 前同时核对数据库独立，不沿用生产 DB。CLI 的本机转发签名密钥只用于本机，不能填入生产/预览 webhook。PUBLIC_BASE_URL 在 Preview 指向它自身，PLUS_ENABLED 初始设 0。
3. **核对服务端密钥权限**：使用受限密钥，确认 Checkout Sessions 读写、Subscriptions 读写、Invoices 读取、Customers 读取、Billing Portal Sessions 创建；动态 price_data/product_data 所需权限以沙箱同权限密钥实测验证。保留题包当前对 Charges、Refunds、Disputes、Balance Transactions 的读权限。CLI OAuth 测试不能证明这把密钥可用。可先用同权限沙箱密钥验证，生产使用只读探测与 Dashboard 权限核对；不为验证权限擅自产生真实付款。
4. **部署兼容后端，保持关闭新购**：发布候选全量 server（包含 Plus schema、计费、官网、报表及既有模型输出差异），PLUS_ENABLED=0。核验持久化为 Postgres、迁移完成、旧客户端题包和体验接口正常、/v1/plus 已存在且新购关闭。不将客户端先于服务端发布。
5. **补充 webhook**：对现有 `we_1TslR1DLfLoLVRGJXChtUW6u` 更新 enabled_events 为“执行时现有集合 ∪ 方案新增 8 项”。保留地址 `https://notchspi-api.vercel.app/webhooks/stripe`、现有签名密钥及事件版本 `2026-06-24.dahlia`，不覆盖/丢弃题包的退款和争议事件。不默认升级此共享 webhook 的 API 版本。验证签名拒绝路径与 Stripe 投递结果、失败重试监控。
6. **配置账单门户**：若仍无配置，按 JSON 创建；若已存在，先核对再调整目标配置。确认 active 默认配置存在；开启发票历史、更新付款方式、期末取消（不按比例退款）；关闭套餐/数量/价格变更和暂停。当前服务端未传 configuration ID，因此必须核对“默认”配置，而不是只创建一个非默认配置。设置返回正式 Plus 完成页。
7. **启用和发包**：用户实机验收通过、生产权限/签名与配置核验完成，且获得正式发布授权后，将 PLUS_ENABLED 设为 1 并触发对应部署使配置生效；再次验证 API 的 69/400 契约和入口可用，再发布客户端、更新元数据和公开下载。不得以未付款测试事件冒充真实生产支付验收；如需真实小额验收，另行明确支付授权与处理方式。

## 具体参数和边界

- JSON 中 webhook payload 是基于本轮基线的完整并集，不是要求以后盲目覆盖实时集合。
- 价格由代码 `price_data` 固定为 CNY 6900 分/月、quantity=1，不需要额外创建并配置一个生产 price ID。全局 `CURRENCY=JPY` 服务于旧题包，保持不变。
- Plus 新用户免费体验由本地服务的 claim 处理，与 Stripe subscription trial 无关，不设置 Stripe 免费试用、优惠券或税额附加；当前严格发票契约需要每期支付 6900 分。
- 本轮账单/权益验证不包含“退款自动撤销 Plus 权益”。退款和取消续费是两件事，客服处理必须核对两者，不把退款理解为自动止续费。
- Plus 毛收款、净收款及 JPY 结算分别按发票/支付/余额交易核对；现有题包面板明确不含 Plus 财务。上线前确定由谁查看 Stripe Plus 发票与对账差异，避免把题包报表当总收入。

## 回退方案

出现新购问题：PLUS_ENABLED=0 并重新部署当前兼容后端，停止创建新 Checkout；保留 webhook、门户及取消续费接口，继续处理已付用户权益。关闭开关不会取消已建会话，也不会自动取消既有自动续费；未完成会话需在 Stripe 核对，必要时按授权逐一过期。不要直接回滚到不识别 Plus 的旧后端，不删除 Plus 表，不以数据库恢复抹去已付款记录。

上线后观察：webhook 非 2xx、同步失败、已付发票与本地权益不一致、重复订阅、失败续费越期授予，以及门户不可用。出现差异先暂停新购、保存证据再修复。候选已能在开关关闭时继续管理既有订阅。
