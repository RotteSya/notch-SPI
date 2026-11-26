# Mac 候选包追溯

工程命令以 [HANDOVER](../../HANDOVER.md) 为准。

`./scripts/package.sh release --unsigned` 使用现有锁定 Swift checkout，禁止自动解析或更新依赖；缺少 checkout 时停止，不自动下载。
每次 release 构建输出 `dist/candidates/<candidateID>/NotchSPI<version>-mac.dmg`，保留既有 `dist/NotchSPI.dmg` 和其他候选。
DMG 窗口样式：隐藏的 `.background/background.tiff`（由 `swift scripts/dmg-background.swift` 生成，尺寸与 package.sh 中的图标坐标对应）和卷图标，由 Finder 写入 `.DS_Store`。首次打包需允许终端控制 Finder；签名 release 布局失败即停止，`--unsigned`（含 CI）仅警告并退回普通窗口。打包前须先推出已挂载的 NotchSPI 卷。
QA 仍使用 `dist-qa/NotchSPI.app`，兼容 `run-local.sh`；QA 是可覆盖的本地启动目录，不作为历史交付归档。

构建开始前记录整个非忽略源码集合的提交、内容摘要、dirty 状态、构建主机及 CI 标识，写入 App 的 `Contents/Resources/build-provenance.json`。
App 完成后校验源码未漂移及严格代码签名。DMG 完成后用系统 hdiutil 只读挂载到本项目 output 临时目录，比较所有 App 文件内容、可执行标记和符号链接目标，再卸载。
验证成功才在候选旁生成 `delivery-manifest.json`，包含包内源码身份、App 摘要、DMG 摘要及各项核验状态。
不把旧 DMG 与新源码关联；源代码发生变化或 DMG 内 App 不匹配时失败。

`appSignatureValid` 表示 codesign 严格校验通过，ad-hoc 也可以满足，不代表 Developer ID、Gatekeeper、Apple 公证、真实安装或升级验收。
`--unsigned` 不使用正式签名或公证；正式发布仍需要独立授权和验收。
工作区 dirty 的候选只能追溯该工作区内容，干净提交候选才可从记录的提交检出重建。

可复核已有候选：

```sh
node scripts/cross-platform/mac-provenance.mjs finish output/mac-builds/<candidateID> dist/candidates/<candidateID>/staging/NotchSPI.app dist/candidates/<candidateID>/NotchSPI<version>-mac.dmg
```

该命令要求当前源码身份仍与候选记录一致。历史候选应在对应源码快照下复核，不能将失败解释为自动重签名或更改历史记录的许可。


## 用户可见文件名

2026-11-13起，官网、网盘、直接交付及未来发布包统一使用 `NotchSPI<major>.<minor>.<patch>-mac.dmg`（Apple Silicon）或 `NotchSPI<major>.<minor>.<patch>-intel.dmg`。例如NotchSPI3.1.5-mac.dmg、NotchSPI3.1.5-intel.dmg；旧3.1文件名规范为3.1.0，不能改标为3.1.5。文件名不带build、候选ID、日期或AppleSilicon字样。Windows文件保留其平台/架构及真实扩展名，也不添加build号；不可为了套用Mac格式将exe/zip改成dmg。

build号仍用于CFBundleVersion、升级比较、签名manifest和内部追溯。候选目录继续隔离，同版本同平台最终对外只能选择一份已验收字节；不得覆盖同名不同内容。App仍名为NotchSPI.app。冻结包、历史manifest及失败验收记录不改写；仅改外层文件名不需要重签，但必须核对摘要一致并同步新的对外校验清单。

主线package.sh输出mac后缀；独立Intel维护树package.sh输出intel后缀。已有正式标签仍标识旧源码，不因命名维护移动标签。官网/dl及/dl/intel从同一稳定发布快照选择具体资产，Content-Disposition使用版本与平台名；优先规范资产，兼容内部旧别名。发布元数据不可用或资产缺失时返回502，不把未知字节标为新版本。下载因此依赖发布元数据可用性；更新接口和已有内部存储别名继续兼容，未来发布可只上传规范名称。

本轮夸克共享目录NotchSPI Releases的两个旧3.1包已分别改为NotchSPI3.1.0-mac.dmg和NotchSPI3.1.0-intel.dmg，未改变分享权限或替换内容。用户后续明确授权上线：2026-11-13已向v3.1.5新增两个规范名称DMG及NotchSPI3.1.5-SHA256SUMS.txt，原资产ID、名称、摘要和发布说明不变。源码de823ca以生产配置暂存验证后提升为部署dpl_5YinJkasz4hZyxXECDCsTofvZC6W，官网别名已回读确认；未推送代码、移动标签或重签包。两个公开下载响应均为200、无重定向，文件名、大小和SHA-256匹配原签名包；两个更新接口的版本/说明、三语言入口及进程健康检查通过。

下载元数据按通道在进程内最多缓存600秒，缓存具体资产URL与规范文件名的配对，不缓存失败，不在过期查询失败时冒用旧结果；新发布的可见延迟与更新元数据的10分钟窗口一致。

上线证据在本机output/public-filenames-20261113/production/：stage/public-verification.json、promotion.json及源码/资产清单。135个部署源文件逐项匹配审阅快照；实际运行变更仅routes.ts及新增release-download.ts，生产环境配置未改。回退点为dpl_25HF1bcgD58Bnze3p3Hhz6WBwnyQ；原存储别名保留，可在获授权后恢复旧部署，禁止删除旧包或覆盖数据库。检查窗口内新部署未见error/fatal日志，不代表长期负载验收。未调用模型、操作付款或重做Intel实机验收。


## 本机正式发布与夸克同步

用户选择由本机正式发布命令触发同步，不增加常驻任务、CI 凭据或工具安装。必须先完成双平台签名、公证及约定的验收，准备已存在 tag 的 GitHub 稳定草稿；草稿包含同一版本的 mac/intel 规范 DMG 和 `NotchSPI<version>-SHA256SUMS.txt`，校验清单按 `SHA256  文件名`（两个空格）绑定两个包。此入口检查下载字节，不能替代签名、公证或 Intel 真机验收，也不从主树构建 Intel。

使用本机已有 gh 与夸克登录。在已忽略的 output/release-local.json 配置现有工具路径和固定目标，不放 token、cookie：

```json
{
  "quarkCli": "/现有夸克技能目录/bin/qk",
  "folderName": "NotchSPI Releases",
  "folderPath": "夸克网盘/NotchSPI Releases"
}
```

用户要求发布新版本并授权后，由 Codex 从主维护树执行以下入口，用户无需手动运行：

```sh
node scripts/release.mjs publish vX.Y.Z
```

入口先下载 GitHub 资产、核对平台名称/大小/SHA-256/校验清单，再读取夸克完整搜索结果，拒绝歧义目录、截断搜索、无可信回执的同名文件。通过预检后将草稿发布为 latest，只上传两个 DMG 安装包到既有共享目录；校验清单保留在 GitHub 和本地发布证据中，不上传夸克。对两个安装包逐个按文件 ID 下载回验，并复核 GitHub 资产身份未变。只在两端核验全部完成时成功退出。发布公开后若夸克失败，不自动撤销 GitHub 发布，状态记录为 blocked；不得将部分成功报告为双渠道完成。

补同步已公开版本或恢复有明确回执的失败任务：

```sh
node scripts/release.mjs sync vX.Y.Z
```

sync 不发布草稿；重跑复用已核验的资产身份与上传 ID，不自动覆盖或上传重复文件。回执和原始日志在 output/release-publish/对应版本/，需随电脑迁移保全。上传结果未知时必须先查看日志、核实远端实际文件；禁止通过清空状态强行重试。进程异常退出留下 running.lock 时，先确认所属进程已结束并核验上传结果，再人工解除锁。登录过期会停止并提示，按现有工具流程恢复授权后再运行，不自动安装或重新登录。既有文件若被人工移动/删除，需要人工核查目标目录与回执，不将历史路径回执当成持续监控。

package.sh/CI 构建及直接在 GitHub 网页发布不会触发此本机命令；今后正式双平台发布须使用上述入口。它不更改分享权限、不删除旧包，不为单平台候选放宽完整性要求。

2026-11-13 实际补同步 v3.1.5 完成：mac DMG 9,618,136 字节、Intel DMG 9,898,212 字节及校验清单均上传到 NotchSPI Releases 并下载回验，摘要等于已发布规范资产；原 3.1.0 文件保留。回执见本机 output/release-publish/v3.1.5/state.json，测试及执行记录见 output/quark-publish-20261113/。本次未重新发布 GitHub 版本、推送代码或变更 Intel 工作树。

后续按用户要求，夸克中的 NotchSPI3.1.5-SHA256SUMS.txt 已移入回收站（界面提示40天内可恢复），两个3.1.5安装包、旧包和原下载说明保留。同步入口仅上传/回验两个安装包，仍强制下载并校验 GitHub 清单；旧清单上传回执保留为历史，不据此重传或下载已移除文件。

2026-11-20 v3.2.0 首次经 publish 入口完成：草稿发布为 latest，两个安装包上传夸克并按文件 ID 回读，摘要与 GitHub 资产一致；回执见本机 output/release-publish/v3.2.0/state.json。按标签读取 Release 的接口不返回草稿，入口改为分页列出并要求唯一匹配。
