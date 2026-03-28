# Forward/Backward Equivalence Table

Given `input` and `matchPrefixLength` P, does
`completion(input[0..P], "forward")` produce the same result as
`completion(input[0..P], "backward")`?

The answer depends on **where P lands** in the grammar structure, the
**separator mode**, and whether there is a **trailing separator** after
the last matched item.

**Terminology:**

- **Committed:** a separator character follows the last matched
  word/wildcard in `input[0..P]`
  (i.e. `nextNonSeparatorIndex(input[0..P], endIndex) > endIndex`).
- **Uncommitted:** the last matched item runs to end-of-string with no
  trailing separator.

---

## 1. P at a keyword boundary (between parts)

| Separator Mode                                | Preceding wildcard? | Trailing separator?          | Forward = Backward? | Why                                                                     |
| --------------------------------------------- | ------------------- | ---------------------------- | ------------------- | ----------------------------------------------------------------------- |
| `required` / `auto` (word-space scripts)      | No                  | Committed                    | **Yes**             | Separator commits the word; backward has nothing to reconsider          |
| `required` / `auto` (word-space scripts)      | No                  | Uncommitted (keyword at EOI) | **No**              | Backward backs up to re-offer the keyword; forward offers the next part |
| `optional` / `auto` (CJK / non-word-boundary) | No                  | Committed                    | **Yes**             | Separator commits                                                       |
| `optional` / `auto` (CJK / non-word-boundary) | No                  | Uncommitted                  | **No**              | Backward backs up; forward advances                                     |
| `none`                                        | No                  | N/A (no separators)          | **No**              | `couldBackUp` is always `true` when `spacingMode === "none"`            |

## 2. P inside a multi-word keyword (between words of one keyword)

| Separator Mode      | Trailing separator after word K?   | Forward = Backward? | Why                                                          |
| ------------------- | ---------------------------------- | ------------------- | ------------------------------------------------------------ |
| `required` / `auto` | Committed (separator after word K) | **Yes**             | Separator commits word K; `couldBackUp` is false             |
| `required` / `auto` | Uncommitted (word K at EOI)        | **No**              | Backward backs up to `prevEndIndex`; forward offers word K+1 |
| `optional`          | Committed                          | **Yes**             | Separator commits                                            |
| `optional`          | Uncommitted                        | **No**              | Backward reconsiders word K                                  |
| `none`              | N/A                                | **No**              | `spacingMode === "none"` ⇒ `couldBackUp` always true         |

## 3. P at a wildcard-keyword boundary (wildcard finalized at EOI, next part is string)

| Separator Mode | Partial keyword inside wildcard?                        | Forward = Backward? | Why                                                                                                             |
| -------------- | ------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------- |
| non-`none`     | No partial keyword                                      | **No**              | Forward defers to Phase B (offers keyword at `prefix.length`); backward backs up to wildcard start              |
| non-`none`     | Yes, at position Q < P                                  | **Yes**             | Both directions find the partial keyword via `findPartialKeywordInWildcard` at Q; `partialKeywordAgrees = true` |
| non-`none`     | Yes, at position Q = P (full first keyword word at EOI) | **No**              | Forward uses it; backward rejects (requires Q < `state.index`) and falls through to `collectBackwardCandidate`  |
| `none`         | Any                                                     | **No**              | `none` mode makes `couldBackUp` always true                                                                     |

## 4. P inside a wildcard (no keyword boundary reached)

| Separator Mode | What follows P?                                  | Forward = Backward?                      | Why                                                                                        |
| -------------- | ------------------------------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------ |
| any            | Non-separator text (Category 3a)                 | **No**                                   | Forward: property completion for wildcard slot; backward: backs up to last matched keyword |
| any            | Separator only / nothing (wildcard just started) | **No** (if `lastMatchedPartInfo` exists) | Backward can reconsider the preceding keyword                                              |

## 5. P = 0 (nothing matched)

| Scenario                                     | Forward = Backward? | Why                                                                                        |
| -------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------ |
| Partial match of first keyword (Category 3b) | **Yes**             | `couldBackUp = false` (no words fully matched); backward falls through to forward behavior |

## 6. P = input.length, all parts matched (Category 1: exact match)

| Scenario            | Forward = Backward? | Why                                                                    |
| ------------------- | ------------------- | ---------------------------------------------------------------------- |
| All parts satisfied | **Yes**             | Both directions use `tryCollectBackwardCandidate` — direction-agnostic |

---

## Decision Tree

```
Is P = 0?
  └─ Yes → SAME (nothing to reconsider)

Is P = input.length AND all parts matched (Category 1)?
  └─ Yes → SAME (direction-agnostic)

Is spacingMode = "none"?
  └─ Yes → DIFFERENT (couldBackUp is always true in "none" mode)

Is there a separator after the last matched item at P?
  (nextNonSeparatorIndex(input[0..P], endIndex) > endIndex)
  ├─ Yes (committed) → SAME
  └─ No (uncommitted / at EOI) →
      Is P at a wildcard-keyword boundary AND
      findPartialKeywordInWildcard found a partial keyword
      strictly inside the wildcard (position < P)?
        ├─ Yes → SAME (partialKeywordAgrees = true)
        └─ No → DIFFERENT (backward backs up)
```

**Key insight:** The separator is the universal "commit" mechanism.
Once `input[0..P]` ends with a separator after the last matched item,
the position is committed and both directions agree. Without that
separator (including `none` mode where separators don't exist),
backward has the option to reconsider — and the directions diverge.
