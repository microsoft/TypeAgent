# RFC: AGR `?` / `*` / `+` Quantifier Semantics

**Status:** Open for design review (Curtis)  
**Related:** [PR #2765](https://github.com/microsoft/TypeAgent/pull/2765) (parser: bare `<Rule>?`), companion draft PR (grammar files: wrap as `(<Rule>)?`)  
**One-pager** — code > prose. Pick **A** or **B**.

---

## 1. Bug that started this

Authors write what regex/EBNF muscle memory suggests. Parser does something else.

```agr
// Author intent: optional polite prefix
<Polite> = "please" | "could you" | "can you" | "kindly";
<Start>  = <Polite>? "open outlook"
    -> { actionName: "openApp", parameters: { app: "outlook" } };
```

```text
// Actual AST on main today (bare <Polite>?):
[
  { type: "ruleReference", name: "Polite", optional: false },
  { type: "string", value: ["?", "open", "outlook"] }   // "?" is a LITERAL token
]

// Match results:
"open outlook"          → no match   // missing literal "?"
"please open outlook"   → no match   // missing literal "?"
"please ? open outlook" → match      // nonsense
```

```agr
// Works today — only after ")":
<Start> = (<Polite>)? "open outlook" -> { ... };
// Also works:
$(units:<UnitsSpec>)?
(the | a)?
```

Repo evidence (pre-fix): ~16 bare `<Name>?` sites across email/weather/video/code/calendar test grammars, all author-intent optional, all broken the same way. Built-in category docs already warn:

```ts
// builtInGrammarCategories.ts
// Usage in patterns: (<CategoryName>)?   (note: (<Name>)? not <Name>? — bare optional not yet supported)
```

Meanwhile `sample.agr` documents the *opposite* aspiration:

```agr
// ts/extensions/agr-language/sample.agr  (misleading today)
<Operators> =
    one? two* three+ four  // claimed: optional / * / +
  | (item)+
  | (prefix)* suffix;
// Reality on main: "one?" is the literal token "one?"
```

---

## 2. Why the grammar is this way (Curtis)

```text
Goal: natural-language patterns should accept "?" without escaping.

  what is the time?          // "?" is punctuation in the utterance
  what is the singer for song <song>?   // same

So "?" is mostly a *string character*, not a reserved operator.

Quantifier meaning is deliberately gated:
  after ")"  →  optional / * / +     // )?, )*, )+
  after ">)" in $(...)?              // already special-cased
  after ">"  →  NOT a quantifier today
  after word →  NOT a quantifier today
```

```ts
// grammarRuleParser.ts — expressionsSpecialChar (main)
// "?" "*" "+" are intentionally ABSENT
export const expressionsSpecialChar = [
  "|", "(", ")", "<", ">", "$", "-", ";",
  "{", "}", "[", "]",
];

// Only these forms set optional/repeat today:
//   ( ... )?   ( ... )*   ( ... )+
//   $(name:type)?
```

---

## 3. Two designs

### Design A — Keep group-gated quantifiers (status quo + fix authors)

**Rule:** `?` / `*` / `+` are quantifiers **only** immediately after `)`. Everywhere else they are literal characters in string tokens.

```agr
// ── Canonical optional forms (A) ──────────────────────────────────
(<Polite>)?                      // optional rule ref
$(units:<UnitsSpec>)?            // optional capture (already)
(the | a)?                       // optional words
("please" | "kindly")?           // optional quoted alts

// ── Literal "?" (no escape needed) ────────────────────────────────
what is the time?                // matches utterance ending in ?
what is the singer for song <SongName>?
"really?"                        // quoted literal including ?

// ── Illegal / broken author forms under A (must rewrite) ──────────
<Polite>?                        // BROKEN → becomes literal "?"
<TimeSpec>?                      // BROKEN
one?                             // BROKEN → token "one?"
```

**This PR (grammar-only):** rewrite broken sites to the canonical form. No parser change.

```diff
- <VideoPhrase> = <Polite>? <CreateVerb> <VideoTarget> <VideoContent>? | ...
+ <VideoPhrase> = (<Polite>)? <CreateVerb> <VideoTarget> (<VideoContent>)? | ...

- <getCurrentConditions> = <Polite>? <CurrentWeatherPatterns> $(location:<LocationSpec>) $(units:<UnitsSpec>)?
+ <getCurrentConditions> = (<Polite>)? <CurrentWeatherPatterns> $(location:<LocationSpec>) $(units:<UnitsSpec>)?

- <scheduleEvent> = ... <DateSpec> <TimeSpec>? <LocationSpec>? <ParticipantSpec>? -> { ... }
+ <scheduleEvent> = ... <DateSpec> (<TimeSpec>)? (<LocationSpec>)? (<ParticipantSpec>)? -> { ... }

- <showSourceControl> = ... <PanelRef>? -> { ... }
+ <showSourceControl> = ... (<PanelRef>)? -> { ... }
```

Files touched (6):

```text
ts/packages/agents/email/src/emailSchema.agr
ts/packages/agents/weather/src/weatherSchema.agr
ts/packages/agents/video/src/videoSchema.agr
ts/packages/agents/code/src/vscode/displaySchema.agr
ts/packages/agentSdkWrapper/test/calendar-new.agr
ts/packages/agentSdkWrapper/test/calendar-extended.agr
```

**Make the footgun obvious (A hardening, optional follow-ups):**

```ts
// Option A1 — lint / compile warning (recommended if we stay on A)
// After parsing a ruleReference, if next non-ws char is '?' | '*' | '+':
//   warn: `<Polite>?` is not optional; did you mean `(<Polite>)`?`
//         Literal '?' will be required in the utterance.

// Option A2 — hard error in strict mode / CI policy check on .agr
//   fail on /<[A-Za-z][A-Za-z0-9_]*>[?*+]/
//   fail on bare word quantifiers if we never intend them

// Option A3 — docs + sample.agr alignment
//   delete "one? two* three+" claim; show only ()? forms
```

```agr
// After A1 warning, author sees:
//   emailSchema.agr(29,19): warning: bare '<Polite>?' does not make the
//   rule optional; '?' is a literal. Use '(<Polite>)?' instead.
```

**Pros / cons (A)**

```text
+ Zero parser/matcher risk; "?" stays free as NL punctuation
+ Matches intentional design + existing $(...)? / ()? special cases
+ Migration is mechanical and already done for known sites
− Authors keep hitting the footgun (regex muscle memory)
− sample.agr / mental model diverge from EBNF/regex
− Asymmetry: $(x)? works, <X>? does not (unless grouped)
```

---

### Design B — Reserved quantifiers (opinionated, consistent)

**Rule:** postfix `?` / `*` / `+` always mean optional / zero-or-more / one-or-more when they follow a complete sub-expression atom. Literal `?` requires a quote or escape.

```agr
// ── Atoms that accept a postfix quantifier ────────────────────────
<Polite>?                        // == (<Polite>)?
<Polite>*                        // == (<Polite>)*
<Polite>+                        // == (<Polite>)+
$(units:<UnitsSpec>)?            // unchanged
(the | a)?                       // unchanged
the?                             // optional word "the"
"please"?                        // optional exact token please

// ── Literal "?" must be explicit ──────────────────────────────────
"what is the time?"              // whole phrase incl. ?
what is the time\?               // escaped single char
// bare:  what is the time?      // PARSE ERROR or "time" optional + stray?
```

```ts
// Parser sketch (B) — after every atom, try readQuantifier()
type Quantifier = { optional?: true; repeat?: true }; // ? | * | +

function readQuantifier(): Quantifier | undefined {
  if (isAt("?")) { skip(1); return { optional: true }; }
  if (isAt("*")) { skip(1); return { optional: true, repeat: true }; }
  if (isAt("+")) { skip(1); return { repeat: true }; }
  return undefined;
}

// Apply after:
//   parseRuleName()     → <Name>  + quant?
//   parseGroup()        → ( ... ) + quant?     // already
//   parseVariable()     → $(...)  + quant?     // already for ?
//   parseStrAtom()      → word | "quoted" + quant?   // NEW
```

```ts
// expressionsSpecialChar (B) — promote quantifiers to special
export const expressionsSpecialChar = [
  "|", "(", ")", "<", ">", "$", "-", ";",
  "{", "}", "[", "]",
  "?", "*", "+",          // NEW — stop string runs before quantifier
];
```

```agr
// Realistic agent patterns under B
<Start> =
    <Polite>? open <App>                              // polite optional
  | what is the time\?                                // literal ?
  | what is the singer for song <SongName>\?          // literal ?
  | show <Owner>? files                               // optional owner
  | tag <Label>+                                      // one or more labels
  | mute (notifications)?                             // group still fine
  ;
```

```ts
// Breakage audit for B (what to search before flipping the switch)
// 1. Bare <Name>? sites  → become correct optionals (GOOD; this was the bug)
// 2. Intentional literal "?" after a rule ref:
//      "singer for song <song>?"
//    → would become optional <song> + no "?", OR need rewrite to:
//      "singer for song" <song> "?"
//      "singer for song" <song> \?
// 3. sample.agr "one? two* three+" → becomes correct (GOOD)
// 4. Value-expr ternary `cond ? a : b` is in -> { } land, not expression
//    atoms — unaffected (separate lexer mode).
```

**PR #2765 implements a slice of B:** bare `<Name>?/*/+` only. It does **not** make `word?` or treat `?` as globally reserved. Full B is a larger language change.

**Pros / cons (B)**

```text
+ Matches how authors already write grammars (and sample.agr)
+ One rule: postfix quantifier always means the same thing
+ Removes (<Polite>)? ceremony for the common polite/optional-slot case
− Literal "?" in patterns needs quotes or \?
− Risk: "… <name>?" question-utterance patterns become silent optionals
− Needs corpus audit + possible codemod for literal "?"
```

---

## 4. Side-by-side: same intent, both designs

```agr
// Intent: optional polite, required open, required app
// Utterances: "open outlook" | "please open outlook"

// A (group-gated)                          // B (reserved quantifier)
<Start> = (<Polite>)? open <App> -> …       <Start> = <Polite>? open <App> -> …
```

```agr
// Intent: question utterance with trailing ?
// Utterance: "what is the time?"

// A                                        // B
<Start> = what is the time? -> …            <Start> = "what is the time?" -> …
// or                                       // or
<Start> = what is the time "?" -> …         <Start> = what is the time\? -> …
```

```agr
// Intent: optional song name, then a real question mark
// Utterance: "who sings song?" | "who sings song Hello?"

// A — natural                              // B — must separate quantifier from "?"
<Start> =                                   <Start> =
  who sings song <Song>? -> …                 who sings song <Song>\? -> …
// <Song> required, "?" literal               // <Song> required, "?" literal
//                                            // WRONG if written:
//                                            //   who sings song <Song>?
//                                            // → <Song> becomes optional, no "?"
```

```agr
// Intent: optional song name (no question punctuation)
// Utterance: "play" | "play Hello"

// A                                        // B
<Start> = play (<Song>)? -> …               <Start> = play <Song>? -> …
```

---

## 5. Which mistake is more common?

Empirical in this repo (main, before companion PR):

```text
Bare <Name>? meaning OPTIONAL (author bug under A):   ~16 sites, 6 files
  email <Polite>?, weather <Polite>?, video <Polite>/<VideoContent>?,
  code <PanelRef>?, calendar <TimeSpec>/<LocationSpec>/…

Bare <Name>? meaning LITERAL "?" after a rule:        0 sites found
Trailing "?" question utterances in .agr patterns:    rare; usually unquoted
  words ("what is the time") without needing "?"

sample.agr documents word?/*/+ as quantifiers         (B-shaped expectation)
builtInGrammarCategories documents (<Name>)? only     (A-shaped expectation)
```

```text
Curtis concern:  "what is the singer for song <songname>?"
Repo concern:    "<Polite>? open outlook"  (actually shipping, actually broken)
```

---

## 6. Recommendation (strawman for debate)

```text
Ship now:     Design A + companion grammar rewrite  (this draft PR)
              → unblocks broken agent grammars with zero language risk

Decide next:  Design B vs A-hardening
              If B: extend #2765 beyond rule refs; add word?/quoted?;
                    audit literal "?"; update sample + category docs together
              If A: add A1 lint (bare <Name>? warning) so the footgun is loud;
                    fix sample.agr; keep #2765 closed/abandoned
```

```text
Decision checklist for Curtis:
  [ ] Is free literal "?" more valuable than bare <Rule>? ergonomics?
  [ ] Accept lint noise (A1) or language change (B)?
  [ ] If B: is word? in scope, or only <Rule>? / $(...)? / ()?
  [ ] If B: escape story = \?  or  "?"  or both?
  [ ] Generator / Claude prompts currently emit (<Cat>)? — keep or switch?
```

---

## 7. Out of scope

```text
- NFA/DFA matcher changes beyond what quantifier flags already support
- Spacing modes, value expressions, ternary `? :` inside -> { }
- Auto-migrating external/user-authored grammars outside this monorepo
```

---

## 8. Test matrix (either design)

```ts
// Must hold after whichever design we pick
const cases = [
  // optional polite
  ["open outlook", true],
  ["please open outlook", true],
  ["please ? open outlook", false], // never require a literal "?"

  // required still required
  ["open", false],                  // missing <App>
  ["open outlook", true],

  // grouped form always works
  // (<Polite>)? open <App>

  // Design-specific:
  // A: "what is the time?" matches with bare ?
  // B: "what is the time?" requires "…"\? or quotes
];
```
