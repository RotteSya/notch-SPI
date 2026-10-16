# Ghost 指示器接入（2026-10-16）

## 实现

用 Libraries.dev MIT 开源 Ghost 替换全部 RoseLoaderView，包括刘海和旧欢迎窗口。
本地 SwiftPM 依赖 `Vendor/BotAvatarsKit` 固定上游 bfcb86329da15235a5ee2dcdb6417c8a80f82bb1，保留 6 个绘制/动画核心源文件和 MIT 许可；应用打包携带 Resources/ThirdParty/BotAvatarsKit-LICENSE.txt。

上游完整 Swift 包实测无法在 macOS 编译：UIColor 和 CADisplayLink(target:selector:) 属于 iOS 路径。本地颜色桥接改为 NSColor，采用应用原有的窗口显示时钟驱动公开 BotAvatarSim/drawBotAvatarFrame API。未引入 npm、WebView、付费 Studio 或在线调用。

尺寸和坐标数值保持：收起 20pt、日常展开 16pt、引导 14.5pt、旧欢迎窗口 96pt。0.94 倍 body box 保持原约 2/3 可见轮廓，补偿 Ghost 轮廓中心偏移 2.25 body units。白色待机、主题工作色、红色错误继续跟随原状态；使用原生 smooth 材质（不是网页 fabric 毛绒）。保留眼睛、眨眼和轻微摆动，收敛旋转/跳跃，避免小槽位越界。装饰视图保持点击透传、移除停止时钟、弱引用释放以及系统减少动态效果响应。

## 验证

- 最终原生 SwiftPM 串行 warnings-as-errors：532 项，4 跳过，0 失败。日志 /tmp/notch-ghost-regression.log。
- 新增四种尺寸 × 待机/工作 × 120 帧，共 960 帧实际绘制像素检查，轮廓不接触边界且确有非透明内容；原生命周期测试验证 50 次状态切换及移除释放。原硬件刘海几何与引导过渡回归通过。
- 三语 102 状态边界检查通过，图像在 ../output/ghost-2026-10-16/frames（项目外层 output）；人工抽查中文欢迎、英文工作、日文重拍，以及 96pt Ghost。
- DEBUG 独立离线 ready 场景原生界面已通过 CUA 查看，点击收起后再次检查可见图案和边界。没有真实截图查题或付费模型调用。
- arm64 Release 构建、Developer ID 签名和验签通过：/tmp/notch-ghost-package.log。正常包 dist-qa/NotchSPI.app 已启动，版本保持 2.17/24。
- 带快照的前两轮完整测试出现遥测用例 5 个失败断言；该用例独立复核和最终不导出快照的完整运行通过。未更改遥测代码，快照运行与该用例的干扰原因尚未定位，不将早先失败记作通过。
- 首版新增像素测试曾重复施加 2× 缩放导致裁切误报，修正测试位图坐标后通过；产品界面未受该测试错误影响。
- scripts/verify.sh 在 repo-health 因输出/历史归档的 2330 条断链停止；未宣称总脚本通过。代码空白检查通过。

未提交、推送或发布。正常 Release 受既有截图排除保护，直接 CUA 对正常 bundle 的选择出现旧 test 窗口缓存，视觉核对使用独立 DEBUG bundle 和 AppKit 实际绘制快照。

## 思考动效增强

截图提交后现有 running 状态立即启动 Ghost 思考循环，并持续覆盖 streaming；idle/error/ready 退出并约 0.2–0.5 秒平滑回到待机。多图收集本身不启动思考。未改变请求、计费、取消或截图逻辑。

思考时每 1.4 秒轻浮动、倾斜并左右转头；身体下方的三个小墨点每 1.05 秒依次明暗变化。墨点放在身体内部，不增加外框或挤占文字。减少动态效果下保持静态思索姿态与三个墨点。新动效仍通过四尺寸共 960 帧边界验证；新增启动/结束过渡、running/streaming/终态及多图收集状态映射测试。

全量首次 534 项，4 跳过，遥测用例出现与前轮相同的 5 个失败断言；其余（含全部新增动效测试）通过。日志 /tmp/notch-thinking-tests.log。该遥测问题没有改动，不能称本次全量全绿。

思考动效专项、生命周期与遥测独立复核通过（/tmp/notch-thinking-focused.log）；DEBUG working 场景两帧原生画面核对了轻浮动和三点显示。Release 构建、Developer ID签名及验签通过（/tmp/notch-thinking-package.log），退出离线 QA 后重启正常本机包。未调用真实模型，未推送或发布。

## 回答完成动效

在真实 running/streaming → idle 且存在有效答案、不是错误/重拍/空输出提示时触发一次 1.25 秒完成反馈。轻点头，思考点淡出后在身体内显示短暂对勾，最后恢复待机；工作色在 0.4 秒内过渡回原待机配色。视图外框、布局数值、锚点和缩放不变。重绘/展开不重播，新请求打断，失败/取消/重拍不播放；减少动态效果时跳过该短动画。

新增首帧姿态连续、单次触发、结束恢复、新请求打断及非成功终态拒绝测试；像素检查扩展到待机/思考/完成三阶段、四尺寸，共 1440 帧。首次专项 31 项通过，日志 /tmp/notch-complete-focused.log。可见轮廓依旧在原槽位内；96pt图像复核发现初版对勾靠近眼睛，已缩小并下移，最终图像与验证结果见后续记录。

完成动效验证收尾：完整 Swift536项（4跳过、0失败，/tmp/notch-complete-full.log）；对勾最终缩小下移后再次运行5项Ghost专项，含1440帧绘制，全部通过（/tmp/notch-complete-final-visual.log）。最终96pt和20pt完成画面已查看，对勾与眼睛分离，外框不变。图像位于项目外层 output/ghost-complete-2026-10-16/。Release构建与签名验签通过（/tmp/notch-complete-package.log），正常本机包重启；无真实模型调用、提交推送或发布。完整verify的既有历史断链边界仍保留。

## 展开尺寸与卡片左边界校准

按用户反馈取消展开时缩小 Ghost：刘海收起、日常展开、引导展开统一20pt外框，并在整个展开/收起过程中保持20pt。旧欢迎窗口96pt不变。

展开时使用下方卡片同一 contentInsetH=20pt，并扣除 Ghost 原生轮廓在画布中的3.796pt透明留白，令静息轮廓左边缘对齐卡片的左边框；不使用NSView的透明外框假装视觉对齐。收起原来的横向中心不变，展开仅平滑移动至新锚点；日常23pt/引导20pt垂直中心保留，标题位置保持，图案右侧仍有留白。动画中轮廓的轻微摆动围绕该对齐基准进行。

三语102状态增加20pt宽度与可见轮廓基准对齐断言；日常/引导、两种面板高度的收起过渡逐帧增加20×20尺寸断言。初次20项专项（含1440帧像素边界）通过，图像位于项目外层 output/ghost-align-2026-10-16，中文欢迎页已查看并确认左边缘与卡片齐平。

本轮最终完整Swift536项（4跳过、0失败，/tmp/notch-ghost-align-full.log），包括新尺寸/对齐/过渡断言。独立DEBUG日常展开和点击收起后的实际画面均已查看，Ghost保持同样大小，展开左轮廓与下方卡片齐平。Release构建与签名验签通过（/tmp/notch-ghost-align-package.log），正常本机包已重启。未推送发布。
