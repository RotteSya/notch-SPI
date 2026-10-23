# Win/Mac 开发闭环验收

本清单由 [HANDOVER](../../HANDOVER.md) 引用，记录尚未完成的目标；完成定义不能缩减为本机测试通过。

## 完成条件与当前证据

| 要求 | 可接受的证据 | 当前状态 / 下一步 |
| --- | --- | --- |
| 规则单一来源 | 同一源变更抵达两个实际运行时；参数、协议、状态规则有共用用例 | 已有 shared/、生成器、prove-shared-change；自动连答、取消隔离、终态结算快照新增共用用例。完整流事件序列、人物像仍需继续审计 |
| 两端行为一致 | 相同输入及事件序列下的结果、请求次数、取消/账户隔离一致 | `Tests/Fixtures/auto-session/`、`capture-isolation/`、`settlement/` 被 Swift 和 desktop 共同消费；不是所有功能均覆盖 |
| 自动验证闭环 | 当前提交的双平台 CI 成功记录，必要检查作为合并要求 | 本地完整验证已有；远端 CI 和分支保护仍需重新只读核实，禁止推送限制继续生效 |
| Windows 实机 | 绑定具体候选、系统、DPI、屏幕布局的验收记录 | 未完成。按 manual-acceptance.md 检查截图、热键、焦点、多屏、凭据与支付回跳；Mac/Electron smoke 不能替代 |
| 视觉与性能一致 | 同素材成对截图/录像，明确帧时间及允许差异 | 共享引擎和参数已有；Windows 成对视觉与帧时间证据缺失 |
| 交付可追溯 | 包内源码身份、同候选包摘要、CI 标识、验证及实机证据绑定 | Windows 入口已补候选独立目录、源码指纹与 ZIP 内核验，并完成本机离线构建验证；Mac 入口已增加包内来源与 DMG 内容对照，实际 ad-hoc DMG 正向与旧包反向检查通过；不可拿旧包附上新提交 |
| 安装与升级 | 已签名候选安装、升级保留数据、错误签名拒绝及回退记录 | Windows 未完成；正式签名、更新源和发布仍需对应授权 |

## 推进顺序

1. 确保新增行为共享用例留在常规双端测试入口，并审计剩余流/结算和人物像边界。
2. 完成 Windows 与 Mac 源码—候选—验证证据绑定，拒绝源码漂移、陈旧包和错误证据。
3. 核实远端双端 CI；在授权边界内准备变更，不能用本地工作流文件代替实际运行记录。
4. 补 Windows 实机、视觉、安装升级证据。缺硬件或授权时保留未完成，不能标记总体闭环。

当前限制：不安装新工具，不推送，不发布；没有 Windows 实机验收条件。可在已有工具下继续实现和验证共同逻辑、追溯及本地候选。

## 2026-10-23 本地追溯验证

- `output/verification/20261023T074049Z-8856/summary.tsv`：完整自动验证通过；589 项 Swift 测试中 4 项按条件跳过，Postgres、硬件、签名保留未执行状态。
- `output/cross-platform-closure/windows-candidate-offline.log`：禁止网络条件下复用本机 Electron ZIP，构建与实际 ZIP 内容核验成功；实际 ZIP 的错误内容反向检查也被拒绝。
- GitHub Desktop workflow 只读查询再次 TLS 超时；远端运行状态仍未确认。
- 本轮不构成 Mac 包追溯或 Windows 实机/安装/签名验收完成的证据。

## 2026-10-23 Mac 追溯验证

- `output/verification/20261023T075446Z-20373/summary.tsv`：完整自动验证通过；589 项 Swift 测试中 4 项跳过，真实硬件/安装/更新验收仍未完成。
- `output/cross-platform-closure/mac-candidate.log`：ad-hoc App 严格签名校验、DMG 只读挂载、包内内容摘要对照全部通过。
- `output/cross-platform-closure/mac-negative-check.json`：已有旧 DMG 被拒绝，原成功 manifest 保留，临时挂载已卸载清理。
- `dist/NotchSPI.dmg` 旧包保留；release 新包进入独立候选目录。未使用正式签名或 Apple 公证，未推送或发布。

## 2026-10-23 终态结算共用回归

- `Tests/Fixtures/settlement/cases.json` 的 20 个快照同时由 Swift `SettlementSnapshot` 和 desktop `validSettlement` 验证，覆盖结算/释放/辅助操作、版本字符串、累计用量和可选体验字段。
- 修复前 desktop 错误接受其中 6 个无效快照；修复后双端全部通过。Windows 终态查询复用账户校验，拒绝数字版本号、无效累计用量和体验数据；Mac 实现未修改。
- `output/verification/20261023T081434Z-34293/summary.tsv`：完整自动验证通过，desktop 119、server 684、scheduler 17、Swift 590（4 项跳过），arm64 Release 构建通过。
- 此证据限于终态快照校验，不代替完整 SSE 事件序列、实机或新候选包验证；此前生成的候选仍对应各自旧源码身份。
