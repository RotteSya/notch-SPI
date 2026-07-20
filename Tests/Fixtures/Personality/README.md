# Personality fixture evaluation

`manifest.json` is the sole source of fixture IDs, hashes, expected protocol behavior, accepted persona-direction choices, and release thresholds. All checked-in JPEGs are synthetic. Regenerate them deterministically with:

```bash
python3 scripts/generate-personality-fixtures.py
swift test --filter PersonalityEvaluationTests.testSyntheticFixtureManifestIsCompleteAndSelfConsistent
```

Raw evaluation JSONL is written below `.eval-results/personality/` and is ignored by Git. It contains only protocol/scoring metadata; raw completions, persona text, question text, API keys, and user data are forbidden.

## Run a channel

The official channel is the release gate. A first pass deliberately uses a pending reviewer and writes the evidence before failing only the sign-off assertion:

```bash
NSPI_RUN_PERSONALITY_EVAL=1 \
NSPI_EVAL_CHANNEL=official \
NSPI_EVAL_EXECUTOR="$USER" \
NSPI_EVAL_REVIEWER=pending-second-review \
NSPI_EVAL_PROVIDER_MODEL='anthropic:claude-opus-4-8' \
swift test --filter PersonalityEvaluationTests.testOfficialPersonalityReleaseGateWhenExplicitlyEnabled
```

For CLI or custom-key baselines, set `NSPI_EVAL_CHANNEL=cli` with `NSPI_EVAL_CLI=claude|codex`, or `NSPI_EVAL_CHANNEL=customKey` with the provider configuration available in the app/Keychain. A full non-official run records metrics without applying official behavior thresholds. Set `NSPI_EVAL_FILTER=<fixture-id-or-category>` to make a selected run a strict protocol-compatibility check.

`NSPI_PERSONALITY_FIXTURES_DIR` may point at a private external fixture directory with the same manifest schema. Never place private images or absolute paths in this repository.

## Second-person review

The reviewer opens the generated Markdown summary, then checks every row in its directionality index against the corresponding synthetic image, persona variant, and `expected_choices` entry in `manifest.json`. After the review, sign and revalidate the existing result without calling the model again:

```bash
NSPI_REVIEW_PERSONALITY_EVAL="$PWD/.eval-results/personality/<result>.jsonl" \
NSPI_EVAL_REVIEWER='<reviewer identity>' \
swift test --filter PersonalityEvaluationTests.testExistingOfficialRecordWhenExplicitlyReviewed
```

Signing only replaces the `reviewer` metadata in that JSONL and regenerates its checked-in-safe Markdown summary. The test also verifies complete manifest coverage, no transport failures, and all five official thresholds.
