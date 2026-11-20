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

## 2026-11-13 常驻工作树收口

基点 `6efd26f`。目标为main与Intel两个常驻工作树，Windows未闭环调查按用户允许的例外暂留。三棵退役树原工作区均干净；未覆盖未提交成果。最近新用户测试聊天已明确“测试完了，归位吧”并完成恢复；本次未触碰其备份、账户、偏好或系统权限。

| 退役工作树（相对output） | 固定源码及依据 |
| --- | --- |
| release-3.0-execution/source | 84d68702798c04d3ad1a85599d154348ad6c8554。4个主线之外提交中，a62d11d的8个实现/配置/测试文件补丁与main祖先696883f完全一致：鉴权readyz、无DB探测healthz、独立有界只读连接、serverless无维护定时器及15分钟维护均仍在当前实现；readiness测试整个文件相同。其余3提交为历史发布/权限记录，原文随完整历史保留，不移植过时生产配置。 |
| release-3.1-execution/source | dd3a45abf1c936f5b0339b3e7dd91a3cf46b66d7，已包含于main。父目录deploy.mjs与acceptance.mjs仍是历史原文；后者包含真实模型调用，前者包含部署动作，均非日常验证入口。需要重现时先恢复固定source和原node_modules，再单独审查所需授权，不直接执行。 |
| release-315-arm64-prep-20261113/source | a005b09b242ec20de90c3b8ab56d2b200722b62f，与v3.1.5标签及最终候选来源一致。permission-acceptance.json、upgrade-acceptance.json均绑定最终来源；同一DMG的SHA-256 c9b7520ae2443dea349084e68a79af72af89803ded8a2024e689b328ff8b76ee重新核验，hdiutil verify和严格App签名通过。原单图/多图练习在RC1验收，其后未改对应实现；不将RC1/RC2/RC3权限失败计为成功。后续双架构report.md记录该包正式发布，早期publication-plan/report“尚未发布”是阶段快照，保留原文。 |

Windows `codex/windows-2022-flight-diagnostics` / e2a54b4暂留原目录。`output/windows-2022-investigation/report.md`与remote-results.json保存108轮结果；原始Windows Server 2022空白未重现，缺少原失败后续帧，无法确定是首次采样还是持续绘制问题。诊断可能改变时序，不能将后续运行通过当作根因修复。下次复现需保留连续像素、图片就绪与renderer时间线；有充分诊断结论并处理独有工具后再退役。当前主线和Intel源码、Windows诊断及两个archive实验分支不变。

### 本机保全与恢复契约

保全根 `output/resident-worktrees-20261113/`，未纳入Git，迁移电脑须另行复制。这是同盘回退材料，不宣称已具备异机备份。

- `sources.bundle`保存三棵树完整Git历史，SHA-256 `38853525ac1711e888fac4ca2d99a649e2c3ca2a06d90e0823a27178b145de70`；无前置对象，已独立bare恢复、fsck并核对2800个跟踪文件的原始内容。临时恢复仓库已移除。
- `path-map.json`、`baseline.json`记录原路径/HEAD和保全路径；三个inventory记录原字节摘要、权限及符号链接。`release31/payload/`保存原server/node_modules；`arm64/payload/`保存全部.build、dist、output、三个node_modules及scheduler/.wrangler。未删除失败候选、验收材料或私有配置，不将搬迁算作磁盘节省。
- 三个原父目录的发布记录、安装包、回滚材料及private目录保持原位。历史manifest的source下路径按path-map将根替换为相应payload读取；源码由bundle或精确提交恢复，不能用当前main冒充。
- `release30-integration.json`、`arm64-evidence.json`、`restoration.json`保存替代及核验依据；`retirement-journal.json`记录迁移和普通删除。release30本地分支与其本地upstream相等，Git允许普通-d；不是声称其历史已合入main。其余两个分支是main祖先。未改变远端引用或标签。

需要恢复某一历史执行环境时：先校验bundle摘要并运行 `git bundle verify output/resident-worktrees-20261113/sources.bundle`；确认原路径和原分支均空缺，从baseline取完整HEAD并对应下列分支：release30为codex/release-3-0，release31为codex/release-3-1，arm64为codex/release-3-1-5-arm64-prep。

```sh
# 示例：只恢复3.1的原执行目录，不运行历史部署或验收脚本。
git fetch output/resident-worktrees-20261113/sources.bundle refs/heads/codex/release-3-1:refs/heads/codex/release-3-1
git worktree add output/release-3.1-execution/source codex/release-3-1
after_restore=output/release-3.1-execution/source
cp -a output/resident-worktrees-20261113/release31/payload/. "$after_restore/"
```

其他树替换为表中的精确路径/分支和对应payload；release30无非Git材料，不需要复制payload。恢复后核对HEAD、工作区及inventory，再审查历史脚本的网络、生产配置和隔离边界；本次恢复验证没有执行历史业务代码。旧依赖和绝对路径缓存可能需重新准备，不能将归档恢复等同于旧工具链运行通过。

本轮工作树6→3、本地分支8→5，未清理两个实验引用。产品代码不变；检查结果记录在本机outcome.json。未重跑付费模型、真实数据库或硬件验收，不把历史已通过报告表述为本轮实机结果。


## 2026-11-13 远端分支授权收口

用户审阅精确七分支清单后明确确认，原“不删远端”限制仅对本次名单解除。使用普通 `git push --atomic origin --delete` 一次删除下列七个引用，无强制参数；未推送本地main、创建发布或修改保护规则。

| 删除的远端分支（均为codex/前缀） | 删除前HEAD | 依据 |
| --- | --- | --- |
| fix-math-resources-hover-ci | 595cde7678f072c877ca58dc5b9a91d6187f6d55 | 主线已有替代实现，原代码完整保全 |
| intel-auto-update | 304419ba7537787b6bee6387764be68dc59d2be8 | 已包含于正式Intel f1c9346 |
| intel-reliability-20261112 | 212f094a308dcb93706aa45f38364ff7bbb60c14 | 已包含于正式Intel f1c9346 |
| intel-update-channel | 2a9292eef13b15b70f01fae62f5c7ad0bb406b1c | 已包含于远端main 7366e21 |
| objective-legacy-baseline | 619c9d085b351f3e7cfa7dbf9ad07830d182e5a1 | 独有评分器及六份历史评测原文保全，原失败/待审结论不变 |
| release-3-0 | 84d68702798c04d3ad1a85599d154348ad6c8554 | 数据库保护已纳入主线，历史提交完整保全 |
| release-3-1 | dd3a45abf1c936f5b0339b3e7dd91a3cf46b66d7 | 已包含于远端main，历史脚本及恢复契约保全 |

删除前重新核对全部HEAD、标签、分支保护、rulesets和开放PR；候选无保护、无开放PR或活动运行。此前仅查询最近100次运行未发现活动项，后按queued/in_progress/waiting/pending/requested补查发现main旧任务34749651409仍queued（2026-09-13创建），与删除名单无关，未取消或修改。仓库当前及远端main的CI/脚本/部署配置未发现对七个分支名的依赖；未声称审计了外部第三方自动化。

删除后远端10→3：main仍为7366e21372c9f0fda68451491f2b8ac775c9bac0，codex/release-3-1-5-intel仍为f1c9346c03763dfa8122f9e81e1a9732311f809c，codex/windows-2022-flight-diagnostics仍为e2a54b4798e0ba91f14a0c3754d76c5ec7e78e1c。全部标签逐项不变；本地5分支和3工作树保持原用途，只有对应远端跟踪引用随删除同步移除。旧分支名URL不再可用，历史复现使用完整提交和保全材料。

证据根 `output/remote-branch-review-20261113/`：manifest.json记录完整HEAD与判定，deletion.json记录授权及删除结果，heads/tags前后快照用于回读核验。candidates.bundle SHA-256为 `c002bba8880339669c459f1728be5fc003762d413778a8e56cc97602fdd3e681`；独立恢复、fsck及5963个树条目对象可读性核验通过。bundle存储refs/remotes/origin/*，默认bare clone未导入这些引用；修正为显式fetch后独立验证通过，原日志保留。此材料未纳入Git，是同盘回退材料，迁移需另行复制。

恢复前校验摘要、运行bundle verify并确认本地目标分支不存在。以下示例只恢复本地历史，不访问远端：

```sh
git bundle verify output/remote-branch-review-20261113/candidates.bundle
git fetch output/remote-branch-review-20261113/candidates.bundle refs/remotes/origin/codex/release-3-0:refs/heads/codex/release-3-0
```

应恢复到表中完整HEAD；其他分支替换同名ref即可。重新创建远端分支属于另一次远端写入，需要相应授权，并先确认远端同名引用空缺；不得覆盖后续新工作。验收结果见本机outcome.json；本次仅引用和文档治理，不重跑未受影响的产品构建、真实模型或硬件验收。

## 2026-11-13 剩余八树计量

自[工程交接](../../HANDOVER.md#剩余八树核验与收口)移入，原文不变：本轮计量：工作树9→6（主树及5个保留树），本地分支15→13；迁移保全27,974个普通文件。三个旧树合计2,394,180 KiB，保全目录在最终日志前2,296,348 KiB，差值97,832 KiB（约95.5 MiB）；不是全盘空闲空间变化。

## 2026-11-13 旧 Intel 可靠性草稿退役

自[工程交接](../../HANDOVER.md#旧-intel-可靠性草稿退役)移入，原文不变；其中路径相对Git根目录。

`778e141` 记录移除 `tmp/intel-reliability-20261112`。旧 HEAD `212f094a308dcb93706aa45f38364ff7bbb60c14` 是正式 Intel `f1c9346` 的祖先。五个草稿中 OfficialAPI及测试整个文件同时等于主线/正式Intel，VERSION.env和desktop生成版本等于正式Intel；HANDOVER仅首段不同，正式说明更完整。原文件及补丁保全后，定点restore并验证补丁可重新应用，再用非强制worktree remove退役；分支后续已删除，来源仍在正式Intel历史中。

保全目录 `output/intel-worktree-retirement-20261113/` 内：`inventory-before.json` 是文件SHA-256/权限/链接清单，`draft.patch`及`draft-files/`保全草稿，`payload/`原样保存旧树 `.build/`、`dist/`、`output/`，共7,098个普通文件。五个候选目录的十份DMG（每目录两份相同）及App摘要匹配manifest；五个候选的 hdiutil verify、codesign --verify --deep --strict 通过。原验收缺口不变，未声称Intel真机或升级通过。旧树与保全目录的分配空间差为32,272 KiB（约31.5 MiB，验收日志写入前），不算全盘可用空间增量。

历史 recovery-safety/recovery-latency/reliability-remediation 等记录中的旧路径不改写：将旧根替换为保全目录 `payload/`，见 `path-map.json`。恢复前确认目标路径及同名分支空缺、上述212f094仍可读取；在Git根目录执行以下恢复步骤（不是当前操作）：

```sh
retirement="$PWD/output/intel-worktree-retirement-20261113"
git worktree add -b codex/intel-reliability-20261112 tmp/intel-reliability-20261112 212f094a308dcb93706aa45f38364ff7bbb60c14
git -C tmp/intel-reliability-20261112 apply "$retirement/draft.patch"
cp -a "$retirement/payload/." tmp/intel-reliability-20261112/
```

该草稿不等于正式build43来源。退役时工作树10→9、分支15不变，其他工作树及引用不变；quick治理95/95及delivery通过，报告 `output/verification/20261113T062103Z-5002/results.json`。首次文档超限失败日志保留；通过合并重复记录解决，未提高预算。

## 2026-11-20 现状核对与清理

基点 `ee30e27`，与origin/main一致，清理前工作区干净。本节是本机快照，不代表生产或硬件验收；证据在本机 `output/governance-20261120/`（refs/工作树前后快照、分支删除日志、外层残留清单），未纳入Git。

已处理：

- 本地分支8→6。11-13收口后的5个分支因3.2.0发布新增Intel、渠道及CI修复分支而成为8个；本轮以普通 `git branch -d` 删除 `fix/ci-masked-test-failures`（58f612bd68d56465ea2833574417746a6387a0b5，main祖先，无远端、无工作树）与 `codex/release-3-2-channels`（b1cf98e62c4c1560b1ff5a9404e9470c560c7b5d，经c2b6925合入main，origin同名分支HEAD相同）。当前及远端main的脚本、CI、文档未引用这两个分支名。恢复：`git branch <原名> <完整HEAD>`。标签、远端引用、其他分支不变。
- Git根之外的 `../.build/`：仅SwiftPM的CACHEDIR.TAG与.buildSystem_debug两个标记文件（共219字节，时间戳2026-10-09，推断为在非包目录运行swift所留），无构建产物；记录摘要后移除。
- 文档对齐：README原将仍在维护的Intel写作历史归档，改为与工程交接一致；工程交接中3.1.5 Intel退役行补记本地b4b7706与远端f1c9346的差别，并将旧Intel草稿退役原文移入本文件以容纳现状记录。

核对后保留：

- 三个工作树均干净，无未提交修改。`output/release-320-20261119/intel` 为bc91120，等于v3.2.0-intel-build45与origin分支；其report.md记录两包已于2026-11-19T15:49Z正式发布，同目录STATUS-paused-20261120.md是公证受阻时的进度快照，保留原文。未发现未发布的Intel候选源码；未使用的ad-hoc及首次公证失败候选仍在两处dist/candidates，未删除。
- `codex/release-3-1-5-intel` 本地b4b7706比远端f1c9346多1个提交，该提交可从origin/codex/release-3-2-intel到达；11-20退役记录已决定保留分支，本轮不改。两个archive实验分支、Windows诊断分支及其工作树的保留理由不变。
- `.build/arm64-apple-macosx`（约405M）与 `.build/apple`（约388M）是旧构建系统目录，现行swiftbuild输出在 `.build/out`；其中含2026-09至10月的Products及NotchSPI.dSYM，无法排除与已发布版本符号对应，且2026-11-13清理明确保留Products/dSYM，故保留。`.build/NotchSPI-QA.app`、`NotchSPI-Device.app`、`personality-qa.*` 无现行脚本引用，但带签名身份，用途未能确证，保留。
- `desktop/dist/candidates`（18个Windows候选，约8.6G）、`output/`（约21G，320项）、`.release-evidence`、dist三目录、外层 `release-worktrees/`、`.tmp/`、`output/`：属候选包、验收或业务材料，Windows与Intel实机验收仍未闭环，全部保留。

用户确认后的追加处理（同日）：

- 远端 `codex/release-3-2-channels`（b1cf98e62c4c1560b1ff5a9404e9470c560c7b5d）以普通 `git push origin --delete` 删除；删除前复核其为origin/main祖先、无开放PR。远端分支5→4，标签不变。恢复需另一次远端写入：`git push origin b1cf98e62c4c1560b1ff5a9404e9470c560c7b5d:refs/heads/codex/release-3-2-channels`。
- 本地 `codex/release-3-1-5-intel`（b4b77065ba6939e957033c3b4c4baa48177a7e26）从3.2 Intel工作树以普通 `git branch -d` 删除，该提交是bc91120的祖先。本地分支6→5。远端同名分支（f1c9346，与v3.1.5-intel-build43标签指向相同）未动。
- 经用户再次确认，远端 `codex/release-3-1-5-intel`（f1c9346c03763dfa8122f9e81e1a9732311f809c）以普通 `git push origin --delete` 删除；删除前复核其与标签v3.1.5-intel-build43指向相同、是origin/codex/release-3-2-intel祖先、无开放PR及分支保护，CI与脚本无引用。远端分支4→3（main、3.2 Intel、Windows诊断），标签不变。恢复：`git push origin v3.1.5-intel-build43^{commit}:refs/heads/codex/release-3-1-5-intel`。
- 瘦身共69个目录，逐目录依据、文件数、占用与恢复方式在 `output/governance-20261120/slimming.json`，逐文件清单在同目录slimming-files.tsv：
  - 16个Windows `win-unpacked`（15个候选及desktop/dist顶层）：每个文件与相邻zip成员的名称、大小、CRC32一致，候选zip摘要与delivery-manifest一致；zip、manifest及3个仅含mac-arm64的候选不动。恢复用unzip解到原目录。
  - `output/automatic-runtime-judge-20261105/runtime/` 的model、cache、venv：该实验final-execution-report已否决候选并关闭许可；模型文件大小及LFS摘要与model-file-manifest固定修订一致，venv绑定改名前的项目绝对路径，版本留在requirements.actual.lock。输入、输出、日志与报告不动。
  - 退役树payload中3个server与2个scheduler的node_modules：已安装包的版本与integrity全部等于对应提交（a005b09、dd3a45a、7366e21）的package-lock。两个desktop/node_modules有prettier条目与锁文件不符，保留。
  - Swift缓存48个目录：ModuleCache、CompilationCache、SDKStatCaches、SDKExplicitPrecompiledModules及主树 `.build/index-build`，范围为主树旧构建目录、退役树payload和冻结/实验源码副本的 `.build`；类别沿用11-13清理并补入SDK预编译模块与编辑器索引。Products、dSYM、checkouts、打包App、主树 `.build/out` 与两个在用工作树不动。
- 11-13与11-20各退役记录中的payload inventory描述迁移当时的完整文件；本次移除项以slimming清单为差集，未改写原inventory。重新下载模型、安装依赖属另行授权事项。
- 计量：项目native目录du由37,371,552 KiB降至22,738,812 KiB（约13.95 GiB）；同一时段卷可用空间增加约12.25 GiB，后者含其他进程的变化。

验证：清理前quick与delivery通过。文档改动后quick通过（`output/verification/20261120T013050Z-24415`）。瘦身后完整verify（`output/verification/20261120T015252Z-71672`）：治理111、desktop 379、server 887、scheduler 21、Worker构建、依赖锁、Swift checkout、arm64 Release、资源、固定证据、路由及空白检查通过；swift-tests在600秒上限超时，记为失败。测试产物0.66秒完成构建，卡在L10nTests之后的套件：进程采样显示主线程等待expectation、64个线程阻塞于NSAnimation，当时屏幕已锁定且显示器自10:27关闭；同参数单独重跑停在同一位置。本轮未改源码与主树 `.build/out`，该次不计为通过。用户告知屏幕解锁后复跑完整verify（`output/verification/20261120T054412Z-99373`）退出0：Swift 665项、9条件跳过、0失败，用时约221秒，其余必需步骤通过。Postgres跳过，硬件blocked，签名skipped。

仍待用户决定：

1. 工程交接现行规则要求Intel含Apple Silicon全部改动、其余差异逐条告知用户；3.2.0 Intel未回移刘海轮廓修复，[兼容账本](../compatibility.md)记为“不适用”。该差异已写入发布记录，但规则在发布后（ee30e27）才确立；用户答复暂不处理，留待下次Intel发布前决定。
2. 余下大项为候选zip与安装包、旧构建目录中的Products/dSYM、QA App、windows-local-test各轮材料（R2至R6压缩包摘要互不相同）及冻结源码，属独有材料，未列入瘦身。
3. Apple Silicon与Intel 3.2.0真机安装、截图、应用内升级，Windows实机，Postgres集成仍未验证。
