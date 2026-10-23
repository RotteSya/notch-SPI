# Windows 连续截图与飞入修复 · 2026-10-21

> 历史记录时点：2026-10-21。本文的“当前”“最新”、部署状态、测试计数与待办均指对应记录时点，不代表 2026-10-23 的线上状态；本次整理未重新核对生产。

适用客户端：Windows ZIP 3.0.27。目标是连续截图时刘海一直显示，题图中排除刘海和飞入层，飞入时间轴保持连续。此轮保留此前的鼠标移出收起、设置拖动、普通窗口可截图和账户刷新修复。未修改 Mac 原生代码、共享设计参数、服务端、系统设置或安装依赖。

## 实现

- 新增 `desktop/platform/capture-exclusion.mjs`，由 Windows 合成器排除受保护窗口。Windows 的单次、多图与自动连答取帧统一走此入口，不调用刘海的隐藏、显示或透明度接口，也不暂停、恢复或重新计时飞入。
- 刘海和每个屏幕上的飞入窗口在原生窗口属性设置完成后注册保护。显示、置顶和鼠标穿透属性变化后重新应用保护，避免窗口样式更新后保护失效。设置、历史等普通窗口不注册。
- 仅在保护状态变化后等待 120 ms，让桌面合成器应用属性；稳定连续取帧不重复等待。如果取帧期间新飞入层出现或保护发生变化，丢弃该本地帧并重取，最多尝试 5 次。重取发生在查题请求之前，不重发网络请求。
- 飞入窗口只在实际需要时显示/隐藏，避免每次几何更新重复显示；落地和取消仍按原有规则清理。Ghost、飞入轨迹、时长与缓动继续消费已有共享来源。
- 截图要求 Windows 10 2004（build 19041）或更新版本；更老系统明确报错，避免旧版 Windows 把保护窗口画成黑色矩形。Mac 原生 AppKit 保持原实现；macOS 上的 Electron 开发壳保留其已有取帧适配。

依据：[Electron 窗口保护文档](https://www.electronjs.org/docs/latest/api/base-window#winsetcontentprotectionenable-macos-windows)说明保护在下一次桌面合成时生效；[Microsoft 的 SetWindowDisplayAffinity 文档](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowdisplayaffinity)定义了屏幕可见而截图排除的行为及系统版本要求。仓库现有 Electron 44.9.0 无需升级。API 调用或缓存的保护标记不能证明系统最终像素正确，因此增加实际像素回归。

## 本机验证

当前环境为 macOS，以下验证区分逻辑、真实窗口与 Windows 系统截图：

| 检查 | 结果与证据 |
| --- | --- |
| 客户端检查 | 88 项通过、0 失败。新增 8 项覆盖连续/重叠取帧、异常、用户主动隐藏、属性变化、取帧期间新窗口、飞入进度/落地/取消、旧 Windows 拒绝和重试上限。含原有真实隔离服务端回归。`output/windows-visible-capture-tests.log` |
| 启动 | Electron 启动及 renderer 就绪通过。`output/windows-visible-capture-smoke.log` |
| 真实窗口动效 | macOS Electron 真实透明窗口绘制了截图卡片和 Ghost；重叠取帧期间窗口保持可见、飞入起始时间不变，落地与取消清理通过。取帧回调用明确测试 fixture，不据此宣称 Windows 排除像素已验证。`desktop/test-output/motion/result.json`、`flight-moving-1.png`、`ghost-working.png`、`ghost-completion.png` |
| Windows 原生像素 | 当前环境明确跳过，`output/windows-visible-capture-pixels.log`。Windows CI 已配置该检查，但尚未推送/执行。 |
| 工程与交付检查 | `repo-health`、`git diff --check` 通过；Windows x64 ZIP 构建成功，51 个交付源文件与 ASAR 逐字节一致，运行依赖齐全，fixture 未打入包。ZIP CRC 和 ZIP 内 ASAR 一致性通过。`output/windows-visible-capture-package-verification.log`、`output/windows-visible-capture-zip-integrity.log` |

真实像素回归使用普通蓝色背景窗口和青色普通窗口作为参照：先临时关闭测试刘海保护，确认截图能看到它；再启用保护，验证截图恢复背景、没有黑色占位，普通窗口仍可见。实际飞入开始后取帧，并追加连续取帧。失败会中止检查；测试素材和测试模块不打入 ZIP，发行包拒绝 QA 启动参数。

本轮复核截图同时保存在 `~/Desktop/Screenshot/NotchSPI-20261021-flight.png`、`NotchSPI-20261021-ghost-working.png` 和 `NotchSPI-20261021-ghost-complete.png`。

## Windows 实机待验

这些项目确实需要 Windows 图形桌面，不能用 Mac 构建或测试替代：

1. 用新 ZIP 连续截图和自动连答：刘海始终可见，题图不含刘海、预览和飞入层，普通设置窗口可被截到；连续按截图快捷键时飞入顺畅，不闪烁、不重启。
2. 在首次展开、鼠标进入/移出改变穿透状态、窗口重新显示以及睡眠唤醒后重复上述操作。
3. 跨屏、负坐标、混合 DPI、不同刷新率及远程桌面分别验证；用 Win+Shift+S 核对系统截图工具行为。
4. 取帧失败后窗口和飞入不被重开；用户主动隐藏仍保持隐藏。

开发命令、像素回归和打包步骤统一见 [HANDOVER](../../HANDOVER.md#windows)。无需新工具或启动步骤。本轮改动集中于 Windows 截图适配及测试，Mac 原生不受影响；共享模块生成一致性和相关客户端回归均纳入检查。

## 交付

新包路径：`desktop/dist/NotchSPI-3.0.27-Windows-x64.zip`。版本保持 3.0.27，通过 `output/windows-delivery/manifest.json` 中的构建时间和 SHA-256 区别旧包。

2026-10-21 00:52（北京时间）核验：158988695 字节；SHA-256：`26d9ece816c35031833115e70974e88fc86e5ab64a246eaad2643a6c9a4b0957`。

退出旧 Windows 客户端，将新 ZIP 解压到独立目录后运行 `NotchSPI Desktop.exe`，保留全部同目录资源。原应用数据保留。此包未签名、未发布，未改动现有 Mac 发行包。
