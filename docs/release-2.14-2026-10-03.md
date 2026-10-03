# NotchSPI 2.14 正式发布 · 2026-10-03

2.14 / build 21 已于 2026-10-03 21:07（Asia/Shanghai）公开发布：[发行页](https://github.com/RotteSya/notch-SPI/releases/tag/v2.14)、[官方下载](https://notchspi-api.vercel.app/dl)。

## 发布内容

- 刘海内新手引导、首次查题和完成后的答案衔接。
- 单图、多图、性格测试、自动模式统一快捷键样式与对齐，补齐自动模式启停说明，读取实际自定义组合键。
- 1–4 张题目截图保留在答案上方，提交前后槽位稳定，支持原图预览。
- 调整答案层级、字号和留白，修复卡片边缘裁切与末行滚动淡出；减少重复排版和逐帧字符映射。

## 发布绑定

- main 已推送；标签 `v2.14` 指向 `63439f30106f4e12a9e05bee4b557fe1015dedc6`。
- 干净发布工作树基于该提交构建；72 个源码、资源、版本与打包脚本输入摘要在构建后保持一致。
- DMG：3,782,903 字节；SHA-256 `70a739a5a995cfb669c545bcc3cb2914da32e48f3935edf995e4dde14edf38a8`。
- Apple 公证 Accepted：`a1b55272-fd31-43ab-a9a8-8b54eb175eb6`。DMG 装订、签名和 Gatekeeper 通过；挂载后的 App 签名、Gatekeeper、2.14/21 版本及二进制一致性通过。
- GitHub latest 已指向 v2.14，正式 `/dl` 返回文件与本地产物逐字节一致；原始 `/update` 和带版本查询参数的请求都返回 2.14 / v2.14。

## 验证与发布修复

- [CI 37124720388](https://github.com/RotteSya/notch-SPI/actions/runs/37124720388) 的 10 项全部通过，覆盖 macOS、Node 双版本、四组 Postgres、调度器、AL2023 原生资源及 Vercel Linux 函数包。
- 干净发布工作树的完整 `scripts/verify.sh` 通过：repo-health、类型检查、571 项 Node 测试、隔离服务 smoke、367 项 Swift 测试（4 项条件跳过、0 失败）、arm64 Release 和 diff 检查。
- 调度器 17 项测试、类型检查和两套 dry-run 构建通过；server 和 scheduler 依赖审计均为 0 vulnerabilities。
- 修复上一轮 CI 的高危间接依赖审计失败，升级锁文件中的服务端依赖和调度器开发工具，同步 Worker 类型声明。
- 两项动效测试使用 DEBUG 手动时钟推进真实 morph，显式控制减少动态效果，避免系统显示设置和墙钟调度造成误判；正式版本继续使用显示时钟。
- 私有本机历史证据未纳入提交。设计记录中的本机图片以文件名保留，干净 checkout 的文档检查通过。
- Xcode 许可和 Apple 开发者协议由用户处理；Apple 初期仍返回协议 403，随后同步恢复，成功公证后才公开发行。

本次发布客户端安装包。生产服务、模型、计费、数据库和调度部署未变；依赖更新尚未部署到生产服务。验证未新增真实付费题目调用。构建、CI、公证和公开下载核验日志保存在本机 `output/release-2.14-2026-10-03/`。
