# 兼容账本

删除任一兼容路径需要同时满足：最低支持版本已经写明、生产证据证明旧版本流量归零、并且至少跨过两个正式版本。2026-10-16 的本地审计没有这些证据，因此下列路径全部保留。

源码版本在 `VERSION.env`。Mac 3.0 / build 27 的发布记录见 [发布执行记录](release-3.0-execution-2026-10-20.md)；本账本保留从 2.17 / build 24 升级的兼容基线。Bundle ID、偏好域和 Keychain service 都是 `com.rottesya.notchspi`。屏幕录制授权由 macOS 管理，应用不迁移 TCC。

| id | protected_data_or_client | implementation | regression_tests | removal_conditions | status |
| --- | --- | --- | --- | --- | --- |
| MIG-KEY-001 | 自定义 API Key。账户 `apiKey.<storageKey>`，claude/codex/deepseek 沿用原后缀。暂时不可读时不得用旧明文覆盖 | `Settings.swift` | `UpgradeCompatibilityTests` | 见文首 | retained |
| MIG-TOK-001 | 官方设备令牌。service `com.rottesya.notchspi`，account `official.deviceToken` | `KeychainStore.swift`、`OfficialAccountState.swift` | `OfficialAccountStateTests`、`UpgradeCompatibilityTests` | 见文首 | retained |
| MIG-HOT-001 | 快捷键迁移标记 `screenshotHotkeysV1`。多图键名仍是 `context` | `Settings.migrateScreenshotHotkeys` | `UpgradeCompatibilityTests` | 见文首 | retained |
| MIG-PER-001 | 人物像 JSON：姓名、内容和活动项 | `PersonaStore` | `UpgradeCompatibilityTests` | 见文首 | retained |
| MIG-FONT-001 | 旧 `answerSize` 字号预设 | `Theme.swift` | `UpgradeCompatibilityTests` | 见文首 | retained |
| MIG-ONB-001 | `onboardingDone`、`onboarding.v3.dismissed` | `NotchOnboarding.swift` | `NotchOnboardingTests`、`OnboardingJourneyTests` | 见文首 | retained |
| MIG-SRC-001 | 自愿来源 `attribution.voluntarySource.v1`。跳过只留在本机 | `DeviceSourceSelection.swift` | 来源路由测试 | 见文首 | retained |
| MIG-WIRE-001 | 单图字段 `image_base64` 与 `images_base64` 同时携带最后一张图 | 官方捕获请求 | `OfficialCaptureRunTests` | 见文首 | retained |
| MIG-OBJ-001 | 未携带 `result_protocol` 的客户端继续走旧提示、解析和 `MIN_BILLABLE_CHARS` | `server/src/routes.ts`、objective 解析 | objective 路由测试 | 见文首 | retained |
| MIG-PROV-001 | objective treatment 默认继承 control | provider 配置 | `provider-routing`、`objective-routes` | 见文首 | retained |
| MIG-DB-001 | 懒扩展列：`topups.note`、`devices.cli_enabled`、`onboarded`、`hotkey_presses`。旧余额首次访问建立 `legacy_unknown` | `db-postgres.ts`、`db-sqlite.ts`、`db-memory.ts` | `db`、`quota-migration` | 见文首 | retained |
| MIG-PAY-001 | 退款与恢复队列、购买会话和旧充值页 | `payment-*`、`/topup` | `checkout-reconciliation`、`payment-ledger`、`payment-finance` | 见文首 | retained |

`scripts/migrate-quota.mjs` 的 `status` 也会初始化 schema，不能当作只读探针。禁止用提交 `7ba96db` 的旧表定义直接改已经迁移的库。流程见 [quota-migration.md](quota-migration.md)。

旧 `depth` 原值保留。`reasoningEffort` 独立默认 `low`，不把旧讲解档映射成高思考档。

## 冻结平台发行来源

主树仅支持 Apple Silicon/macOS 14+。历史 Intel build 28 为 x86_64/macOS 12.3+，Catalina build 29 为 x86_64/macOS 10.15.7+；它们由独立冻结源码构建，不能从当前主树重制。
Intel SHA-256 为 b365a4e5f5afe40b40870220b709ac81175e58e0b2fdafa33126ffbbb919bc8f；Catalina 为 48ef38436629ee0f9a9ff94fb18ea7320efb3914805ce6559bf95506ece507ce。签名、公证记录和旧系统未完成的硬件验收见[历史索引](history/index.json)，不代表本轮重新验证。
现有下载行为、冻结源码、原安装包和原始证据保持；旧版手动更新/登录启动限制不因主树整理改变。


## Intel 自动更新准备

独立 Intel 3.1 候选使用 `/update/intel` 与 `/dl/intel`，最低 macOS 12.3；主线 Apple Silicon 仍用 `/update` 与 `/dl`。安装前同时核验签名、CPU 架构及最低系统，失败保留旧包。旧 Intel 3.0 无法通过服务端开启已禁用的更新入口，需手动安装一次新客户端。

2026-11-08 用户在知悉暂无 Intel 实机验收后，明确要求将已签名、公证的 Intel 3.1 build 31 设为正式 Intel 下载包。资产名为 NotchSPI-3.1-build31-Intel.dmg，SHA-256 为 52b27b1a14878fd4f773902c4706e375fad538aae2cdddf6a367a28a37801ca9；构建来源为独立 Intel 提交 304419ba7537787b6bee6387764be68dc59d2be8。交叉构建、签名、公证、Gatekeeper 和 arm64 上的兼容源码回归通过；Intel 真机安装、运行和应用内升级仍未验证。Catalina 冻结版及其手动更新方式不变。

2026-11-12 可靠性更新：Apple Silicon 3.1.1 build 32 来源 `dc4fd6523bf410e13e3f24b01ab896ee4216e131`；Intel 3.1.1 build 33 来源独立分支 `7ae277c`，仅回移相同的官方网络恢复代码与测试。已发布 3.1 继续兼容服务端；自动补回答需要 3.1.1。两个架构使用不同安装包及更新入口，保留 Bundle ID、设备凭证、偏好与所有权益。Intel 兼容代码在 arm64 主机的 59 项相关测试中 58 通过、1 项已有跳过，并完成 x86_64/macOS 12.3 交叉构建、签名和公证；Intel 真机运行及实际应用内升级仍未验证。

2026-11-12 恢复时延更新：Apple Silicon 3.1.2 build 36、Intel 3.1.2 build 37使用相同的 8 秒失联检测与 20 秒有界恢复。正常慢生成由服务端心跳保护；无需重置设备、账户、偏好或权益。Intel 实机及应用内升级验收边界不变。
