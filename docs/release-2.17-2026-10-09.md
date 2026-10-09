# NotchSPI 2.17 正式发布 · 2026-10-09

经用户“发新版本。同时通过夸克CLI上传到夸克网盘”授权，客户端 **2.17 / build 24** 于2026-10-09 18:49（Asia/Shanghai）正式发布：[官方下载](https://notchspi-api.vercel.app/dl)、[发行记录](https://github.com/RotteSya/notch-SPI/releases/tag/v2.17)。

## 内容与发布绑定

包含物理刘海左右两翼布局、收起底边像素修正、人物像长名称截断、截图飞入动效及客户端截图/刷新优化。没有把所有内容整体下移。此次只发布客户端；现网服务端与官网仍以[轮播上线记录](site-carousel-2026-10-09.md)中的独立生产源码为基线，main里的服务端延迟优化没有随DMG发布部署。

- 标签 `v2.17`、源码提交 `677f1f73d0a157a2953364f4e701dc5e5d4a7aed`，已推送main。
- 发布前修复旧Xcode缺少macOS26截图SDK类型的编译失败：编译期约束新接口，旧工具链继续采用兼容接口；运行期可用性检查保留。macOS26接口测试在本机Xcode27实际执行，在旧SDK上明确条件跳过。
- 服务端sharp及调度器sharp覆盖版本从0.35.4升级到0.35.5，修复发布CI安全审计阻塞；锁文件只更新sharp相关原生依赖，两处审计均0漏洞。本次没有将依赖变更部署到生产服务。
- Developer ID签名、Apple公证Accepted：`b459f836-a5be-492d-bd93-00c6e0e84b1d`。
- DMG 4,115,394字节；SHA-256 `9a33b9dad64f789b316f1455c13070ee0e73297e69d00414c80b5befb9ab1f4d`。

## 验证及分发

- 干净发布工作树完整 `scripts/verify.sh` 通过：repo-health、服务端类型检查、Node625/625、隔离mock smoke、串行Swift395项（4项条件跳过，0失败，warnings-as-errors）、arm64 Release及diff检查。没有将主工作树历史输出目录断链误报为已修复。
- 调度器类型检查、17/17测试、两个配置dry-run构建通过。
- [CI 37919721456](https://github.com/RotteSya/notch-SPI/actions/runs/37919721456) 10/10通过，覆盖旧macOS工具链、Node22/24、PostgreSQL16/17、AL2023原生资源及Vercel Linux函数包。
- 74个客户端构建输入在打包后摘要一致；DMG签名、装订、Gatekeeper及只读挂载后App签名、Gatekeeper、版本2.17/24和二进制一致性通过。
- GitHub正式latest为v2.17，资产摘要一致；正式 `/update` 返回2.17/v2.17，正式 `/dl` 完整下载的大小和SHA-256与公证产物一致。
- 本机夸克CLI上传成功（非秒传）：`夸克网盘/NotchSPI Releases/NotchSPI-2.17.dmg`，返回大小4,115,394字节、成功数量1；FID `02aa8f14fed84b67950d24dec52705c4`。首次上传使用CLI默认目录，随后按用户指定移至NotchSPI Releases，CLI回执确认最终路径，FID保持不变；后续版本使用此目录。移动回执为 `quark-move.jsonl`。上传源文件与公证产物摘要一致；未对网盘文件重新下载校验，也未创建分享链接。

证据位于 `output/release-2.17-2026-10-09/`，包含构建输入、公证日志、验证脚本、CI结果、下载摘要和夸克上传回执。

## 验证边界

硬件遮挡的几何、动画及2×离屏像素回归通过，沿用本轮已完成的DEBUG实际窗口验收。左侧软件扩展区曲率尚未逐像素实拍校准；其他MacBook机型、物理热插拔/合盖及全屏切换仍需实机确认；极小虚拟显示器未做整套响应式重排。详见[硬件刘海记录](hardware-notch-layout-2026-10-09.md)。真实模型端到端两秒目标仍未达成，本次没有新增付费模型调用。

客户端上一正式版本为v2.16；此次没有生产服务或数据库迁移，无需进行服务端回退。没有替换本机Applications安装包。
