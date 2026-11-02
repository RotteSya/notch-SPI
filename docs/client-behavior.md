# 客户端行为

当前源码行为的导航见 [HANDOVER](../HANDOVER.md)；持久数据的删除条件见[兼容账本](compatibility.md)。本参考说明 Mac 原生行为，共享规则及 Windows 边界见[共享架构](windows/architecture.md)。

## 截图与多图

热键所有者是 Settings.swift：讲题、多图、人格、自动模式和显隐分别保留独立配置，多图持久化键名仍为 context。系统截图键不被占用。
单图接收成功即提交，不等待缩略图动画。多图收集 2–4 张，末次有效变更后按共享 submitDelay 提交；单张继续等待，预览暂停，关闭重新计时，删除有撤销窗口。取消、目标/账户/模式变化使过期回调失效。
题组过期保留已完成正文及解释，清理截图、补取和解释资格；旧回调不能覆盖下一题。最近查题拥有独立图片副本，不能提前删除在途所有者的材料。
验证：ScreenshotRoundTests、ScreenshotIntakeTests、CaptureFlowStabilityTests、CaptureFileLifecycleTests。

## 引导

NotchController 和 NotchOnboardingProgress 管理欢迎、单图/多图练习、体验领取及完成/收起检查点。语言为简中、日语、英语；用户输入不翻译。试题是明确 fixture，不能当成真实识题效果。
体验显式领取，领取成功才开始计时；跳过不消耗资格，之后可从账户页领取。额度、时区和过期规则由服务端及 SharedFreeTrial 定义，不在客户端自行授予。
菜单可重放引导；onboardingDone/onboarding.v3.dismissed 保持兼容。系统减少动态效果继续有效，DEBUG 可用显式 QA fixture。
验证：NotchOnboardingTests、OnboardingJourneyTests、OnboardingBoundsTests、OnboardingAccessibilityTests、OnboardingMotionTests。

## 答案、公式与 Ghost

流式答案经共享协议校验及可见文本过滤，机器标记不进入正文、剪贴板和辅助功能。人物像、review、retake、忙碌及空答案的复制资格由 shared/ui/reading.mjs 定义。
公式使用 SwiftMath，字体 bundle 必须随包交付。共享 Ghost 仿真经 JavaScriptCore 驱动，原生绘制由 BotAvatarsKit 提供。长文换行、选择、滚动、悬停展开、主动收起及硬件刘海避让保留原生适配。
Release 排除本应用窗口的软件截图；DEBUG 仅显式 QA 开关可放开。
验证：AnswerMathTests、SharedAnswerCopyTests、ManualCollapseHoverTests、HardwareNotchLayoutTests、GhostIndicatorTests。

## 最近查题与题库

只有合格成功结果进入本机历史；回顾不提交新请求、不扣题。RecentQuestionStore 在串行队列提交独立图片与元数据，并执行容量/条数/时间保留。队列持有原材料直到复制完成。
本地题库入口、导入、检索及本地答案流程已经移除；旧 Application Support 文件保持原样，当前应用不读取或清理。
验证：RecentQuestionTests、ContinuousReadingTests、CaptureFileLifecycleTests。

## 三通道与账户

新安装默认官方服务；自定义 API 和本机 CLI 仍是产品能力。隔离开发 bundle 固定 loopback mock 与临时凭证；真实本地启动保持用户已保存的通道和账户。
官方账户快照、401、取消、恢复与并发覆盖见 OfficialAccountStateTests、OfficialCaptureRunTests 和 OfficialStreamTransportTests。CLI 继续受账户 cli_enabled 约束。

## 设置中的账户与订阅

MainSettingsWindow 保留通用、快捷键、账户与订阅、人物像、服务与模型五页。布局以当前源码为准；历史轮次和视觉回调不作为新的修改要求。
通用包含作答方式、答案呈现、应用偏好；跟随系统外观，历史主题值保留。字号、默认展开、保持展开/收起延迟、语言、自动复制及自动连答上限沿用原偏好；修改上限从下一会话生效，无限不绕过额度、失败、空闲停止或手动取消。
账户按体验、订阅、额外用量、恢复组织。来源快照不重复相加；关闭已购题包自动使用由请求及服务端事务共同执行，不能只在界面隐藏消费。
恢复码只有用户主动查看时显示；恢复前用候选凭证验证完整快照，成功且账户/服务未变化才替换。失败保留原账户，恢复不合并余额。
Plus 状态区分未知、同步、未开通、待付款、到期及取消续费；回跳只触发刷新，不授予权益。取消续费采用窗口内确认，默认保留订阅。
控件保留键盘、辅助功能、焦点和减少动态效果；离页/关闭取消快捷键录制。语言重建后恢复焦点及可见性，异步完成不抢走已转移焦点；切页保留滚动位置。
验证：AccountOverviewTests、SettingsNavigationAccessibilityTests、UpgradeCompatibilityTests 及相关设置/焦点测试；离线预览使用[QA 工具](prototypes.md)。

## 应用内更新

UpdateChecker 从 /update 检测版本；用户触发后 InAppUpdater 从 /dl 下载、校验、同卷暂存、正常退出、替换并确认新版本启动。失败回退或保留备份；账户和设置目录不参与替换。
只接受可写目录内的已安装 App，拒绝 DMG、Translocation 和未打包运行。候选必须匹配正式 bundle、签名身份及版本要求，正式下载及重定向保持 HTTPS。
显式 --update-test-base-url 只允许 IPv4 回环及端口，不写偏好，不更换账户服务；签名和版本校验不放宽。下载可取消，安装/启动确认有期限，不能保证之后长期稳定。
发布前用 Developer ID 签名、公证的两个版本实测下载、升级、重启和权限保留；开发包及单元测试不代替这项证据。验证：InAppUpdaterTests、UpgradeCompatibilityTests。
