// Checkpoints match the shipped Mac guide. Only a successful real solve advances practice.
export const guideSteps = [
  "welcome",
  "permission",
  "practice",
  "capture",
  "working",
  "firstAnswer",
  "multiple",
  "multiCapture",
  "collecting",
  "success",
  "trial",
];
export function onboardingCheckpoint(step, multiple = false) {
  if (multiple && ["working", "permission"].includes(step)) return "multiple";
  if (step === "working") return "capture";
  if (step === "success") return "trial";
  return ["firstAnswer", "multiCapture", "collecting"].includes(step)
    ? "multiple"
    : guideSteps.includes(step)
      ? step
      : "welcome";
}
export class Onboarding {
  constructor(saved = {}, complete = false) {
    this.done = (complete && saved.done !== false) || saved.done === true;
    this.dismissed = saved.dismissed === true;
    this.active = !this.done && !this.dismissed;
    this.step = onboardingCheckpoint(saved.step);
    this.multiple = [
      "multiple",
      "multiCapture",
      "collecting",
      "success",
    ].includes(this.step);
    this.failed = false;
    this.claiming = false;
  }
  move(step) {
    if (!guideSteps.includes(step)) throw new Error("Invalid guide step");
    this.step = step;
    this.failed = false;
  }
  startCapture(kind) {
    if (!this.active) return true;
    if (
      !["capture", "multiCapture", "collecting", "working"].includes(this.step)
    )
      return false;
    if (kind !== (this.multiple ? "multiple" : "single")) return false;
    this.move(this.multiple ? "collecting" : "working");
    return true;
  }
  submitting() {
    if (this.active) this.move("working");
  }
  finished(usable) {
    if (!this.active || this.step !== "working") return;
    if (usable) this.move(this.multiple ? "success" : "firstAnswer");
    else this.failed = true;
  }
  cancel() {
    if (this.active) {
      this.move(this.multiple ? "multiCapture" : "capture");
      this.failed = false;
    }
  }
  permission() {
    if (this.active) this.move("permission");
  }
  dismiss() {
    this.dismissed = true;
    this.active = false;
  }
  resume() {
    if (this.done) {
      this.step = "welcome";
      this.multiple = false;
      this.done = false;
    }
    this.active = true;
    this.dismissed = false;
    this.step = onboardingCheckpoint(this.step, this.multiple);
    this.failed = false;
  }
  complete() {
    this.done = true;
    this.active = false;
    this.dismissed = false;
  }
  get saved() {
    return {
      done: this.done,
      dismissed: this.dismissed,
      step: onboardingCheckpoint(this.step, this.multiple),
    };
  }
  get snapshot() {
    return {
      step: this.step,
      multiple: this.multiple,
      failed: this.failed,
      claiming: this.claiming,
      live: ["working", "firstAnswer", "collecting", "success"].includes(
        this.step,
      ),
    };
  }
}
const guideCopy = {
  welcome: [
    ["欢迎使用NotchSPI！", "NotchSPIへようこそ！", "Welcome to NotchSPI!"],
    [
      "每道题，抬眸尽收眼底。你在做的题，解答将会出现在这里。",
      "取り組んでいる問題の解答が、ここに表示されます。",
      "Every question, a glance away. Answers will appear right here.",
    ],
    ["试一道题", "練習してみる", "Try a question"],
  ],
  practice: [
    [
      "从一道练习题开始。",
      "練習問題から始めましょう。",
      "Start with a practice question.",
    ],
    [
      "练习题会在默认浏览器中打开。",
      "練習問題をデフォルトのブラウザで開きます。",
      "The practice opens in your default browser.",
    ],
    ["打开练习题", "練習問題を開く", "Open practice"],
  ],
  capture: [
    [
      "现在，截下这道题。",
      "この問題を撮ってみましょう。",
      "Now capture the question.",
    ],
    [
      "让题目和选项完整显示，按下方快捷键截图。答案会出现在这里。",
      "問題と選択肢をすべて表示し、下のショートカットで撮影します。",
      "Keep the question and choices visible. Press the shortcut below; your answer will appear here.",
    ],
    ["", "", ""],
  ],
  multiple: [
    [
      "一道题，也可以分开截。",
      "長い問題は、分けて撮影。",
      "One question. Multiple captures.",
    ],
    [
      "先按下方快捷键截取“材料”，再切到“问题”按一次。最多4张，第2张起，停顿4秒后自动查题。",
      "「資料」を撮影。「問題」に切り替え、同じキーをもう一度押します。最大4枚、2枚目から4秒後に送信。",
      "Capture Passage, switch to Question, then press the shortcut again. Up to 4 images; a 4-second pause sends them after the second.",
    ],
    ["打开多图练习", "複数画像の練習を開く", "Open multi-image practice"],
  ],
  working: [
    ["", "", ""],
    ["正在读取题目…", "問題を読み取っています…", "Reading your question…"],
    ["", "", ""],
  ],
  firstAnswer: [
    ["", "", ""],
    [
      "成功了！接下来试试多图模式，用于题目和选项一张图截不完的情况。",
      "できました！次は複数画像モードを試してみましょう。",
      "You did it! Next, try multiple-image mode for questions that do not fit in one capture.",
    ],
    ["试试多图模式", "複数画像モードを試す", "Try multiple-image mode"],
  ],
  collecting: [
    ["", "", ""],
    [
      "切到练习的“问题”页，再按一次快捷键。预览暂停自动提交；关闭后重新倒计时。",
      "「問題」に切り替え、もう一度撮影。プレビュー中は送信を一時停止します。",
      "Switch to Question and press the shortcut again. Preview pauses sending; closing restarts the countdown.",
    ],
    ["", "", ""],
  ],
  success: [
    ["", "", ""],
    [
      "成功了！除此之外还有自动模式和性格测试模式，欢迎自行探索。",
      "できました！自動モードや性格テストモードもお試しください。",
      "You did it! There is also auto mode and personality test mode to explore.",
    ],
    ["继续", "次へ", "Continue"],
  ],
  trial: [
    ["领取3天免费体验。", "3日間の無料体験をどうぞ。", "Enjoy 3 days on us."],
    [
      "新用户可自行选择领取时间，领取后开始72小时体验。每天400次，失败不计次数。稍后可在账户与订阅中领取。",
      "受け取りから72時間、毎日400回。あとでアカウント画面から受け取れます。",
      "Choose when to start your 72-hour trial: 400 solves per day; failures do not count. You can claim later in Account.",
    ],
    ["领取免费体验", "無料体験を始める", "Claim free trial"],
  ],
  permission: [
    [
      "允许截取这道题。",
      "問題を撮影するための許可。",
      "Allow question capture.",
    ],
    [
      "检查系统截图权限与目标窗口。授权后返回，再按快捷键开始截图。",
      "撮影の許可と対象を確認してから、ショートカットで撮影してください。",
      "Check capture permission and the target window. Return after allowing access, then press the shortcut.",
    ],
    ["检查权限并返回", "確認して戻る", "Check and return"],
  ],
};
export function onboardingCopy(step, language = "en", trial = null) {
  const i = language === "zh" ? 0 : language === "ja" ? 1 : 2,
    r =
      guideCopy[step === "multiCapture" ? "multiple" : step] ||
      guideCopy.welcome;
  if (
    step === "trial" &&
    trial &&
    ["active", "expired", "ineligible"].includes(trial.status)
  ) {
    const active = trial.status === "active";
    return {
      title: (active
        ? [
            "免费体验已开启。",
            "無料体験が始まりました。",
            "Your free trial is ready.",
          ]
        : trial.status === "expired"
          ? [
              "免费体验已结束。",
              "無料体験が終了しました。",
              "Your free trial has ended.",
            ]
          : [
              "当前账户无法领取。",
              "このアカウントは対象外です。",
              "This account isn’t eligible.",
            ])[i],
      body: (active
        ? [
            "每天400次，北京时间00:00重置，失败不计次数。",
            "毎日400回、北京時間00:00にリセット。失敗はカウントされません。",
            "400 solves per day, resetting at 00:00 Beijing time. Failures do not count.",
          ]
        : [
            "已购买的题数仍可继续使用。",
            "購入済みの問題数は引き続き使えます。",
            "Your purchased questions are still available.",
          ])[i],
      action: ["开始使用", "使い始める", "Start using NotchSPI"][i],
    };
  }
  return {
    title: r[0][i],
    body: r[1][i],
    action: step === "multiCapture" ? "" : r[2][i],
  };
}
