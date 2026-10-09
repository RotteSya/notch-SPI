# 官网自动轮播发布 · 2026-10-09

用户明确授权“上线改动”后已发布至 https://notchspi-api.vercel.app/?lang=zh 。

- 正式部署：`dpl_4ybnroX8acj2pAwCd8Gh8VEF7xRR`，状态 READY。
- 候选地址：`https://notchspi-2lwwmqm5o-rottesyas-projects.vercel.app`。
- 来源：以已核验现网 `dpl_2eoR8nPsyYgpujVcrnunkC3fHCdL` 的保留源码为基线，仅叠加四个官网源码文件（含新增 site-demo.ts）及两个测试文件。部署目录 `release-worktrees/website-carousel-20261009`；完整摘要在 `output/site-carousel-2026-10-09/source-manifest.json`。下次部署须以此来源为准，不可直接假定 main 与生产相同。
- 看题3秒、截图2.2秒、答案5秒循环；三语暂停/播放、手动切换、后台/离屏/键盘步骤焦点暂停及减少动态效果支持。脚本通过固定 SHA-256 CSP 授权。
- 候选类型检查、588项服务端测试通过；首轮因归档缺少Git历史路径失败，提供只读 GIT_DIR 后全量通过，未修改断言。
- 候选及正式各16项只读HTTP检查通过，三语首页逐字节一致；CSP脚本摘要匹配。Browser确认正式页面自动由看题切到截图，控制台无error/warn。截图 `output/site-carousel-2026-10-09/production.png`。
- 价格、免费30题、支付配置和健康状态保持原样。无原生客户端发布、真实付费调用或支付交易。
- 原工作区完整verify仍被既有2270条历史文档断链阻断；本轮无Swift变动。
- 回退目标：`dpl_2eoR8nPsyYgpujVcrnunkC3fHCdL`；无需数据库回退。
