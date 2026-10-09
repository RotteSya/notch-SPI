# NotchSPI 工程交接

2026-10-09 人物像长名称显示修复（仅用户指定的显示检查第2项，未发布）：刘海名称按钮限制宽度并为状态/题数保留空间，超长名称单行省略，悬停和辅助功能保留全名；短名称与原有点击入口正常。Debug/Release构建、现有5项答案布局测试及三语15组实际视图几何检查通过，隔离离线窗口确认长名称不再挤掉状态、短名称完整、点击打开人物像页。证据在 `output/persona-title-fix-2026-10-09/`。正常运行包未替换，其余3项显示风险未修改。

2026-10-09 本机运行更新：按用户“在我的电脑上运行最新版本”要求，以 `scripts/run-local.sh` 构建、Developer ID 签名并启动 `dist-qa/NotchSPI.app`。已核对唯一 NotchSPI 进程指向该路径、无QA/模拟参数，沿用已保存的official服务模式，未配置baseURL覆盖；当前截图飞入刘海动效已进入本机运行版本。启动日志见 `output/screenshot-flight-2026-10-09/run-local.log`。未替换 `/Applications`、未发布。

2026-10-09 截图飞入刘海动效（已获用户“同意”实施，未发布）：参考 Tendedero 源码改为 0.68 秒缓入缓出飞行、30 pt 轻弧、逐渐缩小/形成深色圆角卡片，终点衔接现有题图并用 0.22 秒轻摆恢复水平。保留展开和接收亮光；单图提交、多图四秒计时不等待飞行，自动模式不新增大图动效。背景缩略图解码提升至2000像素，并校验到达回调轮次。Swift389项（4跳过、0失败）、warnings-as-errors、arm64 Release及diff检查通过；隔离DEBUG窗口核对四图/预览，真实单图截图I/O成功，提交使用模拟答案、无付费模型调用。未录制逐显示帧、未实测跨屏连续飞行；QA已退出，正常安装包未替换。详见[方案与验证](docs/screenshot-flight-2026-10-09.md)。

2026-10-09 查题延迟优化收尾（用户要求停止，未发布）：目标置为 paused，不再自动优化或派发评测；官方单图“触发→完整答案首绘”≤2000ms 仍未达成，多图单列。已有客户端与服务端优化保留，r2提示候选默认关闭。解锁后的免费mock实机首绘625.7ms，不代表真实模型或生产验收；原定四次付费实机验证取消，本日新增付费0。累计195次、146条独立核销，保守占用3.704196/5 CNY、剩余1.295804；其余49条仍全额预留。测试进程及隔离数据库已退出，源码与费用证据已备份；未推送、部署或替换正常安装包。旧锁屏检查将缺失键误判为锁屏的问题已修正，历史失败保留。详见[收尾记录](docs/capture-latency-2026-10-04.md)。

2026-10-08 查题延迟优化（未发布）：官方单图“触发→完整答案首绘”≤2000ms 仍未达成，多图单列。客户端已提前预热、追踪实际绘制、合并刷新/已校验SSE、复用严格校验的捕获句柄，并在macOS26+采用专用截图接口。结算事务直接返回同一已提交的账户/查题记录，省去终态重复查询（本地PostgreSQL由22次往返降至17次）；另将额度持有与模型尝试登记合为同一事务，模型调用前往返由44次降至39次。再合并模型尝试终态与预算结算事务，模型返回到回执由31次往返降至27次；原子回滚、跨账户冲突与取消/回执丢失验证通过，Node621、含隔离PostgreSQL759、类型检查通过；Swift源未改，既有385（4跳过）、Release/隔离smoke证据保留。前轮r4/r5提示和附加细节图仍有误答/超时；OCR快速模式漏数字，准确模式冷启动61097ms且排序漏标签/单位，均未合入。用户确认目前只有DeepSeek可用。10月8日已刷新价格/余额，事实先行提示与r5固定16次配对均答题6/6、拒答2/2，但两组排序摘要超行、新提示多处语言偏离且最长模型1888ms，未合入。累计195次、146条独立核销，保守占用3.704196/5 CNY、剩余1.295804；后续48次及原空输出保持全预留，usage峰值估计0.725288不是账单；新价格上界仅绑定本次配对计划。已准备隔离PostgreSQL四题实机验证；免费预检中新/旧截图接口均因锁屏返回-3811，模型调用0，待用户解锁；脚本已加锁屏准入检查。r2候选默认关闭；正常钥匙串/生产公网仍未验收，未部署或替换正常包。verify仍有2270历史断链。详见[证据与未完成项](docs/capture-latency-2026-10-04.md)及[独立核销记录](docs/evaluation-direct-provider-settlement.md)。

2026-10-04 21:24：经用户“上线”授权，付款恢复、免费额度与题包一致性已随 2.16 / build 23 正式发布。服务端先切换至 `dpl_2eoR8nPsyYgpujVcrnunkC3fHCdL`，沿用原生产基线加本轮文件；客户端标签 `v2.16` 对应 `cebab65`。干净发布工作树完整 verify、候选 PostgreSQL 710/710、CI 10/10、Apple 公证/Gatekeeper、正式 16 项检查及下载摘要均通过。未真实扣款、未更改收费规则；真实 Stripe 托管付款未实测。来源绑定、回退与验证边界见[2.16 发布记录](docs/release-2.16-2026-10-04.md)。

2026-10-03：本地完成付款与免费额度体验优化：完整题包选择与官网共享名称/配置；设备鉴权订单查询、持久化重试 ID、返回自动核对、Stripe GET 补核与重复通知幂等；账户页自动领取及版本一致的免费/付费明细、直接截图查题。Node 584/584、Swift 370（4跳过）、类型检查、Release 与隔离 smoke 通过；总 verify 仍为既有2270历史断链。未部署、未真实扣款、未改收费规则；推荐继续免注册，需求成立后自愿绑定轻账号。验证、官网来源、注册成本及发布兼容边界见[付款体验与账号评估](docs/purchase-experience-2026-10-03.md)。

2026-10-03 22:54：经用户授权，官网重构及两处确认文案已正式上线。生产部署 `dpl_8CPzewPfCAqw49bdzZBYrW7tX1Xi` 采用线上原 API 基线加官网文件，未带入无关后端/依赖变更。候选 Node 573/573、类型检查及 Vercel 构建通过；正式三入口×三语、健康状态、2.15 下载摘要和 Browser 交互通过。价格与支付/模型配置不变。官网代码 `c6b19ff` 已推送，完整记录及回退 ID 见[官网发布与验收](docs/site-redesign-2026-10-03.md)。

2026-10-03：官网完成本地重构：三语信息架构、杏色桌面/墨黑刘海演示、真实截图、响应式与减少动态效果；价格沿用服务配置，单题均价修正为两位小数，购买指引匹配 App 默认中档题包。Node 573/573、官网 12/12、类型检查与隔离 smoke 通过；Browser 检查桌面/平板/手机与下载事件，完整 verify 仍止于既有 2270 文档断链。未部署或更改收费。详见[官网实现与验收](docs/site-redesign-2026-10-03.md)。

2026-10-03：2.15 / build 22 已正式发布，标签对应 `3db0736`，移除新安装及更新后的匿名可靠性数据弹窗。CI 10/10、干净工作树完整 verify、Swift 367 项（4 跳过、0 失败）、Node 571 项通过；Apple 公证、装订、DMG/App Gatekeeper 和官方下载逐字节核验通过，原始 `/update` 返回 2.15。已通过夸克 CLI 上传 `NotchSPI-2.15.dmg` 至“夸克网盘/来自：ClaudeCode”。见[2.15 发布记录](docs/release-2.15-2026-10-03.md)。

2026-10-03：按用户要求移除启动时“匿名可靠性数据”弹窗，包括按版本显示的判断及旧引导完成时的显示记录写入；设置中的共享开关和遥测行为保持原状。Swift 367 项（4 跳过、0 失败）、arm64 Release 构建及 diff 检查通过。独立 DEBUG QA 包使用隔离凭证、日志及本机不可用服务地址，实机确认首次启动正常显示欢迎引导、已完成引导时仅显示刘海而无弹窗；QA 已退出。完整 verify 止于当前工作树既有 2270 条历史文档断链。证据位于 `output/remove-reliability-notice-2026-10-03/`；未打包发布或替换已安装应用。

2026-10-03：2.14 / build 21 已推送 main 并正式发布，标签对应 `63439f3`。刘海引导、答案与多图布局、四项快捷键及自动模式提示已进入正式安装包。CI 10/10、干净工作树完整 verify、Swift 367项（4跳过、0失败）、Node 571项、调度器17项通过；Apple公证/装订/Gatekeeper通过，官方下载字节与产物一致，原始/update已返回2.14。修复既有依赖审计与动效测试环境问题；生产服务未部署。见[2.14发布记录](docs/release-2.14-2026-10-03.md)。

2026-10-02 待机提示统一：截屏、多图、性格、自动模式四行共用按键胶囊、间距和对齐；动态读取自定义快捷键，补齐自动模式“随画面变化连答，再按停止”，性格模式空态也保留完整指南。新增 ready 离线视觉入口，QA 脚本通过 SwiftPM 查询产物路径以适配新工具链。DEBUG 实际窗口确认四行完整无裁切；Command Line Tools 构建 Release 并通过 Developer ID 签名校验，已退出隔离 QA 和旧进程并启动正常 dist-qa 本机包。Xcode 许可未接受、备用 CLT 缺少 XCTest，Swift 测试未完成；repo-health 仍为既有 2270 条历史断链。证据与日志位于 output/idle-ui-2026-10-02/。未推送或发布。

2026-09-30 多图解锁补验与本机更新完成：实际367项XCTest（363通过、4跳过、0失败），原动效时序测试原样通过。Computer Use获取36份约21秒窗口样本，核对1→4张收集、倒计时重置和自动提交后题图位置保持稳定；样本不是逐显示帧性能录制。随后退出隔离QA及旧运行包，以 `scripts/run-local.sh` 打包、Developer ID验签并启动当前正常Release构建 `dist-qa/NotchSPI.app`。确认唯一运行进程无QA参数、serviceMode为official、无baseURL覆盖；此次多图改动已进入本机运行版本。未替换Applications、未推送或发布。日志 `gallery-tests-resumed.log`、`gallery-run-local.log`，证据见[设计记录](docs/notch-answer-design-2026-09-30.md)。

2026-09-30 多图跟进（覆盖上一轮附件栏方向）：用户明确要求多图同步重做、不要把截图收为附件。已撤销提交后的64 pt底栏，改为始终位于答案上方的156 pt题目图区；128×80 pt稳定槽位、12 pt间距，加入下一张位置，统一张数/取消/倒计时。新增1～4张提交前后槽位不移动、图区始终在答案上方及不越界的回归测试。arm64 Release构建与diff检查通过，4项布局测试通过；全套367项中4跳过、1项既有动效时序测试首次失败，随后原样单独复跑通过。实际离线QA已走通四图收集→自动提交→答案，检查横竖宽图混排与第二张原图预览。继续记录连续帧时Mac锁屏，等待用户解锁；隔离QA进程已退出，正常运行包尚未更新为这次多图改动。详见[设计与证据](docs/notch-answer-design-2026-09-30.md)。

2026-09-30 用户本机测试：按用户要求以 `scripts/run-local.sh` 打包并启动当前设计改动的正常 Release 构建 `dist-qa/NotchSPI.app`；Developer ID签名校验通过，运行进程无QA/样例参数，保存的服务模式为official、无baseURL覆盖。账户与设置沿用，未替换Applications、未发布。构建启动日志见 `output/design-review-2026-09-30/run-local-latest.log`。

2026-09-30 答案面板设计重排：答案上移、已提交截图改64 pt附件栏、完成引导压缩至116 pt；修复Core Text首段背景裁切，统一测量/绘制/命中内边距，并减少重复排版与逐帧字符映射。解锁补验又修复滚动条/辅助功能滚到末端时最后一行仍淡出的缺陷。实际366项测试（4跳过、0失败），原两项显示时钟动效测试已通过；arm64 Release通过，verify仍为既有2270历史断链。真实离线窗口核对中英日文、四图、长答案首尾、失败重试及减少动态效果的完成/收起/重开。预览包直接打开固定离线入口，结束后已退出；未替换Applications、未推送或发布。详见[实现、截图与验收边界](docs/notch-answer-design-2026-09-30.md)。

2026-09-30 引导后始终返回练习答案：用户确认换题仍收到固定答案，定位为交付运行了 `onboarding-qa.sh` 的 localhost mock 包，并非正常服务对题目识别失败。已退出该QA和18929 mock服务，以 `package.sh qa` 构建、Developer ID签名并启动当前代码的正常本机包 `dist-qa/NotchSPI.app`，沿用原账户/服务，无QA参数。官方healthz报告DeepSeek，实机账户页面成功刷新原账户额度与累计使用量；未提交新题、未消耗真实额度，因此本轮不声称验证了真实换题答案。新增 `scripts/run-local.sh`，检查重复进程后打包并打开正常应用；mock引导脚本必须显式 `--mock`，展示名标注Mock QA，README区分正常使用与固定答案预览。Swift363项（4跳过、0失败）、arm64 Release及签名通过；完整verify仍止于既有2270历史断链。Release禁止软件截取自身窗口，本轮以实际AX操作和账户刷新核对运行状态，未提供伪造截图。日志见 `output/onboarding-handoff-2026-09-30/`。未覆盖/更新 `/Applications`，未推送或部署。

2026-09-29 练习步骤文案跟进：删除“打开后，回到刘海完成第一次查题。”，隐藏对应底部说明区，并将练习步骤从248 pt收至220 pt，与截图查题步骤同高。

2026-09-29 第二步按钮文案跟进：主按钮改为“按下⌘⇧1 或 点击查题”，并移除按钮左侧重复的快捷键提示；按钮位置和尺寸保持不变。

2026-09-29 引导步骤拆分：原查题准备页拆为独立的“第一步·打开练习题”和“第二步·截图查题”。第一步主按钮打开内置浏览器练习题，成功后才进入第二步；第二步同一操作行显示快捷键与“点击查题”。打开失败留在第一步重试，返回依次回退，权限中断会回到原步骤。引导19项通过，本机隔离mock走通打开练习题→点击查题→答案。

2026-09-29 欢迎页文案跟进：主标题更新为“每道题，抬眸尽收眼底。”；移除标题下重复的任务说明，将欢迎高度从264 pt收至220 pt，并把三步提示上移到164 pt；主按钮位置保持不变。引导19项测试通过，本机QA确认精简欢迎页及进入查题页的尺寸衔接无裁切。

2026-09-29 文案跟进：按用户反馈，本地QA答案去掉mock/部署说明，直接显示内置练习题的固定答案与计算过程；正式Provider不变。Node571项与类型检查通过，重启QA实机确认，见第三轮研究记录末节。

2026-09-29 第三轮：研究Raycast、Things、CleanShot官方入门资料及后两者动态演示后，收敛到固定主要动作、任务式权限、练习后操作栏保留和真实答案连续。已修复说明重影、收起裁切、失败页按钮重叠与查题后的键盘焦点，并支持完成后点击刘海重开答案。Swift363项（4跳过、0失败）及arm64 Release通过，本机隔离mock全链路/断线重试/拒绝注入/键盘验证已完成；verify仍有既有2270历史断链。见[案例研究、实现与证据](docs/notch-onboarding-research-2026-09-29.md)。工作区待审阅，未推送或发布。

2026-09-29 第二轮：修改前基线已本地提交 `c8a95e2`。按用户确定方向弱化流程卡片、欢迎按钮改为“准备开始查题！”，固定主操作位置，练习页保留捕获栏，说明单独淡化，完成时保持答案布局收回刘海。Swift359项（4跳过、0失败），引导15项通过；本机验证记录见 [第二轮引导打磨](docs/notch-onboarding-polish-2026-09-29.md)。未推送或发布。

2026-09-29：新用户引导已接入真实刘海面板，三阶段连接权限、实际截图与首答，完成后保留答案；关闭/检查点/重入/取消/重试与旧安装兼容已实现。Swift 355 项（4 跳过）与 Node 571 项通过，arm64 构建通过；总 verify 仍被 2,270 个历史断链阻断。已完成最终实机本地 mock 全链路、断网重试、键盘与重启持久化复验；修复 Tab 遍历、立即反向动画及 QA 包重复启动签名，未发布。见 [刘海引导实现与验收](docs/notch-onboarding-2026-09-29.md)。

2026-09-14：2.13 / build 20 已正式发布，一键捕获与刘海多图自动提问已上线。最终 CI 10/10、本地完整 verify、Apple 公证和公开下载摘要核验通过；服务端与额度配置不变。见 [2.13 发布记录](docs/release-2.13-2026-09-14.md)。

2026-09-13 正式上线：2.12 / build 19 已公开发布，后端于17:37上海时间核验可用，/update与/dl文件摘要通过；原44账户/4充值/1108使用记录迁移前后摘要一致。Cloudflare每分钟任务连续三次实际HTTP200，额度到期回收实测通过。累计测试保守25.905667/27元、正式模型每天20元；已启用首周只读费用观察。用户已接受阅读质量和延迟偏差，无待确认发布阻塞。完整运行/公证/备份/回退证据见[正式发布记录](docs/release-completed-2026-09-13.md)。

2026-09-13 15:40最终对照：240+240全部完成、执行与费用已独立核对；旧范围精确率/协议/Token门槛通过，新增p95延迟门槛失败。同模型legacy为7314ms，treatment真实240样本p95界为8661–8677ms，增幅18.42%–18.64%，约慢1.4秒。原reading质量限制已获接受，此次新耗时偏差尚待决定。累计保守25.905667/27元，无新增付费测试计划；候选cron已关闭。Neon隔离演练、生产部署dry-run及切换脚本复核均通过，正式库/生产尚未改变。见[最终对照与切换准备](docs/release-cutover-2026-09-13.md)。

2026-09-13 后续用户已明确接受首版披露的阅读质量限制，授权继续旧版对照及数据库切换后正式发布；保留原评分失败事实，不再按质量待确认暂停。旧范围对照正从一次失败后的第80题续跑，失败样本保留、无择优重测，最终保守测试总额上界25.905667/27元。Neon项目API已授权，恢复分支实测reset密码＋restart计算端点后，既有直连/连接池及旧密码新建连接均无法再写，新凭据可写；生产尚未改动。生产配置已准备为评测同款DeepSeek Flash低思考、回答4096/解释2048，每天20元、单次保守预留3元，题包JPY不变。

2026-09-13 全量回归终态：408题/80解释/2拒绝请求全部完成，解释79/80通过；多选仍有5真实漏选，排除16格式误判后的ready上界92/97=94.85%，并有协议/风险识别未达标，质量未通过、未发布。累计保守16.075267/27 CNY，后续付费对照暂停待质量对齐。公证、Stripe真实财务与CI均已通过；生产旧写入隔离仍待落实。见[完整回归与发布状态](docs/full-regression-2026-09-13.md)。

2026-09-13 Stripe真实财务读取暴露py_非卡付款编号被ch_专用校验拒绝，已修复付款/退款/争议/通知与来源绑定，53项支付测试、571项完整Node与类型检查通过，同一live订单800 JPY/手续费32/净额768已实际只读核对成功；临时探针已删除。见[支付编号兼容](docs/stripe-charge-identifiers.md)。模型全量回归在94b2d17独立候选继续，不改动其执行输入。

2026-09-13 用户恢复Apple公证及Stripe财务读取权限，并明确“全量回归后直接推出正式版”。当前原生2.12/19包已公证Accepted并staple/Gatekeeper通过，Stripe五类只读接口均200；生产未切换。新增regression评测身份，保留全题量/风险/真实provider要求，明确已见家族与family_split_verified=false；数值质量门槛不变，不伪造新盲测。累计测试仍27元、当前保守占用4.704771元；下一步在同一账本运行原408题、80解释与同模型基线后正式放行。见[发布调整](docs/small-user-release-2026-09-11.md)。

2026-09-13 解释/评分后续：low+2048的16次真实解释核心推导和冲突判断全部正确，具体错因6/8完整、2条部分；它是合成父答案诊断，不是正式留出验收。累计保守费用4.704771/27元、剩余22.295229元，测试实例已关闭。另补reading-answer-v3的source_literal单选原文规则，保留上下标以拒绝4⁰误当40；旧literal行为保留，旧v1/v2必须原版本重放。Node565/565、类型检查通过，100题原文政策需独立冻结后用于新manifest；详见[阅读评测](docs/reading-evaluation.md)。

2026-09-13 配置绑定修复：不同CLIENT_CONFIG_REVISION的实例会在辅助请求预留/调用前拒绝旧父请求；status与重复solve回执均关闭对应恢复能力，同版本可重试且名额未消耗。模型、提示词或输出上限变更须同时更新revision；不自动检测同revision环境漂移。Node564/564、类型检查通过；纯本地修复后复现仅一次mock调用，真实模型新增0，累计保守费用仍3.918339/27元。说明见[HTTP契约](docs/official-api.md)。

2026-09-13 进一步诊断：mixed16调用完成，答案8/8但解释严格7/8，gsm1145出现假冲突/自相矛盾；仍未放行解释。本轮48次全部最高预留保留，27元campaign占用3.918339元、剩余23.081661元。已支持显式EXPLANATION_MAX_TOKENS（默认768；1..4096；与slot cap取min），不自动开启或调整生产。后续先冻结新的一致性验证与费用证明，不能复用旧768上界或宣称8题为正式留出集。详情及跨配置绑定实证见[混合候选记录](docs/mixed-thinking-candidate-2026-09-13.md)。

2026-09-13 小范围真测：8ab68ed的32调用完成，独立复核none答案3/8、low8/8；low解释7/8正确可用，一条在768总token后失败。已新增按通道单独配置解释思考强度，下一步以新父答案验证low答题+none解释；Node557/557、类型检查通过。原32调用最高预留仍保留，27元campaign累计保守占用3.082755元。详见[混合候选与既有配置绑定待办](docs/mixed-thinking-candidate-2026-09-13.md)。

2026-09-13 模型候选准备：DeepSeek可按control/treatment分别配置none/low/high/max思考强度，默认none不变；总生成上界仍生效，隐藏reasoning不转发，总usage不重复计数。Node553/553、类型检查及独立代码复核通过，尚未部署/产生新付费模型结果。下一步固定小范围none/low诊断对照，见[候选说明](docs/deepseek-thinking-candidate-2026-09-13.md)。

2026-09-13 费用结算：同一27 CNY测试campaign的966条正用量已完成独立复核和事务结算；3条未知保留原最高费用，保守总占用1.411587元、剩余25.588413元，原969条派发不变。补齐错误账本路径拒绝、证据绑定、幂等和并发保护；Node551/551、类型检查通过，本次新增模型调用0。详见[费用结算记录](docs/evaluation-settlement-2026-09-13.md)。生产仍为7ba96db，模型新范围质量、Stripe只读权限和本机公证凭证仍待解决。

## 1. Authority / 阅读规则

| 字段 | 值 |
|---|---|
| `role` | 本仓库唯一工程交接 SSOT |
| `audience` | 人类开发者、Codex、Claude、其他 AI Agent |
| `repo_root` | `$REPO_ROOT`，用 `git rev-parse --show-toplevel` 取得 |
| `conflict_policy` | 文档与可执行代码冲突时，以测试和代码为现状，再修文档 |
| `no_remote_mutation` | AI 不得自行 push、部署、或改 Stripe / Vercel / Postgres |

`AGENTS.md` 与 `CLAUDE.md` 只指向本文件。产品介绍见 [README.md](README.md)。

当前增量状态（2026-09-11）：用户将整轮模型评测费用上限降为27 CNY，969次实际调用已完成；账户级差额约1.07元，保守预留26.915840元均保留。240+240旧范围对比通过；408题/80解释的新范围质量存在真实解题错误、解释矛盾和单选评分格式缺陷，未批准公开支持。实际retake+FINAL被误扣题的缺陷已在独立分支修复并通过544项Node、317项Swift与Release编译（另4项Swift按条件跳过），旧8846e61公证包不包含修复。Stripe实际服务端密钥Checkout读可用，财务三项只读权限待当场确认；生产未切换。完整现状、证据与历史边界见[9月11日执行状态](docs/release-execution-2026-09-11.md)。

历史状态（2026-09-10）：产品代码/公证包保持 `402d265`，Swift 302 项、2 项模型评测跳过、0 失败，CI 10/10。当前二进制再验证三次连续实际截图及断线后 recovery 无重复扣题，仍被最终界面观察持续超时阻断；replayd 连接管理队列异常采样已保留，截图服务再次重启后工具仍超时。QA/服务已停、图片 0、数据库检查通过。整机重启或另一台授权 Mac 是实机验收的下一步，未擅自重启整机。310 题、428 张输入图已建立统一私有复核索引，排序增至 10 道；另有 3 个与原题同族的多目标风险变体，仍无正式题集签署。生产尚未发布。当前结果见 [9 月 10 日发布记录](docs/release-progress-2026-09-10.md)，后面的记录保留历史边界。

2026-09-10 后续：`402d265` 的精确 CI 产物已部署到受保护隔离 Preview，使用独立 EVAL 项目的新库/受限账号，支付关闭；实际注册幂等/账户配置/恢复接口和零模型调用账本核对通过。生产未切换。三个评测执行器已统一受保护访问，修复提交 `debf6f1` 的 CI 10/10 通过：Node 514、Postgres 每组 635、Swift 302（2 跳过）、Cloudflare 14。候选尚未运行正式模型题集，具体部署与访问边界见同日发布记录。

2026-09-10 题集后续：现有 400 道待复核候选题、518 张输入图、四题型各 100；其中 313 题公开来源、87 道授权自编排序题。自编题经唯一排列和可见题面重算核验，但仅归入 6 个模板家族，未独立签署，不能视为已通过正式留出集。原有 310 条记录保持不变，完整来源与边界见题集获取记录；尚无本轮真实模型结果。

2026-09-10 材料复核后续：100 道多选原文/选项/答案与固定来源一致；前 6 道完整语义审查发现 4 道须暂停准入，2 道文字有依据但未独立签署，余 94 道未语义审查。已按授权编写 4 道自足英语阅读替补及逐项答案，题图和引用验证通过，单列待审，不改变原 400 条库存或虚称正式题数。题集/发布记录已更新；无付费调用或生产变更。

2026-09-10 恢复任务后续：`683a935` 增加隔离候选 Cloudflare Worker，CI 10/10（调度器 17 项）。真实持有已由定时任务释放，30→29→30、账本仅一次 hold/release、无模型调用；131 条保存的成功日志含一次 processed=1。但初始激活至实际释放约 4 小时 50 分，不能宣称分钟恢复时效通过；详见同日发布记录和 Cloudflare 调度说明。生产 cron 仍为空，未切生产。

2026-09-10 恢复时效复验最终：再次启用后 17 分 26.9 秒，第二条到期持有仍未释放（已过期 6 分 34.2 秒），自动时效验收未通过。已暂停候选 cron，经鉴权接口手动清理，账户回到 30、held=0、无模型调用；手动清理不算调度通过。生产/候选 cron 最终均为空，公开 URL 均关闭。下一步保留 Cloudflare 方案定位启动时效，发布继续暂停。

2026-09-10 定时延迟已关联官方事件：Cloudflare `sjs8s0q2x4hw`（Workers Cron Triggers degraded）截至 01:19 UTC 为 identified、未恢复，公告明确触发延迟/不执行及配置传播延迟，与第二次实测吻合。当前服务器/本机时钟差约 0.306 秒。保留免费方案，两套 cron 继续暂停；官方恢复后再做实际触发和到期幂等验收，不在故障期重复重建或启停。无模型费用/生产改动，其他独立评测准备可继续。

2026-09-10 独立审题后续：用户明确授权独立 AI 子代理，原 400 题已全部语义复核，92 道有内容/答案说明问题；另一个公式排版问题已另存修订并通过独立原尺寸检查。排序 100 道答案一致、四道自编替补答案确认；原库存未改。518 张原图均有观察记录，但多选 218 张原分辨率逐字检查仍缺，其他范围/授权/家族/评分与正式 manifest 也未冻结。无产品付费调用、预算重置或生产变更；Cloudflare 截至 11:55 UTC 仍未恢复。下一步按 [独立复核记录](docs/independent-corpus-review-2026-09-10.md) 的逐题清单策展，不能重新把出版方答案默认当作真值。

2026-09-10 策展后续：四批新增 40 道自编多选均完成独立审题，station05 歧义另存修订并复核；自编共 44 道。ScholarBench 撤销无依据的整体 AI 专用许可要求，保留五道可作答题的具体上游文章权利待核，其余 29 题/64 原图完成原尺寸复核，字体/源文缺陷按影响保留。另审 12 ARC/20 GSM，三处出版错键经独立交叉核对为 952→1800、454→240、823→18。当前策展为单选100、短填100、排序100、多选73，共373，仍缺27道多选及真实布局/风险/评分与正式签署。修订不多计、原400库存不改、未调用产品模型。Cloudflare截至13:24 UTC仍未恢复；生产未发布。详情见[策展与纠错记录](docs/corpus-curation-2026-09-10.md)。

2026-09-10 最新策展：已补齐 400 道逻辑题、449 张图，四型各 100；新增多选完成独立 AI 审题，组合 506 项检查及 791 个文件绑定通过，仍未签署正式 manifest。用户明确保持整轮 100 元并评估便宜模型，DeepSeek Flash 价格测算可继续，但本地密钥只读查询 401、Vercel sensitive 读取 403，待有效密钥。生产/每天20元政策未变，模型调用0。Cloudflare截至14:22 UTC仍未恢复。详见[最终策展](docs/corpus-curation-2026-09-10.md)和[费用方案](docs/cheaper-model-feasibility-2026-09-10.md)。

2026-09-10 评分准备：阅读 manifest 新增 schema 2，逐题绑定多选集合、完整排序/预填空位、精确数值与单位规则，并把评分版本和代码摘要纳入授权。schema 1 与原240基线保持原行为。独立反例复核发现的指数拼接、OR标签混淆、排序漏项及单位格式问题已修复；规则能力不等于400题逐题政策已签署。使用方法见[阅读评测](docs/reading-evaluation.md)。产品模型费用仍为0；有效DeepSeek密钥、正式材料/范围及发布验收继续待办。

2026-09-10 最新预检与策展：阅读整套请求统一4MiB，计重复题图及解释/拒绝正文，CLI保护握手延至材料预检后；本地Node528项及类型检查通过。评分提交43ed6bd的CI已10/10。逐题复核发现5道短填目标/单位hold，已独立复核5道替补并建v3索引，400题/449图、395旧条目不变。两道带单位排序政策与货币前缀仍有评分覆盖缺口；正式manifest未签署，生产未发布、产品模型调用0。详见同日[发布记录](docs/release-progress-2026-09-10.md)与[策展记录](docs/corpus-curation-2026-09-10.md)。

2026-09-10 数量评分后续：reading-answer-v2新增逐项数量/单位与显式货币前缀、换行分隔，修复此前2道数量排序和24道货币格式覆盖问题；400题政策草案已组装并基础校验。完整Node533项及类型检查通过，生产解析/实时评分/离线重放一致性另测。旧评分v1须用原版本复现，schema1与240题基线不变。前一c512987的CI10/10；当前新实现的CI及独立反例报告另存。正式manifest、有效模型密钥、真实布局/风险及发布闸门仍未完成，产品模型调用0、未切生产。

2026-09-11 最新材料准备：f03a1b0和aa2c25e的精确CI均10/10，Node各533、数据库各654、Swift302（2跳过、0失败）、Cloudflare17。12张受控浏览器截图已独立复核，含四逻辑题五种呈现和六个异常探针；另获取真实Wikibooks练习页的一道短填及整页多目标两图，独立确认出版错键−7应为7、旁边无正确选项题排除。新增输入图片/范围/4MiB请求预检通过，原400库存不变，正式组合未签署。受控视口和单个外部题不证明广泛用户分布。100元整轮未改、模型调用0，密钥文件仍未更新，Cloudflare故障待恢复，生产未发布。完整边界见[9月11日发布记录](docs/release-progress-2026-09-11.md)。

2026-09-11 最新用户决定与集成：存量用户少，本次2.12改为内部必要验收通过后向现有用户开放、上线后观察；取消四档各72小时/200请求及至少12天等待，执行见[小用户量发布调整](docs/small-user-release-2026-09-11.md)。本轮恢复界面和解释完成已在隔离QA中实测可读且余额不重复扣题；随后把本地截图权限统一入口、超时备用命令和相应测试合入发行分支，必须用新输入复验/重新公证后发布，旧402d265包不包含这些补丁。

## 2. 5 分钟快速启动

| 字段 | 要求 |
|---|---|
| Prerequisites | macOS 14+、Apple Silicon、Xcode/Swift 5.9+、Node ≥22.18.0、npm |
| Bootstrap | [`./scripts/bootstrap.sh`](scripts/bootstrap.sh) |
| Run | [`./scripts/dev.sh`](scripts/dev.sh) |
| Expected server state | `GET /healthz` 为 mock provider、sqlite 或 memory、payments 为 stub 或 disabled |
| Side effects | `npm ci`、Swift debug build、本机临时服务；不碰生产、不写真实 Keychain（`NSPI_QA_EPHEMERAL=1`） |
| Stop | 退出客户端后，dev script 用 trap 关闭服务端 |

`./scripts/dev.sh --server-only` 只起服务，供无 GUI smoke。本地开发不读取 `server/.env`；`npm start` 也不会自动加载它。

## 3. 系统地图

两个组件：Swift macOS 客户端；Node/Fastify 官方服务。

唯一入口：

- 客户端：`Sources/NotchSPI/App/main.swift`
- 本机监听：`server/src/index.ts`（`buildApp()` + `isMain` listen）
- Vercel：`server/api/index.ts`（Root Directory = `server`，相对 `$REPO_ROOT`）

单次问答：热键 → 捕获 JPEG → `Prompts.build` → 通道路由（官方 / 自定义 Key / 本机 CLI）→ provider SSE → 合成 → 刘海 UI。官方通道由 `CaptureService` 绑定请求 ID，`BillingStore.begin/finish` 原子持有、结算或释放；旧 Store 方法保留为兼容适配。

Objective V1 打开时：`ClientConfigService` 冻结远端分组 → 三通道使用同一 `CapturePrompt` → `ObjectiveResultStreamFilter` 隐藏机器行 → `ObjectiveResultParser` 统一映射 `ready/review/retake`。官方服务以冻结请求的 `result_protocol` 选择 control 或 Objective treatment Provider，并只在 route 层解析完整输出、决定结算或释放；Provider 不拥有协议与计费语义。匿名事件经 `ProductTelemetry` 的 7 天/100 条本地队列上传到 `product_events`；事件永不包含截图、题目、答案、Prompt 或模型原文。`ObservationJournal` 将队列、同意版本与覆盖游标原子持久化；`/v1/device-observation` 同步偏好与核验摘要。关闭时立即删队列并停止行为上传，仅同步最小偏好。服务端通过唯一序列回执验证 complete，缺口不得默认完整；事件、回执、覆盖按 90 天清理。

存储选择（`server/src/storage.ts` 动态 `import()`）：Postgres（`POSTGRES_URL` / `DATABASE_URL`）→ 开发 Serverless 上的 memory → 本地 SQLite。正式模式要求持久存储，缺少必要模型预算、价格或恢复配置会拒绝启动。注册采用 fixed30 政策，历史余额保留；首次访问旧余额时建 `legacy_unknown` lot。

旧余额 lot/ledger 与迁移检查点同事务提交；SQLite 整批扩展事务和 Postgres 按 schema 加锁防止半迁移及冷启动竞态。`quota_migration_control` 让兼容实例共享暂停状态，已有结算与恢复继续。`scripts/migrate-quota.mjs` 只接受显式数据库，按设备核对历史充值/用量摘要、lot/ledger/余额，恢复要求最新余额版本全部校验。所有命令含 schema 初始化，status 也可能执行 DDL。生产先排空并退出旧写入实例；禁止回退到 7ba96db 直接改新库。流程与本地验证边界见 [迁移与兼容回退](docs/quota-migration.md)。

SQLite 在切换 WAL 时可能绕过 busy handler 直接返回 SQLITE_BUSY；初始化仅对该幂等操作使用 5 秒单调时钟总预算、25ms 让出间隔，成功后恢复普通写事务的 busy_timeout。所有初始化错误统一关闭连接。该竞态由 Linux 四进程旧库冷启动测试发现。

注册重试同时受 token 与注册凭证的唯一性约束。SQL 插入处理两个唯一索引的并发冲突后，按 token 锁定并核验原凭证绑定，只在实际插入时创建 trial lot/ledger；Memory 执行同一不可重绑检查。冲突不能新发试用额度，也不能返回其他凭证所属设备。

2026-09-09：框选窗口鼠标/键盘已完成实机验收；实际截图→localhost mock→答案/结算链路通过。答案辅助功能、材料删除闭包和隐藏材料栏的文件持有、正常退出临时文件清理已修复；完整 Swift 290 项、2 项真实模型评测跳过、0 失败。最终版最后一张材料删除、新题组清空及随后正常退出已实机通过；完整框选请求链路与性能验收仍缺。安装盘固定 HFS+ / UDZO；最终候选 `645c1de` 已重新公证、装订及 Gatekeeper 验收，60 个输入摘要与代码匹配，仍未公开发布。最新证据与剩余条件见 [9 月 9 日发布记录](docs/release-progress-2026-09-09.md)。

后续诊断定位到系统窗口枚举长等待：单次 SCShareableContent 约 52.376 秒，实际取图约 332ms。`be9676c` 已合并同类枚举并为调用者增加每次系统操作 10 秒等待期限；取消/超时不叠加底层操作，迟到图片不编码发送，旧显示器 generation 不发布缓存。完整 Swift 294 项、2 项模型评测跳过、0 失败，CI 10/10 成功；12 次实际查题成功，另一次系统等待在约 10.077 秒结束且未扣题。完整框选工具读取与正式性能门槛仍未通过，不能宣布整体验收完成。最新公证候选对应 `be9676c`、61 个输入摘要；进程与测试图片已清理，见发布记录“后续定位与系统等待保护”。

最新 `345d677` 已补齐截图准备任务所有权和取消传播，Swift 297 项、2 项模型评测跳过、0 失败，CI 10/10。新包已公证/装订/Gatekeeper 通过，62 个输入摘要匹配。隔离自动框选仍复现系统枚举长等待；replayd 采样显示连接管理队列忙于集合比较，依赖 XPC 队列等待，尚不能断言死锁。两个账户均未扣题、未请求模型，QA/本机服务已停止、图片 0。下一步系统服务重启会影响其他 App 录屏/共享，需先就该系统范围操作与用户对齐；尚未执行。完整框选和正式质量门槛仍阻止发布。详见发布记录“取消截图准备与系统服务阻断”。

2026-09-09 晚间：用户已授权系统截图服务重启及自主获取题集。replayd 已重启，真实截图→框选→本机 legacy 答案链路通过一次（386ms，30→29，只结算 1 题）；随后界面工具观察仍有超时，QA/服务已停，图片已清理。正式新合约/稳定性验收仍缺。ARC 7,787 题、GSM8K test 1,319 题已固定版本获取，200 张待复核卡片已生成；不把它们标为正式 400 题留出集。下一步继续补多选/排序、布局及独立复核，不再等待用户提供题集或重复索取截图重启授权。见最新发布记录及公开题集获取记录。

公开题集后续进展：ScholarBench 完整性恢复后已准备 100 道真实多选、218 张图片；原文图表依赖和家族关系仍待审。STA 19 份完整官方 PDF 中 6 道排序题已对照原卷/评分标准，3 张多题页另保留完整目标区域。复核队列累计 306 题（单选/多选/短填各 100、排序 6），仍不是正式 holdout；不含付费模型结果。产品代码/公证包保持 `345d677`，生产新能力未开。详情见 [公开题集记录](docs/public-corpus-acquisition-2026-09-09.md)。

2026-09-08：2.12 / build 19 已生成公证并装订的正式候选 DMG，未公开发布。Cloudflare `notchspi-reaper` 已部署，生产接口就绪前保持无定时触发；Vercel 生产环境已配置 CNY 20/日、上海零点重置的成本预算，部署新版后才生效。部署记录与当前剩余闸门见 [本轮发布记录](docs/release-progress-2026-09-08.md)，恢复任务说明见 [Cloudflare 调度](docs/cloudflare-scheduler.md)。

Neon 资源 `neon-rose-lens` 的实际快照已恢复到独立分支，并完成 pg_dump/pg_restore、44 账户额度迁移与全历史字段摘要核验。生产 main 未迁移或切换，正式停流备份与旧写入隔离仍需完成，见 [恢复演练记录](docs/neon-restore-rehearsal-2026-09-08.md)。

2.12 / build 19 是尚未发布的候选。题组、区域选择、解释、恢复及新合约仍受放行开关控制；完整蓝图进度与未完成闸门见 [发布进度记录](docs/release-progress-2026-09-06.md)。不得将本地软件测试通过视为新场景模型评测或生产灰度通过。

SPI 与阅读练习页面分别为 `/spi`、`/reading-practice`，三语共用实际定价与下载；未完成评测的阅读范围明确显示未开放/内部测试。引导新增可跳过的自报来源：先本地持久化、再绑定当前 host/device 同步，只有确认后标记 self_reported，跳过保持 unknown。它不改变题目模式、额度或功能。

问题反馈先逐张预览/选择，再明确用途与授权，本地导出 `feedback-v2` JSON 及私有材料文件夹；不会自动发送。离线 `scripts/manage-feedback.mjs` 处理独立收件、审核、撤回与到期删除。正式收件须先配置授权成员、受控邮箱/备份清理及每日任务并做真实演练，详见 [反馈操作规程](docs/feedback-operations.md)。当前导出授权不允许外部模型处理。

新合约主查题、解释和恢复在预扣前通过 `image-validation.ts` 完整验证静态 JPEG/PNG。sharp 固定版本随 lockfile 安装，正式部署须带上目标平台的 optional 原生包；不能仅复制 Mac 的 node_modules。16MP、每进程两个解码任务、每图 libvips 处理超时和禁用操作缓存共同限制资源；仍须验证真实部署平台。

`CaptureService` 在鉴权前监听连接关闭，在解码、预算、持有及尝试记录之后检查取消。三种操作共用准入和并发清理；持有提交回执丢失时，用仅由服务端生成的 requestId 回查归属，禁止释放其他执行者的同 ID 请求。确认未调用模型才释放预算并把已有尝试记为零调用；已启动但 usage 未知保留成本上界。清理事务不可用时记录待核对，持有仍依赖独立恢复任务兜底。

客户端官方 SSE 的唯一读取实现为 `OfficialStreamDecoder`：按字节分帧、严格 usage 类型和顺序、明确 DONE、有限正文及流大小。截断或非法事件不算成功；已收到的结算回执与完整收到答案分开处理，中断只查询原请求状态。新账号/服务地址不接收旧请求的余额。原始内容不进入诊断日志。

`OfficialAPI.run` 的 delta、usage、401、状态补查及最终成功回调在主线程执行时重新检查取消和请求所属账号/地址。`CaptureEnvironment.live` 连接真实 URLSession 与账户镜像，测试可用独立账户状态运行同一请求实现。status 只接收最多 64 KiB JSON，并匹配请求 ID/operation；结束或提前拒绝时取消对应传输任务。`OfficialCaptureMaterials` 在编码前限量读取普通文件，拒绝符号链接/管道，保留原字节与页序；该步骤不代替服务端完整图片解码。

官方捕获 JSON 上限为 4 MiB，为已核验的 Vercel 4.5 MB 入口保留余量；self-hosted 服务的 16 MiB 上限不能作为官方客户端的传输承诺。材料读取按 base64 编码长度与兼容字段重复题图计入预算，序列化不展开斜杠，发送前复核完整 JSON；不降低图像质量、不静默丢页。平台或服务 413 映射为三语框选/减少材料提示，不自动重发。服务端在 Vercel 模式使用 4,500,000 字节 parser 上限，413 返回 payload_too_large。目标平台原生解码/内存验证入口为 `scripts/verify-linux-runtime.mjs`，须在 Node 24 Linux x86_64、1 GiB cgroup 中运行，模拟器耗时不代表生产 SLA。

`OfficialAccountState` 是官方凭证与本地镜像的同步所有者；默认仍使用原 Keychain service/account 和 UserDefaults 键。Keychain 读取区分 missing 与 unavailable，后者不能触发注册或覆盖旧凭证。旧明文仅在 Keychain 确认无项目时迁移，写入失败保留恢复副本；新注册先持久化随机 retry credential，正式 token 保存核验后才清除它。重置必须确认 retry credential 与 token 删除成功后才可重新领取，失败保留账户镜像并在界面报错。

账户缓存以服务地址/令牌摘要绑定；服务、设备或已观察到的身份 generation 变化后，旧注册/刷新/SSE/充值链接不能修改当前镜像。刷新按请求序列与 balance_version 整体应用余额、CLI 权限和服务端总量，旧版本响应不能单独覆盖总量/权限。注册、刷新、购买交接只读取最多 64 KiB JSON，拒绝重定向；购买链接在实际打开前再次核验绑定。镜像变更在解锁后发通知，允许观察者同步读取。原生 NotchController 父请求与题组联动仍须后续验收。

服务端 `BillingStore.accountSnapshot` 在同一设备锁和事务内读取 devices 的余额/版本/累计用量/CLI 权限及 quota lots；Memory 无 await 地复制同一状态。`GET /v1/account` 完成鉴权诊断与恢复任务后使用该快照，不拼接鉴权时较早的 Account。注册响应的余额与版本也取自同一个 quota 快照。非法或无法精确表示的计数拒绝输出，缺失/读取失败不回退至较早账户镜像；接口字段和 schema 不变。三存储并发、过期恢复及旧行重开测试通过。

结算 `finish` 也在原事务内返回完整账户快照。SSE usage、status 和重复请求元数据增加 `account_totals:{questions,input_tokens,output_tokens}`，与同一 `balance_version` 绑定。客户端按身份和版本整体替换累计镜像，不再累加逐次 usage，避免刷新后重复计入、乱序漏计及解释 token 混入口径。累计范围沿用服务端 solve 计数；辅助尝试费用仍单独入账。旧服务缺少累计快照时保留现有计数并执行有界账户刷新，启动与返回均核验原账户身份；新服务端字段先上线。重复/乱序/旧服务兼容和三存储事务测试已通过。

`CaptureRequestBinding` 冻结目标、模式、所选通道及官方账号/base/generation，自定义 Key/endpoint/model 或 CLI 变化也改变材料 scope；scope 使用长度前缀编码后的 SHA-256，不含可读密钥。`NotchController` 在异步边界和回调校验绑定；账户通知、周期检查及明确清理取消当前官方任务和补查、关闭区域选择并使旧 generation 失效。解释/恢复复用父请求账号；`reconcileCaptureStatus` 用冻结凭证补查并在原账号仍有效时更新完整累计镜像。首次注册在本次查题截图前完成；只有未注册、同选择且未过期的材料组可绑定至本次成功确认的账号，以保留先存正文再查题的流程。上述核心/HTTP/文件测试通过，真实 AppKit 交互仍待解锁验收。

恢复答案解释仍走原收费 solve 的 `/explanation`，用可选 `answer_capture_id` 指向该 solve 明确关联、已完成且可用的直接恢复结果。路由核验材料/答案/版本，Store 在同一设备事务内再核验父链并占用原 solve 的唯一解释名额；两份答案共用一次限制和原父 15 分钟截止，不延长期限、不新增扣题。capture 元数据保存选择的答案 ID，成本父关联和原表主键不变；没有 DDL。Swift 分别保留收费 capture 和可见答案 capture，仅在完整交付及明确 capability 后开放解释，回执与正文完成分开判断。三存储并发/失败/期限、真实 HTTP selector 和解码测试已通过，真实 UI 验收仍未完成。

外部边界：模型厂商、Stripe Checkout、Postgres、GitHub Release（`/dl` 与 `/update` 的内部产物源）、Vercel Fluid（SSE 长连接）。公开生产源是服务根路径；客户端默认 `OfficialAPI.defaultBaseURL`。

## 4. Single-Source Ownership Map

| 事实 | 唯一权威源 |
|---|---|
| 产品支持范围与开发命令 | 本文件 |
| App 版本 / build | [`VERSION.env`](VERSION.env) |
| Swift target / platform | [`Package.swift`](Package.swift) |
| Node 版本 / 依赖 / 命令 | [`server/package.json`](server/package.json) + lockfile |
| 环境变量默认值 | [`server/src/config.ts`](server/src/config.ts) |
| 环境变量示例与风险说明 | [`server/.env.example`](server/.env.example) |
| HTTP 客户端契约 | [`docs/official-api.md`](docs/official-api.md) |
| 实际路由集合 | [`server/src/routes.ts`](server/src/routes.ts) |
| 数据接口 | [`server/src/db.ts`](server/src/db.ts) |
| fixture / 阈值 | [`Tests/Fixtures/Personality/manifest.json`](Tests/Fixtures/Personality/manifest.json) |
| Objective 协议 / fixture / 闸门 | [`server/src/objective-result.ts`](server/src/objective-result.ts) + [`Tests/Fixtures/objective-v1/manifest.json`](Tests/Fixtures/objective-v1/manifest.json) + [`Tests/Fixtures/objective-v1/RUNBOOK.md`](Tests/Fixtures/objective-v1/RUNBOOK.md) |
| 发布产物流程 | [`scripts/package.sh`](scripts/package.sh) |
| 回归闭环 | [`scripts/verify.sh`](scripts/verify.sh) |

## 5. 不可破坏的不变量

- `INV-BILL-001`：成功问答扣 1 题；真实失败不扣。
- `INV-BILL-002`：并发预扣不得产生负余额。
- `INV-AUTH-001`：瞬时 401 不得自动销毁付费额度唯一凭证（设备令牌）。
- `INV-STREAM-001`：SSE 正常序列为 `delta`×N → `usage`×1 → `DONE`。
- `INV-CAPTURE-001`：Release 永远排除本 App 软件截图；DEBUG 仅显式 QA 开关可放开。
- `INV-DEPLOY-001`：服务端新增契约字段必须先于客户端部署。
- `INV-STATE-001`：自动模式、人格连续题、截图缓存的生命周期边界不得互相泄漏。
- `INV-SECRET-001`：厂商 Key、管理员 Key、数据库凭证不得写入 Git 或日志。
- `INV-RESULT-001`：Objective 机器协议不得进入可见正文、剪贴板或辅助功能朗读。
- `INV-RESULT-002`：`ready/review` 必须具有可用答案；`retake` 与无可用结果不得扣题。
- `INV-TELEM-001`：产品事件只允许固定键与枚举，不得携带截图、题目、答案、Prompt 或模型原文。
- `INV-TELEM-002`：关闭匿名可靠性数据后，客户端必须立即删除队列且不得生成或上传新事件。
- `INV-PROVIDER-001`：未携带 `result_protocol` 的 control/旧客户端流量只走 `OFFICIAL_PROVIDER`；`objective_v1` 才可走独立 treatment Provider，任一 slot 失败不得向另一组泄漏或扣题。

热键定义在 `Sources/NotchSPI/Settings/Settings.swift`：`⌘⇧1` 讲题、`⌘⇧2` 上下文追问、`⌘⇧9` 人格测试、`⌘⇧0` 自动模式、`⌘⇧Space` 显隐。`⌘⇧3–6` 是系统截图键，不要占用。

## 6. 变更影响矩阵

| 改动 | 必须同步跑 |
|---|---|
| HTTP body / SSE | 契约文档 + Swift `OfficialAPI` tests + Node API/SSE tests |
| Store 接口 / schema | memory + sqlite；有 `TEST_POSTGRES_URL` 时再加 postgres（库名必须含 `test`，会 TRUNCATE） |
| Prompt / protocol | golden fixtures + personality composition tests |
| UI / 热键 | Swift tests + DEBUG visual QA |
| 版本 / 打包 | `VERSION.env` + repo-health + plist / codesign / notary |
| 环境变量 | `config.ts` 与 `.env.example` 对齐（repo-health） |

## 7. 兼容性账本

删除门槛（三项同时满足才可另立任务）：所有者明确最低支持版本 + 生产遥测证明旧版本归零 + 至少跨过两个正式版本。

| ID | 位置 | 保护对象 | 状态 |
|---|---|---|---|
| `MIG-KEY-001` | `Settings.swift` `apiKey(for:)` | UserDefaults 明文 API Key → Keychain | live |
| `MIG-TOK-001` | `OfficialAPI.swift` `deviceToken` | 设备令牌 → Keychain；丢失则已购额度不可恢复 | live |
| `MIG-PER-001` | `PersonaStore.swift` init | 单 persona 字段 → persona library | live |
| `MIG-FONT-001` | `Theme.swift` `legacyAnswerFontSize()` | `answerSize` 三档 → 连续字号 | live |
| `MIG-WIRE-001` | `OfficialAPI.swift` + `routes.ts` | `image_base64` 单图；`images_base64` 存在时仍带最后一张 | live |
| `MIG-STOR-001` | `APIProvider.swift` | Anthropic/OpenAI 的 `storageKey` 仍为 `claude` / `codex`；DeepSeek 使用独立 `deepseek` | live |
| `MIG-DB-001` | `db-postgres.ts` / `db-sqlite.ts` | lazy columns：`topups.note`、`devices.cli_enabled`、`onboarded`、`hotkey_presses` | live |
| `MIG-OBJ-001` | `ObjectiveResult.swift` / `routes.ts` | 未携带 `result_protocol` 的客户端继续使用旧 Prompt、旧解析与 `MIN_BILLABLE_CHARS` 计费 | live |
| `MIG-PROV-001` | `config.ts` / `providers/index.ts` / `routes.ts` | Objective treatment Provider 缺省继承 control；旧客户端不因实验模型配置而迁移 Provider | live |

`db-postgres.ts` / `db-memory.ts` / `db-sqlite.ts` 由 `storage.ts` 动态加载。`recordCount` 是 `@testable` 测试观测面。`Resources/NotchSPI.png` 供未打包 `swift run` 的更新对话框图标。

## 8. 验证与发布

- 本地：[`./scripts/verify.sh`](scripts/verify.sh)。Swift 测试必须串行；verify 为普通迁移测试启用 `NSPI_QA_EPHEMERAL=1`，避免读写用户真实密钥。账户集成测试显式使用独立随机 service 的真实 Keychain，并在结束时删除测试项目和独立 defaults suite；默认 `.live` 联动使用隔离的全局凭证后端。
- CI 在 main、PR 和 `codex/product-update-2-12` 验证分支运行；覆盖 Node 22.18/24.20、Postgres 16/17、macOS 串行 Swift 与原生 AL2023 1 GiB 资源探针。验证分支的 Vercel Git 自动部署已在配置中关闭；CI 不携带生产凭证。原生 CI 结果必须实际通过，模拟器的整文件进程退出不能按重跑成功抹去。
- 付费 personality 闸门：[`Tests/Fixtures/Personality/RUNBOOK.md`](Tests/Fixtures/Personality/RUNBOOK.md)。阈值只在 `manifest.json`。
- 付费 Objective 闸门：[`Tests/Fixtures/objective-v1/RUNBOOK.md`](Tests/Fixtures/objective-v1/RUNBOOK.md)。普通 CI 只验证 240 张 manifest、SHA-256 与解析器；正式运行必须显式设置 `NSPI_RUN_OBJECTIVE_EVAL=1`。
- DeepSeek Objective r5 的 240 题绝对闸门与同模型 legacy 相对闸门均已自动通过并由 RotteSya 以独立 attestation 签署：准确率 96.57%、V1/状态/retake 100%、平均 Token +5.92%、p95 -43.58%。脱敏归档、比较与签署见 Runbook。安全灰度保持 control `OFFICIAL_PROVIDER=anthropic`，以 `OBJECTIVE_RESULT_V1_PROVIDER=deepseek` 隔离 treatment，并从 `OBJECTIVE_RESULT_V1_BPS=0` 开始。
- 打包：`./scripts/package.sh qa` → `dist-qa/NotchSPI.app`；`./scripts/package.sh release` → `dist/NotchSPI.dmg`（Developer ID + 公证 + staple）。无证书的 release 必须显式 `--unsigned`。
- Owner-only：push、tag `v${APP_VERSION}`、GitHub Release 上传 DMG、Vercel 部署、Stripe webhook 配置。
- 服务端契约新字段先于客户端发版（`INV-DEPLOY-001`）。
- Vercel 静态输出只允许 `server/public/robots.txt`；`outputDirectory=public` 防止默认静态打包公开 src/test。`scripts/verify-vercel-output.mjs` 检查真实构建包的公开清单、目标原生模块、动态 SQL 导入及入口 HTTP/SSE；CI 用固定 CLI 59.11.7 在 AL2023 构建后于断网容器执行。macOS 生成的 sharp 包只能做宿主诊断，不能交付 Linux。Fluid 当前计费模式忽略函数 memory 设置，1 GiB 测试是保守资源约束，不是生产内存配置证明。具体证据和边界见 [Vercel 函数包核验](docs/vercel-bundle-verification.md)。
- 过期请求通过独立 `GET /api/internal/reap` 调度恢复，使用独立 `CRON_SECRET`。2026-09-07 已只读核验 notchspi-api 使用 Node 24.x，所属团队为 Hobby；当前每分钟 Vercel cron 配置超出该套餐能力，会阻断部署。生产须落实已有外部分钟调度，或经费用授权升级支持分钟调度的套餐，再验证实际恢复日志。调度方案待确认，进程内计时器不能替代它。已收费请求的恢复失败或 worker 终止均只补偿一次 goodwill。

支付运营：Stripe webhook 必须同时订阅 `checkout.session.completed`、`checkout.session.async_payment_succeeded` 及 `refund.created` / `refund.updated` / `refund.failed`。受限 key 需要 Checkout Sessions read/write 和退款对象 read 权限，无需发起退款权限。订单入账与额度同事务；退款先读当前资源再按持久化 generation 应用，全额成功撤回未用 paid lot，处理中冻结，失败恢复。部分退款需 `/admin/payments/refund-decision` 的明确题数和当前指纹；历史 `legacy_unknown` 不猜测归属。`GET /admin/payments` 为受限核对视图，不能代替全量财务聚合。细节见 API 文档和发布记录。

购买恢复：`purchase-session.ts` 与共享 SQL 事务实现三存储一致语义。同一已鉴权 purchase ID 重试只换发随机短 secret、恢复原订单及期限；原短链接失效。Checkout ID/URL 持久化，丢失响应可恢复同一页面；已付款会话在充值事务中写 `consumed_at` 后禁止再次使用。过期短链接不阻断已经创建的 Checkout 延迟到账。`purchase-page.ts` 提供三语言购买/返回页，返回页仅提示回 App 核对余额。

异常付款：`checkout-reconciliation.ts` 统一最小快照、不可变归属与明确审核规则；Memory/共享 SQL 队列先提交签名收据，再应用额度事务。依赖缺失和 Stripe 读取失败延后重试，五次后交人工；财务冲突停在 review。`/admin/payments/checkouts` 提供分页查询、重核和带指纹/证据摘要/明确题数的审核 API，审核与额度同事务，不能重绑已知设备或购买归属。独立 reaper 每次最多取 3 个 Checkout；进程内支付恢复禁止重叠，并在关闭存储前等待结束。真实 Stripe 权限、版本、生产迁移与对账核验仍待完成。

未入账收款：`reporting-receipts.ts` 将签名 Checkout 投递按 Checkout / PaymentIntent 联合去重，并与截止时间前的全账户订单及历史充值核对。`cohort-economics-v2` 单列本批次已识别设备待入账、账户级身份未分配及冲突/缺失信息；后者不按来源分摊。确定已入账的收据排除；收据毛额不增加订单现金或 P28 分子，不改变额度。未核验净额保持未知，相关币种贡献停止计算。内部与外部归属冲突保留在账户冲突池，不能被内部设备排除隐藏。

`checkout_deliveries.recorded_at` 记录收据投影实际提交时间，防止延后处理的旧 webhook 回填到历史 as_of。SQLite/Postgres 启动增量加 nullable 列；旧行保留 NULL，不编造接收时间，报表列为历史时间未核验且不计入已确认毛额。查询仍使用同一一致事务及有界批次；旧 v1 归档没有收据字段时明确显示未知。

财务资源核对：`payment-finance*.ts` 维护通知序列、租约任务、资源唯一归属和不可变修订；`stripe-finance.ts` 只执行有界 GET。新订单自动发现，签名通知要求重核；正常核验每日更新，信息不完整每五分钟再查，读取失败一分钟后重试、五次转 review。独立 reaper 每次最多处理三笔，管理员可经 `/admin/payments/finance/reconcile` 重核。成功读取不代表所有费用或净额完整；`cohort-economics-v3` 展示核对覆盖、待重核、退款账本缺项及未决拒付。余额交易本金与费用分开，唯一交易不跨订单或多笔拒付重复计算；未知或未经核验的外汇转换阻断完整贡献。

财务通知另需订阅 charge succeeded/updated/refunded，以及 dispute created/updated/closed/funds_withdrawn/funds_reinstated；受限 key 需具备 Charges、Refunds、Disputes 及展开 Balance Transactions 的 GET 权限。完整事件名和 HTTP 读取见 API 文档，真实账户配置仍须核验。

财务发现漏记退款时，按明确的本地 `finance.refund.reconcile` 来源批量加入既有退款队列，由 worker 重新读当前 Stripe Refund 后更新原状态机；不发现金退款、不直接用早先快照改额度。回滚到不认识该本地事件类型的旧服务前，必须先排空这些待处理项并核验持有；保留新增财务表和归档。当前仅本机三存储、协议、页面验收通过；真实 Stripe 权限/资源、生产迁移、账户费用覆盖和汇率证据仍未核验。

`ALLOW_STUB_TOPUP=1` 只在本地显式开启。`amount_cents` 是币种最小单位（JPY 为日元整数，CNY/USD 为分）。

Postgres TLS 默认 `verify-full`。`ADMIN_TOKEN` 为空则全部 `/admin*` 为 404。

批次/经济查询：`/admin/cohorts`、`/admin/economics` 使用 `reporting.ts` 的定义与三存储一致快照，按 UTC 发生时间、同意覆盖、付款资源修订和历史 lot 计算；金额为十进制字符串，未知不是零，币种不隐式相加。`/admin/devices/internal` 维护可信内部设备排除；`/v1/device-source` 只记录自愿来源；`/admin/economics/expense-allocation` 保存有审计引用的累计分摊快照。

`/admin/reports` 提供成熟/覆盖、来源比较和成本/履约区间三个视图，以及不可变快照的保存、分页读取和 JSON 下载。页面不持久化密钥，数据端点均使用 Admin 鉴权。`/admin/reports/data` 从同一份事实快照生成各来源读数；保存接口重新核对已查看内容的 SHA-256，事实变化返回 409。`report_archives` 不随详细事件清理，读取时校验内容；90 天明细期外的实时查询返回 410，须读取此前保存的快照。归档是当时读数，不自动宣称质量/放量闸门通过。

`/admin/quality/reports` 提供第四个独立评测视图；`/admin/quality` 接收严格白名单的已评分逐题摘要，服务端只保存不可变聚合、源文件摘要和复核声明。相同 run 不能重绑执行版本，评分修订追加记录；撤回不删除审计，也不恢复旧评分。V1、fallback、范围覆盖和风险阻断分别计算，未知家族/真值保持未知。历史 240 题仅用 `legacy_objective`，不声明新支持范围；非 SPI 400 / 每题型 100 的样本要求仅计已声明组合中的已标注客观题。离线历史核对、上传及审查边界见 [质量记录操作说明](docs/quality-evidence.md)。

`run-reading-eval.mjs` 按完整授权 manifest 经隔离官方服务运行新合约，使用同一 100 CNY 累计预算；每题冻结 UUID、保留失败，立即抽取解释及无答案入口拒绝检查。`prepare-reading-quality.mjs` 限量逐文件重读原始响应、重算评分、核对执行顺序和独立复核摘要；答案与解释成本/判断分别归档，禁止自动重试、补签或把部分运行称为完整。详见 [阅读评测操作说明](docs/reading-evaluation.md)。执行适配器已实现；真实授权 holdout、模型结果、至少 80 个解释复核、准确候选同模型基线及完整财务收尾仍待完成。

## 9. 故障定位顺序

1. 工具链 / `./scripts/bootstrap.sh`
2. `GET /healthz`（provider / db / payments / webhook）
3. `./scripts/dev.sh` 本地 mock
4. 通道路由（官方 / 自定义 Key / CLI）
5. Screen Recording 权限与捕获排除
6. 厂商 / 支付 / 数据库
7. 生产只读核验由所有者执行

## 10. Definition of Done

- `./scripts/verify.sh` 全绿
- 文档链接与权威映射通过 `scripts/repo-health.mjs`
- 无 tracked 生成物（`.build`、`node_modules`、`dist`、`.eval-results`、数据库、`.env`）
- `git status --short` 干净
- 无未解释的兼容删除
- 所有外部副作用由所有者确认
