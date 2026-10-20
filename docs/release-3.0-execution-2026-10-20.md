# 3.0 发布推进记录（2026-10-20）

状态：发布准备已推进，**尚未公开发布**。用户明确暂不升级 Neon 付费套餐，继续完成其余准备。生产数据库业务检查仍失败，不能将存活检查 200 当作业务恢复。

## 已完成

- 建立隔离发布分支 `codex/release-3-0`，运行代码提交 `a62d11d2b3012c12bccdf396f430a94e308fc17e`；[草稿 PR #13](https://github.com/RotteSya/notch-SPI/pull/13)。发布分支客户端与已公证 build 27 来源 `8b4f3f0` 完全一致，未带入主工作区正在进行的客户端及 Windows 改动。
- 保存数据库恢复修复：Serverless 关闭内部维护计时器，常驻及 Cloudflare 维护间隔 15 分钟，`/readyz` 鉴权、只读且限时。
- [CI 39374531338](https://github.com/RotteSya/notch-SPI/actions/runs/39374531338) 的 11 项全部通过，包含 macOS、Node 22/24、PostgreSQL 16/17、scheduler、Linux 原生资源及 Vercel 函数构建。79 个后端快照文件逐个与提交内容核对一致。
- Vercel 候选 `dpl_89kTAbxvVVMx3npLgUSZW9nr2QCN` 构建 READY，使用生产环境但 `--skip-domain`，没有分配正式域名。候选 `/healthz` 200，未鉴权 `/v1/plus` 与 `/readyz` 均为业务层 401。**尚未执行候选的数据库迁移或真实业务验收。**
- 生产 Stripe 两个敏感变量 `STRIPE_SECRET_KEY`、`STRIPE_WEBHOOK_SECRET` 的 target 已收窄为 Production；新增生产 `PLUS_ENABLED=0`。回读确认成功。Preview 若再次使用，须独立配置沙箱密钥、对应签名密钥和独立数据库。
- 正式 webhook `we_1TslR1DLfLoLVRGJXChtUW6u` 已从 13 项扩为 21 项，并以 Stripe 只读 API 回查完整并集。保留原题包/退款/争议事件、端点 URL、签名密钥和 API 版本 `2026-06-24.dahlia`。新增 Checkout 过期、订阅创建/更新/删除、发票付款/失败/需认证/作废 8 项。
- 正式默认账单门户 `bpc_1USVW9DLfLoLVRGJlqS78rD4` 已创建并 API 回查：`active=true`、`is_default=true`、`livemode=true`。发票记录、更新付款方式、期末取消开启；取消不按比例退款；套餐/数量更改、暂停、取消原因收集关闭。标题为「NotchSPI Plus 订阅管理」，返回 `/purchase/complete?product=plus`。保留界面默认的客户账单信息更新功能。
- [v3.0 Release 草稿](https://github.com/RotteSya/notch-SPI/releases/tag/untagged-eb0f8f8c9317224cd744) 已上传 `NotchSPI.dmg` 及 `SHA256SUMS.txt`，目标固定为 `a62d11d2b3012c12bccdf396f430a94e308fc17e`。GitHub 资产回读 SHA256 与本地已公证 DMG 一致：`7759d26f03fa10e60edf3c51b8500196da37328aafd9f609701146a2f0de00d6`。

- 正式受限密钥 `checkout`（`mk_1TslOoDLfLoLVRGJV2YOllH1`）的四项新增权限已获用户批准；用户完成 Stripe 身份验证并保存后，重新进入编辑页面逐项核对：Customers / Invoices 为读取，Subscriptions / Customer Portal 为写入；原有 Checkout Sessions 写入仍在。未新建或轮换密钥。

## 尚未完成

1. **候选实际支付密钥验证**：受限密钥 `checkout` 的四项新增权限已保存并回读确认。Vercel 敏感值不可回读，尚未证明它就是候选实际使用的密钥；恢复后仍须用实际服务凭证验收 Checkout、订阅和门户调用。
2. **生产数据库恢复**：用户本轮明确暂不升级付费套餐。2026-10-20 13:25（北京时间）复查 `/stats` 仍 500，正式 `/v1/plus` 仍 404。正式域名仍指向 `dpl_BiBGvjAazTWsmMqfUsgLWzuTBa6s`，`/update` 仍公开 2.17；候选没有覆盖生产流量。
3. **恢复后的验收**：保存数据库备份/恢复点；验证 SELECT 1 和授权 `/readyz`；执行兼容迁移；核对既有账户、题包余额、体验领取、真实解题成功/失败扣费、重试与恢复任务。用实际服务密钥验证 Checkout、订阅读取/取消及门户，验证 Stripe 的真实签名投递，不以健康探针或未付款测试事件替代。
4. **实机升级验收**：2.17 覆盖安装到 3.0 build 27、账户/设置/权限保留、拒绝录屏后的恢复、物理快捷键、跨屏及休眠唤醒仍需完成对应实机记录。Apple 签名、公证和身份兼容检查已经通过。

## 后续放行顺序

数据库恢复后，按 [生产方案](plus-3.0-production-plan.md) 完成上述验收。先把兼容后端切到正式域名，保持 `PLUS_ENABLED=0`；正式业务/支付和实机验收通过后启用 Plus 并部署验证，最后发布 GitHub 草稿、核对 `/update` 和 `/dl`。公开资产名必须为 `NotchSPI.dmg`。

若 Plus 上线后出现问题，用 `PLUS_ENABLED=0` 重新部署兼容后端以停止新购，继续接收回调、同步已付权益并提供取消续费/门户；不要回退到不识别 Plus 的旧后端或恢复数据库覆盖已付款记录。

本轮没有数据库付费升级、真实扣款、正式域名切换、Plus 新购开放或公开 Release。完整无密钥证据在 `output/release-3.0-execution/`。之前审计的时间点见 [发布前检查](release-3.0-preflight-2026-10-20.md)。
