# 3.0 官网更新（2026-10-20）

> 历史记录时点：2026-10-20。本文的“当前”“最新”、部署状态、测试计数与待办均指对应记录时点，不代表 2026-10-23 的线上状态；本次整理未重新核对生产。

官网中、日、英版本已同步到 3.0：首屏发布标记、72 小时每日 400 次免费体验、Plus 与题包购买路径、账户恢复码、最近查题及旧版升级说明。Windows 下载按钮显示 Coming soon，使用原生 disabled 状态，不链接未发布安装包。

生产部署：`dpl_CPuj878hemLND2XVe9yZbvCr5oGm`，官网 https://notchspi-api.vercel.app/ 。从已发布的 `a62d11d2b3012c12bccdf396f430a94e308fc17e` 提取 server，且与上次发布保存的 deployment/server 比对，仅 `src/site.ts` 和 `src/site-design.ts` 有内容差异。使用生产环境构建、先不绑定域名，验证候选页面后 promote。未带入主工作区的其他客户端或后端修改。

验证：服务端 TypeScript 检查、19 项官网/演示/3.0 专项测试和 git diff --check 通过。浏览器已核对线上中文页面。部署源码、三语言页面及线上检查结果位于工作区 `output/website-3.0-2026-10-20/`。

前一生产部署：`dpl_7umrG4fqNEHW3qiPBCm6YAWdBYYk`，可按既有发布流程回退。

## Ghost 品牌补正

用户指出首轮遗漏品牌图形。已用 App QA 实际渲染的 Ghost 替换页头、演示面板、底部 CTA、页尾以及浏览器 favicon；移除包含旧四瓣花的历史截图，以 Ghost 吉祥物图展示并同步三语言标签。保留 BotAvatarsKit MIT 许可。资源源文件：`output/ghost-2026-10-16/frames/ghost-96.0-false.png`。

最新生产部署：`dpl_7UG148tb8z3WRX8ddshfiaZQYKR3`。对已发布源码仅有 site.ts、site-design.ts、site-assets.ts 三个官网文件差异。类型检查及 20 项专项测试通过，三语言线上 Ghost、favicon、Windows Coming soon 回读通过。

## 产品截图与下载按钮修订

按用户页面批注，特性区恢复真实 App 截图：使用带 Ghost 的首次查题引导实际捕获 `output/ghost-2026-10-16/frames/zh-first-answer.png`，三语言图注说明画面内容。所有题包卡片与免费卡片共用 `download('secondary')`，直接连接 `/dl`。

生产部署：`dpl_5cU8saoLxi1rg7vtGfASWbfsAohP`。20 项专项测试和类型检查通过；候选与线上三语言均验证实际产品图、四张卡片下载链接以及购买步骤跳转移除。
