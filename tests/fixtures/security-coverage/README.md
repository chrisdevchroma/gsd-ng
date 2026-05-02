# Security Coverage Fixtures

Pinned snapshot fixtures used by `tests/security-coverage.test.cjs` to assert
that `scanForInjection` (gsd-ng/bin/lib/security.cjs) detects representative
attack samples and avoids flagging benign multi-language content.

Tests run fully offline against the JSONL files committed in this directory.

## Fixture entry shape

Every line in every `*.jsonl` file is a JSON object with these fields:

```
{ "id": "string (unique within file)",
  "source_dataset": "Lakera/gandalf_ignore_instructions" | "deepset/prompt-injections" | "garak/promptinject" | "hand-authored",
  "text": "string (the prompt under test)",
  "expected_label": 0 | 1,
  "attack_family": "string (e.g. direct-injection, benign, multilingual-direct-injection, homoglyph-evasion, goal-hijacking, prompt-leaking, context-reset, authority-claim, roleplay-framing)"
}
```

`expected_label` semantics:
- `0` — benign content that MUST NOT be flagged (false-positive guard)
- `1` — attack content that MUST be flagged at one of the recognised tiers

## Sources

| File | Source dataset | License | URL |
|------|----------------|---------|-----|
| `lakera-gandalf-sample.jsonl` | Lakera/gandalf_ignore_instructions | MIT | https://huggingface.co/datasets/Lakera/gandalf_ignore_instructions |
| `deepset-injection-sample.jsonl` | deepset/prompt-injections | Apache-2.0 | https://huggingface.co/datasets/deepset/prompt-injections |
| `garak-promptinject-sample.jsonl` | NVIDIA/garak — promptinject probe | Apache-2.0 | https://github.com/NVIDIA/garak |
| `multilang-patterns.jsonl` | hand-authored | (this repo) | n/a |
| `homoglyph-patterns.jsonl` | hand-authored (added by Plan 50-02) | (this repo) | n/a |

Full license texts: see [LICENSE](./LICENSE).

## Refresh procedure

Fixtures are pinned snapshots. To refresh:

1. Re-export from the source dataset using its native field names.
2. Reshape each row into the schema above:
   - Lakera Gandalf: `text` → `text`, all rows `expected_label: 1`, `attack_family: "direct-injection"`.
   - deepset: `label=0` → `expected_label: 0, attack_family: "benign"`; `label=1` → `expected_label: 1, attack_family: "direct-injection"`.
   - Garak promptinject: rogue-string template → `text`; `attack_family ∈ {"goal-hijacking","prompt-leaking"}`.
3. Replace the file in this directory; re-run `npm test` from `gsd-ng/`.

`source_dataset` strings MUST match the canonical values exactly — the test
suite asserts on them.

Combined fixture size budget: under 500 KB across all `*.jsonl` files.
