# 3.0 发布执行记录（2026-10-20）

状态：**3.0 build 27 已于北京时间 14:30:49 正式发布，Plus 已开启。**

- [公开 Release v3.0](https://github.com/RotteSya/notch-SPI/releases/tag/v3.0)
- [正式下载](https://notchspi-api.vercel.app/dl)
- 正式后端：`dpl_7umrG4fqNEHW3qiPBCm6YAWdBYYk`。生产 `PLUS_ENABLED=1`，正式 `/v1/plus` 已回读 `available=true`、CNY 6900 分/月、每日 400。
- 运行源码/发布标签：`a62d11d2b3012c12bccdf396f430a94e308fc17e`；客户端与已公证 build 27 来源 `8b4f3f0` 相同。主工作区后续 Mac/Windows 改动未带入此次发布。
- [PR #13](https://github.com/RotteSya/notch-SPI/pull/13) 保存发布分支。代码 CI 的 11 项任务全部通过：[39375842119](https://github.com/RotteSya/notch-SPI/actions/runs/39375842119)。正式后端 79 个文件与隔离发布源逐个比较一致。

## 数据库与费用

用户已批准并自行完成 Neon Launch 升级。Vercel 与 Neon 回读确认 Launch。生产节点 `ep-shy-mouse-aty2l0xy` 已从升级后的 0.25–8 CU 收窄为固定 **0.25 CU**；保存后重新进入编辑页确认最小/最大均为 0.25，**空闲 5 分钟休眠**开启。

组织每月费用提醒已设为 **$10**；80% 与 100% 发邮件，不停止服务，不构成账单上限。10 月 31 日 10:00（北京时间）的用量复查任务 `notchspi-neon` 已创建，不自动降级。既有 Cloudflare 维护周期为 15 分钟。

已创建 main 发布前手动快照：`main at 2026-10-20 06:10:00 UTC (manual)`，页面确认共 2 个快照，保留原有 9 月快照。未执行生产恢复。当前快照尚未做恢复演练或独立 pg_dump 导出；本地/CLI 下载的数据库敏感变量是占位符，备份脚本在身份检查时停止，未改写生产数据。

Neon SQL Editor 只读事务确认 SELECT 1=1、数据库 neondb、52 张 public 表。发布前基线：89 个账户、负余额 0、总余额 10106、题包记录 4。这是当前基线，不代表已逐行比对历史数据。验收随后新增一个 release-qa 账户。

## 实际验收证据

- 用户回复「测试正常」，确认所询问的签名 build 27 覆盖旧版、账户/设置保留、截图解题、拒绝录屏后恢复、快捷键及休眠唤醒。此为用户实测确认；不额外声称 macOS 14 或外接屏专项已验收。
- 带正式 CRON_SECRET 的 `/readyz`：200、database=available；`/stats` 恢复 200。
- 候选注册和账户查询 200；先提升兼容后端且保持 Plus 关闭，再完成验收后启用 Plus。
- 正式体验领取：200，72 小时、每日 400。使用独立 QA 账户调用正式模型，测试题正确返回 B / 60 km/h；SSE 完整，成功扣 1 次，余额 400→399，held=0。
- 同 capture ID 重试返回 409；非法图片返回 400。之后账户仍为余额 399、累计成功 1、held=0，无重复扣次。此项验证输入失败不扣费；供应商故障/并发边界由已有自动化测试覆盖，未人为制造生产供应商故障。
- 实际部署 Stripe 密钥在 Vercel 生产构建环境中完成 Checkout、Subscriptions、Customers、Invoices、Portal Configurations 五项只读请求，全部 200；仅记录状态码，不输出密钥或客户信息。
- 在未绑定正式域名、Plus 开启的同源部署创建真实 live Checkout，返回 200。确认 unpaid、无 subscription 后使该 QA 会话过期。Stripe 真实签名事件投递到正式后端；直接只读查询数据库确认 `checkout_expired`，期间未调用会主动同步的 Plus 查询接口。没有付款。
- 缺失签名的 webhook 返回 400。现有 webhook `we_1TslR1DLfLoLVRGJXChtUW6u` 保留 URL、签名密钥、API 版本和既有事件，已扩至 21 项并回读。
- 正式默认门户 `bpc_1USVW9DLfLoLVRGJlqS78rD4` 配置已回读：发票历史、付款方式更新、期末取消开启；不按比例退款，套餐变更/暂停关闭。
- 正式账户没有可用客户记录，因此未创建真实客户门户。对明确不存在的测试资源调用门户创建和订阅取消接口，分别得到 400/404 `resource_missing`，未出现权限拒绝，也未修改任何客户或订阅。这是权限探测，不是付款后门户/取消续费端到端验收。
- 临时构建探测脚本仅用于无正式域名的检查部署，已从部署目录移出；正式部署不含这些脚本。

## 公开交付核验

GitHub Release 已非草稿、非预发布，标签 v3.0。公开 `/update` 返回 version=3.0、tag=v3.0；`/dl` 实际下载 200、9,488,632 字节，SHA256 与签名公证产物及 GitHub asset digest 一致：

`7759d26f03fa10e60edf3c51b8500196da37328aafd9f609701146a2f0de00d6`

用户从 2.17 升级须手动安装一次；3.0 起使用新的应用内安装器。公开更新元数据可有最长 10 分钟缓存。

## 验收范围与后续

未做生产实际扣款、付费订阅激活、续费和真实客户取消的端到端验收；未擅自付款。生产 Checkout 创建、未付款签名回调、实际密钥权限以及已有沙箱/自动化覆盖已验证。首次真实订阅仍应核对 Stripe 已付发票、本地权益和取消续费状态，不将未付款事件写成付款成功证据。

若新购异常：将 `PLUS_ENABLED=0` 并重新部署当前兼容后端；保留 webhook、已付权益同步与取消/门户。不要回退到不识别 Plus 的旧后端，不要通过恢复数据库覆盖付款记录。

无密钥执行证据在 `output/release-3.0-execution/`；QA 凭证文件仅存于受限的 ignored `recovery/private/`。历史检查见 [发版审计](release-3.0-preflight-2026-10-20.md)。
