# 历史归档

当前工程规则只从 [HANDOVER](../../HANDOVER.md) 进入。历史记录中的安装、部署或付款步骤均不是当前指令。

[index.json](index.json) 记录旧路径、来源和替代文档。此前条目使用 `baseline_commit` 从 Git 历史读取；带 `archive` 的条目必须读取指定归档，因为内容包含当时尚未提交的工作区变更。

[2026-10-21 归档](2026-10-21-retired.tar.gz) 保存清理前的交接入口、QA 说明、旧发布/Windows 计划、生产计划 JSON，以及六个旧月票原型文件。所有原文保持原始字节；[清单](2026-10-21-retired.json) 包含整个压缩包和每个文件的 SHA-256。归档用于追溯，不参与编译或当前文档搜索。

在仓库根目录查看目录用 `tar -tzf docs/history/2026-10-21-retired.tar.gz`；读取某个原文用 `tar -xOzf docs/history/2026-10-21-retired.tar.gz <清单内路径>`。如需解包，选择项目临时目录，避免覆盖当前源码。

发布工作树、签名安装包、Intel/Catalina 源码与原始发布证据保持原位置。`objective-eval-output/` 的十七份固定证据继续按既有清单校验，未转移或改写。

## 2026-11-02 知识归档

[本轮清单](2026-11-02-governance-34b85d5-retired.json)与[原始字节归档](2026-11-02-governance-34b85d5-retired.tar.gz)保存 94 份日期报告、样本和旧交接材料。来源提交为 34b85d5bf9effa0892725ebd2449119c46d1a612；逐文件大小和 SHA-256 均已回读核验。日期授权、预算和未发布状态只属于原记录时点。
同一路径可能被再次用于不同材料，例如 design-qa.md；必须同时核对 baseline_commit 和摘要。索引中的 replacement 是当前参考导航，原文从 archive 指定成员读取。

## 2026-11-09 Windows 验收归档

[清单](2026-11-09-windows-acceptance-retired.json)与[原文](2026-11-09-windows-acceptance-retired.tar.gz)保存改写前的 Windows 手册；原日期、旧候选身份及结论不变。当前步骤仍见 [Windows 验收](../windows/manual-acceptance.md)。读取命令为 `tar -xOzf docs/history/2026-11-09-windows-acceptance-retired.tar.gz docs/windows/manual-acceptance.md`，在仓库根目录执行。
