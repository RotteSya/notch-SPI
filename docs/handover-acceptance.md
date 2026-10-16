# 交接验收记录（2026-10-17）

本文件只记录本次验收证据；工程规则、启动入口和故障定位以 [HANDOVER.md](../HANDOVER.md) 为准。

## 被测版本

- 清理提交：`08e7be87a36f6cf8f07a4b531947030ca553b797`。
- 被测源码提交：`d7571384c7de6d9a137028a77bb4ee2b59f9c260`。包含 Ghost 绘制运算的显式类型转换，修复旧 Swift 工具链的 CGFloat/Double 推导歧义。
- 交付 PR：[#12](https://github.com/RotteSya/notch-SPI/pull/12)。本报告及 HANDOVER 的后续证据更新属于文档变更。

## 干净克隆与启动

从 GitHub 克隆上述源码提交；开始时不存在项目 `.build`、`server/node_modules` 和 `scheduler/node_modules`。保留机器已有的 npm / Swift 全局下载缓存，因此不是全新操作系统或全断缓存测试。

- 主机：macOS 27.0.1 arm64、Swift 6.4、Node 24.16.0。
- 实际执行 HANDOVER 中的一键命令，安装两个锁定依赖树并首次编译。
- 75.73 秒观察到开发 App 进程及 loopback 健康响应；响应为 mock provider、SQLite、stub payments。
- 受控终止开发 App 后脚本返回 143，所属本地服务退出；这是测试主动发出的 SIGTERM。
- 在前一清理提交上，通过真实 App 菜单“退出 NotchSPI”退出，脚本返回 0，所属服务退出。
- 源码 Git 工作区保持干净。实测耗时是此工具链、网络和全局缓存条件下的结果，不是任意设备的五分钟保证。

## 自动化验证

- 干净克隆执行完整验证，退出码 0。治理 46 项、服务端 672 项、调度器 17 项、路由 13 项通过；Swift 544 项中跳过 4 项，其余通过。类型检查、调度器 dry-run、arm64 Release、资源、不可变证据和空白检查全部通过。
- 本机 Postgres 标为 skipped，硬件标为 blocked，签名公证标为 skipped；这些状态保留原意，没有计入通过。
- 被测源码的 [CI 运行 38939005331](https://github.com/RotteSya/notch-SPI/actions/runs/38939005331) 全部 11 个作业通过，包含 Node 两个版本、Postgres 四组组合、AL2023、Vercel 函数包、Cloudflare scheduler、治理和 macOS 测试及 Release。
- 可携带的提交绑定、启动测量和逐项结果保存在 [handover-evidence.json](handover-evidence.json)。CI 原始日志和产物从运行链接取得。本地详细日志位于本次工作区的 `output/handover-closeout/delivery-verification`，不要求下一位开发者拥有它们。

## 人工体验

已通过真实界面验证欢迎页、“试一道题”引导与菜单退出。实体热键、录屏权限、截图后 mock 答案、刘海及外接屏正在由操作者确认。未确认的项目不计入通过。

签名公证、生产部署、真实支付和付费模型效果不属于此次本地交接验收。
