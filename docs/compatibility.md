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
