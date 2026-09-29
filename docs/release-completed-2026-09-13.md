# NotchSPI 2.12 正式发布记录 · 2026-09-13

2.12 / build 19 已正式发布，后端与公开下载已通过实际验证。用户接受既有阅读质量限制及 p95 延迟偏差，并于本轮明确授权“可以接受，线上线”；本版保留数值闸门失败事实，按该授权发布。

## 正式状态

- 后端公开可用时间核验：2026-09-13 17:37:00（上海）；GitHub 正式版发布：17:37:39。
- 生产部署：`dpl_A5L92kn48vnM74ijEtD8jRGZ7qHL`；运行源码 `5c6dfbf819eaaf3db05f9868839af954fbfd7b9d`。
- 兼容回退：`dpl_CpQm3LAEKGqrby8LnVjNM7b44M8x`，同一已验证运行源码，关闭新查题/解释范围；健康检查与配置实测通过。
- 发布标签 `v2.12` 指向 `804ae33496072180ce0c82dee9a8a6ca5cdd16c7`；该提交在已验证运行代码上仅增加发布文档、生产配置记录和关闭 Git 自动部署。
- [正式下载](https://notchspi-api.vercel.app/dl)、[发行页](https://github.com/RotteSya/notch-SPI/releases/tag/v2.12)。`/update` 实际返回 `2.12` / `v2.12`。
- Git 自动部署已关闭，后续须显式部署已验证产物再 promote；60 项生产环境变量已保存，非生产作用域保留。敏感值通过受控提交成功确认，其余值逐项解密比对一致。

## 实现与验证

答案优先显示、按需解释、框选一道目标题、最多三张补充材料、请求状态恢复、重复请求保护、异常额度回收、新设备固定 30 题、历史额度保留、模型费用硬上限已集成。另修复截图超时/取消与材料清理，以及 Stripe `py_` 非卡付款编号兼容。

运行源码的 CI `34742428452` 已 10/10 成功：Node 22/24 各 571 项；Postgres 16/17 × Node 22/24 各 693 项；Swift 317 项通过、4 项条件跳过、0 失败；Swift Release 编译按 warnings-as-errors 通过；Cloudflare 调度器 17 项通过。类型检查、依赖审计和打包检查通过。日志和摘要保留在私有证据目录，不将敏感内容加入仓库。

原生安装包 3,074,090 字节，SHA-256 `f5079b8a195b744872f378c62619a6a05b3c5a31cbc73484a98e05f97e84de11`。Apple 公证 Accepted：`323f7634-60b2-4fe2-b916-9259f0b1b27a`；staple、签名与 Gatekeeper 验证通过。从正式 `/dl` 下载的文件摘要再次完全一致。

生产实际检查通过：DeepSeek 双通道、Postgres、Stripe/webhook；注册重试返回同一设备与一次 30 题；账户余额 30、held 0；新配置/reading_practice 范围生效；日元题包为 100题/300 JPY、300题/800 JPY、1000题/2200 JPY；回收接口未鉴权 401、已鉴权 200。未创建真实收费/退款测试，也未追加模型调用。

## 数据库与运行维护

17:10:57 开始维护，排空旧实例后重设生产角色密码并重启计算端点。旧连接及旧密码直连/连接池写入均失败，新凭据正常。最终备份 52,898 字节，SHA-256 `a9426b211945cade4a860f88c5751720777b446f315e8a6c536ec3fb5d512507`，已在独立分支的新库 `notchspi_release_restore_20260913` 实际还原。

隔离后、备份、独立还原、迁移后五张原表逐字段摘要一致：44 个原账户、4 条充值、1108 条使用记录均保留。迁移完成 44/44 账户校验；上线前加入一台 QA 设备后，45/45 全部校验，状态 active / revision 2，未校验账户、持有请求和运行尝试均为 0。独立 AI 子代理只读复核通过。

维护中已解决的工具问题：pg_dump 默认寻找不存在的本机 root.crt，改用系统可信根且保留 verify-full 后备份成功；Vercel 项目暂停也禁止构建，改为临时全入口登录保护后恢复构建，promote 与生产 ID 核对后恢复原公开策略；PATCH 返回未含 production target，随后独立 GET 与公网健康确认成功。所有首次失败和后续验证分别留档。

回退必须使用上述兼容部署和当前数据库，禁止恢复旧密码、回滚到旧写入程序或用旧备份覆盖上线后的新记录。当前生产连接的私有记录位于 `.release-evidence/2026-09-13/production-release/private/production-new-connection.json`，历史凭据证据不代表有效连接。

## 模型质量与预算

408题、80解释、2项拒绝测试和 240+240 旧范围对照已全部执行完。它们是已见材料回归，不能称作新盲测。旧范围 treatment 正确 200/204；解释 79/80。多选仍有实际漏选，阅读协议与风险识别仍有未达原门槛项；延迟 p95 的完整 240 样本界为 8661–8677ms，对照 7314ms，增幅 18.42%–18.64%，未通过原 +10% 门槛。用户已接受这些已披露限制。详细逐题记录见既有全量回归文档。

同一账本 2003 条派发的累计保守占用为 **25.905667 / 27 CNY**，剩余 **1.094333 CNY**；未知项保留原最高额。它是保守核算，不等于厂商最终账单。本轮部署验证额外模型调用 0，未重置或重算预算。

正式配置为 DeepSeek Flash / low，回答上限 4096、解释上限 2048；**上海自然日模型费用最多 20 CNY**，单次保守预留 3 CNY，服务器费用另算。不是每天固定扣 20 元。已有首周费用复查自动任务保持 ACTIVE，以本次真实上线时间开始计算七天，只读观察、不自动提高预算。

## 运维证据入口

本机证据根目录：`native/.release-evidence/2026-09-13/production-release/`（项目总目录下）。关键记录：`qualification.json`、`production-isolation-final.json`、`backup-manifest.json`、`independent-restore-history.json`、`production-migration.json`、`migration-resumed.json`、`verified-candidate.json`、`verified-rollback.json`、`project-environment-persisted.json`、`public-health.json`、`github-release.json`、`public-release-verified.json`、`test-budget-final.json`。初次上线后的生产 error 日志查询成功，返回 0 条；这是已查询时间窗的结果，不代表未来永不出错。


## 免费定时任务实证

Cloudflare `notchspi-reaper` 已启用每分钟一次，账户计划未升级，公开 Worker URL 与预览 URL 仍关闭。17:37:19 保存定时配置；实际 scheduled 日志确认 17:40:36、17:41:36、17:42:36 连续三次触发，每次间隔 60 秒、接口 HTTP 200、运行 outcome ok，恢复/支付/财务失败计数均为 0。首次配置传播约 3 分 16 秒，不能算作即时触发。

生产 QA 账户实际制造一笔 15 秒有效期的持有，余额 30→29、held 1；只读观察确认到期约 38 秒后自动释放，余额回到 30、held 0，仅一条 hold 和一条 release，模型尝试 0、使用记账 0 题/0 token。该释放先于 Cloudflare 首次日志，来自服务端自动恢复，不能冒充 Cloudflare 单独触发；Cloudflare 后续三次真实调用均已独立验证成功，processed 0 表示当时没有待回收请求。

证据：`production-scheduler-activated.json`、`production-scheduler-first-ticks.json`、`scheduler-reservation-created.json`、`scheduler-reservation-recovered.json`。定时配置、真实调用、额度到期恢复和发布下载检查均已完成，无待用户确认的发布阻塞。
