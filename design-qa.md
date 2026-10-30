# 官网视觉精修验收 — 2026-10-30

final result: passed

## 基准与修正
用户指出上一版与第 1 张概念图差距过大。上一版的“通过”不能代表用户接受视觉效果。本轮以原图重新比较，修正屏幕材质、悬浮面板、题目截图飞入及浅色区块衔接。

Source: `../../../../.codex/generated_images/01a18b2e-3926-7442-9739-abf5cbd802e5/exec-574cd8cd-6c61-4eae-b308-8c4fe84f6365.png`。

证据位于 `output/website-theater/refinement/`：
- `comparison.jpg`：左为原概念图，右为当前实现；分别由 1435×1096 与 1440×1100 缩放至 720×550。
- `desktop.png`、`full-desktop.png`、`full-mobile.png`：实际浏览器画面。
- `flight.png`：题目截图飞行阶段。

## 视觉结果
- 深色居中标题、冷蓝强调、金属屏幕边缘、柔和桌面背景与短悬浮答案面板。浅色区域从桌面视口约 y798 开始，与概念图约 y790 接近。
- 辅助平台入口移至后续内容，步骤与播放控件叠放于舞台底部，避免撑长首屏。
- 浅色区使用暖色桌面场景，已标注“产品场景示意”；它是生成的场景图，不是真实截图。功能区仍展示真实 App 引导截图。
- 飞行卡片内容取自相同的题干与选项，按当前面板坐标计算落点，缩小进入面板；不再飞入答案截图。概念图的静态光束没有逐像素复刻，交互以卡片运动与蓝色光晕表达。
- 完整页面沿用真实功能、现有价格与购买路径。未添加检测绕过保证。

## 浏览器验证
- 桌面 1440×1100、中文手机 390×844、英文 320×800、日文平板 768×1024；均无横向溢出。
- 检查完整桌面、手机页面、首屏、浅色过渡、价格导航；图片均完整加载，console error/warn 为空。
- 修复日文平板标题拆词，复查为语义完整的两行。
- 手动选择截图阶段可播放飞入；自动演示一次后停留答案，可重播。
- 修复暂停 CSS 优先级：浏览器实测暂停时 `data-paused=true` 且计算样式 `animation-play-state=paused`。
- reduced-motion 由 CSS 禁止动画、脚本默认保留答案；单元测试覆盖。未改变系统偏好或进行浏览器媒体模拟。

## 验证边界
- 本地渲染使用现有默认 JPY 题包与 CNY 69/月 Plus，启用体验与 Plus 展示；正式路由保留实际功能开关。
- 保留 72 小时体验、每日 400 次；不修改价格、订阅规则或生产配置。
- 未执行真实支付、下载包安装、屏幕共享兼容性实测或生产部署。
- 生成场景图仅用于视觉呈现，实际交互由 HTML/CSS/JS 实现。

## 本地预览
运行 `node scripts/preview-site.mjs`，访问 `http://127.0.0.1:4173/?lang=zh`。
只绑定回环地址，不加载数据库、支付凭据或模型服务。下载按钮使用既有正式下载地址。

## 检查结果
- 官网、演示、3.0 页面和价格：27/27 测试通过。
- server TypeScript 检查通过。
- `./scripts/verify.sh --quick` 通过。
- `git diff --check` 通过。

## 第二轮精修：比例与动作衔接

- 基准不变。本轮新增证据：`output/website-theater/polish-2/comparison.jpg`（全幅并排）、`detail.jpg`（刘海、题目和浅色交界放大）、`desktop.png` 与 `mobile.png`。
- 对照规格：1440×1100 CSS px 桌面截图；原图 1435×1096；全幅各归一为 720×550。细节使用原图和实现相同区域（x280/y370，870×550）并排。概念图同时表现答案与飞行轨迹，实际页面按截题、接收、答案顺序展示，静态答案截图不伪造同步状态。
- [已修复 P2] 屏幕偏窄且下沉：舞台从最大 1320 调为 1400px，上间距减少 24px；屏幕顶部约 y379，浅色交界约 y790。面板下移 18px，与物理刘海保持悬浮间隙；题目窗口下移 25px。
- [已修复 P2] 下方标题偏大、位置偏低：改为顶部对齐，标题最大 38px，缩短上间距。新正文承接练习体验，不再重复首屏操作说明。
- [已修复 P2] 截图尚未到达就显示已收集：接收提示在飞行末段出现；卡片落点对应真实缩略图位置，面板尺寸变化后重新校准；接收时短暂亮起边缘。移除截图选项提前高亮。
- 暂停覆盖飞行卡、接收文字、面板反馈和截图高亮。浏览器实际检查三项动画计算样式均为 paused；捕获开始时 pending opacity=0，到达后为 1，飞行卡为 0。
- 字体：沿用系统字体，调小后续标题使层级更接近原图。颜色：保留冷蓝、墨黑、暖白，增强面板边缘与两层阴影。图像：继续复用已生成屏幕和场景；无新素材下载或安装。文案：中日英新增一致的承接段落，功能与价格不变。
- 保留差异/P3：原图的静态光束和桌面窗口工具栏未逐像素复刻；当前以可暂停的卡片运动、光晕及真实状态顺序传达动作。
- 本轮检查发现官网测试只检查响应头而未消费页面响应，导致服务关闭等待连接；补充读取响应体后 27/27 通过。此修正不改变生产行为。

## 第三轮：原图素材与真实 Mac 面板

用户要求排除蓝色光束/拖尾后进一步忠实于原图，去除“NotchSPI 交互演示”菜单栏，并优先使用真实 App 画面。

- 官网模板、样式、新增 `server/src/site-native-assets.ts` 及相关页面测试是本轮代码范围；未改生产、收费或原生客户端。
- 原生答案素材：`docs/windows/evidence/mac-build27-answer.png`，来源由 `docs/windows/baseline.md` 记录，来自隔离的原生 AppKit QA 应用与离线 fixture。网页仅缩放/裁切外缘并显示实际截图，示例解释单列于截图下方。不是实时录屏或线上模型结果。
- 概念图用于设备背景及下方摄影场景的图片区域；标题、导航、按钮、题目、飞行截图、状态与控件仍为可交互页面。桌面菜单沿用原图的 Finder 外观；小屏窗口图标使用系统 SF Symbols 导出资产，无新增依赖。
- 以不透明题目窗口和完整尺寸状态面板覆盖原图的题目、旧面板、光束与飞行卡；未新增蓝色光束或拖尾。原图其余设备与壁纸像素直接复用。
- 中文标题/按钮/菜单排列、四个题目选项、段落换行、下方摄影和标题位置按同尺寸原图校准。为了真实展示，答案面板保留真实 App 的字形、按钮和题图布局，未伪造为概念图中的简化 UI。
- 悬停或键盘聚焦才显示桌面播放控件；手机持续显示。减少动态效果保留答案状态。未改变费用与下载目的地。
- 新增回归检查覆盖 Finder 菜单、原生截图、菜单不含“交互演示”标签及第四个选项。

### 本轮修复与证据
- [已修复 P2] 图片高度限制导致手机/平板裁切露出原图上半部分：取消图片 max-height，限定场景容器比例和宽度；复查手机 390px 和平板 768px 的 scrollWidth 均等于视口。
- [已修复 P2] 日文平板导航被重复下载入口挤压：平板收起页头下载，保留首屏主入口，导航不再拆字。
- [已修复 P2] 手动播放受过期的 IntersectionObserver 状态阻塞：显式播放优先完成单次演示，后台标签页仍暂停；新增单测。浏览器已验证手动截图为 running，暂停后三项动画均为 paused。
- 字体与布局：保留系统字体，并按原图校准标题、菜单、按钮和下方标题。色彩：冷蓝按钮、暗色产品舞台、暖白场景。图像：直接复用概念图设备/摄影区域，真实原生答案截图及系统符号。文案：中文题目与说明按原图调整；中日英导航保持可用；真实截图保留其原始中文 UI。
- 原图与最终实现同为 1435×1096 px，CSS 视口同尺寸。答案状态对照；原图中的飞行卡、光束和拖尾按用户要求不纳入静态答案构图对齐。
- 证据：`output/website-theater/exact-pass/desktop.png`、`comparison.jpg`、`detail.jpg`、`full-mobile.png`、`tablet.png`。原生 UI 与概念图简化面板的差异为用户希望优先使用真机画面的取舍；不是像素完全相同的 App 面板。
- 完成真实浏览器检查：中文桌面/手机，英文 320px，日文 768px；图片加载、价格→购买说明定位、手动截图与暂停。未执行真实支付或线上部署。
- 最终结果：29/29 官网、演示、价格与版本专项测试通过；server typecheck 通过；`./scripts/verify.sh --quick` 通过（`output/verification/20261030T055914Z-27183/`）；浏览器 console error/warn 为空。最终 full-page 截图已目视检查。
- 本轮结论：功能与响应式检查通过。App 面板有意采用真实原生截图，而非概念图中的简化面板；标题上方背景光感仍非逐像素复刻，不声明整页像素完全一致。原图未覆盖的下方收费及功能区沿用已完成实现与现价。

## 第四轮：物理刘海融合与内容放大
- 用户要求：本地首屏真实 App 面板与物理刘海融为一体，放大答案和题图；不部署。
- 本轮仅修改 `server/src/site.ts`、`server/src/site-design.ts` 及本记录。真实截图标题栏单独裁切，主体保持原生像素并放大，未生成替代 UI。面板上缘接到屏幕内缘，取消顶部圆角及边框，底部保留原生黑色材质与圆角。
- 1435px 桌面面板 420×184px，答案主体截图从约 434px 宽改为 568px 宽；答案与题图约增大 31%。题目正文 17px、选项 16px；手机正文 14px、选项 13px。宽屏按比例扩展，避免露出底图旧面板。
- 真实浏览器检查 390×844、768×1024、1435×1096、1920×1080。手机和平板无横向溢出；桌面与宽屏面板覆盖完整，下方内容衔接保持。截图飞入状态为 running，未暂停；控制台无 error/warn。减少动态效果规则保留，本轮未模拟系统设置。
- 证据：`output/website-theater/integrated-notch/desktop.png` 和 `mobile.png`。展示的是实际原生 App 离线截图的网页组合动画，并非实时录屏。
- 官网、演示、版本和价格相关测试 29/29 通过，server typecheck 通过。收费、生产配置及下载目的地均未修改。

## 第五轮：按新概念图完成剩余页面（2026-10-30）

### 对照目标与范围
- Source visual truth: `用户附件：ChatGPT 图像 2026年10月30日 14_32_49.png`，816×1927。
- 本轮遵循“剩余部分”：保留已经确认的真实 App 首屏及融合刘海；重建其后的保护演示、功能双栏、三类收费、FAQ 与山景页尾。没有生产、远端、安装或价格配置变更。
- 图形取自用户提供的参考图对应图像区域，功能图明确为示意；双屏左侧叠加既有真实 AppKit 离线截图。页尾背景由 image_gen 按参考图去除文字/UI后生成，未假称真机录屏。
- 实现文件：`server/src/site.ts`、`site-demo.ts`，新增 `site-continuation.ts`、`site-continuation-script.ts`、`site-continuation-assets.ts`；更新页面测试以验证合并后的题包选择，保留原来的商业约束检查。

### 同状态视觉证据
- 比较视口816×1100 CSS px；截图像素宽816（1:1），中文、屏幕共享标签、答案完全显示、300题默认选择、首个FAQ展开。参考下半页从y476起1451px；实现下半页从y829起1581px。不同的首屏不计入本轮下半页比较。
- `output/website-theater/new-concept/full-final-816.png`：完整浏览器截图。
- `comparison-final.jpg`：源图/实现的下半页左右同尺度比较（统一缩至612px宽），未纵向拉伸掩盖差异。
- `pricing-detail.jpg`：816px原尺寸收费卡细节比较；真实金额、权益与文本清晰度逐项检查。
- `desktop-full.png` / `desktop-review.jpg`：1435×1096 CSS视口完整页面与缩略检查。
- `mobile-full.png` / `mobile-review.jpg`：390×844 CSS视口完整页面与缩略检查。

### 对比迭代与修正
1. `comparison-first.jpg`：发现旧样式导致Plus标题呈白色、题包数字40px、收费标题居中、FAQ过高、页尾白字落入亮色背景（P1/P2）。修正局部样式覆盖，紧凑化间距并校准山景裁切。
2. `full-second.png` / `full-third.png`：修复题包金额与说明换行、标题与按钮对齐、FAQ伪元素撑高；将原有较长使用/账户资料移入可访问的“使用说明”，保留必要条款。
3. `comparison-final.jpg`：结构与各区域位置一致，原生面板保持截图材质。修复截图下缘白色余边；补齐英文标题词间空格与较长题包标签换行。最终桌面、手机和日文平板目视复核无遮挡/横向溢出。

### 五项视觉评估
- 字体：沿用系统字体与既有标题层级；中文标题黑色粗体、强调蓝色。生成概念图不是可提取字体文件，未声称字形逐像素一致。多语内容换行按可读性适配。
- 布局：保护→功能→收费→FAQ→页尾的顺序和双栏/三栏对齐按图实现；手机转单栏，双屏对比仍并排。长规则以展开方式保留。下半页比原图高约130px，来自真实条款入口、可读字号与额外说明；不宣称整页像素相同。
- 色彩：暖白内容、冷蓝强调、淡蓝Plus卡、深蓝山景；修复Plus继承白字和页尾标题对比不足。
- 图像：复用参考的笔记本与功能画面，叠加真实原生答案；对应示意有文字标识。示例历史画面不代表用户真实记录。山景为独立生成资产，细节不是原图完全相同。图标使用现有macOS系统符号，无新依赖。
- 文案：主模块按参考；捕获保护加入支持环境与边界说明。`ScreenShareGuard.windowSharingType` Release值为`.none`，但不把源码机制当作所有软件/环境实测保证。价格仍来自`PLUS`和传入题包配置；300题默认与App一致，未照搬概念图的100题默认。

### 功能与工程验证
- 浏览器：中文1435桌面、816参考宽度、390手机；英文768平板与320窄屏；日文768平板。检查无横向溢出；桌面所有图片加载完成；console error/warn为空。
- 保护标签鼠标切换与方向键切换；range Home/End改变左侧答案可见度、右侧保持原题；播放/暂停aria状态；1000题选择→购买说明展开显示JPY2200/1000题；隐私链接展开对应内容均实测。
- 减少动态效果：保留原有全局规则，新增演示在该设置下直接切换状态；未修改用户系统设置，新增路径未在浏览器中模拟系统减少动态效果。
- 官网/演示/版本/价格专项29/29通过；server typecheck通过；`./scripts/verify.sh --quick`通过，证据`output/verification/20261030T065109Z-50583/`。之后的英文换行与文案间距修改再次通过typecheck与29项专项测试。
- 未执行真实付款、真实屏幕共享/录屏验收、发布或部署。本地服务运行于127.0.0.1:4173。

### 剩余差异与结论
- P3：系统字体与生成字形、山脊细节、少量阴影与垂直间距不是逐像素一致；真实原生答案与概念图简化面板的差异为既定要求。
- 适用范围说明、真实价格、App默认题包与原生截图优先于概念图的非实测承诺/示意细节。无未解决的布局遮挡或关键交互问题。
- final result: passed


## Sixth pass — native product capture refresh (2026-10-30)

- Replaced low-resolution concept content in the comparison, multi-capture and history sections with lossless WebP exports of actual AppKit windows. Source captures: `output/website-theater/native-refresh/`. History is 1920×1416, question preview 2190×1424, multi panel 1288×456.
- Captured using the existing October 19 offline Design QA app with ephemeral fixture history; no personal history, paid inference or production configuration was used. These are native UI fixtures, not proof of live screen-sharing exclusion. The dual-device composition remains explicitly labelled an illustration.
- Preserved the existing outer section proportions, replaced screen contents, aligned the answer with the device top, and added keyboard-accessible native dialog enlargement. Moved captions outside screenshots to avoid overlap on mobile.
- Browser checked at 1435×1096 and 390×844: no horizontal overflow or broken images; native history opens at 1920px source width; Escape closes and returns focus; close button works; no console warnings/errors observed. Screenshots: `desktop.png`, `mobile.png`, `history-large.png` in the capture directory.
- Server typecheck and 29 relevant site/demo/pricing tests passed. Initial quick verification identified an absolute-path entry in this QA file; normalized that reference; the rerun passed (`output/verification/20261030T071537Z-63230`). The comparison slider was also keyboard-tested at both ends.
- Local preview only. Prices, checkout configuration, native sources and deployment unchanged.

## Seventh pass — visual and motion polish (2026-10-30)

- Scope: local website only; retained the selected mountain/device direction, real offline AppKit captures and existing prices. No native code, installation, deployment, checkout or production changes.
- Main defects addressed: oversized empty notch states; hard hero/content boundary; raster device edges in comparison; uneven feature columns and heavy heading hierarchy; Japanese demo-note overlap at tablet width; flight destination ignored the device border and fractional CSS positions.
- `site-polish.ts` defines the final device geometry, responsive typography, spacing, control styling and motion treatment. `site-continuation.ts` no longer renders raster laptop frames. `site-design.ts` drops unused concept/background image payloads and shortens Japanese/English subtitles and demo notes. `site-continuation-script.ts` uses requestAnimationFrame for comparison playback. `site-demo.ts` uses border-aware, fractional flight coordinates and holds the answer under reduced motion. `site-demo.test.ts` covers the coordinate regression and reduced-motion behavior.
- Browser review: 1440×1000 desktop, 816×1100 tablet (Japanese and English), 390×844 mobile. Checked hero, comparison, features, plans and FAQ; no horizontal overflow at measured widths. Real image dialog opens at 1920px source width, Escape returns to the page; tab ArrowRight/Home navigation works; comparison reaches 100 and stops; Plus CTA opens the local instructions with CNY 69 / 月. No payment was made.
- Motion: captured 36 automatic sequence samples and 55 manual flight samples, inspected the contact sheet, then corrected the observed landing offset. This is sampled visual evidence, not a guarantee of every display frame or a GPU performance benchmark. Browser console reported no warning/error. Reduced-motion state is covered by the regression tests and CSS inspection; OS preference was not changed.
- Evidence in `output/website-theater/polish/`: `before.png`, `after-hero.png`, `after-desktop.png`, `after-mobile-hero.png`, `after-mobile.png`, `motion-contact-sheet.jpg`, and individual sampled frames. Viewport captures are the authoritative visual reference; full-page capture can differ while its capture surface resizes.
- Validation: server typecheck and 30 site/demo/pricing tests passed; quick verification passed in `output/verification/20261030T075850Z-78970`; diff whitespace check passed. The final fractional-coordinate adjustment was followed by server typecheck and the 30 relevant tests again.
- Limits: actual App screenshots use offline fixtures. Comparison remains an illustration, not a live sharing recording. No claim of award qualification, cross-browser certification, or frame-perfect performance on untested hardware.
