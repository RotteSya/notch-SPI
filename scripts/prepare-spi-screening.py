#!/usr/bin/env python3
"""Local material preparation only. Existing Pillow, no network or credential access.

Only passage/stem/options and reviewed original figures may reach a rendered input.
Gold, explanations, Chinese titles and provenance remain outside model input pixels.
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
REVIEW = ROOT / 'output/spi-ja-review-20261117'
DEST = ROOT / 'output/spi-screening-20261117'
OLD_IDS = ['M02', 'M03', 'M04', 'M05', 'M08', 'M09', 'C01', 'C05']
NEW_IDS = ['P01', 'R01', 'R02', 'R03', 'F01', 'F02', 'F03', 'F04']
WIDTH, MARGIN, FONT_SIZE, LINE_HEIGHT = 1200, 64, 28, 44


def offline(event, args):
    if event.startswith('socket.') or event in ('subprocess.Popen', 'os.system', 'os.posix_spawn'):
        raise RuntimeError('Material preparation is offline')


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load(path):
    return json.loads(path.read_text())


def immutable_json(path, value):
    data = (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode()
    if path.exists():
        assert path.read_bytes() == data, 'Existing material differs; do not overwrite a frozen input'
    else:
        path.write_bytes(data)


def input_content(q):
    # Deliberate allowlist; do not pass the source object to the renderer.
    return {'passage': q['passage_ja'], 'stem': q['stem_ja'],
            'options': q['options_ja'],
            'figures': [{'path': str((REVIEW / 'candidate-update' / f['path']).relative_to(ROOT)),
                         'sha256': f['sha256']} for f in q['images']]}


def render(content, font, destination):
    probe = ImageDraw.Draw(Image.new('RGB', (1, 1)))
    operations = []
    y = MARGIN
    def text(paragraph, gap=14):
        nonlocal y
        line = ''
        for char in paragraph:
            if probe.textlength(line + char, font=font) > WIDTH - 2 * MARGIN:
                operations.append(('text', line, MARGIN, y))
                y += LINE_HEIGHT
                line = ''
            line += char
        if line:
            operations.append(('text', line, MARGIN, y))
            y += LINE_HEIGHT
        y += gap
    for para in content['passage'].splitlines():
        text(para)
    text(content['stem'], 24)
    for ref in content['figures']:
        file = ROOT / ref['path']
        assert sha(file) == ref['sha256']
        im = Image.open(file).convert('RGB')
        assert im.width <= WIDTH - 2 * MARGIN, 'Never silently resize an original figure'
        operations.append(('figure', im, (WIDTH - im.width) // 2, y))
        y += im.height + 24
    for i, option in enumerate(content['options']):
        # Source numeric options are HTML ordered lists; preserve their displayed order.
        label = f'{i + 1}. ' if content['passage'] else ''
        text(label + option)
    canvas = Image.new('RGB', (WIDTH, y + MARGIN), 'white')
    draw = ImageDraw.Draw(canvas)
    for kind, value, x, top in operations:
        if kind == 'text':
            draw.text((x, top), value, font=font, fill='black', anchor='lt')
        else:
            canvas.paste(value, (x, top))
    # Render to memory to compare a repeated preparation without replacing files.
    import io
    buffer = io.BytesIO()
    canvas.save(buffer, format='PNG', optimize=False)
    data = buffer.getvalue()
    if destination.exists():
        assert destination.read_bytes() == data, 'Rendered bytes drifted'
    else:
        destination.write_bytes(data)
    return {'width': canvas.width, 'height': canvas.height, 'draw_operations': len(operations),
            'drawn_character_count': sum(len(v) for k, v, _, _ in operations if k == 'text')}


def main(write=False):
    sys.addaudithook(offline)
    old = {q['id']: q for q in load(REVIEW / 'suitability-review/question-review.json')['questions']}
    assessed = {q['id']: q for q in load(REVIEW / 'candidate-update/existing-question-assessment.json')['questions']}
    new = {q['id']: q for q in load(REVIEW / 'candidate-update/new-candidates.json')['questions']}
    if not write:
        return {'mode': 'dry-run', 'old': OLD_IDS, 'new': NEW_IDS, 'count': 16,
                'spi_direction': 12, 'cab_extension': 4, 'network': False}
    inputs = DEST / 'inputs'
    inputs.mkdir(exist_ok=True)
    font_path = next(p for p in Path('/System/Library/Fonts').glob('*.ttc')
                     if 'W3' in p.name and '角' in p.name)
    font = ImageFont.truetype(str(font_path), FONT_SIZE)
    rows, render_records = [], []
    for ident in OLD_IDS + NEW_IDS:
        is_old = ident in old
        q = old[ident] if is_old else new[ident]
        if is_old:
            assert assessed[ident]['recommendation'] == '推荐保留'
            title = assessed[ident]['title_zh']
            images = []
            for original in q['images']:
                file = REVIEW / original['path']
                assert sha(file) == original['sha256']
                with Image.open(file) as im:
                    width, height = im.size
                images.append({'path': str(file.relative_to(ROOT)), 'sha256': sha(file),
                               'media_type': 'image/png', 'width': width, 'height': height})
            gold = str(q['gold_choice'])
            category = 'statistical_chart' if ident.startswith('C') else 'calculation'
            source_number = q['original_question_number']
            provenance = 'government_exam_not_SPI'
            input_kind = 'existing_original_exam_page_or_crop'
            scoring_note = 'Official published choice, assistant checked; no independent human key signoff.'
        else:
            title = q['title_zh']
            content = input_content(q)
            immutable_json(inputs / f'{ident}.content.json', content)
            file = inputs / f'{ident}.png'
            rendered = render(content, font, file)
            render_records.append({'id': ident, **rendered, 'content_sha256': sha(inputs / f'{ident}.content.json')})
            images = [{'path': str(file.relative_to(ROOT)), 'sha256': sha(file), 'media_type': 'image/png',
                       'width': rendered['width'], 'height': rendered['height']}]
            gold = q['gold_label']
            category = 'cab_figural' if ident.startswith('F') else 'reading' if ident.startswith('R') else 'calculation'
            source_number = q['source_question_number']
            provenance = 'publisher_CAB_style_practice_not_SPI' if ident.startswith('F') else 'publisher_SPI_style_practice_not_verified_real_exam'
            input_kind = 'web_text_typeset_with_unscaled_original_figures' if q['images'] else 'web_text_typeset_not_exam_screenshot'
            scoring_note = 'Publisher answer, assistant checked; no independent human key signoff.'
            if ident == 'P01':
                scoring_note += ' Profit divided by cost: 8800/20000=44%, choice D. Stem does not explicitly name denominator; keep unchanged and disclose.'
        labels = ['A', 'B', 'C', 'D'] if ident in ['F03', 'F04'] else ['A', 'B', 'C', 'D', 'E'] if ident.startswith('F') or ident == 'P01' else ['1', '2', '3', '4', '5']
        assert gold in labels
        rows.append({'id': ident, 'title_zh': title, 'status': 'available', 'group': 'cab_extension' if ident.startswith('F') else 'spi_direction',
                     'category': category, 'language': 'ja', 'kind': 'single_choice', 'origin': provenance,
                     'previously_seen': True, 'seen_note': 'Assistant reviewed during preparation; no claim about model training or new paid model exposure.',
                     'image_quality': input_kind, 'images': images, 'source': q['source'], 'source_question_number': source_number,
                     'source_record': {'path': str((REVIEW / ('suitability-review/question-review.json' if is_old else 'candidate-update/new-candidates.json')).relative_to(ROOT)),
                                       'id': ident},
                     'expected': {'expectation': 'answerable', 'state': 'ready', 'reason': 'none',
                                  'accepted_answers': [gold], 'answer_scoring': {'mode': 'literal'} if labels[0] == '1' else {'mode': 'label_set', 'labels': labels}},
                     'gold_status': 'official_answer' if is_old else 'publisher_answer', 'solution_zh': q['solution_zh'],
                     'scoring_note': scoring_note, 'assistant_key_check': 'completed', 'human_key_signoff': 'not_provided',
                     'user_direction_and_difficulty_approved': True, 'user_key_signoff_inferred': False,
                     'external_processing_approved': False,
                     'rights_status': 'existing_PDL_basis_user_dispatch_pending' if is_old else 'attributed_reproduction_basis_AI_processing_scope_unconfirmed'})
    assert len(rows) == 16 and sum(len(q['images']) for q in rows) == 16
    manifest = {'schema_version': 1, 'id': 'spi-screening-20261117', 'status': 'prepared_pending_paid_and_material_authorization',
                'approved_calls': 0, 'count': 16, 'groups': {'spi_direction': 12, 'cab_extension': 4},
                'remaining_reading_gap': 7, 'no_further_search_or_synthesis': True, 'excluded_old_ids': ['M01','M06','M07','C02','C03','C04','C06','C07','C08','C09','C10'],
                'questions': rows}
    immutable_json(DEST / 'cases.json', manifest)
    immutable_json(DEST / 'render-provenance.json', {'font': str(font_path), 'font_sha256': sha(font_path),
                   'width': WIDTH, 'font_size': FONT_SIZE, 'line_height': LINE_HEIGHT,
                   'input_fields_only': ['passage', 'stem', 'options', 'figures'], 'source_figures_not_resized': True,
                   'gold_and_explanation_excluded_from_pixels': True, 'records': render_records})
    return {'mode': 'local-preparation', 'questions': len(rows), 'images': 16,
            'rendered': len(render_records), 'network': False}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    print(json.dumps(main(args.write), ensure_ascii=False))
