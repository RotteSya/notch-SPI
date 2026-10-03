# 刘海答案界面重排 · 2026-09-30

本轮针对用户提供的两张实拍图，修改真实 AppKit / Core Text 界面。主要问题是截图与引导占据首屏、答案挤在底部，以及第一段答案卡片的背景上沿被裁切。

## 当前方向：按用户反馈撤销附件栏

用户指出多图模式未同步重做，且不接受底部附件栏。现统一为「状态 → 题目截图 → 答案 → 解释操作」。题目图区固定156 pt，1～4张截图保持相同128×80 pt槽位及12 pt间隔；实际图片按原比例完整显示。提交前后图区位置、尺寸不变，答案在其下展开。收集时显示张数、下一张占位、取消和倒计时；提交后仍是题目图区。下方旧附件栏说明与截图属于上一轮历史，不代表当前交付。

新增多图真实流程离线检查 `multi-flow`：在捕获I/O边界注入样例，运行真实收集、飞入、4秒倒计时及提交状态机；四张分别在1、9、11、13秒进入。另有collecting-1到collecting-4、mixed横竖混排场景。

## 上一轮实现（附件栏方案已撤销）

- 阅读顺序改为状态 → 答案 → 解释操作 → 截图附件。收集截图时继续显示完整收集栏，提交后切换为 64 pt 附件栏（原 136 pt）；保留每张截图的顺序、预览和文件所有权。
- 答案标题独立一行，答案字号相对用户设置增加 10 pt，采用中等字重；背景改为低对比石墨色，14 pt 圆角、16 pt 横向内边距。强调色保留在小标题和控件。
- Core Text 忽略首段 paragraphSpacingBefore，改为测量、绘制、命中测试共享显式上/下内边距；边框内收，避免上沿与左右边被裁切。
- 完成引导高度从 194 pt 收至 116 pt，工作中高度为 148 pt。常规设置步骤保持同一主按钮位置，工作/完成步骤使用另一组固定位置。三种语言按钮宽度与动作不重叠测试同步更新。
- FINAL 卡片出现后停止追随推理尾部，将阅读位置回到答案；尊重已经手动离开尾部的用户。保留统一显示时钟、弹簧高度变化、收起/立即反向机制。
- 相同 attributed string 不再使 Core Text 布局缓存失效；字符到 UTF-16 的出生时间映射在内容变化时计算，不再每帧重建。答案动效遵循同一 Reduce Motion 开关。
- 新增只在 DEBUG、显式 ephemeral 模式运行的离线设计预览：`scripts/design-qa.sh`。其独立 bundle 为 `com.rottesya.notchspi.design-qa`，不激活业务服务、不注册热键、不截取屏幕、不提交问题。样例答案仅用于 UI 检查。

## 实际检查

以下 PNG 来自实际运行的独立 QA 窗口，经 Computer Use 获取，未重绘或美化；题目和答案为离线样例：

- 日常答案（本机证据：`output/design-review-2026-09-30/answer.png`）
- 完成引导（本机证据：`output/design-review-2026-09-30/success.png`）
- 英文四图附件（本机证据：`output/design-review-2026-09-30/multiple-en.png`）
- 日文完成引导（本机证据：`output/design-review-2026-09-30/success-ja.png`）
- 长答案首屏（本机证据：`output/design-review-2026-09-30/long-top.png`）

实际点击验证：完成引导后收回刘海，点击刘海重新展开原答案；英文四图中点击第三张打开“Screenshot 3 / 4 · Preview”。长答案首屏完整呈现答案、可滚动正文与底部附件。随后主机锁定，继续滚动与后续动效观察被工具拒绝，已请求用户手动解锁。

## 验证结果与限制

- arm64 Release 构建通过。此机 Xcode 许可未完成确认，使用已安装 Command Line Tools 编译；存在工具链 arclite/search path 链接警告。
- XCTest 编译借助已安装 Xcode 的 Frameworks 和 Swift overlay 路径完成，再直接调用 `Xcode.app/Contents/Developer/usr/bin/xctest`。不能把 SwiftPM 在该环境报告的“0 tests”当成通过。
- 最终实际执行 366 项：362 通过、4 跳过、0 失败。新增答案边距、收集/提交布局与滚动边缘淡出回归均通过。完整日志为 `xctest-scroll-fix.log`。
- 首轮在锁屏后失败的 `testClosingPreservesCompositionAndInterruptedReopenUsesDailyLayout` 和 `testRetargetDuringExpansionAndReversalDoesNotJumpWindow`，已在解锁后两次完整执行中通过；保留首轮失败日志，不将其删除。
- Swift 6.4 新增的弱捕获诊断阻塞原有 `DeviceSourceSelectionTests`，已使外层与内层均显式弱捕获；业务实现未改。
- 完整 `verify.sh` 停在既有 2,270 个历史材料断链，数量与上一轮工程交接一致。
- 未进行真实付费问题、账户额度、发布、公证或生产端验证。本轮没有真实服务变更，也未替换 `/Applications/NotchSPI.app`。
- 当前证据不覆盖逐帧视频录制与帧时间性能指标，不能声称逐像素或获奖等级验收。长答案末行、滚动、失败重试、减少动态效果的完成/收起/重开检查已完成，见下方补验记录。

日志位于 `output/design-review-2026-09-30/`。

## 复现

在已配置的 macOS 开发环境运行：

```sh
./scripts/design-qa.sh success -appLanguage zh-Hans
./scripts/design-qa.sh multiple -appLanguage en
./scripts/design-qa.sh success -appLanguage ja
./scripts/design-qa.sh long -appLanguage zh-Hans
NSPI_QA_REDUCE_MOTION=1 ./scripts/design-qa.sh multiline -appLanguage zh-Hans
```

每次先退出上一个设计预览；该独立应用名称明确标注 Offline Design QA，不能作为正常查题应用交付。本机尚未配置 Xcode 时可为构建命令临时设置 `DEVELOPER_DIR=/Library/Developer/CommandLineTools`；这不修改系统默认开发者目录。


## 继续执行后的补验

主机解锁后，原两项动效测试恢复通过。进一步通过真实窗口检查发现，滚动条或辅助功能滚动绕过 `scrollWheel` 时，底部淡出没有更新，滚到底后末行仍发灰。现改为监听 clip view 的实际位置变化，并区分代码驱动的滚动，避免打断跟随弹簧；新增测试直接改变 clip bounds，核对上下边缘透明度。

- 长答案末行修复后（本机证据：`output/design-review-2026-09-30/long-bottom-fixed.png`）：辅助功能滚到末端，最后一行完整可读，附件栏位置保持稳定。
- 英文失败界面（本机证据：`output/design-review-2026-09-30/failure-en.png`）与点击重试后（本机证据：`output/design-review-2026-09-30/failure-retry.png`）：错误与恢复动作不重叠；重试经过真实控制器的失败恢复流程，I/O 使用本地注入的捕获失败，不读取用户屏幕。
- 减少动态效果：完成引导（本机证据：`output/design-review-2026-09-30/reduce-motion-success-en.png`）与重新展开（本机证据：`output/design-review-2026-09-30/reduce-motion-reopen-en.png`）：英文文字完整；立即收起、重开保留同一答案。
- 独立预览包直接打开也固定进入离线样例，在所有单例初始化前开启 ephemeral vault；捕获、提交与练习页入口均有本地注入，避免误入正常查题路径。使用时固定展开便于检视，正式应用的自动收起行为不变。直接重新打开已实测无普通启动提示。
- 更新后的 arm64 Release 构建通过，日志为 `release-resumed.log`；`git diff --check` 通过。
- 检查结束已退出离线预览应用，未把样例模式留作用户的正常查题应用。


## 多图跟进验收

- 三图收集中（本机证据：`output/design-review-2026-09-30/gallery-collecting-3.png`）：清晰显示第4张位置、取消和倒计时。
- 横竖宽图混排（本机证据：`output/design-review-2026-09-30/gallery-mixed-en.png`）与第二张原图预览（本机证据：`output/design-review-2026-09-30/gallery-portrait-preview.png`）：截图保留在答案上方，按原比例显示。
- 真实收集流程：第一张（本机证据：`output/design-review-2026-09-30/gallery-flow-early.png`）与四张自动提交后的答案（本机证据：`output/design-review-2026-09-30/gallery-flow-later.png`）：通过生产收集状态机，只有截图I/O和答案请求使用离线注入。
- `gallery-tests.log`：367项、4跳过、1失败。新增及既有4项答案布局测试全部通过；失败是已有 `testRetargetDuringExpansionAndReversalDoesNotJumpWindow` 的25毫秒墙钟时序阈值。原样单独复跑通过，见 `gallery-motion-retest.log`；不能将本轮全套执行写成全绿。
- 连续窗口序列采样被系统锁屏中止，没有生成可用的逐帧证据。等待手动解锁后补验，不声称帧率或逐像素验收完成。
- 已结束此次隔离QA进程；正常本机运行包尚未更新为本次多图改动。

- 本次 arm64 Release 构建通过（`gallery-release.log`，65.93秒）；`git diff --check`通过。工具链的arclite与CLT路径警告仍存在。


## 解锁后的多图补验

- 完整复跑实际367项XCTest：363通过、4跳过、0失败。上一轮失败的动效时序测试原样通过，没有放宽阈值。日志：`gallery-test-build-resumed.log`、`gallery-tests-resumed.log`。SwiftPM显示的0 tests不计入结果。
- 通过Computer Use连续获取36份窗口截图和辅助功能状态，覆盖约21秒的1→2→3→4张收集、每次新图重置倒计时，以及自动提交后的答案。状态与时间戳见 `gallery-sequence.json`。
- 已实际查看第二张飞入期间（本机证据：`output/design-review-2026-09-30/gallery-sequence-15.png`）、第三张飞入期间（本机证据：`output/design-review-2026-09-30/gallery-sequence-18.png`）、第四张飞入期间（本机证据：`output/design-review-2026-09-30/gallery-sequence-21.png`）、提交前（本机证据：`output/design-review-2026-09-30/gallery-sequence-27.png`）、答案出现后（本机证据：`output/design-review-2026-09-30/gallery-sequence-28.png`）。题图区未换位，已有图像未被挤移，答案从下方展开。
- 这些是约0.6秒间隔的主窗口样本，独立飞行动画窗口不在主窗口截取范围内；不将其表述为逐显示帧录制或帧时间性能测试。

- 已完成本机正常版本更新：`scripts/run-local.sh`使用当前Release二进制打包，Developer ID签名验证通过，启动`dist-qa/NotchSPI.app`。确认运行进程无QA/样例参数、serviceMode为official、无baseURL覆盖。独立QA已退出。构建和启动日志为 `gallery-run-local.log`；未替换Applications，未发布或推送。
