# 本轮验证结果与剩余验收

> 验收记录始于 2026-10-19，后续更新以各段日期和关联记录为准。本文的运行状态、测试计数和待验收项属于各次记录时点；2026-10-23 的提交整理没有执行 Windows 实机验收。

2026-10-19。验证主机：Apple Silicon / macOS 27 / Node 24.16.0 / Swift 6.4。**没有 Windows 运行环境。本轮没有把交叉打包、macOS Electron 截图或单元测试当作 Windows 实机通过。**

## 已执行

| 检查 | 结果 | 证据 |
|---|---|---|
| 原有完整 `scripts/verify.sh` | 通过 | `output/verification/20261019T082735Z-55887/summary.tsv` |
| Mac Swift 全量 | 585 项，4 项原有环境跳过，0 失败 | 同目录 `swift-tests.log` |
| 原有服务端 / scheduler / 工程自检 | 683 / 17 / 51 项通过 | 同目录各日志 |
| Mac arm64 Release / 资源 / 13 条路由 | 通过 | 同目录 `release-arm64.log` 等 |
| 桌面检查、共享生成一致性、协议与端到端 | 68 项通过 | `output/windows-node-tests.log` |
| 单一来源 4→5 秒与共享阅读字号 15→16 的真实跨运行时回归 | 通过；主项目保持原值 | `output/shared-change-proof/result.json` 和 4 份日志 |
| 桌面启动 | Electron 在 macOS 上启动、renderer 进入可见完成态 | `output/windows-desktop-smoke.log`、`desktop/test-output/launch.png` |
| Windows x64 ZIP 交叉打包 | 已生成，EXE 为 PE32+ GUI x86-64 | `output/windows-build-final.log`、`desktop/dist/` |
| 打包内容核验 | ASAR 源码与工作区一致；运行依赖齐全，fixture/test 不进入包；ZIP SHA-256 已记录 | `output/windows-delivery/manifest.json` |
| 生产运行依赖安全检查 | 高危阈值检查通过 | `output/windows-dependency-audit.log` |
| AppKit / Electron UI 实际操作 | 答案浮层、展开/收起、五页导航、保存无限上限、中文人物像保存 | `evidence/`；桌面截图只来自 macOS |
| 桌面 UI 到本地服务端 | 实际操作注册刷新 → 0 次 → 主动领取 → 400 次 → 导入题图 → 流式结果；本轮另走通真实屏幕截图→首题→两图→自动提交→成功→结束引导 | 本地 memory/mock/stub，未连接生产；模型为明确 fixture |

NSIS 初次在 Apple Silicon 交叉构建失败，原因是 electron-builder 的 macOS `makensis` 辅助程序为 Intel，系统没有相应执行条件。脚本已改为 macOS 生成 ZIP，Windows runner 生成 NSIS + ZIP，未安装 Rosetta 或修改系统设置。**Windows CI 工作流已写入但未推送/实际运行，NSIS 安装包还不能标为已验证。**

最新工程健康检查也通过；HANDOVER 接近原有篇幅预算，因此 2026-10-17 的历史段落已**原样移至** `docs/settings-iteration-history-2026-10-17.md`，保留全部原始文字及证据链接。

新增默认路径共享迁移专项 **92 项通过**：`output/windows-final-visual-regression.log`；其后共享引导专项 **44 项通过**（`output/windows-onboarding-native-regression.log`），最终原生 arm64 Release 重建通过。逐帧/透明窗口及实际操作证据见 [本轮报告](motion-and-shared-ui.md)。

## 查题回归覆盖

桌面端不是一个只显示演示结果的壳：发行默认调用原官方 API，测试调用现有 `server/src/index.ts` 构建的真实 Fastify app，使用真实 JPEG 输入和实际 HTTP/SSE。仅模型提供者替换成可控 fixture。

- 注册 singleflight、持久幂等尝试 ID、主动体验领取，不隐式领取。
- 多图顺序、末图目标、冻结请求、screen_query/objective 配置、请求体大小上限。
- ready/review 成功扣 1；retake/无结果/provider failure 扣 0；相同 capture ID 不重复扣费。
- 取消中止流、阻止陈旧回调，不启动自动状态查询/重放；流截断保留合法余额回执，但不把部分结果作为成功。
- 状态查询、补取 ID 与父题绑定、恢复后的答案 ID、解释绑定，辅助操作不再次扣费。
- 401 保留恢复凭据、非法新凭据不替换旧凭据、402 不调用模型、不隐式领体验、旧 owner 不覆盖新账户。
- 客观题共享 fixtures、机器标记及分块前缀不外泄，非法 JSON/字段/结束顺序失败关闭。
- UTF-8/CRLF/BOM/SSE 分帧、事件与总字节上限、余额版本单调。
- 自定义 OpenAI/Anthropic 请求与结束判定，token cutoff/截流不能成功；CLI 拒绝相对路径与 shell 脚本。
- 多图取消/预览/删除/撤销、动效公式、自动连答上限与稳定检测、人物像全角题号/上下文屏障、历史淘汰。

本轮未使用真实云模型或个人 API key，未执行付费推理、购买或订阅。真实模型识题准确性与端到端耗时仍需以相同题图、账户和配置做双平台实测。

## 明确的平台差异与缺口

| 项目 | 当前实现及影响 | 验收条件 / 后续工作 |
|---|---|---|
| Windows 启动 | EXE 已打包，尚未在 Windows 执行 | Windows 10/11 x64 交互桌面运行 ZIP 和 NSIS |
| 字体/尺寸 | 系统字体回退，600 CSS px 与 AppKit pt 对齐；部分设置行、控件、字距仍有差异 | 100/125/150/200% DPI、中英日长文本，对照截图修订 |
| 动效 | 主形变、反转、透明度使用同参数；没有 Windows 帧时间证据 | 60/120/144 Hz 下录制展开/收起/快速反转/加载 |
| Ghost | 已迁移完整引擎；7,200 帧与原 Mac 引擎一致，Mac 生产路径已消费共享引擎 | Windows GPU/刷新率下的渲染帧时间与实际材质对照 |
| 截图飞入 | 已实现每屏穿透面板、680 ms 共享轨迹、动态目标、取消/删除、180 ms 减少动效、220 ms 落地/重排；真实透明层像素与清理 smoke 通过 | Windows 多屏、负坐标/竖排、125–200% 混合 DPI、DWM/WGC；本机只有一个物理屏幕 |
| 屏幕/窗口目标 | Windows 以系统可捕获窗口 ID 选择，窗口重建须重选；不是 Mac 应用 bundle 语义 | WGC、最小化/关闭/重开、不同 DPI、多屏/竖排/负坐标、任务栏布局 |
| 浮层/模糊 | 黑曜石面板与透明窗口；背景/噪点/阴影采用 Web 等效绘制 | DWM、全屏/虚拟桌面、睡眠唤醒、HDR 和对比度检查 |
| 截图排除 | Windows 刘海和飞入保持显示并使用 contentProtection，属性变化后重施保护；普通设置/历史可截图。见 [10 月 21 日记录](visible-capture-2026-10-21.md) | Windows 10 2004+ 实际像素回归、连续取帧无闪烁、多屏/混合 DPI 和外部工具仍待实机；安全桌面不捕获 |
| 热键/输入 | Ctrl 替代 Command，可改键、冲突回滚；录制时暂停全局键 | Windows IME、键盘布局、系统占用、输入焦点和 Esc |
| 引导 | 已补齐真实单图/多图练习、结果推进、主动体验、权限/失败、返回/关闭/恢复；检查点两端共用；Mac保留原生视图 | 本机真实截图→本地服务→两阶段结果→体验状态→结束已操作通过；Windows继续核对系统权限与热键 |
| 凭据 | Electron safeStorage，Windows 为系统用户绑定保护；无明文降级 | DPAPI、跨用户/漫游、损坏文件、锁屏/恢复及恢复码流程 |
| CLI | 真实进程与图片输入，Windows 使用原生 taskkill /T /F 取消所属进程树；参数/归属测试通过 | Windows 原生 Codex/Claude 实际安装与子进程、超时测试 |
| 付款回跳 | 已接入原 Mac/server 的 notchspi://plus 与 //account，冷启动/二次实例打开账户并从服务刷新；URL 不授予余额/身份 | Windows 协议关联与 Stripe 沙箱实际回跳；未执行购买 |
| 更新/发布 | 已有显式检查/下载/安装及签名校验配置；当前候选无签名源，按钮禁用 | Windows 证书、HTTPS 更新桶、NSIS，验签、篡改拒绝、升降级/回退实测 |
| Mac UI 共享 | 默认产品路径已消费共享 Ghost、飞入/卡片、阅读结构；原生选择/滚动/公式保留 | 设置、引导与平台绘制仍有独立适配边界 |

上述缺口是继续开发/验收项，并非降低验收标准后的“通过”。当前不建议作为已完成全面体验对齐的正式版本发布。

## Windows 重复验收序列

1. 从同一 Git 提交安装依赖、运行 check/smoke、生成 ZIP/NSIS；启动两个产物并验证图标、版本、卸载保留用户数据。
2. 同样输入与配置，对照 Mac 的单图、2/4 张、多图删除/撤销/预览、等待时新增截图和取消。
3. 实际模型检查数学公式、多选、需重截图、无题/多题；同时验证服务断流、超时、401/402/429/5xx、恢复和解释。
4. 逐项运行上表的 DPI、显示器、快捷键、截图排除、系统字体、辅助功能、动效检查，保存截图/录屏及环境版本。
5. 使用签名沙箱发行验证升级、错误签名拒绝、恢复码和付款回跳后，才将这些项目改成通过。

Postgres 16/17、真实硬件权限、Mac 签名公证未在本轮重复执行；现有不可变发行证据未改写。
