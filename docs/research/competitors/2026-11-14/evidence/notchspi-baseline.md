# NotchSPI 基线证据

观察日期：2026-11-14（Asia/Shanghai）。源码 HEAD：`fe4e68c9a9bd5af3d82e3f42df48cd6003f821d6`。

仅代码和公开端点核实，不代表本轮已运行客户端验收。摘录中的 Markdown 链接地址已调整为本快照可访问路径；行号与文件 SHA-256 仍对应原始源码，仅另去除展示用行尾空白，其余文字不变。

## 公开更新端点

```json
[
  {
    "url": "https://notchspi-api.vercel.app/update",
    "status": 200,
    "body": "{\"version\":\"3.1.5\",\"tag\":\"v3.1.5\",\"notes\":\"这次更新，让第一次使用更顺手。\\n\\n- 新手引导加入单图和多图截图练习，不消耗查题次数。\\n- 修复允许屏幕录制后，引导没有继续的问题。\\n- 修复部分情况下查题意外中断的问题。\\n- 优化界面动画和中、日、英文显示细节。\\n\\n如果你使用的是 Intel Mac 上的 3.0 版，请前往官网手动安装一次新版，之后就可以在应用内更新。\\n\"}"
  },
  {
    "url": "https://notchspi-api.vercel.app/update/intel",
    "status": 200,
    "body": "{\"version\":\"3.1.5\",\"tag\":\"v3.1.5\",\"notes\":\"这次更新，让第一次使用更顺手。\\n\\n- 新手引导加入单图和多图截图练习，不消耗查题次数。\\n- 修复允许屏幕录制后，引导没有继续的问题。\\n- 修复部分情况下查题意外中断的问题。\\n- 优化界面动画和中、日、英文显示细节。\\n\\n如果你使用的是 Intel Mac 上的 3.0 版，请前往官网手动安装一次新版，之后就可以在应用内更新。\\n\"}"
  }
]
```

## 公开首页摘录

来源：https://notchspi-api.vercel.app/ 。HTTP 200；以下为抓取文本的行号，未登录。

```text
130: まず体験。使う量で選ぶ。
131: おためし
132: NotchSPI が自分に合うか、試してみる。
133: ¥0
134: 72 時間の無料体験
135: 毎日 400 回
136: カード登録不要
137: ダウンロードして体験
138: 毎日使う方へ
139: Plus
140: 毎日の学習に使いたい方へ。
141: CNY
142: 69
143: / 月
144: 毎月自動更新
145: 毎日 400 回
146: 北京時間 00:00 リセット・繰り越しなし
147: 自動更新はいつでも停止可能
148: 購読の手順を見る →
149: 問題パック
150: 必要な時に、必要な分だけ。
151: 問題パックを選択
152: JPY
153: 300
154: / 100 問
155: JPY
156: 800
157: / 300 問
158: JPY
159: 2200
160: / 1,000 問
161: 一回払い
162: 購入の手順を見る →
163: 料金・利用条件
164: 同じ公式サービスを、使う頻度に合わせて。体験・月額・問題パックはそれぞれ別の利用枠です。
165: 現在のサービス設定に基づく税込価格です。通貨は各価格に記載。最終金額は決済画面でご確認ください。
166: 一つの依頼で利用可能な回答を受け取ると 1 問分を消費。回答なしの失敗は消費しません。利用可能は正解保証ではありません。別の再実行は新しい依頼です。決済は Stripe が処理します。
167: NotchSPI Plus: 毎月自動更新 · 毎日400回の解答。解説・失敗は追加消費なし。北京時間00:00リセット、繰り越しなし。 いつでも自動更新を停止でき、支払済み期間は利用可能。問題パックも単独で購入できます。
168: 開始時から計時。北京時間の毎日 00:00 にリセット、繰り越しなし
169: 新規デバイスは好きな時に72時間・毎日400回の無料体験を開始できます。ガイドでスキップ後も設定のアカウント画面から受け取れます。初回無料残高の未使用分と置き換わり、購入済み残高は保持。無料体験、Plus、購入パックの順に各枠を使います。
170: 100 問 · ¥300 JPY · 一回払い · 一問あたり約 ￥3.00
171: 300 問 · ¥800 JPY · 一回払い · 一問あたり約 ￥2.67
172: 1,000 問 · ¥2200 JPY · 一回払い · 一問あたり約 ￥2.20
```

```text
179: 新しいアプリでは全パックを選択でき、初期選択は 300 問です。選べない旧版は更新するかサポートへ。
180: はじめる前の、気になること。
181: よくある質問をまとめました。
182: はじめの一歩に。
183: 画面共有に回答も映りますか？
184: 正式版にはウィンドウをキャプチャから除外する仕組みがあります。共有・録画の結果は OS とソフトによって異なり、すべての環境での動作は保証していません。ご利用環境で先に確認してください。
185: キャプチャ保護と検知回避は同じですか？
186: いいえ。対応する共有・撮影・録画経路に対するウィンドウ除外です。すべての OS・ソフト・検知方法で非表示になる保証はありません。
187: 動作環境は？
188: 通常版：Apple Silicon Mac、macOS 14 以降。Intel Mac 互換版：macOS 12.3 以降。Intel 3.0 からは 3.1.5 を一度手動でインストールし、その後はアプリ内更新に対応します。ノッチのない画面では上部パネルを使います。初回に画面収録の許可が必要です。Windows 版は Coming soon、正式公開前です。
```

```text
229: サーバーに問題画像は保存しません。切断から自動復旧するため、回答を15分間暗号化してキャッシュします。期限後は取得できず、定期処理で削除します。一時材料は最大15分。成功した質問の画像・回答は「最近の問題」に別途保存します。読み書き時に過去30日・最大100件 / 200 MBへ整理します。画面から削除できます。書き出したファイルは自分で削除してください。
230: 機種変更したら残高は？
231: 旧 Mac の設定 →「アカウントとプラン」で復元コードを保存し、新しい Mac で元のアカウントを復元できます。残高の統合は行いません。復元コードは大切に保管してください。
232: 返金はできますか？
233: 下記の返金ポリシーをご覧ください。誤答の報告は確認が必要で、題数の補償と返金は別に処理します。
234: 3.0 への更新方法は？
235: 2.17 からは Mac 版をダウンロードし、一度手動でインストールしてください。3.0 以降はアプリ内でダウンロード、検証、インストール、再起動ができます。
236: 一枚に収まらなくても。
237: 問題文と選択肢が離れていたら、⌘⇧2 で 2〜4 枚を順番に撮影。2 枚目以降は最後の撮影から 4 秒後に自動送信。1 枚だけなら待機します。プレビュー中は送信停止。画像の削除や手動送信もできます。
238: 必要なときだけ、そこに。
239: ⌘⇧Space でパネルを表示・非表示に。「最近の問題」で保存済みの問題と回答を振り返れます。キーは変更でき、ノッチのない Mac では画面上部のパネルを使えます。
```

```text
243: Intel 版をダウンロード
244: Intel プロセッサ · macOS 12.3 以降 · 3.1.5 build 43 · 3.0 から一度手動でインストール後、アプリ内更新に対応
```

## `README.md:1`

文件 SHA-256：`766ddac25507a2e550c8030c5df60edb56946f9fa4b704d3e490bae79c777800`

```text
1: # NotchSPI
2:
3: NotchSPI 是桌面学习助手。热键截取屏幕上的题目，顶部面板流式展示讲解，支持简体中文、日本語和 English。
4:
5: Mac 原生主开发树使用 AppKit，面向 Apple Silicon / macOS 14+；历史 Intel/Catalina 发行归档和现有下载入口保留，Windows Electron 开发版本有独立验收边界。当前状态、唯一启动步骤、源码来源和验证方法见 [HANDOVER.md](../../../../../HANDOVER.md)。
6:
7: NotchSPI 自己的窗口不参与应用内软件截图。账户、题包、Plus 与旧版本升级遵循仓库的兼容约定。
```

## `VERSION.env:1`

文件 SHA-256：`5c304d4f03044f227cd5527e09f653ce6a450d14d907b1f3ae58b5e4f5fa89f9`

```text
1: APP_VERSION=3.1.5
2: BUILD_NUMBER=42
```

## `shared/product.json:1`

文件 SHA-256：`d84c2ef502060da961afe68944edb860b0a26ff4ebe1f47a0e71fc8df4f89a17`

```text
1: {
2:   "schemaVersion": 1,
3:   "capture": {
4:     "limit": 4,
5:     "submitDelay": 4,
6:     "undoSeconds": 8,
7:     "retentionSeconds": 900,
8:     "bodyLimit": 4194304
9:   },
10:   "personalitySession": {
11:     "maxAgeSeconds": 900,
12:     "maxRecords": 5,
13:     "maxContextBytes": 8192
14:   },
15:   "reasoningEfforts": ["low", "high", "max"],
16:   "autoCaps": [5, 10, 20, 30, 50, 100, -1],
17:   "defaultAutoCap": 20,
18:   "motion": {
19:     "duration": 0.32,
20:     "springDecay": 6,
21:     "springFrequency": 5.2,
22:     "closeDecay": 1.5,
```

## `Sources/NotchSPI/History/RecentQuestions.swift:21`

文件 SHA-256：`2891c22114c8984a0d488d8490c59080c7cf5d4327c5438e573b826c31e3e75b`

```text
21: final class RecentQuestionStore: @unchecked Sendable {
22:     static let changed = Notification.Name("RecentQuestionStore.changed")
23:     static let shared = RecentQuestionStore(directory: defaultDirectory)
24:     static var defaultDirectory: URL {
25:         if ProcessInfo.processInfo.environment["NSPI_QA_EPHEMERAL"] == "1" {
26:             return FileManager.default.temporaryDirectory.appendingPathComponent("notchspi-history-qa-\(ProcessInfo.processInfo.processIdentifier)")
27:         }
28:         return FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
29:             .appendingPathComponent("NotchSPI/RecentQuestions", isDirectory: true)
30:     }
31:     let directory: URL
32:     private let queue = DispatchQueue(label: "NotchSPI.recentQuestions", qos: .utility)
33:     private let limit: Int
34:     private let lifetime: TimeInterval
35:     private let byteLimit: Int
36:     private let now: () -> Date
37:     private var records: [RecentQuestion] = []
38:     private var loaded = false
39:     private var failure = false
40:
41:     init(directory: URL, limit: Int = 100, lifetime: TimeInterval = 30 * 86400,
42:          byteLimit: Int = 200 * 1024 * 1024, now: @escaping () -> Date = Date.init) {
43:         self.directory = directory; self.limit = limit; self.lifetime = lifetime
```

## `Sources/NotchSPI/History/RecentQuestions.swift:60`

文件 SHA-256：`2891c22114c8984a0d488d8490c59080c7cf5d4327c5438e573b826c31e3e75b`

```text
60:
61:     func flush() async {
62:         await withCheckedContinuation { continuation in queue.async { continuation.resume() } }
63:     }
64:
65:     func save(snapshot: QuestionCaptureSnapshot, answer: String, needsReview: Bool) {
66:         // A partial stream, retake or failed request must never arrive here.
67:         guard !answer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
68:               !snapshot.assets.isEmpty, snapshot.assets.count <= 4 else { return }
69:         queue.async {
```

## `Sources/NotchSPI/Capture/CaptureRecovery.swift:1`

文件 SHA-256：`ddfcb075f5ca2dfb22bf9411ebdb25fd31241963df1d17b3decaba1416d43f88`

```text
1: import Foundation
2:
3: /// Give a stalled ScreenCaptureKit service a quiet interval before probing it again.
4: /// The alternate backend captures a fresh image for every request; it never reuses a shot.
5: @MainActor
6: final class CaptureRecovery {
7:     private let now: () -> TimeInterval
8:     private var fallbackUntil: TimeInterval = 0
9:     var usesFallback: Bool { now() < fallbackUntil }
10:
11:     init(now: @escaping () -> TimeInterval = { ProcessInfo.processInfo.systemUptime }) {
12:         self.now = now
13:     }
14:
15:     func run<Value>(
16:         primary: () async -> Result<Value, CaptureError>,
17:         fallback: () async -> Result<Value, CaptureError>
18:     ) async -> Result<Value, CaptureError> {
19:         guard !Task.isCancelled else { return .failure(.captureFailed) }
20:         if usesFallback { return await fallback() }
21:         let result = await primary()
22:         guard !Task.isCancelled else { return .failure(.captureFailed) }
23:         guard case .failure(.captureTimedOut) = result else { return result }
24:         fallbackUntil = now() + 60
25:         return await fallback()
26:     }
27: }
```

## `Sources/NotchSPI/Settings/Settings.swift:254`

文件 SHA-256：`be6570fbe579d7b3e15cb36fa614bf9305154b21a2cc48c8da27c45f58afb266`

```text
254:     private static let defaultCapture = HotkeyCombo(keyCode: UInt32(kVK_ANSI_1), modifiers: UInt32(cmdKey | shiftKey), label: "1")
255:     // ⌘⇧2 was the personality combo until the 上下文追问 remap; personality moved to ⌘⇧3.
256:     // Users who explicitly recorded a combo keep their stored value (see `combo(_:_:)`).
257:     private static let defaultContext = HotkeyCombo(keyCode: UInt32(kVK_ANSI_2), modifiers: UInt32(cmdKey | shiftKey), label: "2")
258:     // ⌘⇧9, NOT ⌘⇧3: the 3–6 row is owned by the system screenshot shortcuts, which swallow
259:     // the event after RegisterEventHotKey "succeeds" (same invisible-by-design dead combo as
260:     // documented for auto mode below).
261:     private static let defaultPersonality = HotkeyCombo(keyCode: UInt32(kVK_ANSI_9), modifiers: UInt32(cmdKey | shiftKey), label: "9")
262:     private static let defaultToggle = HotkeyCombo(keyCode: UInt32(kVK_Space), modifiers: UInt32(cmdKey | shiftKey), label: "Space")
263:     // ⌘⇧0: the 3–6 row is owned by the system screenshot shortcuts, which swallow the
264:     // event after RegisterEventHotKey "succeeds" — an invisible-by-design dead combo.
265:     private static let defaultAutoMode = HotkeyCombo(keyCode: UInt32(kVK_ANSI_0), modifiers: UInt32(cmdKey | shiftKey), label: "0")
266:
267:     func migrateScreenshotHotkeys() {
268:         guard !d.bool(forKey: "screenshotHotkeysV1") else { return }
269:         let defaults = [("capture", Self.defaultCapture), ("context", Self.defaultContext),
270:                         ("personality", Self.defaultPersonality)]
271:         let reserved = defaults.map { $0.1 }
272:         for (role, fallback) in defaults + [("toggle", Self.defaultToggle), ("autoMode", Self.defaultAutoMode)] {
273:             let saved = combo(role, fallback)
274:             if reserved.contains(where: { $0.keyCode == saved.keyCode && $0.modifiers == saved.modifiers }),
275:                saved.keyCode != fallback.keyCode || saved.modifiers != fallback.modifiers {
276:                 setCombo(role, fallback)
277:             }
278:         }
```

## `server/src/objective-result.ts:1`

文件 SHA-256：`565ee243f5b7dbcf36fbbdee1520a62c6b69d8d46de9452d9fc30d075db284d9`

```text
1: export const OBJECTIVE_RESULT_MARKER = 'NSPI_RESULT_V1:';
2:
3: export type ObjectiveQuestionKind =
4:   | 'single_choice' | 'multiple_choice' | 'ordering' | 'short_fill' | 'other';
5: export type ObjectiveResultState = 'ready' | 'review' | 'retake';
6: export type ObjectiveResultReason =
7:   | 'none' | 'ambiguous_question' | 'ambiguous_options' | 'cropped' | 'unreadable'
8:   | 'missing_context' | 'unsupported';
9: export type ObjectiveParserPath = 'v1' | 'legacy_fallback' | 'legacy' | 'none';
10: export type ObjectiveProtocolViolation =
11:   | 'duplicateMarker' | 'markerNotLast' | 'invalidJSON' | 'oversizedJSON' | 'unknownField'
12:   | 'invalidEnum' | 'invalidStateCombination' | 'finalMismatch' | 'missingUsableResult';
13:
14: export interface ObjectiveResultV1 {
15:   v: 1;
16:   kind: ObjectiveQuestionKind;
17:   state: ObjectiveResultState;
18:   answer: string | null;
```

## `docs/client-behavior.md:9`

文件 SHA-256：`a5ab6e36a9cd3b7f9cb0f789bb517734feb5f54314f90506d96c58188f9eec9b`

```text
9: 题组过期保留已完成正文及解释，清理截图、补取和解释资格；旧回调不能覆盖下一题。最近查题拥有独立图片副本，不能提前删除在途所有者的材料。
10: 验证：ScreenshotRoundTests、ScreenshotIntakeTests、CaptureFlowStabilityTests、CaptureFileLifecycleTests。
11:
12: ## 引导
13:
14: NotchController 和 NotchOnboardingProgress 管理欢迎、单图/多图练习、体验领取及完成/收起检查点。语言为简中、日语、英语；用户输入不翻译。试题是明确 fixture，不能当成真实识题效果。
15: 体验显式领取，领取成功才开始计时；跳过不消耗资格，之后可从账户页领取。额度、时区和过期规则由服务端及 SharedFreeTrial 定义，不在客户端自行授予。
16: 菜单可重放引导；onboardingDone/onboarding.v3.dismissed 保持兼容。系统减少动态效果继续有效，DEBUG 可用显式 QA fixture。
```

## `docs/client-behavior.md:26`

文件 SHA-256：`a5ab6e36a9cd3b7f9cb0f789bb517734feb5f54314f90506d96c58188f9eec9b`

```text
26: ## 最近查题与题库
27:
28: 只有合格成功结果进入本机历史；回顾不提交新请求、不扣题。RecentQuestionStore 在串行队列提交独立图片与元数据，并执行容量/条数/时间保留。队列持有原材料直到复制完成。
29: 本地题库入口、导入、检索及本地答案流程已经移除；旧 Application Support 文件保持原样，当前应用不读取或清理。
30: 验证：RecentQuestionTests、ContinuousReadingTests、CaptureFileLifecycleTests。
31:
32: ## 三通道与账户
33:
34: 新安装默认官方服务；自定义 API 和本机 CLI 仍是产品能力。隔离开发 bundle 固定 loopback mock 与临时凭证；真实本地启动保持用户已保存的通道和账户。
35: 官方账户快照、401、取消、恢复与并发覆盖见 OfficialAccountStateTests、OfficialCaptureRunTests 和 OfficialStreamTransportTests。CLI 继续受账户 cli_enabled 约束。
```

## `docs/compatibility.md:52`

文件 SHA-256：`f4b3dc0372e8393f5389bd0ff5df1657e2d2eb99999763595531f341a19b8620`

```text
```

## `docs/windows/closure-plan.md:1`

文件 SHA-256：`21671ce5cb76456c93f38d52cd84ab9cab57b2b355ad4bbac59245d162f19552`

```text
1: # Win/Mac 开发闭环验收
2:
3: 工程入口见 [HANDOVER](../../../../../HANDOVER.md)。此表定义完成条件；日期报告与原始结果从[历史索引](../../../../history/index.json)查询，不能代替当前提交验收。
4:
5: | 要求 | 必需证据 | 未完成边界 |
6: | --- | --- | --- |
7: | 规则同源 | 共享源变更实际抵达双端；共用 fixtures 与生成一致性 | 平台窗口、字节适配和界面仍分别验证 |
8: | 自动验证 | 当前源码身份、全部必需检查及实际 CI 结果 | 工作流存在不等于远端已经运行 |
9: | Windows 实机 | 候选摘要、系统版本、DPI、屏幕布局与逐项操作结果 | 当前没有本轮 Windows 硬件证据 |
10: | 视觉/性能 | 相同素材的双端截图/录像、帧时间和允许差异 | Mac Electron 与单元测试不能替代 DWM/GPU 结果 |
11: | 候选可追溯 | 包内源码身份、包摘要、验证及实机结果一致 | 不能给旧包更换源码提交标签 |
12: | 安装/升级 | 已签名候选、数据保留、错误签名拒绝、回退 | 真实 Windows 安装/更新仍待独立验收 |
13:
14: 按共享回归 → 当前源码自动验证 → 配对候选 → Windows 实机/视觉 → 签名安装升级的顺序补齐证据。按照[实机清单](../../../../windows/manual-acceptance.md)记录 passed/failed/skipped/blocked，不缩小完成定义；无外部条件时明确记录缺口。
```
