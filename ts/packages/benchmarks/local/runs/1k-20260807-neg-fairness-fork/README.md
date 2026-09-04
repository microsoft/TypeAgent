# 1k neg-fairness — fork with list.addItems value defects

Fork of the negative-fairness benchmark of record, extended with two
benchmark-proven `list.addItems` value-correctness defects.

## Source

Forked from `1k-20260807-neg-fairness/artifacts/benchmark-approved-1000.jsonl`
(932 cases, 905 unique positive + 905 unique negative utterances, scored on
`azure/gpt-5.4-nano`, `azure/gpt-4.1`, `azure/gpt-4.1-mini`).

## Added

50 new cases (100 generalizations, balanced 50 positive + 50 negative), each a
single-action `list.addItems` request. The action is always correct; the defect
is the `items[]` array content. Ground: `agents/list/src/listSchema.ts`
`AddItemsAction` — `items: string[]` with no quantity field and no
cardinality/dedupe contract.

- **F1 — conjunction drop**: "Add socks, shirts, and pants..." collapses to
  `["socks"]` or empties. nano 47.1%→22.2% repro, mini 8%→4%; mini control 0%.
- **F2 — quantity expansion**: "Add 3 apples..." expands to
  `["apples","apples","apples"]`; "a dozen eggs" → 12× "egg". nano 60%→80%
  repro, mini 16%→12%; controls ≤4.8%.

Both confirmed on both azure models across an initial ladder and an independent
reproduction run, `history=undefined`, 100% `emptyHistoryProven`. Full evidence:
`500-fpr-repro/artifacts/value-probes/`.

## File

`benchmark-approved-1000-plus-list-defects.jsonl` — same record format as the
source (one metadata record, then case records). New cases carry
`dimensions.issue` = `F1-list-conjunction-drop` | `F2-list-quantity-expansion`.
Tracked with Git LFS.
