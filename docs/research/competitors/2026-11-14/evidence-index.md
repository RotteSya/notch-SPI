# 证据索引与 REA 实际调用记录

研究日期：2026-11-14（Asia/Shanghai）。REA 浏览器环境使用 UTC，所以原始事件可能记为 2026-11-13 18:xx；是同一次观察，不是不同日期的版本混用。主报告见 [report.md](report.md)。

## 1. 如何读证据

| 标记 | 含义 | 不能推导的事项 |
|---|---|---|
| 直接观察 | 本轮工具实际取得的界面、DOM、网络元数据、文件内容或公开端点 | 静态字符串不是已执行行为；按钮存在不是功能完成；一题成功不是准确率 |
| 官方描述 | 产品官网、官方文档、官方发行商店中的功能与条款 | 不等于本轮实测，也不自动成为已证明的商业效果 |
| 合理推断 | 从明确证据归纳、但未经完整验证的解释 | 不当成模型供应商、后端架构、因果增长或性能事实 |
| 未知 | 登录、安装、付费、样本或能力边界使本轮没有证据 | 不将未知写成“不支持”“没有”或“失败” |

市场数据单独区分：发行平台公开统计、厂商自报、第三方估计、独立实测。本文没有采用第三方估计收入/份额，也没有独立验证任何厂商的用户总量。Google Play 下载是累计区间，Chrome 商店用户不是付费人数；商店评论不是随机抽样。

## 2. 文件与复核方式

| 文件 | 用途 |
|---|---|
| [REA 原始记录压缩档](evidence/rea-records.json.gz) | 36 条精选原始 Evidence，记录值不改写；包含浏览器 DOM/辅助功能树/网络元数据及静态分析图/摘要。不是完整可导入的会话备份 |
| [浏览器可读摘取](evidence/browser-observations.json) | 由原记录派生的参数、步骤结果、辅助功能文本和选定接口清单；接口清单去除查询值。完整原值仍以压缩档为准 |
| [NotchSPI 基线快照](evidence/notchspi-baseline.md) | 本地源码行号、源码文件 SHA-256、实际 Git HEAD、公开首页文本与两个更新端点响应 |
| [Monica 静态片段](evidence/monica-static.md) | 官方安装包来源及 SHA-256；Info.plist、包依赖、更新配置；定点代码片段及字符偏移 |
| [校验清单](evidence/manifest.json) | 交付文件 SHA-256、包身份、研究边界与检查摘要 |

为避免把容器目录倾倒进正式文档，未保留两个完整 `inventory_artifact` 记录，以及内嵌这些清单的两个 `inspect_artifact` 父记录；保留原始摘要、清单ID、根哈希、关系和覆盖范围。省略项列在压缩档顶层的 `omitted_*` 字段。工具记录中可能有公开站点生成的临时游客ID；没有登录凭据、用户真实输入或项目代码上传。它不是供公开部署的网站资产。

可用现有 Python 标准库读取，无需安装：

```python
import gzip, json
from pathlib import Path
# 在包含 HANDOVER.md 的 Git 根目录运行
base = Path('docs/research/competitors/2026-11-14')
bundle = json.loads(gzip.decompress((base / 'evidence/rea-records.json.gz').read_bytes()))
record = next(r for r in bundle['records'] if r['evidence_id'].startswith('ev_9e03d7e0'))
print(record['operation'])
print(record['parameters'])
print(record['normalized_result']['steps'][-1]['artifacts']['accessibility']['value']['text'])
```

## 3. REA 方法与实际调用范围

先发现当前 `mcp__rea__*` 工具，读取工具说明，并调用 `search_guidance` / `read_guidance_section`。当前指导包标识为 `rea-agents@6.8.0`，指导包摘要 `226f5f4d53cfc8e407d721e0b5ae9f131fd79fe2481e150a787fbc0c85dda274`；它是指导包版本，不据此给整个运行时强行标版本。

实际使用的工具：

| REA 工具 | 本次具体问题与结果 |
|---|---|
| `capture_browser_scenario` | 不登录能否完成首题、回访结果会怎样、价格页实际渲染什么、网页调用哪些可观察接口；产生下列 SX/GA/MO/SL 记录 |
| `open_binary` | 将官方 Monica DMG、之后 ASAR 作为资源打开；不是启动目标 App |
| `inspect_artifact` | 检查 DMG/ASAR 容器内容及根哈希，定位包元数据、preload、主入口与更新配置 |
| `inspect_analysis_view` | 阅读容器与 JS 图的摘要/关系/边界，避免无目的输出全量清单 |
| `analyze_javascript_application` | 对选定 `dist/preload.js` 做不执行代码的 AST 分析，识别 Electron bridge 和 IPC 关系的可见部分 |
| `export_evidence_bundle` | 导出阶段性原始结果；正式归档从这些导出中选择完整记录，不伪造或重写其ID |
| `close_binary` / `reset_investigation` | 导出后释放目标和中间分析状态；容量受限后缩小范围；结束时再次关闭目标 |

浏览器使用已存在的 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`，REA launch 模式创建自身进程/临时上下文。工具报告 Chromium **157.0.8103.79**、`process_ownership=provider-owned`、`cleanup=terminated-owned-process`。默认 viewport 1280×720、locale en-US、timezone UTC、service workers blocked；因此不是日常用户Profile、不是移动端，也不是完整离线/PWA测试。宿主为当前 Mac，但工具自身环境字段 architecture/platform 为 unknown，未把它改写成工具已确认的架构。

网络采集保留请求方法、URL、状态等元数据；`header_values=false`、`request_body=false`、`response_body=false`。所有上传文字都是本研究自编方程，没有私人资料。网页脚本按普通浏览器方式执行；下载的 Monica 客户端从未执行。

### SX-01

**StudyX 首页与文字输入准备** — https://studyx.ai/ ，公开 Web，2026-11-14。

- REA `capture_browser_scenario`：`ev_32fa035a08b1dc54e2c81f57b6127ba8c4ba4810ba3b298ba85240710a1cffe9`。
- 文字交互调整后的观察：`ev_813effdbb3fa497b07d475ff026f959fda02e775605cfdf8bc7381865aca989c`。
- 结果：多种学习工具入口、Text 输入、Nuxt/Vue 标记。属于直接页面观察；框架家族是合理推断，精确版本未知。
- 初次文字切换 `ev_adb4a1c7450722ee48638c7f999341a5e75a3302be70ea677c61798c4adac44c` 未达到预期输入状态；补足页面等待后完成，未将其作为崩溃或错误率证据。

### SX-02

**StudyX 匿名首题** — 起点 https://studyx.ai/ ，结果 https://studyx.ai/ask/4mm2jjj ，公开 Web。

- REA `capture_browser_scenario`：`ev_6b0a5aa42515ca755b010a56082489e8a8d9fbaeacf5013ed61b05d7fd697bad`。
- 步骤：等待页面 → 点击 Text → 填入 `.tiptap.ProseMirror[contenteditable=true]` → 点击 `#panel-homework span:has-text("Get answer")` → 等待并采集。
- 输入：`Practice example: Solve 3(x - 2) = 2x + 5. Explain the steps and check the answer by substitution.`
- 结果：答案 x=11、分步推导与验证、复制/重新生成/反馈、概念与错因解锁入口。辅助功能树遗漏部分公式文本；DOM 中可见公式，未声称视觉排版已截图验证。
- 主要接口：`mvp.studyxapp.com/.../question/getShortIdV3`、`mapp.studyxapp.com/.../ai/newQueryQuestionInfo`、`.../solveProblem`、`.../question/ocrKeyConceptAndSplit`。精确请求方法与路径在原始事件/派生接口表。
- 证据类型：直接观察；未实测图片OCR、模型选择或完整学习工具链。

### SX-03

**StudyX 在新会话回看同一结果** — https://studyx.ai/ask/4mm2jjj 。

- REA `capture_browser_scenario`：`ev_f3df9fd995c19e260d5bf44253ab18b9e16c7075d1df30f4cdb87f67871315ba`。
- 结果：新临时上下文跳转 `/login?redirect=/ask/4mm2jjj`；后续计划点击 Unlock 的动作找不到按钮并超时，剩余动作取消。
- 支持“此新会话需要身份才能继续”的直接观察；不支持“已点击解锁并遇到付款”“原会话刷新丢失”“该结果公开可共享”。没有注册。

### SX-04

**StudyX 价格实际渲染** — https://studyx.ai/plan 。

- REA `capture_browser_scenario`：`ev_a2d8799e3480891243481b8e8987d939c52a968f49d497fa8daaad1705bac4bf`。
- 年付展示：Plus 69.99、Pro 106.99、Max 718.99；月均分别5.83、8.92、59.92，页面符号 `$`。没有测试月付切换或结账。
- 同价 Plus/Pro 的 USD 项目由[官方 App Store](https://apps.apple.com/ai/app/studyx-ai-homework-helper/id1571844479)辅助核实；不以移动端SKU证明所有Web条款一致。

### GA-00

**Gauth 旧站访问受限** — https://www.gauthmath.com/ 。

- REA `capture_browser_scenario`：`ev_619d55e66ef8eb0127dda599f9f7323da541b49b8e7d1125dcef2f98baa3f1cd`。
- 结果：Access Denied。未绕过；官方旧站政策链接跳往 `www.gauth.com/policy`，与官方商店/品牌关联后改用新站。该限制不能推断为产品停服。

### GA-01

**Gauth 新站首页** — https://www.gauth.com/ 。

- REA `capture_browser_scenario`：`ev_bc738b2563d19b7f8c96a4864cb5700eed5f3ac8207f3d4dd8e1faa942c6c67b`。
- 直接观察文字、文件、Fast模式、语音、History、Upgrade、课程和Atlas入口；未调用所有入口。

### GA-02

**Gauth 匿名首题** — 起点 https://www.gauth.com/ ，结果 https://www.gauth.com/chat/7707722497071863558 。

- REA `capture_browser_scenario`：`ev_9e03d7e040eb70d97e1c15469214241cea88bf04701fb6fc3f4118a25d6e23b8`。
- 步骤：wait 2500ms → fill role=textbox/name=Message → click role=button/name=Send Message → wait 10000ms → DOM/辅助功能树/URL与事件采集。
- 输入：`Practice example: Solve 3(x - 2) = 2x + 5. Explain the steps and check by substitution.`
- 直接观察：x=11，3x−6=2x+5 → x−6=5 → x=11，核验27=27；复制与评价、两个具体追问入口。独立算术检查一致，不是通用准确率测试。
- 主要请求：`POST https://api-sg.gauth.com/chat/send_message`、`POST https://api-sg.gauth.com/ehi/chat/ai_tutor_thread/get`。原记录还有权益/配置请求。接口名称不证明后端内部拓扑。

### GA-03

**Gauth Web Plus** — https://www.gauth.com/plus 。

- REA `capture_browser_scenario`：`ev_04110fbf1cd2b17053e74acd65ad28ef4e80936522e17b635c0fd2b139b79c22`。
- 直接观察：免费0 JPY/月、三天体验及功能差异；付费金额未成功展示。没有把0JPY作为Plus价格。
- 报告中的付费数字来自[美国App Store](https://apps.apple.com/us/app/gauth-ai-study-companion/id1542571008)，不是这次REA观察出的日本Web金额。

### MO-01

**Monica 官方桌面发行入口** — https://monica.im/desktop 。

- REA `capture_browser_scenario`：`ev_959c44ef0ea88aed15def33c82aef916abbd1a8f53e4a919e8fb86250aed1395`。
- 直接观察：Apple Silicon、Intel DMG与Windows exe下载链接；选择官方arm64 DMG进行静态分析。

### MO-02

**Monica 年付方案** — https://monica.im/pricing 。

- REA `capture_browser_scenario`：`ev_db9e15ab7bbdd2c38cd537211f5de40b8087731c89e8bfcd05cdc8beda1fa113`。
- 直接观察：Free40基础访问/日；Pro US$99/年；Max促销US$199/年，原年价299；Ultra US$995/年。没有结账，也没有验证月付或税。
- 额度字段与查询次数分开；没有把UI的模型名当成真实推理路径。

### MO-03

**Monica Web 首题身份门槛** — https://monica.im/home 。

- 首页记录：`ev_d646c55308867b19f13ff0c8b17714784c7279a15a676317f434c3958f4cf313`。
- 提交记录：REA `capture_browser_scenario`，`ev_fdf3079cb782f5ae646a588bfae0926fd5ef9bcc9691ac46d4ee6ddbdf9c9963`。
- 步骤：填入同一自编方程的简短提示，Enter，等待；弹出Google/Email/Apple注册入口，输入仍在页面，没有取得答案。没有实际登录、授权第三方或创建账号。
- 元数据可见 `api.monica.im/api/usagev2/get_quotas`、`/api/vip/get_subscription_plans_v2`、`/api/app_config/get_app_configs` 等；不能据此复原真实聊天正文。

### MO-04

**Monica DMG 容器** — 官方URL https://download.monica.im/Monica-2.9.5-arm64.dmg ，macOS arm64 2.9.5。

- 临时下载路径：`/tmp/notchspi-competitors-2026-11-14/Monica-2.9.5-arm64.dmg`（完成后清理；可凭URL重新取得并比对摘要）。
- SHA-256：`b0a1c2b861a65871cfe29231726c0392fc22b9ffe11d842c24089666e6e8c50e`。
- REA `open_binary` 后 `inspect_artifact` 父ID：`ev_19170266760b21c5e2500466de4ee1bb64e4cf9009bd36a34cf1c43568b90fc5`；完整清单ID：`ev_1ad95e6e63108a36185ab6ece808bc8d66616515d3d000b778694c1e8c5a0365`（两条大记录未放入最终精选档）。
- **保留的原始摘要**：`inspect_analysis_view`，`ev_8730ebbf634bd76df71b0cfc2cc0385bc749c46505972cb2297d378e10b2c295`；根哈希与手工SHA一致，容器条目覆盖完整，但这不是完整语义分析。

### MO-05

**Monica ASAR 容器与元数据** — 包内 `Monica.app/Contents/Resources/app.asar`。

- SHA-256：`cccb2d4542d77e36f8699febb99567450e18d25d2a89b603f938310f1f655c4f`。
- REA `inspect_artifact` 父ID：`ev_f51945bb37e91a6b97be6d3ef4104d37a7ce6d898a043c5a850a99537b3d699c`；清单ID：`ev_e78e5d47bbab93c58cc757297e4df781576bc21d63a8641b0f761fb267a76aeb`（未保留全量大记录）。
- **保留的摘要**：`inspect_analysis_view`，`ev_5a33196439326145581751a9c68e71f4371bf25f990c47e0eef33035b052aad4`。
- 只读挂载后使用已有Python标准库读取ASAR头部和选定文件；没有安装ASAR工具。Info.plist、依赖和更新配置见[静态片段](evidence/monica-static.md)。这些读取是辅助静态交叉验证，不冒称全由REA解析出的实现。

### MO-06

**Monica preload 惰性语义分析** — 选取包内 `dist/preload.js`。

- REA `analyze_javascript_application` 参数：`input_path=/tmp/notchspi-competitors-2026-11-14/monica-selected`，`format=directory`，`source_paths=[dist/preload.js]`。这是从官方包派生的选定目录，根哈希不能当原DMG哈希。
- 原始图ID：`ev_2bb4f4f581551670c6116fda1af2ecdfd93a07e52591049ac1efaf8021ed60ac`。
- 摘要ID：`ev_8bc1d32e81d3408558322bd8ee6153fd8ec028562f0f0d0d4fca6a87f78fe5ea`。
- 解析1个1483字节文件，418个AST节点；识别1个contextBridge API、7成员、5项IPC操作、4项动态频道操作、3项归属未消歧的发送。所选范围没有完整主进程处理器配对；2项应用未知、249项语义未知必须保留。
- 直接静态观察：`_bridge` 的IPC包装、频道允许列表、`onSetAccessibility`，以及host/WebSocket环境变量。未知项不是漏洞、也不是未实现功能。
- background.js的录屏检查/快捷键只用定点文字片段交叉核对，没有调用目标JS，未宣称其路径已运行。

### SL-01

**StudyLens 细分补充** — https://studylens.jp/ ，公开Web，2026-11-14，固定Web版本未知。

- REA `capture_browser_scenario`：`ev_fc5564037481105e9f020a8f50228f3421dcd3dd6133ee8c0012e88678c1cb98`。
- 直接观察日语入口、注册入口和方案。Google继续按钮当时呈禁用状态，不推断其长期不可用。
- 截图线程、手机只读、额度与账期来自[官网](https://studylens.jp/)及[FAQ](https://studylens.jp/faq)，不是已安装扩展测试。

## 4. 失败、覆盖限制和保守处理

1. 初期浏览器场景参数有工具契约校验错误，涉及捕获字段或locator字段；读取当前说明与契约后修正。它们发生于执行前，不记作产品失败，也不反复执行相同无效参数。
2. 在已有大体积DMG/ASAR清单保留的情况下，完整ASAR语义请求触及REA证据容量上限：保留量约812,421,390字节、申请约276,741,584字节、上限约1,089,162,846字节。没有调整上限；先导出、关闭/清理会话，再分析选定preload，成功取得MO-06。完整主进程语义仍未知。
3. Gauth旧域名访问限制、新域名正常；StudyX回看身份门槛；Monica注册门槛，均按上文记录。没有账号、购买或权限绕过。
4. 所有页面使用工具临时上下文；不验证真实用户已有cookie、扩展、系统权限和历史数据。固定等待时长不能当产品响应时延。
5. 本次没有主动注入网络错误或耗尽额度，未观察到恢复不意味着产品不支持恢复。未下载移动端或Windows包，不能把macOS静态证据推广到这些平台。

## 5. 市场与价格的关键原文入口

以下链接均在2026-11-14打开。网页搜索服务可能返回缓存版本；因此动态价格另以REA实际渲染交叉核实，商店统计仍可能有地区/缓存差异。

| 主题 | 原文及核实内容 | 类型/限制 |
|---|---|---|
| StudyX规模与评论 | [Google Play](https://play.google.com/store/apps/details?id=com.brilian.studyx.student)：5M+、95K；[官网](https://studyx.ai/)自报16M | 平台统计/厂商自报分开；不相加 |
| StudyX平台、语言、USD SKU | [官方App Store](https://apps.apple.com/ai/app/studyx-ai-homework-helper/id1571844479)；[Chrome/Edge说明](https://studyx.ai/browser-extension) | 商店地区不同导致SKU不同；不是Web结账验证 |
| Gauth规模与近期维护 | [Google Play](https://play.google.com/store/apps/details?id=com.education.android.h.intelligence)：100M+、2.26M、2026-11-10更新 | 下载累计区间、评价数；非活跃/付费 |
| Gauth美国价格和语言 | [美国App Store](https://apps.apple.com/us/app/gauth-ai-study-companion/id1542571008) | USD11.99/月、31.99/季、99.99/年；不推广到日本Web |
| Monica规模与版本 | [Chrome商店](https://chromewebstore.google.com/detail/monica-all-in-one-ai-assi/ofpnmcalabcbjgholdjcjblkibolbppb?hl=us) | 3M用户、32.4K评分、扩展9.0.24；与桌面2.9.5分开 |
| Monica平台/历史 | [官方设备指南](https://www.monica.im/help/Get-Monica-across-all-your-devices)；[数据迁移公告](https://www.monica.im/help/Data_Backup_and_Restoration_Information/am_i_affected) | 功能描述与2026年8月特定地区安排；不推断今日全体停服 |
| Question.AI | [Google Play](https://play.google.com/store/apps/details?id=com.qianfan.aihomework) | 10M+下载、231K评价 |
| Photomath | [Google Play](https://play.google.com/store/apps/details?id=com.microblink.photomath) | 100M+下载、约3.1M评价；数学范围 |
| Sider | [Chrome商店](https://chromewebstore.google.com/detail/sider-chat-with-all-ai-gp/difoiogjjojoaoomphldepapgpbgkhkb?hl=enm) | 5M用户、114.7K评分、5.35.6；该规模指标高于Monica |
| QANDA / 作业帮 | [QANDA](https://qanda.ai/en) / [作业帮](https://www.zybang.com/) | 当前产品存在与范围；本轮不引用未经核实当前规模 |
| ChatGPT替代 | [官方Study Mode](https://openai.com/index/chatgpt-study-mode/) | 官方学习流程描述；未使用私人ChatGPT账户测试 |
| Cluely / Scrny | [Cluely](https://cluely.com/) / [Scrny](https://scrny.ai/) | 当前定位与官网流程；规模、速度和准确率宣传未认证 |
| StudyLens | [官网](https://studylens.jp/) / [FAQ](https://studylens.jp/faq) | 日本细分需求、USD月费和credits；未证明市场领先 |

本研究没有以广告式测评站、融资金额、社交讨论量或搜索排名推导领先地位；收入、转化、留存和真实用户构成保持未知。报告关于“为什么获得用户”的论述是**可观察机制 + 少量评论支持的产品假设**，不是统计因果结论。

## 6. 交付检查状态

使用隔离的临时 Git index 纳入本次研究文件，未更改用户原 index，也未提交。`repo-health --delivery` 的最终剩余项是4份新增 Markdown 缺少 guide-map 分类；未修改 `docs/guide-map.json` 或放宽检查。文件存在性、正文证据ID、包哈希与归档读取另外核验。研究已完成，仓库全局治理检查未通过，不能把这两件事混写为全部检查通过。
