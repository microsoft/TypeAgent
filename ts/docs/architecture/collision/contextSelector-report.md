# contextSelector benchmark

_Generated 2026-07-14T23:17:56.018Z._

## What this measures

**contextSelector** is a fast, deterministic step in the dispatcher that handles _grammar collisions_ — when a single user request matches the command grammar of **two or more agents** at once (for example, "play something relaxing" could be the music player _or_ the video player). Instead of always picking the same agent, it reads the **recent conversation** and either **resolves** the collision to the agent the context points to, or **abstains** when the evidence is too weak — handing the decision back to today's routing (or the LLM) rather than guessing.

The rule it must never break: **never silently route a request to the wrong agent.** So the headline result is simple — on realistic input, **wrong-target must be 0.** How often it helps, and how confidently it fires, all matter less than keeping that promise.

It is checked three ways (Metrics 1–3 below): **(1)** does it pull the conversation's real topic out of the noise, **(2)** does it fire only when there is a clear winner and stay quiet otherwise, and **(3)** when it does fire, does it pick the right agent.

This is an **offline** benchmark: it runs the _real_ scoring pipeline — the shipped agent keyword lists, the same recency-weighted model of the recent conversation, and the same decision rule the product uses — against hand-labeled conversations, with **no LLM call and no app startup**. Every number is reproducible bit-for-bit. Shipped decision thresholds: `minUniqueTokens=2, minMass=1.0, margin=0.5` (recency decay λ=0.9 over a 20-turn look-back).

The test set spans **250 hand-labeled conversations** across five difficulty tiers, plus larger auto-generated collision sets — real overlapping agent pairs and a family of deliberately-confusable synthetic agents (**1690** realistic collisions in the combined corpus) — and a separate **50-case adversarial** set that stress-tests where word-matching breaks.

## Summary of results

**Bottom line: contextSelector is safe to use as a first-pass collision resolver.** On realistic conversation it routes a large share of ambiguous requests to the right agent and **never once silently sends one to the wrong agent** — when the evidence is weak it steps aside and lets today's routing (or the LLM) decide. The only misroutes it makes are on inputs deliberately engineered to defeat word-matching, which are meant to fall through to the LLM anyway. Everything below is the supporting evidence — scroll on for the per-tier breakdown, the three metrics, the head-to-head against every other strategy, and the LLM comparison.

- **Safety — the headline: 0 silent misroutes.** Across all **1690** realistic collisions (and all 100 hand-written realistic conversations), _wrong-target_ is **0**.
- **Helpfulness:** on the combined corpus it confidently resolves **59.6%** of collisions (650/1090), and **100.0%** of those go to the right agent.
- **Net routing gain:** layered on the dispatcher's current default (first-match), routing accuracy climbs **49.4% → 78.4%** (**+29.0%**), with no group of conversations left worse off than before.
- **Safer than every silent strategy:** its silent-misroute rate is **0.0%**, versus 50.6% for first-match and 49.1% for priority; and it auto-handles **59.6%** of collisions that the always-ask strategy would interrupt the user for.
- **Where it must not be trusted:** on the separate **50-case adversarial** stress set (loaded negation, sarcasm, quoting someone else) it makes **8** misroutes — failures that need semantic/LLM understanding, which is exactly why those inputs are excluded from the safety corpus and left to the LLM.

## Key terms

Every conversation is labeled with what _should_ happen, then scored by the real pipeline. Each one lands in exactly one of four outcomes:

| Outcome             | What it means                                       | Good or bad?                                                             |
| ------------------- | --------------------------------------------------- | ------------------------------------------------------------------------ |
| ✅ **correct**      | Resolved to the right agent, or correctly abstained | Good                                                                     |
| ⚪ **safe-miss**    | Should have resolved, but abstained instead         | Safe — a missed chance, not a mistake; it just defers to today's routing |
| ❌ **wrong-target** | Resolved to the **wrong** agent                     | The dangerous failure: a silent misroute (must be 0)                     |
| ❌ **spurious**     | Fired when it should have stayed out                | A false alarm                                                            |

The metrics throughout the report are just different views of those four outcomes:

- **Resolve** = commit to one agent. **Abstain** = decline and defer to the existing routing.
- **Yield** — of the conversations that _should_ resolve, how many did (higher = more helpful).
- **Resolution accuracy** — of the times it resolved, how many hit the right agent.
- **Abstention** — of the conversations that _should_ stay out, how many correctly did.
- **Spurious** — of the should-abstain conversations, how many it wrongly fired on (a false alarm).
- **Wrong-target** — of the resolves it made, how many went to the wrong agent (**must stay 0**).
- **Routing lift** — extra requests sent to the right agent versus the routing the dispatcher uses today.

## How to regenerate this report

```
cd packages/dispatcher/dispatcher
npx tsx src/validation/contextselector/reproduce.mts
```

Runs the whole suite — this report plus the LLM comparison appended at the end — and overwrites this tracked file (`docs/architecture/collision/contextSelector-report.md`) in place. Deterministic, so re-running produces the same numbers.

## How the benchmark is built

**At a glance:** an _offline, deterministic_ benchmark that replays the **real** contextSelector pipeline — the shipped agent keyword lists, the same recency-weighted model of the recent conversation, and the same resolve/abstain decision gate the product uses — over **1690** labeled collision test cases (four corpora) plus a **50-case** adversarial stress set, and scores three things: does it find the topic, does it fire only when it should, and does it pick the right agent. **No LLM and no app startup** (except a separate, fully-cached LLM-comparison arm). Every run produces identical numbers.

Under the hood it is three layers. You don't need to read the code to follow the results — this is just the shape of the machine that produced them.

**Layer 1 — the foundation.** A _roster_ is loaded from every shipped agent's real keyword list (the exact data the product routes with). A _fixture_ is one labeled test case. A small shared toolkit builds conversation turns and samples words with a fixed random seed, so everything is reproducible.

A **fixture** is the single unit every part of the benchmark speaks in:

```
fixture = {
  prelude:        the recent conversation, as a list of turns (what the scorer reads)
  collisionInput: the final ambiguous request that triggered the collision
  candidates:     the 2+ agents whose grammars collided (candidates[0] = what first-match picks)
  label:          the correct answer — resolve→<agent>, or abstain (tie | no-signal | stale | coverage)
  retrieval?:     (optional) which words the context SHOULD vs SHOULD-NOT focus on, for Metric 1
  tier?:          (optional) clear | vague
}
```

**Layer 2 — the corpus generators.** Each generator turns the roster into a list of fixtures. They differ in where the words come from and how hard the collision is, but all emit the same fixture shape, so the engine scores them identically. Three build their cases from templates (keywords glued with filler words like "the" and "and", so only the keywords carry signal); one is written by hand in plain English. **None uses an LLM** — every case is either template-generated from real/synthetic keyword lists or literally typed by a person.

| Generator      | Words come from                                           | Difficulty                        | Labeled by   |
| -------------- | --------------------------------------------------------- | --------------------------------- | ------------ |
| **easy**       | real agents, _distinct_ pairs (barely-overlapping vocab)  | floor — trivially separable       | construction |
| **siblings**   | _synthetic_ look-alike agents sharing ~60% of their words | hard — little discriminates them  | construction |
| **real-pairs** | real agents, _genuinely confusable_ pairs                 | medium–hard, split clear vs vague | construction |
| **dialogue**   | _hand-written_ natural sentences                          | 5 tiers, simple → adversarial     | human intent |

**Layer 3 — one scoring engine + orchestration.** A single engine scores any corpus the same way, producing the three metrics and the strategy comparison. The top-level script runs every corpus through it and writes this report; a second script adds the LLM comparison; and the one-line command above runs the whole thing.

### What a fixture looks like, per generator

Illustrative examples — the templated turns sample real keywords, so the exact words vary by seed:

**easy** — _player_ vs _browser_, led by one unrelated _weather_ turn; the conversation is on-topic for the music player:

```
prelude:        ["the forecast and the humidity",   // weather noise (oldest, faint)
                 "the playlist and the album",       // player's own words
                 "the artist and the chorus"]
collisionInput: "handle the play request"
candidates:     ["player.play", "browser.open"]
label:          resolve → player.play
```

**siblings** — _vampire_ vs _werewolf_. Both share the occult register (blood, night…), which cancels in scoring; only the unique words (coffin, fang) can point at a winner:

```
prelude:        ["the coffin",               // vampire-unique (discriminates)
                 "the fang",
                 "the blood and the night"]  // shared register (cancels to zero)
collisionInput: "perform the summon"
candidates:     ["vampire.summon", "werewolf.summon"]
label:          resolve → vampire.summon
```

If every turn were shared occult words, the correct answer flips to **abstain** — nothing discriminates.

**real-pairs** — _timer_ vs _windowsClock_, a genuinely confusable pair, in its two flavors:

```
CLEAR  (should resolve):  mostly the shared time-words + a few "tells" unique to timer
                          → label: resolve → timer,  tier: clear
VAGUE  (should abstain):  only the shared time-words both agents answer to
                          → label: abstain,          tier: vague
```

**dialogue** — hand-written, reads like a real user, grounded in the agents' real keywords. The final _ask_ is recorded but not scored (the decision is made from the turns before it):

```
dialogue: ["I've been listening to so much new stuff this week.",
           "my discover weekly has been on point lately.",
           "queue up my favorite upbeat mix for the gym."]
ask:      "play it"                  // recorded, not scored
candidates: ["player", "localPlayer"]
label:      resolve → player
```

## Results by difficulty tier

250 hand-authored conversations across five tiers of increasing difficulty (50 each), each labeled by honest human intent and scored by the real pipeline. See **Key terms** above for what Yield, Resolution accuracy, Abstention, Spurious, and Wrong-target mean; **Retrieval topic share** is how cleanly the recent conversation pointed at the intended agent (Metric 1), and **Routing lift** is the accuracy gained over the dispatcher's current first-match default.

### Simple (50) — short, obvious, single-agent requests with strong keywords — the easy floor

| Metric                                  | dialogue (simple, 50) |
| --------------------------------------- | --------------------- |
| Yield (resolved when it should)         | 100.0% (36/36)        |
| Resolution accuracy                     | 100.0% (36/36)        |
| Abstention (stayed out)                 | 100.0% (14/14)        |
| Spurious (fired when it should abstain) | 0.0% (0/14)           |
| Wrong-target (misrouted a resolve)      | 0.0% (0/36)           |
| Retrieval topic share                   | 100.0%                |
| Routing lift vs first-match             | +33.3%                |

### No-context (50) — a collision with ZERO relevant signal: cold start, greetings, unrelated chatter — should always abstain

| Metric                                  | dialogue (no-context, 50) |
| --------------------------------------- | ------------------------- |
| Yield (resolved when it should)         | n/a                       |
| Resolution accuracy                     | n/a                       |
| Abstention (stayed out)                 | 100.0% (50/50)            |
| Spurious (fired when it should abstain) | 0.0% (0/50)               |
| Wrong-target (misrouted a resolve)      | n/a                       |
| Retrieval topic share                   | n/a                       |
| Routing lift vs first-match             | +0.0%                     |

### Realistic (50) — natural multi-turn conversations a regular user would actually type

| Metric                                  | dialogue (realistic, 50) |
| --------------------------------------- | ------------------------ |
| Yield (resolved when it should)         | 100.0% (34/34)           |
| Resolution accuracy                     | 100.0% (34/34)           |
| Abstention (stayed out)                 | 100.0% (16/16)           |
| Spurious (fired when it should abstain) | 0.0% (0/16)              |
| Wrong-target (misrouted a resolve)      | 0.0% (0/34)              |
| Retrieval topic share                   | 97.3%                    |
| Routing lift vs first-match             | +44.1%                   |

### Hard (50) — edge cases: thin single-word signal, out-of-vocabulary slang, topic shift, distractor traps, near-ties, staleness

| Metric                                  | dialogue (hard, 50) |
| --------------------------------------- | ------------------- |
| Yield (resolved when it should)         | 54.5% (18/33)       |
| Resolution accuracy                     | 100.0% (18/18)      |
| Abstention (stayed out)                 | 100.0% (17/17)      |
| Spurious (fired when it should abstain) | 0.0% (0/17)         |
| Wrong-target (misrouted a resolve)      | 0.0% (0/18)         |
| Retrieval topic share                   | 73.2%               |
| Routing lift vs first-match             | +24.2%              |

### Adversarial (50) — inputs built to confuse the scorer: loaded negation, sarcasm, quoted speech, third-agent distractors

| Metric                                  | dialogue (adversarial, 50) |
| --------------------------------------- | -------------------------- |
| Yield (resolved when it should)         | 58.8% (10/17)              |
| Resolution accuracy                     | 20.0% (2/10)               |
| Abstention (stayed out)                 | 45.5% (15/33)              |
| Spurious (fired when it should abstain) | 54.5% (18/33)              |
| Wrong-target (misrouted a resolve)      | 80.0% (8/10)               |
| Retrieval topic share                   | 56.6%                      |
| Routing lift vs first-match             | +5.9%                      |

**Reading the trend:** the tier gets _safer-but-quieter_ as difficulty climbs — perfect on simple/realistic, conservative safe-misses on hard, and only the adversarial tier (built to defeat lexical matching) produces real misroutes. Wrong-target is **0 on simple, realistic, and hard**, and jumps to 8 only under the adversarial attacks (loaded negation, sarcasm, quoted speech), which need a semantic/LLM tier to catch.

## Realistic dialogue — natural user conversations

100 hand-authored multi-turn conversations (≥3 turns) that read like a regular user talking, grounded in the featured agents' real keyword vectors: **50 normal** + **50 purposely-hard edge cases**. Labeled by honest human intent and verified against the real scorer; the hard set is NOT tuned to pass — it probes where lexical scoring falls short.

| Outcome                                          | normal (50) | hard (50) |
| ------------------------------------------------ | ----------- | --------- |
| ✅ correct (resolved right / abstained right)    | 50          | 35        |
| ⚪ safe-miss (should resolve, abstained instead) | 0           | 15        |
| ❌ **wrong-target** (misrouted)                  | **0**       | **0**     |
| ❌ spurious (should abstain, resolved)           | 0           | 0         |

**The safety claim: 0 wrong-target across all 100 realistic conversations** — even the 50 hard edge cases never misroute. The hard set's failures are all **safe** (conservative misses on thin/vocabulary-gap signal), which fall through to today's routing rather than guessing.

### Hard edge cases by category (ok / safe-miss / wrong-target / spurious)

| Category    | what it probes                                | ok  | safe-miss | wrong | spurious |
| ----------- | --------------------------------------------- | --- | --------- | ----- | -------- |
| cross-drift | long unrelated chatter before the collision   | 1   | 0         | 0     | 0        |
| homonym     | an ambiguous word (book / play)               | 1   | 1         | 0     | 0        |
| near-tie    | both agents genuinely balanced                | 6   | 0         | 0     | 0        |
| negation    | negated mentions the scorer can't detect      | 4   | 3         | 0     | 0        |
| sparse      | ultra-short, no real signal                   | 1   | 0         | 0     | 0        |
| stale       | a strong mention decayed under the mass gate  | 6   | 0         | 0     | 0        |
| thin-signal | clear intent, only ONE discriminating word    | 2   | 6         | 0     | 0        |
| topic-shift | user moves off an early topic to a recent one | 6   | 1         | 0     | 0        |
| trap        | dominant topic + a salient recent distractor  | 8   | 0         | 0     | 0        |
| vocab-gap   | intent in slang not in any keyword vector     | 0   | 4         | 0     | 0        |

Non-correct hard cases (all safe): `hard-thin-player` (safe-miss), `hard-thin-localplayer` (safe-miss), `hard-thin-calendar` (safe-miss), `hard-thin-photo` (safe-miss), `hard-thin-browser` (safe-miss), `hard-thin-weather` (safe-miss), `hard-vocab-calendar` (safe-miss), `hard-vocab-player` (safe-miss), `hard-vocab-code` (safe-miss), `hard-vocab-weather` (safe-miss), `hard-neg-affirm-image` (safe-miss), `hard-neg-affirm-utility` (safe-miss), `hard-shift-to-timer` (safe-miss), `hard-homonym-book` (safe-miss), `hard-double-negative` (safe-miss). These are misses/abstains, not misroutes.

## Adversarial stress test — 50 extra-hard inputs built to confuse it

_These are deliberately adversarial and **excluded from the calibration/sweep corpus above** — they measure where lexical scoring fundamentally breaks, not realistic routing safety._

| Outcome                         | extra-hard (50) |
| ------------------------------- | --------------- |
| ✅ correct                      | 17              |
| ⚪ safe-miss                    | 7               |
| ❌ **wrong-target** (misrouted) | **8**           |
| ❌ spurious (false alarm)       | 18              |

| Attack          | what it does                                              | ok  | safe-miss | wrong | spurious |
| --------------- | --------------------------------------------------------- | --- | --------- | ----- | -------- |
| churn           | a different agent every turn, none dominant               | 0   | 0         | **0** | 5        |
| dense-tie       | both agents heavily and evenly loaded                     | 4   | 0         | **0** | 2        |
| homonym         | an ambiguous word (book / play)                           | 4   | 1         | **0** | 0        |
| loaded-negation | many NEGATED words for one agent, few for the other       | 1   | 4         | **4** | 0        |
| quoted          | another person's quoted suggestion, not the user's intent | 1   | 2         | **4** | 0        |
| sarcasm         | positive-sounding words the user resents                  | 0   | 0         | **0** | 7        |
| third-agent     | a third agent's words overlapping one side                | 2   | 0         | **0** | 4        |
| typo            | misspelled keywords that lose their signal                | 5   | 0         | **0** | 0        |

**The breaking points.** Under input crafted to confuse it, the lexical scorer fails 26/50 of the time — concentrated exactly where word-matching is blind:

- **Loaded negation** is the worst: the scorer counts negated words as positive signal, so "NOT a debugger, forget the thread/stack/memory... just fix the bug" **misroutes to the negated (heavier) agent** every time.
- **Sarcasm** and **quoted speech** fire on the surface words — the tier resolves on a phrase the user is mocking or quoting from someone else.
- **Third-agent distractors** and **rapid churn** bleed enough overlapping mass to trip a spurious resolve.
- **Safe under attack:** typos and homonyms mostly lose their signal and correctly abstain — a garbled keyword can't misroute.

**Implication for shipping:** these failure modes need semantic understanding (an LLM tier), not lexical tuning. contextSelector is safe on realistic conversation but should NOT be relied on to catch negation/sarcasm/quotation — those must fall through to the LLM. The mitigation already in the design (bias toward abstention, LLM fallback) is what bounds the blast radius; a real deployment could add a negation-word guard to force abstain when "not/no/never" precedes the discriminating tokens.

## Real-agent comparisons — clear vs vague conversations

11 genuinely confusable real-agent pairs, each driven with an **even mixture** of _clear_ conversations (obviously one agent) and _vague_ ones (spoken in the shared vocabulary the two agents both answer to, or mentioning both). The point is to watch **which metric lights up** as the conversation gets ambiguous.

| #   | Comparison                                  | shared kw | discA | discB |
| --- | ------------------------------------------- | --------- | ----- | ----- |
| 1   | player vs playerLocal (music)               | 14        | 10    | 9     |
| 2   | powershell vs taskflow (automation flows)   | 10        | 13    | 11    |
| 3   | browser web-flows vs powershell (flows)     | 12        | 8     | 11    |
| 4   | code-debug vs visualStudio (debugging)      | 8         | 16    | 16    |
| 5   | timer vs windowsClock (time)                | 11        | 13    | 13    |
| 6   | calendar vs timer (scheduling)              | 8         | 16    | 16    |
| 7   | desktop-taskbar vs settings (system config) | 10        | 9     | 13    |
| 8   | chat vs photo (images)                      | 14        | 8     | 9     |
| 9   | image vs photo (pictures)                   | 6         | 17    | 17    |
| 10  | browser vs utility (web fetch)              | 7         | 13    | 10    |
| 11  | code-extensions vs github-cli (dev tooling) | 8         | 12    | 16    |

| Measure                           | CLEAR convos       | VAGUE convos       |
| --------------------------------- | ------------------ | ------------------ |
| Yield — resolved when it should   | **66.7%** (66/99)  | —                  |
| Resolution accuracy \| resolved   | **100.0%** (66/66) | —                  |
| Wrong-target resolves             | 0                  | 0                  |
| Abstention — correctly stayed out | —                  | **100.0%** (99/99) |
| Spurious-resolve — false alarm    | —                  | **0.0%** (0)       |

**How the metrics move:** on **clear** conversations the tier fires and routes correctly (yield 66.7%, resolution accuracy 100.0%); on **vague** conversations the _same agents_ now trigger the abstention machinery instead — it correctly stays out 100.0% of the time and false-alarms on 0.0%. Yield/accuracy and abstention are complementary: clear input exercises the first, vague input the second, and the tier does the right thing in both.

**Reading the columns below.** `dlg-simple`, `dlg-nocontext`, `dlg-realistic`, `dlg-hard`, and `dlg-advers` are the five 50-conversation dialogue tiers. **`combined`** is the full calibration corpus — every _realistic_ slice unioned (easy real-roster pairs + confusable siblings + real clear/vague pairs + the four non-adversarial dialogue tiers), scored over one merged roster. The adversarial dialogue tier is **excluded** from `combined` (it is a stress test, reported separately above), so `combined` is not the sum of the five `dlg-*` columns.

## Metric 1 — Context retrieval fidelity

_Does the signal source appropriately retrieve the conversation's topic, before any decision is made?_

**In plain terms:** before the scorer decides anything, the signal source turns the recent conversation into a weighted bag of words (more-recent words count more). It sorts those words into three buckets — the **intended topic** (what the user is really asking about), a **distractor** (a look-alike agent that could be mistaken for it), and **unrelated noise** — and checks that most of the weight landed in the intended-topic bucket. If it did, the signal handed to the scorer already points at the right agent; whether to actually resolve or abstain is decided later (Metrics 2 and 3). The rows below measure how cleanly that separation holds:

- **Topic mass share** — of all the topical weight, the fraction sitting on the intended topic (100% = nothing but the topic; higher is cleaner).
- **Topic is strongest bank** — how often the intended topic outweighs **both** the distractor and the noise.
- **Topic outweighs distractor** — how often the intended topic beats the look-alike agent specifically.
- **Mean separation** — how far ahead the topic is in raw weight — the margin of safety.

| Measure                    | dlg-simple | dlg-nocontext | dlg-realistic | dlg-hard | dlg-advers | combined |
| -------------------------- | ---------- | ------------- | ------------- | -------- | ---------- | -------- |
| Topic mass share           | 100.0%     | n/a           | 97.3%         | 73.2%    | 56.6%      | 86.6%    |
| Topic is strongest bank    | 100.0%     | n/a           | 100.0%        | 87.9%    | 41.2%      | 99.0%    |
| Topic outweighs distractor | 100.0%     | n/a           | 100.0%        | 87.9%    | 41.2%      | 99.0%    |
| Mean separation            | 3.625      | n/a           | 3.199         | 1.819    | -0.650     | 4.068    |

**Signal-source contract checks: 5/5 pass.**

| Property check | Result  | Detail                                                     |
| -------------- | ------- | ---------------------------------------------------------- |
| recency-decay  | ✅ pass | newer=0.900 > older=0.810                                  |
| windowing      | ✅ pass | grocery evicted after 20 turns                             |
| history-only   | ✅ pass | unrecorded token absent from context vector                |
| surface-form   | ✅ pass | vampire/coffin/item/list recovered from plural/cased forms |
| glue-rejection | ✅ pass | context vector size 0 (expected 0)                         |

Retrieval is scored on fixtures with a single intended topic; **real-vague** conversations have no single topic (they are shared-vocabulary or balanced), so retrieval is `n/a` there — correctly, the context vector has nothing to concentrate on. On the **siblings** slice the oracle is the _trap_ fixture (topic dominant, sibling distractor present), so the share drops below the clear slices' near-1.0.

## Metric 2 — Trigger discipline (resolve only when required)

_Does it fire exactly when there is a clear winner, and stay quiet otherwise?_

**Goal:** a collision-resolver is judged as much by its restraint as by its hits. This checks both directions at once — when a conversation clearly points at one agent it should **resolve** (measured by _yield_), and when the conversation is ambiguous or empty it should **abstain** (measured by _abstention_). Firing on a should-abstain conversation is a _spurious_ resolve — a false alarm — and should be near zero.

| Measure                                 | dlg-simple     | dlg-nocontext  | dlg-realistic  | dlg-hard       | dlg-advers    | combined         |
| --------------------------------------- | -------------- | -------------- | -------------- | -------------- | ------------- | ---------------- |
| Yield — resolvable we resolved (recall) | 100.0% (36/36) | n/a            | 100.0% (34/34) | 54.5% (18/33)  | 58.8% (10/17) | 59.6% (650/1090) |
| Abstention (correctly stayed out)       | 100.0% (14/14) | 100.0% (50/50) | 100.0% (16/16) | 100.0% (17/17) | 45.5% (15/33) | 100.0% (600/600) |
| Spurious-resolve rate                   | 0.0% (0)       | 0.0% (0)       | 0.0% (0)       | 0.0% (0)       | 54.5% (18)    | 0.0% (0)         |

The **siblings** slice yield (46.2%) and the **real-clear** yield (66.7%) are the headline numbers: on genuinely confusable input the tier only fires when the scarce discriminating evidence clears the gate, and safely abstains (a _missed_, not a misroute) otherwise. Abstention stays high because a shared-vocabulary-only conversation correctly resolves to nobody.

## Metric 3 — Resolution correctness (resolve correctly)

_When it does fire, does it route to the RIGHT agent?_

**Goal:** this is the safety metric. A high yield is worthless if the resolves land on the wrong agent, so the single most important number in this report is **wrong-target resolves — it must be 0** on realistic input. A wrong resolve is a silent misroute; abstaining instead would have been safe.

| Measure                                                 | dlg-simple | dlg-nocontext  | dlg-realistic | dlg-hard       | dlg-advers     | combined     |
| ------------------------------------------------------- | ---------- | -------------- | ------------- | -------------- | -------------- | ------------ | ---------------- |
| Target accuracy                                         | resolved   | 100.0% (36/36) | n/a           | 100.0% (34/34) | 100.0% (18/18) | 20.0% (2/10) | 100.0% (650/650) |
| Wrong-target resolves (must be 0)                       | 0          | 0              | 0             | 0              | 8              | 0            |
| Wrong-resolution rate (wrong-target + spurious, of all) | 0.0%       | 0.0%           | 0.0%          | 0.0%           | 52.0%          | 0.0%         |

Across every slice — including the _trap_ fixtures where the losing sibling gets a salient recent mention — resolution accuracy holds and wrong-target stays 0: when discriminating evidence is too weak the tier abstains rather than guessing.

## Safety — never worse than today's routing

**Goal:** switching contextSelector on should only ever _add_ correct routings, never remove any. Below, routing accuracy is compared **with vs. without** contextSelector layered on the dispatcher's current default (_first-match_): where it resolves it uses its own pick, otherwise it falls back to first-match. **No-regression** verifies that no group of conversations ends up worse than first-match alone.

| Measure                                   | dlg-simple | dlg-nocontext | dlg-realistic | dlg-hard | dlg-advers | combined |
| ----------------------------------------- | ---------- | ------------- | ------------- | -------- | ---------- | -------- |
| Baseline (first-match) accuracy           | 66.7%      | 0.0%          | 55.9%         | 57.6%    | 11.8%      | 49.4%    |
| Treatment (contextSelector) accuracy      | 100.0%     | 0.0%          | 100.0%        | 81.8%    | 17.6%      | 78.4%    |
| Routing-accuracy lift                     | +33.3%     | +0.0%         | +44.1%        | +24.2%   | +5.9%      | +29.0%   |
| No-regression (never worse than baseline) | ✅ holds   | ✅ holds      | ✅ holds      | ✅ holds | ❌ FAILED  | ✅ holds |

## Deployed routing-lift — adding contextSelector on top of each strategy

The table above is the deployed lift over _first-match_ specifically (contextSelector resolves confidently, else falls back to first-match). Any silent auto-resolver can be the fallback, so this generalizes it to `score-rank` and `priority` too, on the combined corpus — answering "if my dispatcher already routes with strategy X, does adding contextSelector still help, and does it ever regress?" (Deterministic, `defer-to-strategy` mode; the `escalate-to-llm` fallback is measured separately by `compareLlm.mts`.)

| Base strategy X | X alone | + contextSelector (deployed) | Routing lift | No-regression |
| --------------- | ------- | ---------------------------- | ------------ | ------------- |
| first-match     | 49.4%   | 78.4%                        | +29.0%       | ✅ holds      |
| score-rank      | 50.9%   | 80.2%                        | +29.3%       | ✅ holds      |
| priority        | 50.9%   | 80.2%                        | +29.3%       | ✅ holds      |

**vs `user-clarify`:** an accuracy lift is ill-defined (a prompt eventually resolves correctly), so the gain is **prompts avoided** — contextSelector auto-resolves 59.6% of these collisions (650/1090) that user-clarify would interrupt the user for, misrouting 0.0% (0) of them.

## Comparison — contextSelector vs every collision-resolution strategy

The dispatcher's other grammar-collision strategies (`first-match`, `score-rank`, `priority`, `user-clarify`) are all **context-blind**: they pick the same agent no matter what the conversation said. So on a context-dependent collision they land on the intended target only when their fixed rule happens to, and silently misroute otherwise. `user-clarify` never misroutes but prompts the user every time. contextSelector reads the recent conversation — it resolves the clear collisions correctly and _abstains_ (defers, never silently misroutes) on the rest. Each row scores a strategy's **own** decision (an abstain counts as a deferral, not a fallback), so the first-match lift here is smaller than the deployed _routing lift_ above — which additionally credits contextSelector with the first-match fallback it defers to on abstain.

| Measure                      | dlg-simple | dlg-nocontext | dlg-realistic | dlg-hard  | dlg-advers | combined  |
| ---------------------------- | ---------- | ------------- | ------------- | --------- | ---------- | --------- |
| first-match accuracy         | 66.7%      | 0.0%          | 55.9%         | 57.6%     | 11.8%      | 49.4%     |
| score-rank accuracy¹         | 44.4%      | 0.0%          | 50.0%         | 45.5%     | 52.9%      | 50.9%     |
| priority accuracy            | 44.4%      | 0.0%          | 50.0%         | 45.5%     | 52.9%      | 50.9%     |
| **contextSelector accuracy** | **100.0%** | **0.0%**      | **100.0%**    | **54.5%** | **11.8%**  | **59.6%** |
| lift vs first-match          | +33.3%     | +0.0%         | +44.1%        | -3.0%     | +0.0%      | +10.2%    |
| lift vs score-rank           | +55.6%     | +0.0%         | +50.0%        | +9.1%     | -41.2%     | +8.7%     |
| lift vs priority             | +55.6%     | +0.0%         | +50.0%        | +9.1%     | -41.2%     | +8.7%     |

¹ On a genuine grammar collision the colliding constructions matched the _same_ input, so `score-rank`'s match-strength heuristic ties and it falls through to `priority` — the two are identical on this corpus (an honest offline limitation: real grammar match-counts aren't reconstructable without the matcher).

**Per-strategy breakdown on the combined corpus** (1090 resolvable collisions):

| Strategy            | Resolves correctly   | Silently misroutes | Defers / abstains |
| ------------------- | -------------------- | ------------------ | ----------------- |
| first-match         | 49.4% (539/1090)     | 50.6% (551)        | 0.0% (0)          |
| score-rank¹         | 50.9% (555/1090)     | 49.1% (535)        | 0.0% (0)          |
| priority            | 50.9% (555/1090)     | 49.1% (535)        | 0.0% (0)          |
| user-clarify        | 0.0% (0/1090)        | 0.0% (0)           | 100.0% (1090)     |
| **contextSelector** | **59.6%** (650/1090) | **0.0%** (0)       | 40.4% (440)       |

**Takeaway:** contextSelector's silent-misroute rate (0.0%) sits far below every silently-resolving baseline (first-match 50.6%, priority 49.1%); the collisions it can't resolve confidently it hands back rather than guessing. Against the always-safe user-clarify strategy, contextSelector auto-resolves 59.6% of the collisions that a clarify prompt would otherwise interrupt the user for.

## Threshold sweep — how sensitive is safety to the gate settings?

**Goal:** the _gate_ is the set of thresholds that decide resolve-vs-abstain. Loosening it lifts yield but risks false alarms and misroutes; tightening it is safer but quieter. This sweeps 36 threshold combinations to map the safety boundary and confirm the shipped default sits in the fully-safe region.

- **Wrong-target across the sweep:** **4 of 36 cells** produced a wrong-target; the shipped default holds **0** (see the table below).
- **Abstention boundary:** 21/36 cells hold 0 spurious resolves; the rest leak on the stale/shared-tie fixtures when the mass/margin gates are loosened.

**Shipped default (`minUniqueTokens=2, minMass=1.0, margin=0.5`):** yield 59.6%, abstention 100.0%, 0 wrong-target on the combined corpus.

| minUniqueTokens | minMass | margin | yield | abstention | spurious | wrong-target |
| --------------- | ------- | ------ | ----- | ---------- | -------- | ------------ |
| 1 (loose)       | 0.5     | 0.25   | 89.4% | 84.7%      | 92       | 1            |
| 2 (shipped)     | 1       | 0.5    | 59.6% | 100.0%     | 0        | 0            |
| 2 (shipped)     | 1       | 0.5    | 59.6% | 100.0%     | 0        | 0            |

**Recommended operating point:** `minUniqueTokens=2, minMass=1, margin=0.5` — the loosest fully-safe gate (max yield headroom, holds 0 spurious / 0 wrong-target).

## Method & caveats

- **Real committed roster (easy):** vectors are the shipped `*.keywords.json` files, read through the production `KeywordIndex.effective()` path. Distinct agents have near-disjoint vectors, so the easy slice saturates — it is a _floor_, not the headline.
- **Confusable siblings (hard):** a family of synthetic occult agents sharing ~60% of their vocabulary. Shared tokens cancel via candidate-local IDF, so only the scarce unique tokens discriminate — the realistic hard case, and where the metrics become informative.
- **Self-labeled, gate-decided:** resolve fixtures span a signal grid (unique-token count × recency padding); the evidence gate — not the fixture author — decides which clear the bar, so yield is a real property of the thresholds vs the signal gradient.
- **Deterministic:** seeded PRNG, byte-identical across runs (verify with two `--out` dirs).
- **Not covered here (follow-ups):** L3 live agent-server replay, LLM-authored / paraphrased (non-lexical) preludes, and misroute-mined keyword sources.
<!-- BEGIN contextSelector-vs-llm -->

# contextSelector vs the LLM resolution path

_Generated 2026-07-14T23:17:58.645Z · 250 labeled collisions · LLM arm = real `aiclient` model (the standard path's LLM), temperature 0, cached._

**Goal:** the report above shows contextSelector is safe and instant, but the dispatcher could instead just ask the LLM to resolve every collision. This section asks the shipping question head-on: versus letting the LLM decide, what does turning contextSelector on gain, and what does it cost? The same 250 labeled collisions are scored both ways.

**contextSelector OFF** = the collision falls through to the LLM, which picks the agent. **contextSelector ON** = contextSelector resolves it instantly, or abstains and falls through to the LLM. Routing is _correct_ when it commits to the labeled agent (resolve cases) or correctly declines to commit (ambiguous cases). Every LLM answer is cached, so re-running is free and deterministic.

| Tier             | LLM-only acc (CS off) | CS-ON system acc | CS resolves (LLM calls saved) | Regressions (CS wrong, LLM right) | Correct saves |
| ---------------- | --------------------- | ---------------- | ----------------------------- | --------------------------------- | ------------- |
| Simple (50)      | 100% (50/50)          | 100% (50/50)     | 36                            | **0**                             | 36            |
| Realistic (50)   | 76% (38/50)           | 76% (38/50)      | 34                            | **0**                             | 34            |
| Hard (50)        | 84% (42/50)           | 86% (43/50)      | 18                            | **0**                             | 18            |
| Adversarial (50) | 56% (28/50)           | 28% (14/50)      | 28                            | **14**                            | 2             |

**How to read it.** _LLM-only accuracy_ is the standard path with contextSelector off. _CS-ON system accuracy_ is the deployed behavior (resolve, else fall through to the LLM). _Regressions_ are the price of enabling contextSelector — collisions it resolves to the wrong agent that the LLM alone would have routed correctly. _Correct saves_ are the payoff — right answers delivered without an LLM call.

<!-- END contextSelector-vs-llm -->
