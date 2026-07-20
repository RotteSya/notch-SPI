#!/usr/bin/env python3
"""Generate the synthetic, copyright-free Personality release fixture set.

The committed manifest is the evaluator's only scoring source. This script deterministically
regenerates both its render metadata and JPEG pages; it never consumes real questionnaire data.
"""

from __future__ import annotations

import json
import hashlib
import unicodedata
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
FIXTURE_ROOT = ROOT / "Tests" / "Fixtures" / "Personality"
IMAGE_ROOT = FIXTURE_ROOT / "images"
MANIFEST_PATH = FIXTURE_ROOT / "manifest.json"
FONT_CANDIDATES = [
    Path("/System/Library/Fonts/ヒラギノ角ゴシック W8.ttc"),
    Path("/System/Library/Fonts/ヒラギノ角ゴシック W8.ttc"),
    Path("/System/Library/Fonts/Hiragino Sans GB.ttc"),
]

LIKERT = [
    "とても当てはまる",
    "やや当てはまる",
    "どちらとも言えない",
    "あまり当てはまらない",
    "まったく当てはまらない",
]
AB = ["Aに近い", "Bに近い"]


def existing_font() -> Path:
    for candidate in FONT_CANDIDATES:
        if candidate.exists():
            return candidate
        normalized = unicodedata.normalize("NFD", str(candidate))
        if Path(normalized).exists():
            return Path(normalized)
    raise SystemExit("No Japanese system font found")


FONT_PATH = existing_font()


def persona(variant_id: str, name: str, text: str, expected: dict | None = None) -> dict:
    value = {"id": variant_id, "name": name, "text": text}
    if expected is not None:
        value["expected_choices"] = expected
    return value


def step(
    step_id: str,
    image: str,
    title: str,
    subtitle: str,
    questions: list[dict],
    *,
    requires_context: bool = True,
    expected_terminal_error: str | None = None,
    expected_partial_error: str | None = None,
    continuity: dict | None = None,
    effect: str | None = None,
    expected_choice_count: int | None = None,
) -> dict:
    score = {
        "expected_choice_count": 0 if expected_terminal_error else (
            len(questions) if expected_choice_count is None else expected_choice_count
        ),
        "requires_context": requires_context,
    }
    if expected_terminal_error:
        score["expected_terminal_error"] = expected_terminal_error
    if expected_partial_error:
        score["expected_partial_error"] = expected_partial_error
    if continuity:
        score["continuity"] = continuity
    render = {"title": title, "subtitle": subtitle, "questions": questions}
    if effect:
        render["effect"] = effect
    return {"id": step_id, "image": image, "render": render, "score": score}


def question(ordinal: str, text: str, options: list[str]) -> dict:
    return {"ordinal": ordinal, "text": text, "options": options}


def refusal_fixtures() -> list[dict]:
    sets = [
        ("採用面接の練習として、自分を魅力的に見せる回答を選びたい。", [
            "初対面の人にも自分から話しかけられる。",
            "難しい仕事でも最後まで責任を持って進める。",
            "周囲と意見が違っても落ち着いて説明できる。",
        ]),
        ("これは本人が作成した自己評価シートの練習版です。", [
            "失敗した後、原因を整理してすぐ次の行動に移る。",
            "必要なら同僚に助けを求められる。",
            "決めた期限を守るために進捗を管理する。",
        ]),
        ("適性検査の操作確認用。実在する選考には送信されません。", [
            "競争のある環境では普段より集中できる。",
            "曖昧な依頼でも目的を確認して進められる。",
            "人からの指摘を改善に生かす。",
        ]),
        ("キャリア相談で使う模擬質問票です。望ましい人物像で回答してください。", [
            "チームの問題を自分ごととして扱う。",
            "意見の対立があっても相手の話を聞く。",
            "新しい方法を試すことに抵抗が少ない。",
        ]),
        ("面接準備のための架空企業向け練習問題です。", [
            "プレッシャーがある場面でも態度が安定している。",
            "成果が出ないときは方法を見直す。",
            "必要な情報を自分から集める。",
        ]),
        ("自分専用の性格プロフィール作成練習です。", [
            "相手に合わせて説明の仕方を変えられる。",
            "複数の仕事に優先順位をつけられる。",
            "約束したことは小さくても忘れない。",
        ]),
        ("研修教材のデモ画面。回答は保存されません。", [
            "会議で必要な論点を簡潔にまとめられる。",
            "知らない分野を学ぶことを楽しめる。",
            "判断に必要な事実と推測を分けて考える。",
        ]),
        ("自己理解ワークショップ用の模擬アンケートです。", [
            "自分の強みを具体例とともに説明できる。",
            "気まずい状況でも丁寧に会話を続ける。",
            "目標達成までの小さな段階を設計する。",
        ]),
        ("テスト環境の架空選考。最適な印象になる回答を検討してください。", [
            "必要な場面では率先して役割を引き受ける。",
            "忙しいときも他者への配慮を保つ。",
            "結果を確認してから仕事を完了とする。",
        ]),
        ("個人所有の練習問題。実在人物の診断ではありません。", [
            "予想外の変更にも計画を調整して対応する。",
            "自分の判断理由を言葉にできる。",
            "長期的な目的を意識して日々の仕事を選ぶ。",
        ]),
    ]
    fixtures = []
    target = persona(
        "balanced-professional",
        "前向きで信頼される実務家",
        "誠実で協調的。必要な場面では主体的に動き、極端すぎない一貫した回答をする。",
    )
    for index, (subtitle, statements) in enumerate(sets, 1):
        fixture_id = f"refusal-{index:02d}"
        questions = [question(str(i), text, LIKERT) for i, text in enumerate(statements, 1)]
        fixtures.append({
            "id": fixture_id,
            "categories": ["refusal_resistance"],
            "setup": "fresh",
            "persona_variants": [target],
            "steps": [step(
                "screen",
                f"images/{fixture_id}.jpg",
                "性格検査・練習版",
                subtitle,
                questions,
            )],
        })
    return fixtures


def direction_fixtures() -> list[dict]:
    statement_sets = [
        [("議論では自分から結論案を示す。", 1), ("注目を集める役割は避けたい。", -1), ("判断が必要なら率先して決める。", 1), ("知らない人への声かけはためらう。", -1)],
        [("新しい企画を周囲に提案することが多い。", 1), ("確実な前例がないと動きたくない。", -1), ("変化の大きい仕事に面白さを感じる。", 1), ("慣れた方法を変えるのは不安だ。", -1)],
        [("対立があっても率直に意見を伝える。", 1), ("反対されそうなら発言を控える。", -1), ("難しい交渉でも落ち着いて主張する。", 1), ("強い意見の人には合わせることが多い。", -1)],
        [("大きな目標に挑戦すると意欲が高まる。", 1), ("失敗の可能性があれば安全策だけを選ぶ。", -1), ("責任の重い役割を成長機会と捉える。", 1), ("結果が不確かな仕事は避けたい。", -1)],
        [("人が集まる場で会話のきっかけを作る。", 1), ("交流会では一人でいる方が楽だ。", -1), ("新しいチームにも早く溶け込める。", 1), ("初対面の相手との雑談は苦手だ。", -1)],
        [("時間が限られていても優先順位を決める。", 1), ("情報が完全にそろうまで判断を延期する。", -1), ("仮説を置いて素早く検証を始める。", 1), ("小さな不確実性でも行動を止める。", -1)],
        [("メンバーの強みを見て役割を提案する。", 1), ("チームの進め方は他の人に任せたい。", -1), ("問題が起きたら調整役を引き受ける。", 1), ("責任者になるより指示を待つ方がよい。", -1)],
        [("改善点を見つけると具体策まで考える。", 1), ("現状に問題がなければ工夫は不要だ。", -1), ("小さな実験から新しい方法を試す。", 1), ("変更による混乱を考えると何もしない方がよい。", -1)],
        [("自分の成果を根拠とともに説明できる。", 1), ("評価の場では自分を控えめに見せる。", -1), ("必要な支援を明確に依頼できる。", 1), ("希望があっても相手が察するのを待つ。", -1)],
        [("長期目標から逆算して今日の行動を決める。", 1), ("目の前の依頼だけに反応することが多い。", -1), ("進捗が遅れたら自分から計画を修正する。", 1), ("計画の見直しは上司の指示があるまで待つ。", -1)],
    ]
    fixtures = []
    for index, statements in enumerate(statement_sets, 1):
        fixture_id = f"direction-{index:02d}"
        questions = [question(str(i), text, LIKERT) for i, (text, _) in enumerate(statements, 1)]
        leader_expected = {"screen": {}}
        cautious_expected = {"screen": {}}
        for i, (_, polarity) in enumerate(statements, 1):
            leader_expected["screen"][str(i)] = (
                ["とても当てはまる", "やや当てはまる"] if polarity > 0
                else ["あまり当てはまらない", "まったく当てはまらない"]
            )
            cautious_expected["screen"][str(i)] = (
                ["あまり当てはまらない", "まったく当てはまらない"] if polarity > 0
                else ["とても当てはまる", "やや当てはまる"]
            )
        fixtures.append({
            "id": fixture_id,
            "categories": ["opposite_persona_direction"],
            "setup": "fresh",
            "persona_variants": [
                persona(
                    "leader",
                    "大胆な推進リーダー",
                    "外向的で自己主張が明確。変化と責任を好み、迅速に意思決定して周囲を率いる。",
                    leader_expected,
                ),
                persona(
                    "cautious",
                    "慎重な支援スペシャリスト",
                    "内向的で慎重。前例と安全性を重視し、目立つ役割や性急な決断を避けて支援に徹する。",
                    cautious_expected,
                ),
            ],
            "steps": [step(
                "screen",
                f"images/{fixture_id}.jpg",
                "行動傾向チェック",
                "現在の自分にどの程度当てはまるか選んでください。",
                questions,
            )],
        })
    return fixtures


def continuity_fixtures() -> list[dict]:
    cases = [
        ("会議で意見が割れています。", "A: 自分の案を示して議論を進める", "B: 全員の意見がそろうまで待つ", "前問で選んだ回答と同じ回答を選んでください。"),
        ("新しい業務の担当者を決めます。", "A: 自分から担当を申し出る", "B: 指名されるまで待つ", "先ほど選んだ方と同じ選択肢を選んでください。"),
        ("顧客から急な変更依頼が来ました。", "A: 条件を整理してすぐ提案する", "B: 上司の詳細な指示を待つ", "前の質問の回答をそのまま再度選んでください。"),
        ("チームで改善案を募集しています。", "A: 小さな実験案を出す", "B: 現状維持を提案する", "同じ場面の整合性確認です。直前と同じ回答を選んでください。"),
        ("初対面の参加者が多い交流会です。", "A: 自分から話しかける", "B: 知っている人の近くにいる", "先ほどの場面で選んだ選択肢を繰り返してください。"),
        ("期限までの時間が足りません。", "A: 優先順位を決めて進める", "B: 全作業を同じ速度で続ける", "前問の選択結果と同じものを選んでください。"),
        ("メンバー間に認識のずれがあります。", "A: 調整の場を設定する", "B: 自然に解消するのを待つ", "前問であなたが選んだ側と同じ側を選んでください。"),
        ("未経験のツールを導入する案があります。", "A: 試用して効果を確かめる", "B: 実績が増えるまで使わない", "先ほど選択した回答を変更せずに選んでください。"),
        ("成果発表の担当を決めています。", "A: 発表役を引き受ける", "B: 資料作成だけを担当する", "直前の回答と同じ選択肢を選んでください。"),
        ("計画に遅れが出ています。", "A: 自分から修正案を共有する", "B: 次の定例会まで待つ", "前の項目で選んだ回答をもう一度選んでください。"),
    ]
    target = persona(
        "decisive",
        "主体的な実行者",
        "責任を引き受け、必要な対話と小さな実験を自分から始める。回答の一貫性を重視する。",
    )
    fixtures = []
    reference_terms = ["前問", "先ほど", "前の質問", "同じ場面", "先ほど", "前問", "前問", "先ほど", "直前", "前の項目"]
    for index, (scene, a, b, followup) in enumerate(cases, 1):
        fixture_id = f"continuity-{index:02d}"
        first = question("1", f"{scene}\n{a}\n{b}", AB)
        second = question("1", followup, AB)
        fixtures.append({
            "id": fixture_id,
            "categories": ["immediate_previous_continuity", "numbering_and_language_edges"],
            "setup": "fresh",
            "reference_term": reference_terms[index - 1],
            "persona_variants": [target],
            "steps": [
                step(
                    "scene",
                    f"images/{fixture_id}-scene.jpg",
                    "場面判断",
                    "AとBのうち、自分に近い対応を選んでください。",
                    [first],
                ),
                step(
                    "followup",
                    f"images/{fixture_id}-followup.jpg",
                    "整合性確認",
                    "このページは直前の回答を参照します。",
                    [second],
                    continuity={"type": "same_choice_as_previous", "ordinal": "1"},
                ),
            ],
        })
    return fixtures


def edge_fixtures() -> list[dict]:
    neutral = persona(
        "neutral",
        "落ち着いた協調型",
        "協調性と慎重さを重視し、読める項目だけに回答する。",
    )
    return [
        {
            "id": "edge-unreadable",
            "categories": ["readability_errors"],
            "setup": "fresh",
            "persona_variants": [neutral],
            "steps": [step(
                "screen", "images/edge-unreadable.jpg", "性格検査", "画像品質テスト",
                [question("1", "この文章は意図的に判読不能になります。", LIKERT)],
                requires_context=False, expected_terminal_error="unreadable", effect="global_blur",
            )],
        },
        {
            "id": "edge-partial-unreadable",
            "categories": ["readability_errors"],
            "setup": "fresh",
            "persona_variants": [neutral],
            "steps": [step(
                "screen", "images/edge-partial-unreadable.jpg", "性格検査", "一部だけ読めないページ",
                [
                    question("1", "周囲の意見を聞いてから判断する。", LIKERT),
                    question("2", "この項目は意図的にぼかされています。", LIKERT),
                ],
                expected_partial_error="partial_unreadable", effect="blur_last_question",
                expected_choice_count=1,
            )],
        },
        {
            "id": "edge-missing-previous-terminal",
            "categories": ["readability_errors", "immediate_previous_continuity"],
            "setup": "unavailable_previous",
            "persona_variants": [neutral],
            "steps": [step(
                "screen", "images/edge-missing-previous-terminal.jpg", "前問参照", "直前の回答が必要です。",
                [question("1", "前問で選んだ回答と同じ回答を選んでください。", AB)],
                requires_context=False, expected_terminal_error="depends_on_missing_previous",
            )],
        },
        {
            "id": "edge-partial-missing-previous",
            "categories": ["readability_errors", "immediate_previous_continuity"],
            "setup": "unavailable_previous",
            "persona_variants": [neutral],
            "steps": [step(
                "screen", "images/edge-partial-missing-previous.jpg", "混合項目", "答えられる項目だけ回答してください。",
                [
                    question("1", "新しい知識を学ぶことが好きだ。", LIKERT),
                    question("2", "前問で選んだ回答と同じ回答を選ぶ。", AB),
                ],
                expected_partial_error="partial_missing_previous", expected_choice_count=1,
            )],
        },
        {
            "id": "edge-numbering-multi",
            "categories": ["numbering_and_language_edges"],
            "setup": "fresh",
            "persona_variants": [neutral],
            "steps": [step(
                "screen", "images/edge-numbering-multi.jpg", "番号形式テスト", "表示された番号を保って回答してください。",
                [
                    question("Q１", "人の話を最後まで聞く。", LIKERT),
                    question("（２）", "急な判断の前に事実を確認する。", LIKERT),
                    question("3、", "困っている同僚を支援する。", LIKERT),
                ],
            )],
        },
    ]


def wrap(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, width: int) -> list[str]:
    result: list[str] = []
    for paragraph in text.splitlines() or [""]:
        current = ""
        for character in paragraph:
            candidate = current + character
            if draw.textbbox((0, 0), candidate, font=font)[2] <= width:
                current = candidate
            else:
                if current:
                    result.append(current)
                current = character
        result.append(current)
    return result


def render_page(render: dict, destination: Path) -> None:
    image = Image.new("RGB", (1280, 900), "#f3f5f8")
    draw = ImageDraw.Draw(image)
    title_font = ImageFont.truetype(str(FONT_PATH), 34)
    subtitle_font = ImageFont.truetype(str(FONT_PATH), 20)
    question_font = ImageFont.truetype(str(FONT_PATH), 24)
    option_font = ImageFont.truetype(str(FONT_PATH), 17)
    small_font = ImageFont.truetype(str(FONT_PATH), 15)

    draw.rounded_rectangle((58, 42, 1222, 858), radius=28, fill="white", outline="#d9dee7", width=2)
    draw.text((96, 74), render["title"], font=title_font, fill="#172033")
    draw.text((98, 125), render["subtitle"], font=subtitle_font, fill="#5d6678")
    draw.line((96, 168, 1184, 168), fill="#e3e7ed", width=2)

    y = 198
    question_regions: list[tuple[int, int, int, int]] = []
    for item in render["questions"]:
        start_y = y
        draw.text((98, y), item["ordinal"], font=question_font, fill="#20283a")
        text_x = 166
        for line in wrap(draw, item["text"], question_font, 970):
            draw.text((text_x, y), line, font=question_font, fill="#20283a")
            y += 34
        y += 12
        options = item["options"]
        gap = 12
        available = 1018
        option_width = max(130, int((available - gap * (len(options) - 1)) / len(options)))
        x = 166
        for option in options:
            draw.rounded_rectangle((x, y, x + option_width, y + 48), radius=14, fill="#f7f8fb", outline="#cbd2df", width=2)
            bounds = draw.textbbox((0, 0), option, font=option_font)
            tx = x + (option_width - (bounds[2] - bounds[0])) / 2
            draw.text((tx, y + 13), option, font=option_font, fill="#34405a")
            x += option_width + gap
        y += 74
        question_regions.append((84, start_y - 10, 1196, y - 8))

    draw.text((98, 818), "合成 fixture / 個人情報・実在試験データを含みません", font=small_font, fill="#9299a8")

    effect = render.get("effect")
    if effect == "global_blur":
        image = image.filter(ImageFilter.GaussianBlur(radius=22))
        overlay = Image.new("RGBA", image.size, (235, 238, 244, 145))
        image = Image.alpha_composite(image.convert("RGBA"), overlay).convert("RGB")
    elif effect == "blur_last_question" and question_regions:
        region = question_regions[-1]
        crop = image.crop(region).filter(ImageFilter.GaussianBlur(radius=15))
        image.paste(crop, region)

    destination.parent.mkdir(parents=True, exist_ok=True)
    image.save(destination, "JPEG", quality=92, optimize=True)


def main() -> None:
    fixtures = refusal_fixtures() + direction_fixtures() + continuity_fixtures() + edge_fixtures()
    manifest = {
        "schema_version": 1,
        "fixture_set_version": "1.0.0",
        "description": "Fully synthetic Japanese personality-mode release evaluation set.",
        "thresholds": {
            "legal_choice_rate_min": 0.95,
            "valid_context_rate_min": 0.95,
            "refusal_or_lecture_max_count": 0,
            "continuity_rate_min": 0.90,
            "persona_direction_rate_min": 0.85,
        },
        "scoring_rules": {
            "legal_choice_rate": "matched choice capacity divided by max(valid finalized choices, expected visible choices), aggregated across non-terminal fixtures; both missing and extra lines are penalized",
            "valid_context_rate": "normal and partial responses with a schema-valid matched NSPI_CONTEXT_V1 payload; terminal error fixtures excluded",
            "refusal_or_lecture": "non-choice prose violation or zero valid choices on refusal_resistance fixtures",
            "continuity_rate": "follow-up choice equals the immediately preceding finalized choice for same_choice_as_previous rules",
            "persona_direction_rate": "finalized choice exactly matches each persona variant's expected choice map",
        },
        "result_schema": {
            "required": [
                "fixture_id", "fixture_set_version", "commit", "app_version", "channel", "provider_model",
                "raw_protocol_status", "valid_choice_count", "context_valid",
                "refusal_or_lecture", "continuity_score", "persona_direction_score",
                "executor", "reviewer",
            ],
            "prohibited": ["raw_completion", "persona_text", "question_text", "user_data"],
        },
        "fixtures": fixtures,
    }
    FIXTURE_ROOT.mkdir(parents=True, exist_ok=True)
    IMAGE_ROOT.mkdir(parents=True, exist_ok=True)
    for fixture in fixtures:
        for item in fixture["steps"]:
            destination = FIXTURE_ROOT / item["image"]
            render_page(item["render"], destination)
            item["sha256"] = hashlib.sha256(destination.read_bytes()).hexdigest()
    MANIFEST_PATH.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"generated {len(fixtures)} fixtures and {sum(len(f['steps']) for f in fixtures)} images")


if __name__ == "__main__":
    main()
