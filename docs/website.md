# 官网与本地预览

唯一启动入口见 [HANDOVER](../HANDOVER.md#专项操作与历史)。当前页面由 `server/src/site.ts` 组合 site-design、site-polish、site-continuation 和演示脚本；媒体由 site-media 及 `server/public/media/` 提供。

预览只绑定回环地址，不加载账户、数据库、模型或支付凭据。下载按钮仍指向实际下载入口；预览不是生产部署，也不验证安装包或付款。

## 行为与素材

页面提供中/日/英、单图与自动模式真实演示媒体、功能/价格/FAQ、键盘阶段及对照滑杆。保持现有 CSP、减少动态效果、手机/平板排版、实际功能开关及价格来源，不从历史精修报告恢复旧设计。

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
