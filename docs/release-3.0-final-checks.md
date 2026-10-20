# 3.0 发布前核对与实机清单

> 2026-10-20 发布推进更新：候选部署、Release 草稿、生产 webhook 与默认门户已经落地；当前状态及剩余放行条件以 [执行记录](release-3.0-execution-2026-10-20.md) 为准。下文保留原核对时点。

> 2026-10-19 更新：当前候选为 [3.0 build 27](release-3.0-build27.md)。下文保留 10 月 17 日验收记录；build 26 安装包不再作为最新发版包。

> 2026-10-20 的最新放行结论为 **暂不可发布**，见 [发版前审计](release-3.0-preflight-2026-10-20.md)。本页的历史测试记录不能替代生产恢复和最新候选验收。

核对日期：2026-10-17。仅执行只读生产查询、本地修改和隔离测试；未部署、未开启 Plus、未发布 Release、未更新公开下载。

## 生产支付核对

| 项目 | 已确认结果 | 上线前处理 |
| --- | --- | --- |
| Stripe 账户 | notchSPI / acct_1TrsrFDLfLoLVRGJ，日本账户，charges_enabled/payouts_enabled 为 true，card_payments active，结算默认 JPY | Plus 按 CNY 6900 分收款；与题包的 JPY 分开统计 |
| 服务健康 | /healthz 200，Postgres、Stripe、webhook configured；首页 200 | configured 仅表示配置存在，不代表签名与权限已验证 |
| Plus API | 生产 /v1/plus 为 404 | 发布顺序必须先后端、再客户端；本地 DMG 目前不能在生产开通 Plus |
| 开关 | 完整 Vercel 环境清单中没有 PLUS_ENABLED，代码默认关闭 | 正式批准并验收后才设为 1 |
| 普通配置 | PAYMENT_PROVIDER=stripe、ALLOW_STUB_TOPUP=0、PUBLIC_BASE_URL=https://notchspi-api.vercel.app、CURRENCY=JPY | 保留题包币种；Plus 独立使用 CNY，不把全局币种改为 CNY |
| 支付凭据 | STRIPE_SECRET_KEY、STRIPE_WEBHOOK_SECRET 存在，均为 sensitive，同时作用于 Production 与 Preview | Preview 改用独立沙箱配置；生产凭据不能复制给测试部署 |
| 密钥具体权限 | sensitive 值不可从本轮元数据核验；CLI OAuth 权限不等于服务端密钥权限 | 正式密钥需覆盖 Checkout 会话读写、订阅读写、发票/客户读取、账单门户会话创建，并保留既有题包所需权限；不能称为已验证 |
| webhook | we_1TslR1DLfLoLVRGJXChtUW6u，enabled，地址正确，事件版本 2026-06-24.dahlia | 缺少下面 8 项事件。保留全部既有题包/退款/争议事件 |
| Customer Portal | live 配置列表为空、has_more=false | 必须创建并激活默认门户：期末取消、不按比例退款、可更新支付方式及看发票，禁用套餐变更与暂停 |
| 支付方式 | 默认配置 card/Link/Alipay/WeChat Pay 开启 | 此结果不是所有方式都支持 CNY 自动续费的承诺；实际 Checkout 按资格动态展示，不能宣传所有方式均能订阅 |

缺少的事件：

- checkout.session.expired
- customer.subscription.created
- customer.subscription.updated
- customer.subscription.deleted
- invoice.paid
- invoice.payment_failed
- invoice.payment_action_required
- invoice.voided

保留 checkout.session.completed、checkout.session.async_payment_succeeded，以及全部已有退款、charge 和 dispute 事件。候选 Stripe REST 读取固定使用 2026-08-26.dahlia；webhook 只取资源标识后重新读取订阅，并兼容新旧发票 subscription 位置。不要为 Plus 直接升级现有整个 webhook 版本，以免影响题包；正式配置后仍需核对真实签名投递及错误告警。

当前代码只接受标准 CNY 69/月、数量 1、已支付 6900 分的月度发票。不要在 Stripe 后台给此版本订阅添加优惠券、套餐切换、额外发票项或改变金额；这些会导致已收款但不满足权益契约。退款不等于取消订阅，取消续费不等于退款；现有 Plus 未自动按退款撤销已付权益，人工退款须同时核对订阅后续计费与权益处理，不能沿用题包自动撤回的假设。

证据：`output/release-3.0-candidate/production-stripe-readonly.json`、`production-env-metadata.json`、`production-http-readonly.json`。生产设置本轮保持原状。

## Plus 收入统计口径

1. **支付来源**：通过 subscription.metadata.plus_intent_id 识别 Plus，再以唯一 invoice ID 关联订阅及支付记录。不能仅凭商品名、金额或 customer 判定，也不能把首次 Checkout 和首张发票重复计入。
2. **实收毛额**：标准月账单成功收款为 CNY 6900 分；续费每张成功发票独立计一次。失败、未付、作废账单不算收入。现金报表以实际 paid_at 分期，统一使用 UTC 半开区间；北京时间报表须明确转换边界。
3. **本地表的边界**：plus_paid_invoices 是权益确认及幂等账本，只有服务期、金额和订阅标识，没有 paid_at、退款、手续费、拒付及结算交易，且通过最新发票同步，历史漏投不能保证完整回补。因此其 SUM(amount_cents) 只能表示“本地已确认权益发票毛额”，不能充当完整月收入或净收入。paid_from 不能代替支付日期（补款尤其如此）。
4. **净收款与结算**：以 Stripe 实际支付、成功退款、拒付及唯一 balance_transaction 去重核对，手续费只扣一次；退款失败/待处理不当作成功退款。CNY 交易币种与 JPY 结算币种分别呈现，用 Stripe 实际换汇/余额交易，禁止直接加总或用固定汇率估算实际到账。银行 payout 也不等于当月营业收入。
5. **订阅指标**：在付费服务期内且未终止为当前有权益用户；已取消续费但未到期者仍有权益，但不计入预期下期续费。MRR 与实收分开；每日 400 次是用量权益，不是 400 份收入或永久库存。
6. **当前后台**：P28、试用后付款、订单现金仍仅统计一次性题包。本轮增加明确范围标记，排除 Plus 每日 lot 对永久题包数量/负债的污染；存在 Plus lot 而缺少 Plus 财务流水时，贡献金额返回未知。全部调用成本保留，不能把此报表视为全产品净收入。
7. **上线操作口径**：Plus 财务以 Stripe 发票及余额明细单独对账，题包报表单独使用；尚未开发全产品合并财务面板。要合并时必须先补齐发票支付时间、实际支付绑定、退款/争议、费用及版本化快照，再谈完整贡献。

沙箱核对：本地账本的 4 张唯一成功发票逐一与 Stripe GET invoice 比对，合计 CNY 276.00（纯测试金额），包括首付、正常续费和失败后补款；这不是生产收入，也不是扣费后净额。证据 `plus-invoice-reconciliation.json`。

参考：[订阅 webhook](https://docs.stripe.com/billing/subscriptions/webhooks)、[Stripe 余额报表](https://docs.stripe.com/reports/balance)、[API 密钥](https://docs.stripe.com/keys)。

## 需要用户实机操作

建议记录设备型号、macOS 版本、显示器组合、步骤结果和异常截图。先退出原应用；不要清除正式账户凭据、历史或系统权限来制造新用户。最低系统需一台 Apple Silicon macOS 14 设备（没有该设备就保留未验收，不以新系统结果替代）。

| 步骤 | 操作 | 通过标准 |
| --- | --- | --- |
| 安装与升级 | 保留旧安装包，把已公证 3.0 build 27 DMG 中 App 放入 Applications 覆盖旧版，打开 | 无安全拦截；设置版本正确；原设置、账户余额和历史保留 |
| 权限保留 | 在已给录屏权限的旧版环境覆盖安装后截图 | 原授权仍可用，截图内容正常，没有重复授权循环 |
| 首次拒绝再授权 | 用独立 macOS 测试用户启动，在需要时拒绝录屏；再从系统隐私设置授权，按提示退出重开 | 拒绝有可理解提示、不扣题；授权后恢复截图 |
| 快捷键 | 菜单截图、全局快捷键、Esc 取消；连续启动/退出重开 | 每次只响应一次，取消不会意外发题，重开不失效 |
| 显示器 | 内屏与外屏分别截图，拔插外屏、切换主屏、缩放、全屏 Spaces、睡眠唤醒 | 框选坐标和图像一致，刘海/浮层不跑到屏幕外，不出现残留遮罩 |
| 新用户延后领取 | 独立测试用户或隔离新手 QA：引导选择稍后领取，退出重开，再从账户页领取 | 跳过时不开始 72 小时；入口仍在；领取成功才开始计时，重复点击不重置 |
| 回看与阅读 | 成功查题后打开最近查题，检查长答案、公式、复制、删除 | 公式和滚动正常；回看不再次扣次；删除对应记录 |
| 三语和外观 | 中/日/英切换，浅/深色，打开账户与订阅页面 | 关键金额、取消续费、到期日期可读，按钮不截断且行为清楚 |
| Plus 完整客户端链路 | 待提供隔离沙箱客户端环境后，从 App 开通、浏览器返回 App、查看每日额度、取消续费、账单门户 | 69/月及 400 次一致，取消后保留本期、刷新同步，回跳打开 Plus 页 |

最后一项不能用当前生产后端完成（Plus API 尚未部署），也不要用真实付款代替沙箱。浏览器沙箱生命周期已自动验收，但不替代原生 App 在用户设备上的回跳和视觉检查。应用内自动升级流程在发布更新元数据前无法走生产完整链路；本轮已有安装器回滚/启动确认自动测试，手动覆盖安装只证明安装与权限保留。

## 发布门槛

完成实机清单、正式密钥权限/签名检查、webhook 事件与门户配置、沙箱隔离后，再请求用户最终发布确认。所有生产变更须在正式授权后执行。本文件不表示现在可以直接开启 Plus。

本轮最终检查：服务端 681 项、统计专项 13 项、类型检查、后台脚本语法、git diff --check 均通过；`./scripts/verify.sh --quick` 通过，含工程检查器 51 项、服务端/调度器类型检查及隔离 smoke。证据：`output/verification/20261017T051850Z-88422/summary.tsv`。
