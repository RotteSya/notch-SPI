# 反馈导出、侧向子菜单与失败检查：2026-10-30

本记录接续 `ux-parity-2026-10-30.md` 的第一批修复。代码留在 `codex/win-mac-parity-review` 工作区；不安装依赖、不推送、不合并、不发布。既有网站和 Mac DesignVisualQA 改动保持原样。

## 运行基准与实际操作

继续使用与安装版 3.0 build 27 对应的冻结源码。原来的答案展示 fixture 没有绑定 `currentQuestionSnapshot`，所以实际菜单不显示反馈入口，不能把它当作反馈流程验证。

仅在 `output/parity-audit-2026-10-30/baseline/` 内的隔离 QA 副本补充：四张测试图片、正确摘要和像素尺寸、现有 `qaSeedExpandedAnswer` 快照绑定。后续配对画面改用 Windows 测试已有的同一张 `desktop/test/fixtures/question.jpg`。完整测试数据补丁保存在 `feedback-fixture-only.patch`，修改前文件也已保存。反馈预览、授权、导出、菜单的 Mac 产品实现没有改动；安装版没有改动。QA 进程通过系统沙箱拒绝网络，不请求真实答案。

通过实际 Mac UI 操作确认：

1. 普通答案有快照时，菜单提供“导出问题反馈”。
2. 打开的是“检查反馈内容与授权”窗口；四图默认全选，前三图为参考、末图为题目；当前答案只读；标准答案可选，默认用途为仅排查本次问题。
3. 未勾选授权时导出禁用。勾选授权后可导出；更改图片勾选或标准答案会撤销授权。切换预览图片不改变导出范围。
4. 授权后才进入系统保存面板，默认名为 `notchspi-feedback-<capture-id>.json`，明确提示 JSON 与旁边材料目录一起发送，保存不自动发送。
5. 取消保存面板直接回到刘海，不自动返回预览、更不上传。
6. 截图目标/人物像是独立侧向子菜单，不在主菜单内部插入选项。

截图与补丁位于 `output/parity-audit-2026-10-30/`。`mac-feedback-initial.png` 是首次四图流程观察；`mac-feedback-save-dialog.png` 是实际保存面板。所有冻结 QA 画面必须标注为发布源码重建，不冒充原安装二进制的可截图画面。

## Windows 实现

### 反馈

- `desktop/core/feedback.mjs`：冻结本轮图片和答案；明确授权、用途、90 天期限、另行许可外部处理；只导出选中图片与当前答案/可选标准答案。不接网络、不自动发信。
- `desktop/ui/feedback.mjs`、`style.css`：复现 Mac 的 560×418 内容区、预览分段、原图按钮、材料复选框、只读答案、标准答案、用途、授权、取消/导出顺序；内容变化撤销授权，预览切换保留授权。支持 Escape、Tab 和默认导出键。
- `desktop/main.mjs`：独立受截图排除保护的模态窗口；只有反馈窗口能调用其原图/保存/取消操作。打开原图使用本机临时副本，关闭预览清理副本。系统保存面板确认后再落盘。
- 预览绑定打开时的冻结内容，下一轮答题不能替换待导出的材料。保存面板返回后再次校验材料、快照时效和授权，错误时清理本次未完成包，已有包不被拼接复用。
- 没有完整答案时与 Mac 一样提示先获取完整答案；人格模式不显示该入口。原图限制与 Mac 导出一致：最多四图、单图最多 2 MiB、最多 1600 万像素；超界不悄悄压缩改内容。
- 沿用主刘海的透明、命中和排除机制。反馈图像只向反馈窗口发送，不在每次主窗口状态刷新时广播完整图像。

### 子菜单

- `desktop/ui/app.mjs`、`notch-controls.mjs`、`style.css`：目标/人物像子菜单独立侧向浮层，悬停展开，进入子菜单不会导致父项关闭；空间不足向另一侧展开并限制在宿主可见范围，长列表可滚动。
- 上下/Home/End 移动选项，Right 进入，Left/Escape 退回父项，再次 Escape 关闭。选项执行后关闭主菜单和子菜单，失焦关闭策略保留。
- 增加反馈入口；最近查题、设置、退出、引导文字补齐 Mac 文案；截图目标菜单不重复添加 Electron 的整屏源。
- 方向/边界行为已在 Electron macOS 宿主执行，但 Win32 窗口焦点和多屏避让不能由这里的结果代替。

## 两项失败检查的根因

| 检查 | 原因与证据 | 处理 |
|---|---|---|
| scheduler dependency-lock | `1b65faf` 将 manifest override/lock 升为 undici 7.30.1。当前实际 `scheduler/node_modules/undici/package.json` 仍是 7.29.1；甚至隐藏安装锁写 7.30.1，也不能代表磁盘包已升级 | 检查器正确失败。没有修改 manifest、任何锁文件、node_modules 或检查器；不安装依赖的约束下保持失败，不能宣布全绿 |
| server charge-on-failure | `94eddd7` 的 `beginSSE()` 提前 `flushHeaders()`；fetch 在响应头到达时正常完成。旧测试把 fetch 必须拒绝当作“没有答案”，并用 40ms/120ms 定时器猜断连阶段 | 仅修改 `server/test/charge-on-failure.test.ts`，不改服务端产品行为。生成器等到真实取消；断连前确认额度已预留、响应体读取以 AbortError 失败、生成器收到取消，最终额度返还且计数为零。另一用例先读到完整答案再取消，仍断言扣一题。不是放宽“不出答案不扣题”要求 |

修正后该文件 8 项、服务端全量 697 项通过；没有 skip、todo 或失败。

## 回归与证据

- `shared/fixtures/feedback-parity.json` 同时由 Swift `FeedbackExporterTests` 和 Node `feedback.test.mjs` 读取，覆盖用途、授权版本、90 天、无授权、已到期、未来授权。
- Node 导出测试覆盖选择子集/原角色、摘要/尺寸、答案绑定、仅文字、无效选择、材料变化/回滚、过期和外部处理权限。
- `desktop/test/feedback-smoke.mjs` 独立运行；原 daily 的既有断言不删除。初期合并运行触发超时后拆成两组；进一步定位为自动化等待已销毁窗口的 executeJavaScript 返回。改为先完成脚本调度、再等待窗口关闭，保留所有结果断言。原 daily 45 秒、新 feedback 默认 15 秒的进程时限均未延长，两组最终分别通过。真实 BrowserWindow/renderer/IPC 验证：悬停侧向菜单、边界、左右返回、四图初始状态、三种授权重置、切换预览不清授权、其他窗口不得直接保存、只导出选中三图、取消保存、取消预览，以及后台下一题不能替换已审阅答案和材料。
- 首轮 UI 检查发现答案框继承全局 textarea 最小高度，已局部修正；新窗口 resize 错误上报截图飞入目标，也限制为只有主刘海可以上报。随后发现模态窗口显示时内容高度减去 32 像素，改为显示后确认内容尺寸，保留 685pt 内容高度与授权区可见的测试断言。
- 本机 GUI 输出：`desktop/test-output/feedback-parity/initial.png`、`submenu-target.png`、`layout.json`、`results.json`、`feedback.json` 及本地测试材料目录。图像是 **Electron 在 macOS 运行**，不是 Windows 实机。
- 日常与飞入 smoke 成功。飞入结果仍明确 `windowsPixels=not-run`。
- Desktop 359 项、服务端 697 项、Swift 全量 616 项、scheduler 17 项通过；Swift 反馈专项 6 项通过，Mac arm64 Release 构建通过。完整验证只有 dependency-lock 必需项失败；Postgres 未配置测试库、硬件和签名保持原有未运行/待验收状态，没有增加跳过。完整验证运行目录：`output/verification/20261030T152832Z-29953/`，完整结果以该目录为准。

复现（已有依赖，无安装）：

```sh
npm --prefix desktop run check
npm --prefix desktop run smoke:daily
npm --prefix desktop run smoke:feedback
npm --prefix desktop run smoke:motion
node --test server/test/charge-on-failure.test.ts
npm --prefix server test
swift test --disable-automatic-resolution --skip-update --filter FeedbackExporterTests
node scripts/lib/lock-check.mjs scheduler
./scripts/verify.sh
```

GUI 需要真实桌面，先退出同产品其他实例。feedback 使用离线 fixture，并替换系统保存面板的选择结果来检查本地输出；它不能证明 Windows 系统保存面板的实际外观。操作结果文件包含 `host: darwin` 和 `windowsHardware: not-run`。

## 仍待 Windows 实机验收

- 模态反馈窗口不会把焦点留在底层编辑器，关闭或取消后焦点正确回到原应用；原图由系统查看器打开。
- Windows 系统保存面板的文件名、扩展名、取消、覆盖和中文路径；NTFS 实际写入/权限效果。
- 新反馈窗口在屏幕捕获中排除；打开、关闭、原图预览、菜单切换时，原刘海透明和穿透不回退。
- 100/125/150/200% DPI、多屏/屏边下子菜单的位置和滚动、透明材质及字体；鼠标连续从父项移入子项无闪烁。
- 同步骤、同语言、同题图、相近显示条件的 Mac/Windows 实机截图或录屏配对。

本轮不能宣称完全一致或全量检查通过。此前本地 Windows ZIP 先于这些新增修复，不能用作本轮候选包；本轮尚未重新生成发行包。


## 2026-10-31 收尾确认

- 中断后检查没有遗留本轮 QA 或 Electron 进程，原已安装 NotchSPI 仍在运行。
- 同题图配对文件：`output/parity-audit-2026-10-30/mac-feedback-paired.png` 与 `desktop/test-output/feedback-parity/initial.png`；双栏查看页为 `output/parity-audit-2026-10-30/feedback-comparison.html`。两侧均中文、四图、同一答案与相同源测试图片，Mac 使用原生预览，Electron 在 macOS 宿主运行。
- QA Mac 图标是测试 bundle 的系统占位图；Electron 使用产品图标。分段控件分隔线、选择框箭头、材质绘制仍有视觉细节差异，不能把流程通过写成逐像素一致。
- 最终独立反馈 GUI 输出 `NSPI_FEEDBACK_SMOKE_OK`；日常输出 `NSPI_DAILY_SMOKE_OK`；飞入输出 `NSPI_DESKTOP_MOTION_OK`。日志中的“Feedback action requires its review window”来自故意由其他窗口调用保存的拒绝测试，是预期拦截，测试同时检查了拒绝结果。
- 完整验证之后仅拆分反馈 GUI 入口、修复测试关闭窗口的调度并补文档；对应桌面检查、生成检查和三组 GUI 已分别复测。Swift/服务端产品代码未再改变，不把旧完整运行冒充最后一次新增测试驱动的全量重跑。
