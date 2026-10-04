# NotchSPI 2.16 正式发布 · 2026-10-04

用户明确授权“上线”后，付款恢复、免费额度体验及题包一致性改动已上线。客户端 2.16 / build 23 于 2026-10-04 21:24（Asia/Shanghai）发布：[官方下载](https://notchspi-api.vercel.app/dl)、[发行页](https://github.com/RotteSya/notch-SPI/releases/tag/v2.16)。服务端及官网已先于客户端切换。

## 发布绑定

- 客户端源码及标签 `v2.16`：`cebab65cb83b137961b1746a20853584a5824a8d`，已推送 main。
- Vercel 正式部署：`dpl_2eoR8nPsyYgpujVcrnunkC3fHCdL`，候选地址 `https://notchspi-fjbzv68b2-rottesyas-projects.vercel.app`。先使用 production 环境、`--skip-domain` 构建并核验，再 promote。
- 服务端仍基于原生产源码 `5c6dfbf819eaaf3db05f9868839af954fbfd7b9d`，叠加本轮 23 个服务端/测试/官网配置文件；原官网资产保留。没有夹带 main 中独立的 mock 文案或依赖锁文件更新。完整清单和摘要保存于 `output/release-2.16-2026-10-04/server-source-manifest.json`，下次服务端部署须以此为现网基线，不应仅按 main 推断线上内容。
- 没有更改生产环境变量、Stripe 配置、价格、币种、免费额度规则或已购权益；本轮没有新增数据库结构迁移。
- Apple 公证 Accepted：`4b71c0ee-b969-46af-b069-0120939c1301`。DMG 3,915,049 字节，SHA-256 `7a6e3b69f23a4b681dea327bbb71933edcc4f29560981bad49c63237171c602a`。

## 验证结果

- 干净客户端发布工作树完整 `scripts/verify.sh` 通过：repo-health、类型检查、Node 584/584、隔离 mock smoke、Swift 370 项（4 项条件跳过、0 失败）、arm64 Release、diff 检查。主工作树既有历史输出目录断链未纳入干净工作树，不宣称已经修复这些历史文件。
- [CI 37204917308](https://github.com/RotteSya/notch-SPI/actions/runs/37204917308) 10/10 通过，覆盖 Node 22/24、PostgreSQL 16/17、macOS、AL2023 原生资源及 Vercel Linux 函数包。
- 实际生产候选源码类型检查及独立本机 PostgreSQL 17 测试库共 710/710 通过；包含重复免费发放、免费耗尽、免费/付费扣减、支付延迟、取消/失败恢复、断线、重复通知与并发查询。首次候选测试有一项历史证据校验因归档目录缺少 Git 历史读取路径失败；补充只读历史仓库路径后全量重跑通过，未修改测试断言。测试数据库已停止。
- 73 个客户端构建输入在打包后摘要一致；DMG 签名、装订、Gatekeeper，以及只读挂载后的 App 签名、Gatekeeper、2.16/23 版本、二进制一致性与 `notchspi` URL scheme 声明通过。
- 同源码 DEBUG 隔离包使用临时凭证和本机 mock 服务，实际通过 `notchspi://account` 冷启动打开账户页并显示免费 30 题；没有接触真实账户密钥。此项是隔离包交互验证，不是生产已付订单的 App 唤起实测。QA 包已退出、注销 URL 注册并删除。
- 候选和正式域名分别完成 16 个只读 HTTP 检查：三页面 × 三语、健康状态、付款返回页、订单查询鉴权及源码/测试文件不可公开访问。正式三语首页与已核验候选逐字节一致。健康状态仍为 DeepSeek / Postgres / Stripe / webhook configured。
- 2026-10-04 21:22–21:25（Asia/Shanghai）复核官网：免费 30 题；100 / 300 / 1000 题对应 300 / 800 / 2200 JPY，一次性付款；名称及购买指引为本轮共享配置。未调整收费条件。
- GitHub latest 为 v2.16；正式 `/update` 返回 2.16 / v2.16；正式 `/dl` 完整下载与公证产物、GitHub 资产 SHA-256 一致。首次 Python 下载探针发生流中断；随后 curl 完整下载和长度/摘要核验通过，保留异常记录，不将首次失败隐藏为成功。

## 验证边界与回退

没有真实扣款、模型付费调用或真实 Stripe sandbox 托管收银台成交。支付成功、异常与幂等由隔离支付适配器及真实测试 PostgreSQL 验证；线上检查不证明新生产订单已实际付款到账。

服务端回退目标为 `dpl_8CPzewPfCAqw49bdzZBYrW7tX1Xi`；客户端旧安装包为 v2.15。回退时先核对在途订单及本地恢复事件状态；旧服务不提供新增订单查询能力，2.16 会提示查询不可用并保留原订单身份，不能让用户盲目再次付款。生产数据库及历史权益应保留。无需回退时不执行这些动作。

账号方案仍为继续免注册，需求成立后自愿绑定轻量账号；没有把注册设为试用或付款前置条件。详细成本区间、触发条件与数据缺口见[付款体验与账号评估](purchase-experience-2026-10-03.md)。本机证据目录：`output/release-2.16-2026-10-04/`。
