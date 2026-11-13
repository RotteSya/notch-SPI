# 历史归档

当前工程规则只从 [HANDOVER](../../HANDOVER.md) 进入。历史记录中的安装、部署或付款步骤均不是当前指令。

[index.json](index.json) 记录旧路径、来源和替代文档。此前条目使用 `baseline_commit` 从 Git 历史读取；带 `archive` 的条目必须读取指定归档，因为内容包含当时尚未提交的工作区变更。

[2026-10-21 归档](2026-10-21-retired.tar.gz) 保存清理前的交接入口、QA 说明、旧发布/Windows 计划、生产计划 JSON，以及六个旧月票原型文件。所有原文保持原始字节；[清单](2026-10-21-retired.json) 包含整个压缩包和每个文件的 SHA-256。归档用于追溯，不参与编译或当前文档搜索。

在仓库根目录查看目录用 `tar -tzf docs/history/2026-10-21-retired.tar.gz`；读取某个原文用 `tar -xOzf docs/history/2026-10-21-retired.tar.gz <清单内路径>`。如需解包，选择项目临时目录，避免覆盖当前源码。

发布来源、签名安装包和原始证据保留；本机工作树退役及材料迁移以[工程交接](../../HANDOVER.md#本地治理记录2026-11-13)中的路径映射为准。`objective-eval-output/` 的十七份固定证据继续按既有清单校验，未转移或改写。

## 2026-11-02 知识归档

[本轮清单](2026-11-02-governance-34b85d5-retired.json)与[原始字节归档](2026-11-02-governance-34b85d5-retired.tar.gz)保存 94 份日期报告、样本和旧交接材料。来源提交为 34b85d5bf9effa0892725ebd2449119c46d1a612；逐文件大小和 SHA-256 均已回读核验。日期授权、预算和未发布状态只属于原记录时点。
同一路径可能被再次用于不同材料，例如 design-qa.md；必须同时核对 baseline_commit 和摘要。索引中的 replacement 是当前参考导航，原文从 archive 指定成员读取。

## 2026-11-09 Windows 验收归档

[清单](2026-11-09-windows-acceptance-retired.json)与[原文](2026-11-09-windows-acceptance-retired.tar.gz)保存改写前的 Windows 手册；原日期、旧候选身份及结论不变。当前步骤仍见 [Windows 验收](../windows/manual-acceptance.md)。读取命令为 `tar -xOzf docs/history/2026-11-09-windows-acceptance-retired.tar.gz docs/windows/manual-acceptance.md`，在仓库根目录执行。

## 2026-11-13 四分支保全与核验

核验基点为 `01d3901`。这是本机历史收口，不改变当前产品行为、生产配置或评测结论，不代表远端现状。完整逐文件比较及判定在本机 `output/branch-value-review-20261113/review.json`；其中88条变更文件记录包含原SHA-256、大小及与main的相同/不同/缺失状态。字节不同不自动等于有待合并功能。

| 原本地分支 | 已被主线覆盖或替代 | 独有价值与处理 |
| --- | --- | --- |
| archive/local-preread-20261108 / 86254cb | Astra路由前置提交在main有等价补丁；裁题、传输计时等8个文件与main相同 | 一次性主动预读、请求复用身份/状态、设置及快捷键、原生QA和runner仍有独有代码；22条路径不在main。保留分支和全部实验，不冒称已上线或已完成实机/真实耗时验收。 |
| archive/request-budget-20261108 / 2f1cf78 | 66e1cc6整合14文件预算实验：12文件的增删行一致；capture-service补入tutorResultV1，测试增加15行覆盖协商请求一致性。当前预算/预扣与评分回归34/34通过 | 主要是整合前快照及历史验证语境，不是缺失功能。bundle已保全，但原提交非main祖先且无upstream，普通branch -d拒绝；保留分支，未使用-D、重设upstream或其他绕过手段。 |
| codex/fix-math-resources-hover-ci / 595cde7 | 0e7cfa4解决资源定位及稳定指针测试；当前AnswerMath和ManualCollapseHoverTests整个文件与0e7cfa4相同 | 旧方案直接移除字体可用性检查；main保留检查并增加XCTest旁资源定位。旧注入指针及屏幕通知断言是历史备选测试，已保全。删除本地别名，不把两个方案称为相同补丁。 |
| codex/objective-legacy-baseline / 619c9d0 | fbcb6eb提供后续legacy prompt/task入口和独立runner | 旧语义评分器及测试、六份评测原文有独立价值，不等于当前更严格评分器。两份JSONL各240条，原manifest摘要匹配；comparison仍为pending_independent_review且Token、p95超阈值。原始字节保全后删除本地别名；不重跑模型、不重评分、不将旧结果并入当前固定证据集。 |

删除的两个codex分支不是main祖先；它们与现存本地上游跟踪引用分别相等，普通 `git branch -d` 接受删除。此事实不是“已合并main”的证明，也不保证远端仍存在；恢复依赖已核验的本机bundle。所有远端跟踪引用及其他分支/标签保持不变。

### 保全与恢复

本机保全根：`output/branch-value-review-20261113/`（不在Git交付中，迁移电脑须另行复制）。

- `branches.bundle`：四分支完整可达历史，SHA-256为 `07114ea3d7eacc4d7f147333ceb3b50fb49c78d3dd7326e9ede3ae9bc0759b88`。bundle verify确认无需前置对象；已在隔离bare仓库恢复、fsck并逐项核对88个变更文件，临时验证仓库随后清理。
- `manifest.json`、`review.json`：完整HEAD、merge-base、原路径与逐文件SHA-256及处理理由；`changed-files/`与各分支patch保留可直接查阅的代码/测试/证据原文。完整依赖及删除路径以bundle为准，摘录目录不作为可构建源码树。
- `budget-integration-hunks.json`记录与66e1cc6的增删行比较；`restoration-verification.json`记录恢复与legacy证据核验；`branch-deletions.json`保留普通删除结果及预算分支的拒绝原因。初始引用在 `refs-before.txt`，工作树状态另存快照。

恢复已删除分支时，先校验bundle摘要和 `git bundle verify`，确认同名本地分支不存在，再在项目Git根执行：

```sh
git fetch output/branch-value-review-20261113/branches.bundle refs/heads/codex/fix-math-resources-hover-ci:refs/heads/codex/fix-math-resources-hover-ci
git fetch output/branch-value-review-20261113/branches.bundle refs/heads/codex/objective-legacy-baseline:refs/heads/codex/objective-legacy-baseline
```

这是本地文件恢复，不访问远端。应恢复到595cde7678f072c877ca58dc5b9a91d6187f6d55、619c9d085b351f3e7cfa7dbf9ad07830d182e5a1；没有强制覆盖参数。其他两分支的恢复使用manifest中的原分支名和完整HEAD，正常情况下无需恢复。历史代码可能缺少当前隔离/依赖保护，恢复不意味着可以直接运行旧付费评测或应用测试。

本轮只减少两个本地引用，分支10→8，工作树仍6；保全会新增本地证据占用，不声称节省磁盘。验证：当前预算/评分回归34/34、治理回归25/25、repo-health文档映射/链接检查通过；六个工作树注册及五个非主工作区HEAD/状态/差异摘要与基线相同，其他引用未变。交付检查结果随本机outcome.json保留；未重复未受影响的产品全量构建、真实模型或硬件验收。
