# Windows 对齐 macOS 3.1 build 30

工程入口：[HANDOVER](../../HANDOVER.md)。本轮基准为 2026-11-11 检查时干净主树 `ca8085fe1228a0d103ec4e49446396ab5db0748b` 的 `Sources/NotchSPI/`、`shared/` 与 `VERSION.env`。本机安装 App 也是 3.1/30，但不能据版本号证明安装包与此提交相同；本轮原生截图来自该源码构建的隔离 Design QA App。未改 macOS、共享规则或服务端行为。

**整体状态：尚未全面验收。** 用户确认没有可用 Windows 环境，要求先完成本地实现并列出实机待验项。下表的“本地通过”仅代表源码检查、隔离回归或 Mac 宿主 Electron 运行。最终完成仍要求全部项目通过，且平台差异经用户接受。

## 方案与实施边界

保留现有 Electron 44.9.0、Win32 适配及锁定依赖。透明置顶窗口、鼠标穿透、截图排除、屏幕/窗口捕获均已有接口；共享 Ghost、飞入和收放曲线已有两端消费者。实际最小验证覆盖独立阅读窗口、320 ms 收放中断轨迹、取消/迟到回调和有界系统捕获。发现的是实现缺口，尚无证据证明 Electron 或局部原生适配不能达标，因此没有重写、没有移除旧版本。

[Electron BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window) 和 [desktopCapturer](https://www.electronjs.org/docs/latest/api/desktop-capturer) 是能力依据，不能代替 Windows 实测。更新接口核对锁定的 electron-updater 6.8.9 实现。

修改前确定的范围是 `desktop/main.mjs`、`desktop/core/`、`desktop/platform/`、`desktop/ui/`、对应测试及本表；文档同步 Windows 入口和 `docs/guide-map.json`。没有新增依赖、安装软件、修改全局环境、提交、推送、部署或发布。

## 对照与验收表

路径均相对于仓库；Swift 简写文件位于 `Sources/NotchSPI/`，共享路径位于 `shared/`。本地证据索引见下文，Windows 列均未获实机通过。

| 项目 | macOS 基准 | Windows 初始差异 → 本轮结果、代码 | 验收方法/本地结果 | Windows 与最终验收 |
|---|---|---|---|---|
| 版本/回退 | VERSION.env 3.1/30 | 设置硬编码3.0 → 生成版本；独立候选保持旧包。`ui/app.mjs`、package脚本 | 设置显示与包内 provenance、ASAR、ZIP核验 | 启动/系统属性待验 |
| 面板布局 | `Notch/NotchDesign.swift`、NotchGeometry：600 pt、48 pt标题、20 pt内边距 | 现有共享几何继续使用。`core/surface.mjs`、`ui/app.mjs`/style | 共享fixtures、daily/settings smoke | 100/125/150/200% DPI与屏幕边缘待验 |
| 字体/颜色 | 系统字体、NotchPalette、Appearance | 系统字体回退、明暗色；服务字段改为原生字号/等宽模型输入 | zh/ja/en；同850×620逻辑尺寸、DPR2截图 | Segoe/CJK字形、字体光栅仍不同，未接受 |
| 材质/阴影 | 原生面板绘制、侧栏系统材质 | 面板共享surface/light-field；侧栏CSS | 本机原生与Electron截图；色值/几何测试 | CSS侧栏与NSVisualEffect并非同一材质；DWM效果待比对，未接受 |
| 收放/中断 | 320 ms、共享曲线、从当前帧反向 | 现有morph保留，新增真实渲染帧采样 | 关闭及100 ms后反向，记录时间/x/y/宽高/透明度；终态通过 | 60/120/144 Hz、掉帧/中断与减少动效实机待验 |
| Ghost/飞入 | 共享Ghost与ScreenshotFlight | 共享引擎、`platform/flights.mjs` | motion smoke：首帧/落点/取消；未隐藏面板 | 跨屏混合DPI、DWM捕获像素待验 |
| 窗口/焦点 | NotchPanel、450 ms hover、手动收起 | 现有window-behavior；完整答案/设置内容尺寸补齐 | 窗口规则/鼠标区单测；独立窗口IPC | 全屏、置顶、穿透、焦点、快捷键冲突待验 |
| 完整答案 | `Notch/ExpandedAnswerWindow.swift`：独立快照、图文、复制/解释 | 初始缺失 → `core/reading-snapshot.mjs`、`ui/reader.mjs`、main阅读窗口 | 原图持有、按内容初始高度、旧题脱离、不解释新题、历史不打断请求，通过 | Win窗口缩放/键盘/大内容滚动待验 |
| 设置 | `Settings/MainSettingsWindow.swift`：五页、850×620、侧栏210 | 服务页组框/行式控件/字号/间距补齐；修复服务方向键写入推理强度 | settings smoke：三语、账户状态、人物像、键盘/焦点/滚动；静态对照 | Win标题栏/亮暗切换/输入法待验 |
| API厂商 | `Cloud/APIProvider.swift`十项，分厂商Key/模型 | 初始单端点 → `core/api-providers.mjs`十项、控制台链接、配置迁移、Key回填/清空；保留自定义协议 | 原生注册表逐项比对；厂商切换/默认值/旧Key/清空；仅设置窗口可读取Key | 真实厂商鉴权/视觉模型未调用；Win DPAPI待验 |
| 官方模型 | `Cloud/OfficialAPI*`、screen_query、推理强度/题包 | 沿用OfficialClient/shared协议 | 双端共享流/结果fixtures、server隔离测试 | 相同账户/设置真实识别、延迟/计费待验 |
| API/CLI请求 | `CLI/APIKeyRunner.swift`、CLIRunner；120 s/进程取消 | `core/providers.mjs`补齐CLI结果终态/尾行/超限/取消；自定义HTTP网关/查询参数 | 9预置厂商请求体、协议/多图；CLI模拟子进程退出码/超时/取消通过 | codex.exe/claude.exe真实登录与进程树；实际服务待验 |
| 后续解释 | 三通道、保留原答案、一次尝试、材料有效期 | 初始仅官方 → API/CLI沿用原图/原设置/原Key/原答案；相同提示 | 成功/503失败/取消/重复点击、旧阅读窗口不可解释新题，通过 | 同账户两端真实模型输出待验 |
| 单/多图录入 | 单图即发；2–4图、4 s提交、8 s撤销 | 现有Intake共享状态机 | fixtures与daily smoke：暂停预览/删除/恢复/迟到回调 | 真实快捷键/屏幕录入待验 |
| 截图/识别 | `Capture/ScreenCapture.swift`、CaptureSystemOperation | `platform/capture.mjs`新增10 s系统超时；超时不释放未完成底层操作；拒绝迟到结果 | 有界/忙碌/迟到帧/恢复单测；导入同一JPEG流程 | 窗口最小化、遮挡、HDR、目标失效、实际识别待验 |
| 截图排除 | Release全产品窗口排除 | 历史/完整答案窗口加入排除注册 | 注册路径检查；原有排除单测 | Win屏幕像素排除/黑块/透明叠层尚未验证 |
| 自动连答 | shared auto-session、上限/暂停/停止 | 沿用共享引擎；外观/上限保存不打断会话 | 同帧序列、阈值/失败/上限fixtures | 真实帧变化、连续题、CPU待验 |
| 人物像 | shared persona-session、作用域/错误屏障 | 沿用共享引擎和人物像库 | 同fixtures；设置编辑与启用分离回归 | 真实CLI/API上下文与快捷键待验 |
| 取消/并发 | NotchController generation、110 s watchdog | 新增同110 s保护；Key读取/捕获/错误回调世代隔离；设置写入串行 | 延迟Key后取消+新请求、超时后新请求、重复解释、并发保存通过；deadline以40 ms隔离夹具触发 | 真实网络物理取消、服务端终止时机待验 |
| 异常/结算 | 401保留令牌、状态补取、服务端扣费权威 | 沿用official/settlement；解释失败保留原答案 | 断流/401/429/无额度/补取/不重复扣费隔离测试 | 真实断网、睡眠唤醒/进程崩溃恢复待验 |
| 历史 | 独立图像保留；回顾不请求 | 历史曾覆盖活动题 → 被动阅读快照，解释更新同题历史 | 持久化/清理测试；活动请求中打开旧历史不取消，通过 | Win文件锁/磁盘满/重启后读取待验 |
| 配置/凭据 | UserDefaults+Keychain | JSON原子写+safeStorage；分厂商配置；写入成功才替换内存；热键失败回滚 | persistence单测、厂商往返、并发保存、清空Key | DPAPI用户作用域/升级迁移待验；密码字段显示掩码而非原生明文，差异未接受 |
| 引导/账户 | 共享引导、显式领体验、恢复候选校验 | 沿用guide/account/official | guide/settings/daily与服务端隔离测试 | 真实账户、付款回跳、额度与恢复码待验，未消费真实额度 |
| 更新 | `Update/UpdateChecker.swift`、InAppUpdater：每日检查/跳过/说明/取消/验证/重启/失败回退 | 增加每日尝试持久化、跳过版本、说明、用户确认后下载与空闲重启、真实取消token、单飞/重试。`core/update-state.mjs` | 模拟updater检查/取消/迟到进度/重试/日频/跳过/安装门禁通过 | 本包无签名feed，功能显示未配置；签名NSIS与损坏/错误签名/断电升级未验。NSIS未实现Mac的“启动确认后自动回退”协议，仍是明确缺口 |
| 性能 | 同题图/账户/模型/屏幕条件 | 现有wait timing与新morph帧记录 | 记录宿主与条件；只报告本机测量，不声称跨平台速度一致 | Windows启动/RSS/闲置CPU、真实首字/总时延、GPU/帧时间待验 |

## 实现与证据

本次新增 `desktop/test/macos-alignment.test.mjs` 的10个回归和 `smoke:alignment`。后者运行真实 Electron 主/渲染进程与 IPC，网络与密钥为隔离夹具，调用实际 API 适配器；不联系生产模型。涵盖17项流程断言、10次模拟请求及两个动画帧序列。设置页截图同时记录850×620逻辑尺寸和DPR2；原生1700×1240截图仅做同条件的设置视觉参考，不能据此声明全部页面/动画已成对验收。

验证命令（使用已经准备好的项目依赖；不自动安装）：

```sh
npm --prefix desktop run check
npm --prefix desktop run smoke:alignment
npm --prefix desktop run smoke:settings
npm --prefix desktop run smoke:daily
npm --prefix desktop run smoke:guide
npm --prefix desktop run smoke:motion
./scripts/verify.sh
npm --prefix desktop run pack:win
```

Windows x64主机的打包入口生成NSIS+ZIP；本机Apple Silicon只生成ZIP，固定`--publish never`。本轮复用缓存的Electron Windows运行时，无签名/更新源配置。候选路径及SHA256以本轮`delivery-manifest.json`为准，不沿用旧包。解压**整个ZIP**，在Windows 10 2004+/Windows 11 x64上运行`NotchSPI Desktop.exe`；不需Node。开发态隔离mock的启动命令统一见[HANDOVER的Windows入口](../../HANDOVER.md#windows)；普通启动会使用实际官方账户，不属于mock。

本地报告与原始证据放在忽略目录 `output/windows-alignment-20261111/`；`report.md`记录最终检查、构建身份/摘要与源文件交付包，`comparison.html`并列原生/Electron截图，`electron-alignment/`保存原始截图、结果和帧时间。完整仓库检查原日志在报告指向的`output/verification/<run-id>/`。这些本地产物不在Git中，移交候选时应随证据包一起保留。

初始desktop检查368/368通过。中间完整verify通过后继续修正，最终以报告中绑定源码摘要的一轮为准。首次设置smoke在固定170 ms等待后写入人物像发生时序失败，复查通过；测试现改为等待新编辑行实际选中再输入，最终结果单独记录。已有SwiftMath checkout的git alternates指向改名前仓库路径，本轮只修正`.build`内此缓存引用，保留原权限和备份；未安装/重新解析Swift依赖。

## 必须保留的缺口与平台差异

1. **Windows实机全部待验。** 按[实机清单](manual-acceptance.md)记录Windows版本、x64、DPI/刷新率/屏幕布局、候选摘要，使用相同练习图、账户条件、通道与模型设置对照Mac。截图比较逻辑尺寸；动画要有帧轨迹或录像，不能用静态截图替代。
2. **真实服务与凭据未验。** 本轮没有真实模型调用、付款、领体验或正式更新；mock不证明识别正确率、实时扣费或服务端物理取消。需要可用于成对验收的测试账户及各通道已有凭据。
3. **更新尚有实现缺口。** 下载/签名/安装委托electron-updater/NSIS；目前没有对应Mac启动确认回退的Windows实现。须在Windows安装/恢复环境下实现并验收此协议，不能把“保留旧候选ZIP”当作自动回退。还需独立配置签名证书/可信更新源；本轮不创建或发布它们。
4. **平台行为差异尚未接受。** Windows按窗口ID选择目标，窗口销毁重建需重选；Mac按应用选择。Windows CLI要求原生exe绝对路径，Mac可发现本机CLI。系统字体、侧栏材质、窗口装饰、Ctrl代替Command及密钥掩码均需明确接受或继续修正。没有Windows证据时不以这些差异为依据仓促重写。
5. **性能与运行环境缺项。** 本机帧记录仅为Mac Electron；不推导Windows性能。Postgres测试环境、正式签名更新及Windows硬件未具备的检查按skipped/blocked记，不算通过。

上述缺口未关闭、平台差异未接受前，本轮交付只能称为**可构建的Windows对齐候选与本地验证证据**，不能宣布全面对齐完成。
