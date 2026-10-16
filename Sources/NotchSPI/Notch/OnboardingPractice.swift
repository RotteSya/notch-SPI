import Foundation

/// Local, capturable practice material. It follows the guide's language and never contains an answer.
enum OnboardingPractice {
    static func write(multiple: Bool) throws -> URL {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(multiple ? "NotchSPI-Multiple-Practice.html" : "NotchSPI-Practice.html")
        try html(multiple: multiple).write(to: file, atomically: true, encoding: .utf8)
        return file
    }
    static func html(multiple: Bool) -> String {
        let t = L10n.t
        func escape(_ value: String) -> String {
            value.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
                .replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\"", with: "&quot;")
        }
        let lang = t("zh-Hans", "ja", "en")
        let title = multiple ? t("把一道题，分成两张图。", "1つの問題を、2枚に分けて。", "One question, two captures.")
            : t("一道题，一次截图。", "1つの問題を、1回で撮影。", "One question, one capture.")
        let passage = t("一列火车以恒定速度行驶，2 小时行驶了 120 千米。", "ある列車は一定の速さで走り、2時間で120 km進みました。", "A train travels at a constant speed, covering 120 km in 2 hours.")
        let question = t("这列火车的平均速度是多少？", "この列車の平均の速さは時速何kmですか？", "What is the train’s average speed?")
        let choices = "A. 40 km/h　 B. 60 km/h　 C. 80 km/h"
        let passageLabel = t("1 · 材料", "1 · 資料", "1 · Passage")
        let questionLabel = t("2 · 问题", "2 · 問題", "2 · Question")
        let key = escape(Settings.displayString(multiple ? Settings.shared.contextCombo : Settings.shared.captureCombo))
        let instruction = multiple
            ? t("按上方快捷键截取材料，再点击“问题”，按同一快捷键截取第二张。两张起停顿 4 秒自动查题，最多 4 张；点击刘海里的题图可预览并暂停倒计时。", "上のショートカットで資料を撮影し、「問題」を開いて同じキーをもう一度押します。2枚目から4秒後に自動送信、最大4枚。ノッチの画像を開くとカウントが一時停止します。", "Press the shortcut above to capture Passage. Open Question, then press the same shortcut again. From two images, a 4-second pause sends them; up to four images. Preview an image in the notch to pause the countdown.")
            : t("让题目和选项完整显示，然后按上方快捷键截图查题。答案会出现在屏幕顶部。", "問題と選択肢をすべて表示して、上のショートカットで撮影します。答えは画面上部に表示されます。", "Keep the question and choices visible, then press the shortcut above. Your answer appears at the top of the screen.")
        let tabs = multiple ? """
        <nav aria-label="\(escape(t("练习页面", "練習ページ", "Practice pages")))">
        <button type="button" id="passage-tab" aria-pressed="true" onclick="showPage(false)">\(passageLabel)</button>
        <button type="button" id="question-tab" aria-pressed="false" onclick="showPage(true)">\(questionLabel)</button></nav>
        """ : ""
        let content = multiple ? """
        <section id="passage"><h2>\(passageLabel)</h2><p>\(passage)</p></section>
        <section id="question" hidden><h2>\(questionLabel)</h2><p>\(question)</p><p class="choices">\(choices)</p></section>
        """ : "<section><p>\(passage)</p><p>\(question)</p><p class=\"choices\">\(choices)</p></section>"
        return """
        <!doctype html><html lang="\(lang)"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
        <title>NotchSPI · \(t("练习", "練習", "Practice"))</title>
        <style>
        *{box-sizing:border-box}body{margin:0;background:#f4f5f7;color:#24262b;font:17px -apple-system,BlinkMacSystemFont,sans-serif;-webkit-font-smoothing:antialiased}
        main{max-width:880px;margin:360px auto 40px;padding:28px 32px;background:#fff;border:1px solid #e1e3e8;border-radius:20px;box-shadow:0 12px 44px #17203906;display:grid;grid-template-columns:minmax(0,1fr) 224px;gap:0 32px}
        small{grid-column:1/-1;font-size:10px;font-weight:600;letter-spacing:2px;color:#767c88}h1{grid-column:1/-1;font-size:26px;font-weight:600;letter-spacing:-.6px;margin:10px 0 24px}h2{font-size:12px;color:#777e8b;font-weight:600;margin:0 0 14px}p{line-height:1.7;margin:0 0 16px}section{min-height:150px}.choices{font-size:17px;font-weight:500;line-height:1.8;margin-bottom:0}
        nav{grid-column:1/-1;display:flex;gap:4px;padding:4px;width:fit-content;background:#f0f2f5;border:1px solid #e8eaee;border-radius:11px;margin-bottom:24px}button{font:500 13px -apple-system,BlinkMacSystemFont,sans-serif;border:1px solid transparent;border-radius:7px;padding:8px 18px;background:transparent;color:#6b7280;cursor:pointer;transition:background .16s,color .16s,box-shadow .16s}button[aria-pressed=true]{background:#fff;color:#262b36;box-shadow:0 1px 4px #17203912}button:focus-visible{outline:3px solid #789bff;outline-offset:3px}
        footer{align-self:stretch;border-left:1px solid #e8eaee;padding:2px 0 0 24px;color:#737b89;font-size:12px;line-height:1.75}kbd{display:inline-block;font:500 14px -apple-system,sans-serif;color:#2c3444;background:#f6f7f9;border:1px solid #dfe3ea;border-bottom-width:2px;border-radius:7px;padding:6px 11px;margin-bottom:12px}
        [hidden]{display:none!important}@media(max-width:760px){main{display:block;margin:360px 20px 28px;padding:24px}footer{border-left:0;border-top:1px solid #e8eaee;padding:18px 0 0;margin-top:22px}h1{font-size:24px}.choices{font-size:16px}}@media(max-height:740px){main{margin-top:300px}}@media(prefers-reduced-motion:reduce){button{transition:none}}
        </style></head>
        <body><main><small>NOTCHSPI / \(multiple ? "02" : "01")</small><h1>\(title)</h1>\(tabs)\(content)
        <footer><kbd>\(key)</kbd><br>\(instruction)</footer></main>
        <script>function showPage(question){document.getElementById('passage').hidden=question;document.getElementById('question').hidden=!question;document.getElementById('passage-tab').setAttribute('aria-pressed',String(!question));document.getElementById('question-tab').setAttribute('aria-pressed',String(question));}</script></body></html>
        """
    }
}
