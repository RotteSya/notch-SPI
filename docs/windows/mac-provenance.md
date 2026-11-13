# Mac 候选包追溯

工程命令以 [HANDOVER](../../HANDOVER.md) 为准。

`./scripts/package.sh release --unsigned` 使用现有锁定 Swift checkout，禁止自动解析或更新依赖；缺少 checkout 时停止，不自动下载。
每次 release 构建输出 `dist/candidates/<candidateID>/NotchSPI<version>-mac.dmg`，保留既有 `dist/NotchSPI.dmg` 和其他候选。
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

本轮夸克共享目录NotchSPI Releases的两个旧3.1包已分别改为NotchSPI3.1.0-mac.dmg和NotchSPI3.1.0-intel.dmg，未改变分享权限或替换内容。当前3.1.5规范副本及原字节摘要见本机output/public-filenames-20261113/delivery/和manifest.json；未代表已上传或生产服务已部署。线上迁移需先准备规范资产，再发布兼容新旧资产名的服务并核验两渠道；旧生产代码仍依赖旧名，不能提前删除旧存储别名。历史旧路径保留为回退依据。

下载元数据按通道在进程内最多缓存600秒，缓存具体资产URL与规范文件名的配对，不缓存失败，不在过期查询失败时冒用旧结果；新发布的可见延迟与更新元数据的10分钟窗口一致。
