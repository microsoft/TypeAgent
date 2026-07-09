<!-- Copyright (c) Microsoft Corporation.
     Licensed under the MIT License. -->

# Inline suppressions for code-quality gate exceptions

**Status:** complete — inline markers implemented in complexity/lint/debt; complexity JSON retired; pre-existing debt grandfathered by the stateless ratchet (no bulk marker migration)
**Area:** `ts/tools/scripts/code/` (the 7-tool analysis suite + CI gates)
**Problem owner:** maintainability roadmap (see `tools/scripts/code/README.md`)

## Problem

Three of the four CI gates record their baseline exceptions by **`file:line`**:

| Tool              | Exception key            | Where                                               |
| ----------------- | ------------------------ | --------------------------------------------------- |
| `code-complexity` | `file:line`              | `complexityReport.ts` → `functionExceptionKey()`    |
| `code-lint`       | `file:line`              | `lintReport.ts` → `exceptionKey()`                  |
| `code-debt`       | `file:line`              | `debtMarkersReport.ts` → `exceptionKey()`           |
| `code-circular`   | canonical cycle path set | `circularDepsReport.ts` → `loadCycleExceptionSet()` |

A `file:line` key is **positional**: any edit _above_ the offender — a Prettier
reflow, a new import, an added comment — shifts its line number, the key stops
matching, the grandfathered debt looks brand-new, and the ratchet/gate fails
spuriously. The committed `complexity-baseline-exception.json` (301 entries) is
also a standing merge-conflict magnet and goes stale the moment anyone reformats.

`code-circular` already avoids this: it keys on the _set of module paths in the
cycle_, canonicalized rotation-invariantly — an intrinsic property of the code,
not its position. That is the model to generalize.

## Goal

Record exceptions in a way that is **immune to reformatting and file moves**,
**self-documenting**, **local to the offending code**, and **lightweight and
AI-fixable** — i.e. inline suppression comments (the pattern the user asked for,
analogous to `// eslint-disable-next-line`), while preserving the suite's core
philosophy: **measure everything; gate only the delta.**

"Lightweight and AI-fixable" is a first-class constraint: applying a suppression
must be a single, local edit an agent (or human) can make right at the offending
line — no central file to reconcile, no issue-tracker round-trip, no hunting down
unrelated markers to "pay" for a new one. This principle is what settles the
decisions below.

### Non-goals

- Changing the thresholds (cyclomatic 25 / cognitive 30) or which rules are gated.
- Changing the ratchet's fundamental HEAD-vs-merge-base, count-based comparison.
- Replacing `code-circular`'s structural key (it already works; see below).

## Background — why exceptions exist at all

The ratchet is **count-based and stateless**: for each changed file it lints
HEAD and the merge base and fails only on a _net increase_ per rule
(`lintReport.ts` → `runRatchet()`). Pre-existing debt is grandfathered for free
because it exists on _both_ sides and cancels out.

The exceptions file is therefore **not** the primary debt suppressor — the
HEAD-vs-base diff is. Its one real job is to cover the case where **git's rename
detection misses a file move**, so the base version of the file isn't found at
its path, its violations aren't subtracted, and pre-existing debt looks "new."

That framing matters: because exceptions are a narrow fallback, we are free to
switch their identity key to anything stable — and inline markers handle the
rename case _better than the JSON file does_, because a marker **moves with the
file** when it's relocated. There is nothing to re-point after a move.

## Proposal — inline suppression markers

Adopt a uniform comment convention, one per tool, placed **on the offending line
(trailing) or the line immediately above it**. Because the marker is attached to
the AST node, Prettier keeps it glued to that node across reflows — positional
fragility disappears by construction.

```
code-<tool>-allow[ <qualifier>]: <reason>
```

- `<tool>` — `complexity` | `lint` | `debt` | `circular`.
- `<qualifier>` — optional, tool-specific (e.g. an ESLint rule id for `lint`).
- `<reason>` — **required, non-empty.** Empty suppressions are rejected so they
  can't rot silently. Optionally enforce an issue reference (`#1234` or a URL).

### Per-tool behavior

**`code-complexity`** — marker on/above the function declaration:

```ts
// code-complexity-allow: large arg-marshaller, tracked in #1234
function buildArgs(/* … */) {
  /* … */
}
```

When the tool finds an over-budget function, it scans upward from the function's
start line past contiguous comment/decorator lines (stopping at the first blank
line or code) for the marker. Attached ⇒ excluded from the **gate**, but still
**counted and shown in the report** (see "measure vs gate" below).

**`code-lint`** — marker trailing the violation, optional rule qualifier:

```ts
const raw = payload as any; // code-lint-allow no-explicit-any: third-party shape
```

Omitting the rule allows any gated rule on that line; naming it scopes the
suppression to that one rule (preferred).

**`code-debt`** — marker on/above the focused/skipped test or TODO:

```ts
// code-debt-allow: platform-specific, re-enable after #1234
it.skip("windows-only path", () => {
  /* … */
});
```

The regex scanner already reads line context; it checks the marker line the same
way it counts the marker.

**`code-circular`** — a cycle is a _whole-graph_ property with no single line, so
this is the weak fit. Two options: (a) **keep the structural JSON key** (it's
already reformatting-proof — no change needed), or (b) additionally honor a
marker on the single **import edge that closes the cycle**:

```ts
import { thing } from "./legacy"; // code-circular-allow: legacy cycle, see #1234
```

Recommendation: keep JSON as the source of truth for circular; treat the inline
edge marker as an optional convenience.

### Measure vs. gate — the critical semantic

There are two _different_ things a suppression can mean, and the suite must keep
them distinct:

| Mechanism                                   | Effect                                                                                                           | Use                                                                                  |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Native `// eslint-disable-next-line <rule>` | Removes the message from **ESLint output entirely** → the offender vanishes from CSV/JSON/HTML **and** the gate. | Avoid for gate exceptions — it hides the metric and makes the baseline dishonest.    |
| Tool marker `// code-<tool>-allow: …`       | Offender is **still measured and reported**; excluded **only from the gate/ratchet**.                            | **Preferred.** Keeps the number honest and the debt visible while unblocking the PR. |

Today neither ESLint gate sets `linterOptions.noInlineConfig`, so
`eslint-disable` directives are **already silently honored** — which means they
already remove offenders from the _reports_, not just the gates. The proposal
makes the intended path explicit: the tool marker filters at the **ratchet
stage** (after measurement), so a suppressed function still appears in
`complexity-report/` with its real 179/232 numbers; it simply doesn't trip the
gate. (Optionally set `noInlineConfig: true` so raw `eslint-disable` can't
quietly shrink the measured baseline out from under the ratchet.)

### Keeping the audit trail

The one genuine advantage of a central JSON file is "see all debt in one place."
Restore it without committing a file:

- **`--list-suppressions`** on each tool (and a roll-up) enumerates every active
  marker as CSV/JSON — `file`, enclosing symbol, `<reason>`, issue ref —
  generated on demand.
- **Unused-suppression reporting**: a marker that no longer sits on an offender
  is stale; report it (and optionally fail in a `--strict`/cleanup mode, mirroring
  ESLint's `reportUnusedDisableDirectives`) so suppressions get pruned.
- **Suppression count (reported, not ratcheted)**: trend the total in reports; a
  hard budget is intentionally avoided so a needed suppression never blocks a PR
  (see Decisions §2).

## Inline vs. sidecar JSON — tradeoffs

|                                      | Inline markers                 | `file:line` JSON (today)                      |
| ------------------------------------ | ------------------------------ | --------------------------------------------- |
| Survives Prettier / line shifts      | ✅ anchored to AST node        | ❌ breaks immediately                         |
| Survives file move / rename          | ✅ moves with the file         | ❌ needs re-pointing (its main purpose today) |
| Reason visible in review & blame     | ✅ next to the code            | ⚠️ in a separate file                         |
| Auto-deleted when code is deleted    | ✅                             | ❌ goes stale                                 |
| Merge-conflict surface               | ✅ none central                | ❌ 301-entry hotspot                          |
| One place to audit all debt          | ⚠️ needs `--list-suppressions` | ✅ inherent                                   |
| Touches production source            | ❌ adds comments to code       | ✅ code untouched                             |
| Fits a whole-graph metric (circular) | ❌ no single line              | ✅ natural                                    |

## Recommendation

1. **Primary mechanism = inline `code-<tool>-allow: <reason>` markers** for
   `complexity`, `lint`, and `debt`. Gate-only semantics (still measured/reported).
2. **Require a non-empty reason**; issue ref optional (expected for `code-debt`
   skips — see Decisions §1).
3. **Keep `code-circular` on its structural key**; optionally honor an inline
   edge marker as a convenience.
4. Add **`--list-suppressions`** and **unused-suppression reporting** to preserve
   auditability and prevent rot.
5. **Leave native `eslint-disable` honored** (parity with real builds); do _not_
   set `noInlineConfig: true` yet. Instead, _report_ `eslint-disable` of gated
   rules in changed files so it can't be a silent bypass (see Decisions §4).

## Migration

### Decision — retire the JSON, don't bulk-migrate

The **only committed exception data was `complexity-baseline-exception.json`
(301 entries)** — the sole exception file CI passed (`build-ts.yml` → _Complexity
ratchet_). The other three gates support `--exceptions-file` but carry no
committed data.

The obvious plan was to convert all 301 entries into inline markers. We built and
ran that converter (299 functions across 206 files) — then **reverted it**,
because it produced a 200+-file diff for almost no benefit:

- The complexity ratchet is **stateless**: it lints each changed file at HEAD
  _and_ the merge base and fails only on a net increase. **Pre-existing debt is
  already grandfathered by the diff** — a function over budget on both sides
  cancels out. The JSON's only extra job was covering git rename-misses, and that
  job was already unreliable because it keyed on line numbers (the very fragility
  this design set out to remove).
- So bulk-marking every pre-existing offender is belt-and-suspenders: churn
  without grandfathering the ratchet doesn't already provide.

**Final approach:**

- **Retire the JSON.** Delete `complexity-baseline-exception.json` and
  `updateComplexityBaselineExceptions.mjs`; drop `--exceptions-file` from the
  `build-ts.yml` Complexity-ratchet step and the `code-complexity:ci` script;
  delete the `code-complexity:update-exceptions` script. The ratchet now
  grandfathers pre-existing complexity debt purely via its stateless diff.
- **Add inline-marker support to all three ESLint/scan gates** (done and
  validated end-to-end), but **do not bulk-insert markers**. A marker is added
  _reactively_, one file at a time, only where actually needed — a rename-miss
  false positive, or a deliberate one-off grandfather — matching the lightweight
  / AI-fixable goal.
- **Keep the JSON loaders as a deprecated fallback for one release** — passing
  `--exceptions-file` still works but prints a deprecation notice; `code-circular`
  keeps the JSON as its primary mechanism (a cycle has no single line to
  annotate).

### Docs

`tools/scripts/code/README.md` describes inline markers as the reactive
suppression mechanism and notes the complexity ratchet grandfathers pre-existing
debt via its stateless diff.

## Decisions

Resolved in favor of the **lightweight / AI-fixable** goal above — every
suppression should be a single local edit an agent can make at the offending
line, and nothing here should ever block a PR from _adding_ one.

1. **Reason required; issue ref optional.** Every marker needs a non-empty
   `<reason>` (enforce a minimum length; reject placeholders like `temp`/`fixme`).
   An issue reference is _optional_ in general but _expected for `code-debt`
   skips_, since those are inherently temporary; support an optional parsed form
   `code-debt-allow(#1234): reason`. Mandating a tracked issue everywhere is
   rejected — it spawns dead "won't-fix" tickets for permanent-by-design cases (a
   lexer, generated code), couples us to one tracker, and adds a round-trip an
   agent can't complete on its own.
2. **Report the suppression count; do not ratchet it.** Trend the number in
   reports and rely on unused-suppression reporting to prevent rot. A hard budget
   ratchet is rejected: it conflicts with the feature's purpose (suppressions
   exist to _unblock_ a PR), is awkward on a changed-files diff (the new marker
   lives in the PR's own files, so it's always +1), and would force an agent to
   delete unrelated markers to "pay" for a needed one — the opposite of
   lightweight. If sprawl is ever observed, add a soft PR-comment delta first.
3. **Require the rule qualifier on `code-lint` markers.** `code-lint-allow
<rule>: reason`, allowing a comma-separated list for the rare multi-rule line.
   Scoping keeps the gate precise — a _new_, unrelated violation on the same line
   still fails — and mirrors ESLint's own idiom. The small extra friction is
   trivially AI-fixable: the agent already knows the rule id it is suppressing.
4. **Do not flip `noInlineConfig` (for now).** Leave native `eslint-disable`
   honored so the gate stays in parity with real builds and the editor — no
   divergence, no double-annotation, nothing new for an agent to learn. To keep
   it from being a _silent_ bypass, detect and report `eslint-disable` of gated
   rules in changed files (and use ESLint's `-- description` syntax to require a
   reason there too). Revisit `noInlineConfig: true` only if that reporting shows
   the escape hatch is being abused.
