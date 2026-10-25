# 日常流程对齐记录 — 2026-10-25

分支 `codex/win-mac-parity-review`。本轮承接已有引导修改，未提交、推送、发布或安装工具。以原生 Mac 现有流程为准，未修改 Mac 产品界面与交互代码。生成的 Swift 共享源和新增 XCTest 仅用于共用规则验证。

## 已修改

| 场景 | 原差异 / 风险 | 本轮处理 |
| --- | --- | --- |
| 多图 | 计数、提交/取消和下一张位置不符合原生托盘；捕获时仍能操作图片 | 数量及提交/取消移到托盘顶部；不足两张禁用提交；捕获时禁用提交、删除和撤销；未满四张显示下一张占位 |
| 预览与倒计时 | 预览、删除与撤销后界面倒计时可能滞后，删空后不再轮询 | 状态发送时同步截止时间；预览暂停自动提交；删除正在预览的图退出预览；关闭预览重新计时 |
| 自动连答 | 停止自动同时取消当前题；待核对结果仍可能继续截屏 | 顶部停止自动胶囊保留当前题；需核对结果暂停后续自动截屏，菜单确认后继续；保留超时退出 |
| 取消 | 旧答案可能遮住取消反馈 | 显示本轮已取消；取消多图清空本轮图片，避免退出后提交 |
| 答案阅读 | 新答案和流式更新可能改变阅读位置；复制入口不同 | 首次答案默认回顶部，手动阅读时保留位置，回到末尾恢复跟随；复制改为原生菜单及键盘入口 |
| 错误/重试 | 保留的旧答案盖住错误；重试不保留截图类型 | 错误、重拍、空结果优先显示反馈；解释失败保留原答案同时显示错误；重试保留单/多图类型并继续受结算状态保护；提供补图和清空 |
| 动效 | 状态变化缺少原生的短淡入 | 状态文字 160 ms 淡入；保留现有共享截图飞入、落位、重排、收起动效和减少动态效果支持 |

主要文件：`desktop/main.mjs`、`desktop/ui/app.mjs`、`desktop/ui/style.css`、`desktop/ui/daily.mjs`、`desktop/core/daily-session.mjs`、`shared/ui/capture.mjs` 及对应生成文件。测试新增 `desktop/test/daily-presentation.test.mjs`、`desktop/test/daily-smoke.mjs`、`Tests/NotchSPITests/DailyPresentationParityTests.swift`；`desktop/package.json` 增加日常冒烟入口。

## 验证及证据边界

- 实际打开了独立 Mac QA 原生进程，观察完成答案和双图收集界面及辅助功能节点；它采用现有原生代码与离线样例，不等于已安装版本的全部运行证据。随后设备锁屏，未完成逐步骤原生复核、保存成对截图或录屏。QA 进程已退出。
- Electron 在当前 Mac 宿主离线运行三语、14 种状态，共 42 个界面场景；检查旧答案遮挡、按钮禁用、数量与占位、自动停止入口及控件纵向裁切。另实际调用自动停止和取消逻辑，验证保留答案/清空本轮。该测试不是真实查题网络测试，也不构成 Windows 截图证据。
- `npm --prefix desktop run check`：272 项通过，无跳过。共用状态规则额外由 Swift XCTest 与原生 TutorModel 对照。
- `npm --prefix desktop run smoke:guide`：通过。`smoke:daily`、`smoke:motion`：通过。动效冒烟验证程序行为，不能证明双端主观节奏相同。
- 完整记录：`output/verification/20261024T160828Z-13568/summary.tsv`。Swift 执行 602 项（原有条件跳过 4 项，0 失败），Mac arm64 Release 编译通过；server 684、scheduler 17、仓库健康 61、路由 13 项通过。完整运行时 desktop 为 271 项，之后新增自动审核暂停用例及末轮修改，单独复跑为 272 项。
- **整套 verify 未通过**：scheduler 已装 `undici 7.29.1`，锁文件要求 `7.30.1`。未安装、更新依赖或放宽检查。Postgres 未配置测试地址；硬件验证 blocked；签名不是本次构建范围。
- Windows 编译/打包未执行；Windows 实机未验证。Mac Release 编译成功不能替代 Windows 构建结果。

截图原始输出：`desktop/test-output/daily-parity/`，`results.json` 明确标注宿主 darwin、windowsRealDevice=false。供查看的中文截图另存 用户截图目录下的 `NotchSPI-daily-20261025/`，前缀 `electron-mac-host-`。没有成对 Mac/Windows 截图，不宣称完全一致。

## 待验收（不可用自动测试替代）

1. 解锁 Mac 后，在同语言、同题图、相近显示尺寸下逐步补原生与桌面端截图：单图、双图、四图、预览/删除/撤销、答案长文本、错误/重试、取消。
2. Windows 实机：真实截图飞入位置与节奏；展开收起、悬停、焦点、快捷键、鼠标穿透；DPI/多屏字体、透明材质、截图排除。现有平台实现及保护开关保留，本轮未改 Windows 原生窗口保护模块。
3. 真实自动连答：停止时正在解题、待核对暂停/确认、达到上限、退出/超时；真实错误结算恢复及重试，避免重复提交。
4. 录屏比对飞入、落位、图片重排、从大图变紧凑参考图、流式文字滚动；现阶段只完成宿主冒烟，未完成双端视觉验收。
5. 系统必需差异单列：快捷键 Command/Control 名称、系统权限入口和弹窗、原生菜单/字体渲染。布局、间距、按钮显隐与行为仍按 Mac 验收，不能归因于平台不同。

复现命令（使用现有依赖，不安装）：`npm --prefix desktop run check`、`npm --prefix desktop run smoke:daily`、`npm --prefix desktop run smoke:guide`、`npm --prefix desktop run smoke:motion`、`./scripts/verify.sh`。

## 解锁后的补验

已补存原生 Mac QA 截图：`native-mac-collecting-2.png`、`native-mac-preview.png`、`native-mac-answer.png`、`native-mac-canceled.png`、`native-mac-error.png`，均位于上述 Screenshot 目录。它们与 `electron-mac-host-*.png` 可用于当前实现的同语言状态对照，但题图样例、窗口截取边界不完全相同，不是像素一致验收，也不是 Windows 实机证据。

实际操作结果（原生 `intake-review` 离线夹具）：自动进入两图预览 → Esc 关闭 → 标题恢复“4 秒后查题”；另一次关闭后点击“取消本轮” → 题图和提交/删除控件消失 → 显示“已取消”和“本轮已取消。按快捷键开始新的截图。”。不取消的一轮正常进入离线答案。静态 `collecting-2` 场景只能看布局，不能当作完整交互夹具；本次操作验证使用 `intake-review`。

新确认的差异与状态：
- **已补修**：错误状态缺少“截屏查题”，现与 Mac 一样按“多图查题、截屏查题、清空题图与答案”提供入口；三语日常冒烟加入入口顺序断言。
- **当时发现，现已修复实现并完成 Mac 宿主验证**：Mac 独立预览与 Electron 内嵌预览的差异，处理见下方续修记录。
- **当时发现，现已续修**：答案卡片底部留白与错误动作容器已调整，见下方；字体、材质和 Windows DPI 的最终外观仍待 Windows 实机验收。
- 解锁阻碍已解除；仍未形成逐帧动效录屏或 Windows 证据。上述“未完成逐步骤原生复核”的范围缩小为剩余场景，不再因锁屏阻塞。

补修后验证：桌面 check 272 项通过；日常三语 42 场景及引导冒烟通过。此次仅修改 Electron 入口和对应测试，未重新构建 Mac；上轮完整 verify 的依赖版本阻碍未变化。


## 独立预览、容器、留白和动效续修

本轮实际改动：
- 新增 `desktop/core/image-preview.mjs`，按原生 QuestionImagePreview 的屏幕余量、最小尺寸和图片比例计算窗口内容尺寸，复用原生三语标题与提示。`desktop/main.mjs` 管理独立预览 BrowserWindow，允许缩放、不提供最小化操作，复用 sandbox/contextIsolation 和现有截图排除注册。Mac 宿主非 QA 的预览同样开启内容保护。
- 预览图片不再覆盖刘海。原生标题栏关闭和 Esc 都释放预览状态；两图以上从关闭时重新计 4 秒；Delete/Backspace 删除预览中的图片，关闭窗口，不足两张不自动提交。捕获期间不允许删除。取消/换题清理旧窗口。
- `desktop/ui/app.mjs`、`style.css` 将日常操作按钮移到内容卡片外、刘海内部；保留引导自身操作区。答案的紧凑题图条去掉多余 8 px，状态提示保留原生对应行高和题图条高度。错误按钮保持多图、单图、清空顺序。
- 内容卡片进入时按共享 referenceDuration=320 ms 淡入；流式重绘延续最初时间线，不重新启动。状态文字 160 ms、截图落位/重排 220 ms、图条交接 320 ms 沿用已有参数；减少动态效果时跳过淡入。展开/收起和飞入继续使用原有共享动画与窗口保护。
- 清除旧内嵌预览样式，防止独立窗口出现额外边框/留白。未修改 Mac 原生体验。

实测：通过 CUA 实际点击桌面端题图打开独立窗口，观察独立窗口标题、图片和 Esc 提示；按 Esc 关闭，辅助功能焦点回到主刘海的“预览截图 1”。截图为 `electron-mac-host-independent-preview.png`。原生参考仍为同目录 `native-mac-preview.png`。二者题图尺寸不同，按图片适配窗口，因此窗口大小不应直接按像素比较。

回归：`image-preview.test.mjs` 新增 2 项（总计 274 项）；`daily-smoke.mjs` 除三语 42 场景外，还真实创建 BrowserWindow，检查暂停、Esc、Delete、原生 close 事件及恢复计时。首轮抓到关闭事件异步时序，测试改为等待实际 closed 事件而非同步断言；没有跳过或放宽状态断言。引导和截图动效冒烟继续运行。

剩余验收边界：Windows 原生标题栏、焦点返回、混合 DPI、透明/鼠标穿透、独立预览截图排除仍需 Windows 实机确认；Mac 宿主验证不能替代。没有双端同步录屏，动效结果为可复现操作和程序检查，不宣称主观节奏已完全一致。

本轮验证记录：`output/verification/20261024T165938Z-23252/summary.tsv`；末轮桌面检查和图形检查另存 `output/verification/preview-parity-20261025/`。Mac arm64 Release 通过；Swift 执行 602 项、原有 4 项条件跳过、0 失败。桌面 274 项全部通过，日常三语 42 场景及预览生命周期、引导、动效冒烟通过。完整 verify 首轮额外发现本文含机器绝对路径，导致 repo-health 和其测试失败；已改成相对位置描述后单独复跑，原始失败记录保留。scheduler 的 undici 版本不一致仍未处理，整套 verify 不能标为通过。未安装依赖，未降低任何测试要求。

可查看的对照页为用户截图目录中的 `NotchSPI-daily-20261025/comparison.html`，并列答案、错误、独立预览。所有测试进程和交互 QA 进程均自行退出或已停止；没有安装或替换正式 Mac App。

路径修正后的复跑结果：repo-health 通过；仓库健康相关 61 项测试全部通过，无跳过。保留完整 verify 的初次失败记录，不改写为全绿。
