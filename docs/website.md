# 官网与本地预览

唯一启动入口见 [HANDOVER](../HANDOVER.md#专项操作与历史)。当前页面由 `server/src/site.ts` 组合 site-design、site-polish、site-continuation 和演示脚本；媒体由 site-media 及 `server/public/media/` 提供。

预览只绑定回环地址，不加载账户、数据库、模型或支付凭据。下载按钮仍指向实际下载入口；预览不是生产部署，也不验证安装包或付款。

## 行为与素材

页面提供中/日/英、单图、多图与自动模式真实演示媒体、功能/价格/FAQ、入口页键盘阶段及对照滑杆。保持现有 CSP、减少动态效果、手机/平板排版、实际功能开关及价格来源，不从历史精修报告恢复旧设计。

Mac 界面素材来源包含 `docs/windows/evidence/mac-build27-answer.png` 等原生隔离 QA 截图；Electron 图片是在 Mac 宿主上取得，不能称为 Windows 实机图。场景/设备图是示意素材，不是实时识题或线上结果。详细生成和精修原文见[历史索引](history/index.json)。

## 回归与发布来源

site、site-demo、v3-site 和 intel-download 测试覆盖页面、CSP、媒体 HEAD/Range、语言、开关、价格与下载兼容。删未用素材时，用相同输入比较各语言/入口/开关组合的 HTML 字节摘要。

[2026-11-02 部署证据](website-release-2026-11-02.json)记录冻结生产源加官网覆盖层的历史部署；其文件摘要不应重写为当前主树摘要。当前源码和生产后端不能据此视为完全一致。部署、模型、支付和下载包发布均需要独立授权。

## 首页企业品牌带（2026-11-16）

按用户最新要求，使用参考站 https://spi-assistant.com/ 的20家企业原始Logo，下载至 `server/public/media/companies/`，替换此前7个官方来源素材。网页不热链接参考站；公开路径为 `/media/company-*`，由 `site-media.ts` 精确白名单提供，静态交付清单同步登记。素材只用于企业品牌展示，标题保持中性，不新增招聘测试采用、客户或合作关系陈述。中日英均已移除原附注及可见暂停控件。

`site-companies.ts` 只在首页主视觉之后输出。两份等宽列表做 CSS 匀速左移，按自然图宽加间距计算周期，以桌面86.2545px/s、手机52.1695px/s匹配参考速度（当前约41.92秒/42.11秒一轮），副本 `aria-hidden` 且空alt。悬停或键盘聚焦轨道暂停，移开后恢复；减少动态效果时移除动画与副本，全部20个品牌换行展示。保留图像原比例及色彩，contain不裁切，不增加依赖。

参考站本次观察为单行左移、两组重复、边缘渐隐，计算样式40秒linear infinite；1440px图像框高48px、间距64px，390px分别32px、32px。未做参考站逐帧接缝或全浏览器保证。

下列素材于2026-11-16原样下载；来源记录不是独立的品牌授权或招聘政策证据。

| 品牌 | 本地文件 | 下载来源 |
| --- | --- | --- |
| ANA | ana.png | https://spi-assistant.com/images/company_logos/ANA.png |
| Canon | canon.png | https://spi-assistant.com/images/company_logos/Canon.png |
| Goldman Sachs | goldman-sachs.png | https://spi-assistant.com/images/company_logos/Goldman_Sachs.png |
| Honda | honda.png | https://spi-assistant.com/images/company_logos/Honda.png |
| ITOCHU | itochu.png | https://spi-assistant.com/images/company_logos/ITOCHU.png |
| JAL | jal.png | https://spi-assistant.com/images/company_logos/JAL.png |
| JR EAST | jr-east.png | https://spi-assistant.com/images/company_logos/JR_EAST.png |
| LINE Yahoo | line-yahoo.webp | https://spi-assistant.com/images/company_logos/LINE_Yahoo.webp |
| Marubeni | marubeni.svg | https://spi-assistant.com/images/company_logos/Marubeni.svg |
| Microsoft | microsoft.png | https://spi-assistant.com/images/company_logos/Microsoft.png |
| Mitsubishi | mitsubishi.png | https://spi-assistant.com/images/company_logos/Mitsubishi.png |
| Panasonic | panasonic.png | https://spi-assistant.com/images/company_logos/Panasonic.png |
| Rakuten | rakuten.png | https://spi-assistant.com/images/company_logos/Rakuten.png |
| Recruit | recruit.png | https://spi-assistant.com/images/company_logos/Recruit.png |
| SoftBank Group | softbank-group.png | https://spi-assistant.com/images/company_logos/SoftBank_Group.png |
| Sony | sony.svg | https://spi-assistant.com/images/company_logos/Sony.svg |
| Starbucks | starbucks.png | https://spi-assistant.com/images/company_logos/Starbucks.png |
| Toyota | toyota.png | https://spi-assistant.com/images/company_logos/Toyota.png |
| AWS | aws.png | https://spi-assistant.com/images/company_logos/aws.png |
| Suntory | suntory.png | https://spi-assistant.com/images/company_logos/suntory.png |


视觉复核：取消原208px/168px固定槽位，改为自然宽度、图像元素高48px/32px、最大宽150px/100px、间距64px/32px，组首尾各补半间距保证接缝相同。模块左右16px，轨道宽为视口减32px；渐隐128px/48px，轨道容器高80px/48px，标题居中且与轨道相隔20px。保留本站字体及底色，无分隔线。767px及以下采用手机参数。

图片元素等高不等于标识本体等高：参考页Honda也未单独放大，原图内部留白保留，不裁切或重画。本轮浏览器参考页的Goldman Sachs为1200×1200蓝底方标、Marubeni为360×338组合标；已下载本地文件分别是1022×429黑色字标和164×16红色字标。按用户保留现有20个素材的要求维持本地版本；这两项不能仅靠CSS变成参考页图形，来源URL相同不能证明字节相同。其余18项原图比例与参考页一致。周期据本地原图比例计算，不假设整组长度与参考页相同。

## 首页阅读节奏（2026-11-16）

保留企业品牌带、检测说明及导航顺序。首页使用静态答案场景，删除三段阶段控件及占位；真实单图视频解释操作流程，多图/自动/性格测试三种模式紧凑排列，性格测试以三步流程说明替换最近查题卡片，不再重复折叠展示。首页多图卡片使用用户提供的真机录像，不提供图片放大入口；单图、多图与自动模式视频不显示下方说明，静音循环行内播放且隐藏播放器控件；进入可视区域时自动播放，完全离开时暂停，返回时从原进度继续；页面隐藏或减少动态效果偏好开启时暂停。首页内容直接显示，不再做章节渐显；入口页原有阶段交互保留。三语修复英文标题分隔与日文价格标题短语换行，页脚增强对比，价格、下载、支付与登录行为不变。

多图录像来源：用户提供 `CleanShot 2026-11-16 at 22.54.34.mp4`（原件保留于本机 Screenshot 目录），6.62 秒、3024×1964、无音轨。网页副本 `server/public/media/multi-mode.mp4` 使用 H.264/CRF22、1920×1246、faststart，保持完整时长与画面；封面 `multi-mode-poster.jpg` 取第 2 秒。三语首页共用同一录像，静音自动循环播放，媒体白名单与静态交付清单同步登记。

## SEO / AEO（2026-11-27）

本轮目标为在日本留学、准备日本就职的中国留学生。官网规范 origin 固定为用户确认的 `https://notchspi-api.vercel.app`，由 `site-seo.ts` 管理；不从请求 Host、内部地址或支付配置推断。保留既有日语默认和 `Accept-Language` 协商，中文内容优先匹配目标用户；每条规范地址显式使用 `?lang=zh|ja|en`。每语言自引用 canonical，并相互声明 `zh-Hans`、`ja`、`en` 与指向显式日语地址的 `x-default`。

用户随后纠正产品定位：NotchSPI 的核心用途是考试过程中截图查题、查看 AI 答案，不是 SPI 备考或自主学习助手。三语搜索标题、摘要、分享文案与软件 JSON-LD 描述按该用途修订；软件分类为 `UtilitiesApplication`。未开放阅读练习入口只保留真实状态说明，不将其当作已发布产品能力。元信息不承诺保证答对、保证通过或不会被检测，并说明使用须遵守考试规则及自行核对 AI 回答。这次仅修订 head 元信息与对应测试，不改官网正文、布局、CSS、交互、规范地址或索引规则。

首页和 `/spi` 是当前索引页面，站点地图只包含其六种规范语言 URL。`/reading-practice` 仍为未公开学习入口，保持实际开放状态说明，使用 `noindex,follow` 并排除出站点地图；正式开放后需同步索引策略与测试。后台、API、购买和充值路径继续维持既有爬虫限制。未改变 AI 爬虫的特定许可或引入训练爬虫专用放行规则。

用户预览后明确要求移除首页和 SPI 页的全部新增可见内容，仅保留技术 SEO。因此本轮不新增定位标语、产品问答、例题讲解或学习导航，页面正文、布局、CSS 与交互保持优化前的版本。`site-seo.ts` 只改变 head 中的搜索与分享元信息及真实软件 JSON-LD，不将关键词作为隐藏正文插入。JSON-LD 不编造评分、评论、免费价格或 Windows 正式支持。分享卡片复用已有 Mac 操作视频封面；没有新增图片、付费媒体或依赖。

`/robots.txt` 与 `/sitemap.xml` 同时由 Fastify、隔离预览和 Vercel 静态文件提供，生成函数、静态文件及精确静态交付名单由测试检查一致。修改 origin、页面集合或语言策略时，需同步重新生成两份文件：

```sh
node --input-type=module -e "import {writeFileSync} from 'node:fs'; import {renderSiteRobots,renderSiteSitemap} from './server/src/site-seo.ts'; writeFileSync('server/public/robots.txt',renderSiteRobots()); writeFileSync('server/public/sitemap.xml',renderSiteSitemap());"
```

参考实现原则来自 [Google 多语言页面指引](https://developers.google.com/search/docs/specialty/international/localized-versions) 和 [站点地图指引](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)。sitemap 和结构化信息不是收录、排名或 AI 引用的保证。后续收录与流量需用已验证的 Search Console 和分析工具观察；本次不配置账户、不提交索引请求。

该改动只作为独立 PR 交付，不合并、不部署。已知公开官网与当前 main 存在功能、版本及隐私说明差异；生产发布前必须核对实际源码身份，并仅迁移经过确认的官网改动，不把整个 main 当作可直接发布的生产基线。
