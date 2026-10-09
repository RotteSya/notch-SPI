# 截图飞入刘海：参考、方案与验证

用户先要求只读研究，随后明确回复“同意”，授权按讨论方案实施；本机验收与运行后又明确要求“推送到main”。本轮修改客户端、相关测试和验证记录，未发布安装包或替换 `/Applications` 中的应用。

## 参考与确认方案

参考固定在 Tendedero 的 `ed0618a67cc59e0a8621b97bb5e32ab9af3b0b69`：

- [CaptureFlight.swift](https://github.com/alejandrobujan/tendedero/blob/ed0618a67cc59e0a8621b97bb5e32ab9af3b0b69/Sources/Tendedero/CaptureFlight.swift)：0.65 秒飞行、三次方缓入缓出、30 pt 向上拱起、捕获区域起飞、缩小并形成照片边框。
- [PeggedView.swift](https://github.com/alejandrobujan/tendedero/blob/ed0618a67cc59e0a8621b97bb5e32ab9af3b0b69/Sources/Tendedero/PeggedView.swift)：落位后轻摆。
- 首页 GIF 是 `scripts/make-readme-art.swift` 生成的绳子展开、复制、收起展示；没有演示捕获后的飞行全过程。没有亲自运行参考 App；以上飞行结论来自源码。

确认的体验：现有手动截图入口 → 从实际捕获区域揭起 → 缓慢起步、中段加速、末段放慢并逐渐缩小 → 刘海向下展开的黑色面板接住 → 题图留在答案上方，轻摆后恢复水平。没有额外停顿或拖尾。展开和接收亮光沿用现有实现；主飞行及轻摆分别为 0.68 秒和 0.22 秒，合计约 0.9 秒。

## 实现边界

- 飞行开始时显示无边框的原图比例，飞行中逐渐形成 4 pt 内边距和 8 pt 深色圆角卡片；飞行结束与题图槽位大小、颜色、边线和阴影对齐。
- 飞行中最多倾斜 2.2°，到达时恢复水平；题图再进行 -1.2° / +0.45° 的短暂摆动，围绕自身中心旋转。
- 预览最大解码尺寸由 480 提升至 2000 像素，避免覆盖大窗口时模糊；后台解码不阻塞截图录入或提交。
- 飞行不拥有图片文件、业务请求或倒计时。到达回调校验当前轮次，取消后不触发迟到的接收亮光。
- 单图继续立即提交；多图仍最多四张，第二张起最后一次成功捕获四秒后提交。自动模式未增加大图飞行。
- 减少动态效果或起点未知时在终点用 0.18 秒淡入；不会凭空从其他屏幕位置起飞。
- DEBUG 的 `NSPI_SLOW_SCREENSHOT_FLIGHT=1` 将同一飞行曲线拉长至 2.4 秒，仅用于观察；不改变截图、多图计时或提交规则。
- DEBUG fixture 支持 `--qa-screenshot-delay N` 和 `--qa-screenshot-four`，可复核一至四张题图的收集及提交。

## 验证结果

1. `NSPI_QA_EPHEMERAL=1 swift test -Xswiftc -warnings-as-errors`：389 项、4 项按条件跳过、0 失败。包含真实图层关键时刻的位置、图片内边距、倾斜角度和透明度，动态终点跟随、多个独立飞行、取消、终点丢失及减少动态效果的测试；已有单图不等待飞行、多图排序/计时/取消测试通过。
2. `swift build -c release --arch arm64` 成功；`git diff --check` 通过。
3. 隔离 DEBUG App 的实际窗口确认四张题图仍位于答案上方；点击第二张打开“截图 2 / 4 · 预览”，Esc 返回正常。
4. `--qa-screenshot-demo --qa-screenshot-single --qa-screenshot-live` 使用真实全屏截图接口，权限检查、系统枚举、取图、编码、录入和缩略图解码均成功；实际窗口显示一张题图及模拟答案。本轮提交边界使用本地固定答案，未向真实模型发题或产生付费调用。

窗口工具采样确认了收集和最终状态，未取得飞行全过程的逐显示帧录制；轨迹与图层姿态采用测试时钟推进生产动画代码验证，不将它宣称为帧率/性能验收。未实测跨显示器的连续飞行；负坐标几何已覆盖。隔离 QA 进程已退出，正常安装包未替换。

本地构建/测试日志位于 `output/screenshot-flight-2026-10-09/`（Git 忽略的验收产物）。

## 用户本机运行

随后按用户要求执行 `scripts/run-local.sh`，重新组装并验证 Developer ID 签名，打开正常 Release 本机包 `dist-qa/NotchSPI.app`。实际进程指向该路径，没有 QA、慢放或模拟答案参数；保存的服务模式为 official，`official.baseURL` 没有覆盖值。Computer Use 确认该本机包的刘海窗口已运行。应用沿用原账户与设置，未覆盖 `/Applications/NotchSPI.app`；此时本机运行的版本已包含新截图动效。日志为 `output/screenshot-flight-2026-10-09/run-local.log`。
