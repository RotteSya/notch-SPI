import {PLUS} from './plus.ts';
import type { QuestionPack } from './pricing.ts';
import { designCopy, siteCSS } from './site-design.ts';
import { demoScript } from './site-demo.ts';
import { ghostAvatar, productScreenshot } from './site-assets.ts';
import { formatMoney, escapeHtml, type PageLang } from './payments.ts';

// The public product site, served at GET / — the "company website" for app users, curious
// visitors, and payment-provider review (Stripe activation requires a real product page with
// pricing, contact, and — for Japan — the 特定商取引法に基づく表記 disclosure, all included
// below). One self-contained page: inline CSS, inline SVG logo, zero external assets.
// Pricing renders from the LIVE pack catalog so the site can never drift from checkout.

// Every download button targets our own /dl endpoint, which tallies the click and then streams
// the DMG back from this origin (see routes.ts; the upstream location lives in config, not here).
// No link on this page may point off-site to where the app is built or hosted.
const DOWNLOAD = '/dl';
const INTEL_DOWNLOAD = '/dl/intel';
const CONTACT_EMAIL = 'raysyadesu@gmail.com';

export interface SiteInput {
  packs: readonly QuestionPack[];
  trialQuestions: number;
  currency: string;
  lang: PageLang;
  aiProvider: string;
  entry?: 'spi' | 'reading_practice';
  entryStatus?: 'beta' | 'disabled';
}

/** ?lang wins; otherwise sniff Accept-Language; default Japanese (the selling entity is JP). */
export function resolveSiteLang(query: string, acceptLanguage: string): PageLang {
  const q = query.toLowerCase();
  if (q.startsWith('ja')) return 'ja';
  if (q.startsWith('zh')) return 'zh';
  if (q.startsWith('en')) return 'en';
  const a = acceptLanguage.toLowerCase();
  for (const part of a.split(',')) {
    const tag = part.trim();
    if (tag.startsWith('ja')) return 'ja';
    if (tag.startsWith('zh')) return 'zh';
    if (tag.startsWith('en')) return 'en';
  }
  return 'ja';
}

// Existing support, privacy and refund policies are preserved verbatim.
const S = {
  "zh": {
    "navDownload": "下载",
    "freeCard": {
      "name": "免费体验"
    },
    "priceNote": "一次请求交付可用答案扣 1 题；没有可用答案的失败不扣。可用不等于保证答对，重新执行是新请求。支付由 Stripe 处理。",
    "faqs": [
      {"q": "如何升级到 3.0？", "a": "从 2.17 升级请下载 Mac 版并手动安装一次。3.0 起支持应用内下载、校验、安装和重启。"},
      {
        "q": "截图会被保存吗？",
        "a": "默认服务端不保存图片和答案正文。临时题组材料最多保留 15 分钟；成功查题的题图与答案会另存到本机「最近查题」。应用读取或保存记录时按最近 30 天、最多 100 条 / 200 MB 清理，可在最近查题中删除。主动导出的反馈文件需自行删除。"
      },
      {
        "q": "答题失败会扣题吗？",
        "a": "没有可用答案的失败不扣题。断线后请先核对本次结算状态；再次执行可能产生新请求。"
      },
      {
        "q": "换电脑后余额怎么办？",
        "a": "在旧 Mac 的设置 →「账户与订阅」保存恢复码，再在新 Mac 恢复原账户。恢复不会合并两个账户的余额；恢复码是账户凭证，请妥善保管。"
      },
      {
        "q": "可以退款吗？",
        "a": "题包退款规则见下方政策。答错反馈需核验，额度补偿与现金退款分别处理。"
      },
      {
        "q": "系统要求？",
        "a": "正式版：Apple Silicon Mac，macOS 14 及以上。Intel 老 Mac 兼容版：macOS 12.3 及以上，需手动更新。无刘海屏幕使用顶部面板；首次使用需授予屏幕录制权限。Windows 版 Coming soon，尚未正式发布。"
      }
    ],
    "legalTitle": "特定商取引法に基づく表記（日本法定披露）",
    "privacyTitle": "隐私与数据使用",
    "privacyBody": [
      "服务记录包含随机设备凭证、额度、请求结算、模型用量与成本及付款核对信息。正常注册无需姓名和邮箱。",
      "官方服务将截图和必要指令交给 AI 服务方（{{AI_PROVIDER}}）处理，实际模型按服务配置选择。图片、题目和答案正文不写入默认数据库或日志。自带 Key 时由你选择的服务处理。",
      "支付由 Stripe 处理，我方不接收卡片信息。支持邮件及你主动提交的材料按相应用途单独处理。",
      "自愿的可靠性数据可在设置关闭。关闭即删除待发送队列并停止行为上传，必要的计费记录仍保留。详细事件保留 90 天，本机待发送队列最多 7 天。",
      "来源选择可在首次引导跳过。你选择的来源与本机注册关联，不根据题目场景或界面语言推断来源。",
      "问题反馈先预览并导出到本机，由你自行提交。默认仅排查本次问题；质量评测用途需另选，授权最长 90 天，外部模型处理需另行同意。收取的材料在到期或撤回时删除，本机原件由你删除。咨询、撤回或删除请联系下方邮箱，并附导出文件中的反馈编号。"
    ],
    "refundTitle": "退款与取消政策",
    "refundBody": [
      "题数充值属数字商品，到账后原则上不支持因个人原因的退款。",
      "如遇重复扣款、支付后未到账等我方原因的问题，将全额退款；请在 7 天内邮件联系。",
      "答题失败不消耗题数（系统自动保障）。"
    ]
  },
  "ja": {
    "navDownload": "ダウンロード",
    "freeCard": {
      "name": "おためし"
    },
    "priceNote": "一つの依頼で利用可能な回答を受け取ると 1 問分を消費。回答なしの失敗は消費しません。利用可能は正解保証ではありません。別の再実行は新しい依頼です。決済は Stripe が処理します。",
    "faqs": [
      {"q": "3.0 への更新方法は？", "a": "2.17 からは Mac 版をダウンロードし、一度手動でインストールしてください。3.0 以降はアプリ内でダウンロード、検証、インストール、再起動ができます。"},
      {
        "q": "スクリーンショットは保存されますか？",
        "a": "サーバーは通常、画像・回答を保存しません。一時材料は最大15分。成功した質問の画像・回答は「最近の問題」に別途保存します。読み書き時に過去30日・最大100件 / 200 MBへ整理します。画面から削除できます。書き出したファイルは自分で削除してください。"
      },
      {
        "q": "回答に失敗したら？",
        "a": "利用可能な回答がない失敗では消費しません。切断した場合は精算状況を確認してください。再実行は新しい依頼になる場合があります。"
      },
      {
        "q": "機種変更したら残高は？",
        "a": "旧 Mac の設定 →「アカウントとプラン」で復元コードを保存し、新しい Mac で元のアカウントを復元できます。残高の統合は行いません。復元コードは大切に保管してください。"
      },
      {
        "q": "返金はできますか？",
        "a": "下記の返金ポリシーをご覧ください。誤答の報告は確認が必要で、題数の補償と返金は別に処理します。"
      },
      {
        "q": "動作環境は？",
        "a": "通常版：Apple Silicon Mac、macOS 14 以降。Intel Mac 互換版：macOS 12.3 以降、手動更新。ノッチのない画面では上部パネルを使います。初回に画面収録の許可が必要です。Windows 版は Coming soon、正式公開前です。"
      }
    ],
    "legalTitle": "特定商取引法に基づく表記",
    "privacyTitle": "プライバシーとデータ利用",
    "privacyBody": [
      "サービス記録にはランダムなデバイス認証情報、残高、依頼の精算、モデル利用量・費用、決済の照合情報を含みます。通常の登録に氏名やメールは不要です。",
      "公式サービスでは画像と必要な指示を AI プロバイダー（{{AI_PROVIDER}}）で処理します。実際のモデル構成は配信設定に従います。画像・問題・回答本文は通常のデータベースやログに保存しません。自分のキーでは選択したサービスを利用します。",
      "決済は Stripe が処理し、カード情報は当方には届きません。問い合わせメールや自発的に提供された材料は、その用途に沿って別に扱います。",
      "任意の信頼性データは設定で停止できます。停止時に未送信キューを消去し、行動記録を送りません。必要な請求記録は残ります。詳細イベントは 90 日、本機の送信待ちは最大 7 日です。",
      "入口の回答は任意で、初回案内からスキップできます。選んだ回答はデバイス登録と関連付けます。問題の種類や表示言語から入口を推測しません。",
      "問題フィードバックは確認して本機へ書き出し、自分で送信します。標準では今回の問題調査のみ。品質評価は別途選び、許諾は最大 90 日間です。外部モデル処理は別の同意が必要です。受領資料は期限・撤回時に削除し、本機の原本は自分で削除してください。問い合わせ・撤回・削除は下記メールへ、書き出したファイルのフィードバック番号を添えてください。"
    ],
    "refundTitle": "返金・キャンセルポリシー",
    "refundBody": [
      "デジタル商品（質問数チャージ）の性質上、チャージ完了後のお客様都合による返金は原則承っておりません。",
      "二重課金・チャージ未反映など、当方の責によるトラブルの場合は全額返金いたします。お問い合わせから 7 日以内にメールでご連絡ください。",
      "回答の生成に失敗した場合、質問数は消費されません（自動的に保護されます）。"
    ]
  },
  "en": {
    "navDownload": "Download",
    "freeCard": {
      "name": "Try it"
    },
    "priceNote": "One request delivering a usable answer costs one question. Failures without a usable answer are not charged. Usable does not guarantee correct; running it again is a new request. Stripe processes payments.",
    "faqs": [
      {"q": "How do I upgrade to 3.0?", "a": "From 2.17, download the Mac version and install it manually once. From 3.0 onward, updates can download, verify, install and restart within the app."},
      {
        "q": "Are my screenshots stored?",
        "a": "The server does not store images or answers by default. Temporary material lasts up to 15 minutes. Successful question images and answers are separately saved in Recent Questions on this Mac. On reading or saving records, the app prunes to the last 30 days, 100 entries / 200 MB. Delete records in Recent Questions. Exported feedback files remain until you delete them."
      },
      {
        "q": "What if an answer fails?",
        "a": "A failure without a usable answer is not charged. After a disconnect, check settlement first. Running it again may create a new request."
      },
      {
        "q": "What about my balance on a new Mac?",
        "a": "Save your recovery code in Settings → Account & plan on your old Mac, then restore that account on your new Mac. Recovery does not merge account balances. Keep your recovery code private."
      },
      {
        "q": "Can I get a refund?",
        "a": "See the policy below. Reports of incorrect answers require review; credit compensation and cash refunds are handled separately."
      },
      {
        "q": "Requirements?",
        "a": "Standard version: Apple Silicon Mac, macOS 14+. Intel compatibility version: macOS 12.3 or later, manual updates. Displays without a notch use a top panel. Screen-recording permission is requested on first use. Windows: Coming soon; not yet released."
      }
    ],
    "legalTitle": "特定商取引法に基づく表記 (Japanese commerce disclosure)",
    "privacyTitle": "Privacy and data use",
    "privacyBody": [
      "Service records include a random device credential, balance, request settlement, model usage and costs, and payment reconciliation. Normal registration needs no name or email.",
      "The official service processes screenshots and necessary instructions through the AI provider ({{AI_PROVIDER}}); actual model routing follows service configuration. Images, questions and answer text are excluded from the default database and logs. Your own key uses the service you select.",
      "Stripe processes payments; card details do not reach us. Support emails and material you voluntarily submit are handled separately for their stated purpose.",
      "Optional reliability sharing can be disabled in Settings. Disabling clears queued events and stops behavioral uploads; necessary billing records remain. Detailed events are kept for 90 days, with up to 7 days queued locally.",
      "The onboarding source question is optional. A selected answer is linked to this device registration. Question profile and display language do not determine your source.",
      "Preview and export problem feedback locally, then submit it yourself. Permission defaults to investigating this problem; quality evaluation is a separate choice. Permission lasts at most 90 days, and external model processing needs separate consent. Received material is deleted at expiry or withdrawal; delete your own local originals yourself. Email below for support, withdrawal or deletion, including the feedback reference in your export."
    ],
    "refundTitle": "Refund & Cancellation Policy",
    "refundBody": [
      "Question credits are digital goods and are generally non-refundable after delivery.",
      "Issues caused by us — double charges, credits not delivered — are fully refunded; email within 7 days.",
      "Failed answers never consume credits (enforced automatically)."
    ]
  }
};

/** 特定商取引法 disclosure — kept in Japanese in every UI language (it is a JP legal text). */
function tokushohoTable(): string {
  const rows: Array<[string, string]> = [
    ['販売業者', 'NotchSPI（個人事業）'],
    ['運営責任者', 'SHE LINGZHAO'],
    ['所在地・電話番号', 'ご請求をいただければ遅滞なく開示いたします'],
    ['お問い合わせ', `<a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>（メールにて受付）`],
    ['販売価格', '各チャージページに表示の金額（消費税込み）'],
    ['商品代金以外の必要料金', 'なし（通信料はお客様負担）'],
    ['お支払い方法', 'クレジットカード等（Stripe 決済）'],
    ['支払時期', '問題パックは購入時。Plus は申込時および毎月の更新時に自動決済'],
    ['商品の引渡時期', '決済確認後、問題数残高または Plus の利用権に反映'],
    ['返品・キャンセル', 'デジタル商品の性質上、チャージ後の返金は原則不可。当方の不具合による場合は全額返金いたします（返金ポリシー参照）'],
    ['動作環境', 'Apple Silicon Mac / macOS 14 以降、Intel Mac / macOS 12.3 以降（ノッチのない画面では上部パネル）'],
  ];
  return rows
    .map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`)
    .join('\n');
}

function entryCopy(input:SiteInput) {
  if(!input.entry)return null;
  const reading=input.entry==='reading_practice',beta=input.entryStatus==='beta';
  if(input.lang==='zh')return {
    title:reading?'在 Mac 上练习阅读题。':'在 Mac 上准备 SPI。',
    description:reading?'把题目、选项和阅读材料放在一起，围绕一道题练习理解。与 SPI 入口使用同一 NotchSPI、下载和题包。':'保留熟悉的 SPI 备考入口，围绕屏幕上的一道题查看答案。与阅读练习共用 NotchSPI、下载和题包。',
    scopeTitle:'当前支持与开放状态',
    scope:reading?(beta?'阅读练习处于内部测试，尚无完成独立评测的公开支持组合。':'阅读练习尚未开放，授权题集与独立评测仍在准备。'):
      '既有 SPI 入口继续可用。新版查题合约的题型、语言和版面组合仍待独立评测；不能把历史 SPI 结果视为所有题目的正确率。',
    journey:'一次只处理一个目标问题。新版材料补充、先看答案和按需解释按 App 的实际开放范围提供；未开放功能不会因下载此页面的安装包而启用。AI 答案需要核验。',
    attribution:'安装后的来源选择可以跳过。选择仅用于比较入口，不改变题目模式、免费额度或功能；下载点击不等于安装记录。',
  };
  if(input.lang==='ja')return {
    title:reading?'Mac で読解練習。':'Mac で SPI 対策。',
    description:reading?'問題・選択肢・文章を揃えて、一問の理解に取り組みます。SPI の入口と同じ NotchSPI、ダウンロード、題数パックを使います。':'慣れた SPI 対策の入口から、画面上の一問の回答を確認。読解練習と同じ NotchSPI、ダウンロード、題数パックです。',
    scopeTitle:'現在の対応範囲と公開状況',
    scope:reading?(beta?'読解練習は内部テスト中です。独立評価が完了した公開対応の組み合わせはまだありません。':'読解練習はまだ公開されていません。許諾済みの問題集と独立評価を準備しています。'):
      '既存の SPI 入口は継続します。新しい質問機能の題型・言語・レイアウトは独立評価待ちです。過去の SPI 結果を全問題の正解率とは扱いません。',
    journey:'一度に対象とするのは一問です。材料追加、回答優先、任意の説明はアプリで公開された範囲で提供します。このページからダウンロードしても未公開機能は有効になりません。AI の回答は確認してください。',
    attribution:'インストール後の入口選択はスキップできます。入口の比較にのみ使い、問題モード・無料枠・機能は変えません。ダウンロードのクリックはインストール記録ではありません。',
  };
  return {
    title:reading?'Practice reading questions on your Mac.':'Prepare for SPI on your Mac.',
    description:reading?'Bring the question, options and reading material together to work through one question. Use the same NotchSPI app, download and question packs as the SPI entry.':'Keep the familiar SPI preparation entry and review one question on screen. It shares the NotchSPI app, download and question packs with reading practice.',
    scopeTitle:'Current scope and availability',
    scope:reading?(beta?'Reading practice is in internal testing. No public support combinations have completed independent evaluation yet.':'Reading practice is not open yet. Authorized material and independent evaluation are being prepared.'):
      'The existing SPI entry continues. Question types, languages and layouts for the new query contract await independent evaluation. Historical SPI results do not establish accuracy for all questions.',
    journey:'Work on one target question at a time. Material support, answers first and optional explanations follow the features actually enabled in the app. Downloading here does not enable unreleased features. Verify AI answers against your material.',
    attribution:'You can skip the source choice after installation. It helps compare entry points and does not change modes, free credits or features. A download click is not an installation record.',
  };
}

/** Keep fractional yen: 800 / 300 is approximately 2.67, not 3. */
export function formatUnitPrice(pack: QuestionPack, currency: string, lang: PageLang): string {
  return new Intl.NumberFormat(lang === 'zh' ? 'zh-CN' : lang, {
    style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(pack.amountCents / pack.questions / (currency === 'JPY' ? 1 : 100));
}

export function renderLandingPage(input: SiteInput): string {
  const s = S[input.lang], d = designCopy[input.lang], entry = entryCopy(input);
  const pagePath = input.entry === 'spi' ? '/spi' : input.entry === 'reading_practice' ? '/reading-practice' : '/';
  const e = escapeHtml;
  const lines = (v:string) => e(v).replaceAll('\n','<br>');
  const ghost = `<img class="ghost-mark" src="${ghostAvatar}" alt="" width="100" height="100" aria-hidden="true">`;
  const packs = [...input.packs].sort((a,b)=>a.questions-b.questions);
  // Same selection as MainSettingsWindow.topUpTapped; never invent an unbound checkout.
  const appPack = packs[1] ?? packs[0];
  const providerName = input.aiProvider === 'deepseek' ? 'DeepSeek' : input.aiProvider === 'anthropic' ? 'Anthropic' : input.aiProvider === 'openai' ? 'OpenAI' : 'AI';
  const langLink = (lang:PageLang,label:string) => `<a class="lang${lang===input.lang?' on':''}" href="${pagePath}?lang=${lang}" lang="${lang}"${lang===input.lang?' aria-current="page"':''}>${label}</a>`;
  const download = (c='')=>`<a class="button ${c}" href="${DOWNLOAD}"><span aria-hidden="true">↓</span> ${d.download}</a>`;
  const intelCopy = {
    zh: {label:'下载 Intel 老 Mac 兼容版', note:'Intel 处理器 · 支持 macOS 12.3 及以上 · 3.0 build 28 · 手动更新'},
    ja: {label:'Intel Mac 互換版をダウンロード', note:'Intel プロセッサ · macOS 12.3 以降 · 3.0 build 28 · 手動更新'},
    en: {label:'Download for older Intel Macs', note:'Intel processor · macOS 12.3 or later · 3.0 build 28 · Manual updates'},
  }[input.lang];
  const intelDownload = () => `<div class="intel-download"><a class="button secondary" href="${INTEL_DOWNLOAD}"><span aria-hidden="true">↓</span> ${intelCopy.label}</a><p class="requirements">${intelCopy.note}</p></div>`;
  const packCards = packs.map((p,i)=>{
    const recommended=p.id===appPack?.id, slot=packs.length===1?1:i===0?0:i===packs.length-1?2:1;
    return `<article class="pack${recommended?' recommended':''}" data-pack-id="${e(p.id)}">
      ${recommended?`<div class="badge">${d.recommended}</div>`:''}<h3 class="pack-name">${d.packNames[slot]}</h3>
      <div class="q">${d.questions(p.questions)}</div><div class="price">${e(formatMoney(p.amountCents,input.currency))}</div>
      <div class="unit">${e(input.currency)} · ${d.oneTime}</div><p class="per">${d.per} ${e(formatUnitPrice(p,input.currency,input.lang))}</p>
      <p class="pack-caption">${d.packReasons[slot]}<br>${d.sameFeatures}</p>
      ${download('secondary')}</article>`;
  }).join('');
  const privacy=s.privacyBody.map(p=>`<p>${e(p.replaceAll('{{AI_PROVIDER}}',providerName))}</p>`).join('');
  const refund=s.refundBody.map(p=>`<p>${e(p)}</p>`).join('');
  const plusCopy = {
    zh: {title:'NotchSPI Plus',period:'每月自动续费',benefit:'每日 400 次成功求解，解释与失败不额外扣次。北京时间 00:00 重置，不累计。',cancel:'可随时取消自动续费，已付款周期内仍可使用。题包仍可单独购买。',buy:'App 设置 → 账户与订阅',trial:'新设备可自行选择领取 72 小时免费体验，每日 400 次。引导可选择稍后领取，之后在设置 → 账户与订阅领取。领取时替换初始赠送的未用部分，已购余额保留。免费体验与 Plus 独立计额，先用免费体验，再用 Plus，最后用题包。'},
    ja: {title:'NotchSPI Plus',period:'毎月自動更新',benefit:'毎日400回の解答。解説・失敗は追加消費なし。北京時間00:00リセット、繰り越しなし。',cancel:'いつでも自動更新を停止でき、支払済み期間は利用可能。問題パックも単独で購入できます。',buy:'アプリ設定 → アカウントとプラン',trial:'新規デバイスは好きな時に72時間・毎日400回の無料体験を開始できます。ガイドでスキップ後も設定のアカウント画面から受け取れます。初回無料残高の未使用分と置き換わり、購入済み残高は保持。無料体験、Plus、購入パックの順に各枠を使います。'},
    en: {title:'NotchSPI Plus',period:'Renews monthly',benefit:'400 successful solves daily. No extra count for explanations or failures. Resets at 00:00 Beijing time; no rollover.',cancel:'Cancel renewal anytime and keep access through the paid period. Question packs remain available separately.',buy:'App Settings → Account & plan',trial:'New devices can choose when to claim a 72-hour trial with 400 solves daily. Choose Claim later in setup, then claim from Settings → Account & plan. Claiming replaces unused initial free credits; purchased credits remain. Trial and Plus allowances are separate, used before purchased credits in that order.'},
  }[input.lang];
  const plusCard = `<article class="feature" style="margin-top:28px"><h3>${plusCopy.title} · ${formatMoney(PLUS.priceCents,PLUS.currency)} CNY / ${input.lang==='zh'?'月':input.lang==='ja'?'月':'month'}</h3><p>${plusCopy.period} · ${plusCopy.benefit}</p><p>${plusCopy.cancel}</p><p>${plusCopy.buy}</p><p>${plusCopy.trial}</p></article>`;
  const faqItems=s.faqs.map(f=>`<details><summary>${e(f.q)}</summary><p>${e(f.a)}</p></details>`).join('');
  const title=entry?.title??`${d.title} ${d.accent}`, description=entry?`${entry.description} ${entry.scope}`:d.sub;
  return `<!doctype html>
<html lang="${input.lang==='zh'?'zh-CN':input.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>NotchSPI — ${e(title)}</title><meta name="description" content="${e(description)}"><meta name="theme-color" content="#f8f7f3"><link rel="icon" type="image/png" href="${ghostAvatar}">
<meta property="og:title" content="NotchSPI — ${e(title)}"><meta property="og:description" content="${e(description)}"><style>${siteCSS}</style></head><body>
<a class="skip" href="#main">${d.skip}</a>
<header class="header wrap"><a class="brand" href="/?lang=${input.lang}" aria-label="NotchSPI">${ghost}NotchSPI</a>
<nav class="mainnav" aria-label="${d.experience}"><a href="#how">${d.experience}</a><a href="#pricing">${d.pricing}</a><a href="#faq">${d.faq}</a></nav>
<nav class="languages" aria-label="Language">${langLink('ja','日本語')}${langLink('zh','中文')}${langLink('en','EN')}</nav><a class="button small" href="${DOWNLOAD}">${s.navDownload} <span aria-hidden="true">↗</span></a></header>
<main id="main"><div class="wrap"><section class="hero${entry ? '' : ' hero-home'}" aria-labelledby="hero-title"><div class="hero-copy">
<p class="eyebrow">${d.eyebrow}</p><h1 id="hero-title">${entry?e(entry.title):`${e(d.title)}<br><span>${e(d.accent)}</span>`}</h1>
<p class="sub">${e(entry?.description??d.sub)}</p><div class="hero-actions">${download()}<button class="button secondary windows-download" type="button" disabled aria-disabled="true">${d.windowsDownload} <span class="coming-soon">Coming soon</span></button></div>
<p class="trial-line">${d.free()}</p><p class="requirements"><span class="release-label">${d.release}</span>${d.requirements}</p>${intelDownload()}
${entry?`<aside class="scope" aria-labelledby="scope-title"><h2 id="scope-title">${e(entry.scopeTitle)}</h2><p>${e(entry.scope)}</p><p>${e(entry.journey)}</p><p>${e(entry.attribution)}</p></aside>`:''}
</div><div class="demo" id="demo"><fieldset><legend>${d.demoLabel}: ${d.demoTitle}</legend>
<div class="stage-controls">${['question','capture','answer'].map((stage,i)=>`<label><input type="radio" id="demo-${stage}" name="demo-stage" value="${stage}" aria-controls="demo-screen"${i===0?' checked':''}><b aria-hidden="true">0${i+1}</b><span>${d.stages[i]}</span></label>`).join('')}</div>
<div class="desktop" id="demo-screen"><div class="menu-bar" aria-hidden="true"><span>NotchSPI &nbsp; · &nbsp; ${d.demoLabel}</span><span>⌘ &nbsp; ◉ &nbsp; 9:41</span></div>
<div class="notch"><div class="notch-head">${ghost}<b>NotchSPI</b><span class="notch-status"><span class="status-ready">${d.ready}</span><span class="status-capture">${d.processing}</span><span class="status-answer">${d.done}</span></span></div>
<div class="pending"><span class="capture-thumb" aria-hidden="true"></span>${d.collected}</div><div class="notch-body"><div class="answer-label">${d.answerLabel}</div><div class="answer-value">${d.answer}</div><div class="answer-work">${e(d.explanation)}</div></div></div>
<div class="question-window"><div class="window-chrome" aria-hidden="true"><i></i><i></i><i></i><span>practice / 01</span></div><div class="question-content"><p class="question-tag">${d.problemTag}</p><h3>${d.question}</h3><div class="options">${d.options.map(o=>`<span>${o}</span>`).join('')}</div></div></div>
<div class="desktop-note">${d.hint}<small>${d.hintSub}</small></div><div class="shortcut" aria-label="Command Shift 1"><kbd>⌘</kbd><kbd>⇧</kbd><kbd>1</kbd></div></div>
</fieldset><div class="demo-playback"><button type="button" class="demo-toggle" hidden aria-controls="demo-screen" data-play="${({zh:'播放演示',ja:'デモを再生',en:'Play demo'})[input.lang]}" data-pause="${({zh:'暂停轮播',ja:'一時停止',en:'Pause demo'})[input.lang]}"></button></div><p class="demo-note">${d.demoNote}</p></div></section>
<div class="rail">${d.rail.map(t=>`<span>${t}</span>`).join('')}</div>
<section id="how" class="section how" aria-labelledby="how-title"><div><p class="eyebrow">${d.howEyebrow}</p><h2 id="how-title">${lines(d.howTitle)}</h2></div><ol class="how-list">${d.steps.map(([t,p],i)=>`<li><span class="step-number">0${i+1}</span><div><h3>${t}</h3><p>${p}</p></div></li>`).join('')}</ol></section>
<section id="features" class="features" aria-labelledby="features-title"><div class="feature-intro"><p class="eyebrow">${d.featureEyebrow}</p><h2 id="features-title">${lines(d.featureTitle)}</h2></div><div class="feature-grid">
<article class="feature"><div class="multi-visual" aria-hidden="true">${d.multiLabels.map((t,i)=>`<div class="mini-page"><b>0${i+1}</b><div class="mini-lines"></div><span>${t}</span></div>`).join('')}</div><h3>${d.multiTitle}</h3><p>${d.multiBody}</p></article>
<article class="feature"><div class="app-photo"><img src="${productScreenshot}" alt="${e(d.actual)}" width="1288" height="641" loading="lazy" decoding="async"><small>${d.actual}</small></div><h3>${d.quietTitle}</h3><p>${d.quietBody}</p></article></div></section></div>
<section id="pricing" class="pricing-band section" aria-labelledby="pricing-title"><div class="wrap"><div class="pricing-header"><p class="eyebrow">${d.priceEyebrow}</p><h2 id="pricing-title">${lines(d.priceTitle)}</h2><p>${d.priceIntro}</p></div>
${plusCard}<div class="packs"><article class="pack"><h3 class="pack-name">${d.trial}</h3><div class="q">${d.trialAmount}</div><div class="price">${e(formatMoney(0,input.currency))}</div><div class="unit">${e(input.currency)} · ${s.freeCard.name}</div><p class="per">${d.trialNote}</p><p class="pack-caption">${d.free()}</p>${download('secondary')}</article>${packCards}</div>
<div class="price-notes"><p>${d.currencyNote}</p><p>${e(s.priceNote)}</p></div><div class="purchase" id="purchase"><div><h3>${d.purchaseTitle}</h3><p>${d.purchaseBody}</p></div><div><ol>${d.purchaseSteps.map(t=>`<li>${t}</li>`).join('')}</ol>${appPack?`<p class="purchase-default">${d.purchaseDefault(appPack.questions)}</p>`:''}</div></div></div></section>
<div class="wrap"><section id="faq" class="section faq-section" aria-labelledby="faq-title"><div><p class="eyebrow">FAQ</p><h2 id="faq-title">${d.faqTitle}</h2></div><div class="faq">${faqItems}</div></section>
<section class="closing">${ghost}<h2>${lines(d.finalTitle)}</h2><p>${d.finalSub}</p>${download()}<p>${d.free()}<br>${d.requirements}</p>${intelDownload()}</section>
<aside class="scope-links"><p>${d.scope}</p><nav class="entrylinks" aria-label="${d.scope}"><a href="/spi?lang=${input.lang}"${input.entry==='spi'?' aria-current="page"':''}>${d.spi}</a><a href="/reading-practice?lang=${input.lang}"${input.entry==='reading_practice'?' aria-current="page"':''}>${d.reading}</a></nav></aside>
<section class="legal" id="legal" aria-label="${d.legal}"><details id="tokushoho"><summary>${s.legalTitle}</summary><table>${tokushohoTable()}</table></details><details id="privacy"><summary>${s.privacyTitle}</summary>${privacy}</details><details id="refund"><summary>${s.refundTitle}</summary>${refund}</details></section></div></main>
<footer class="footer wrap"><a class="brand" href="/?lang=${input.lang}">${ghost}NotchSPI</a><div>© 2026 NotchSPI · SHE LINGZHAO</div><div class="footer-contact"><a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a><a href="#legal">${d.legal}</a></div></footer><script>${demoScript}</script></body></html>`;
}
