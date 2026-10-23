# Mac 候选包追溯

工程命令以 [HANDOVER](../../HANDOVER.md) 为准。

`./scripts/package.sh release --unsigned` 使用现有锁定 Swift checkout，禁止自动解析或更新依赖；缺少 checkout 时停止，不自动下载。
每次 release 构建输出 `dist/candidates/<candidateID>/NotchSPI.dmg`，保留既有 `dist/NotchSPI.dmg` 和其他候选。
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
node scripts/cross-platform/mac-provenance.mjs finish output/mac-builds/<candidateID> dist/candidates/<candidateID>/staging/NotchSPI.app dist/candidates/<candidateID>/NotchSPI.dmg
```

该命令要求当前源码身份仍与候选记录一致。历史候选应在对应源码快照下复核，不能将失败解释为自动重签名或更改历史记录的许可。
