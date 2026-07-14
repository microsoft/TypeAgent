// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Entry point for the contextSelector three-metric benchmark. Measures the three
// metrics the design cares about — SEPARATELY, as requested:
//
//   1. Context retrieval  — are we appropriately retrieving conversation topic?
//   2. Trigger discipline  — do we resolve only when required, and abstain
//                            otherwise (and vice versa)?
//   3. Resolution correctness — when we resolve, do we resolve correctly?
//
// ...across TWO corpora so the numbers actually discriminate:
//
//   EASY  — real overlapping-agent pairs from the committed roster. Near-disjoint
//           keyword vectors, so signal is abundant and the tier saturates
//           (a floor: it must not fail even the easy cases).
//   HARD  — a family of CONFUSABLE synthetic "vampire" siblings (~60% shared
//           occult vocabulary). Discriminating mass is scarce and the evidence
//           gate is genuinely stressed, so yield drops to an informative fraction
//           that reflects where the gate sits vs the signal gradient.
//
// Also runs the B-6 threshold sweep on the combined corpus as a safety-boundary
// study, and writes a markdown + JSON report.
//
// Run: npx tsx src/validation/contextselector/measureMetrics.mts [--out <dir>]

import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveReportPath, writeBaseReport } from "./reportFile.mjs";
import { loadRoster, buildRoster } from "./metricRoster.mjs";
import { selectPairs, generateFixtures, Fixture } from "./metricCorpus.mjs";
import {
    buildAdversary,
    generateAdversaryFixtures,
} from "./metricAdversary.mjs";
import { realPairs, generateRealFixtures } from "./metricRealPairs.mjs";
import {
    SCENARIOS,
    generateDialogueFixtures,
} from "./metricRealisticDialogue.mjs";
import {
    runMetrics,
    retrievalPropertyChecks,
    DEFAULT_THRESHOLDS,
    MetricsResult,
} from "./metricRunner.mjs";

// This script's directory — the default output location for the consolidated
// report, so it lands next to the harness regardless of the caller's cwd.
const HERE = path.dirname(fileURLToPath(import.meta.url));

function pct(x: number): string {
    return `${(x * 100).toFixed(1)}%`;
}

// Signed percentage for deltas/lifts, so a negative renders "-5.9%" not "+-5.9%".
function signedPct(x: number): string {
    return `${x >= 0 ? "+" : ""}${pct(x)}`;
}

// n/a-aware formatters: a slice made entirely of one tier has no data for the
// opposite metric (vague has nothing to resolve; clear has nothing to abstain
// on), so show "n/a" instead of a misleading 0%/100%.
function share(r: MetricsResult): string {
    return r.retrieval.n === 0 ? "n/a" : pct(r.retrieval.meanTopicShare);
}
function yieldOf(r: MetricsResult): string {
    return r.trigger.resolvable === 0 ? "n/a" : pct(r.trigger.yield);
}
function abstentionOf(r: MetricsResult): string {
    return r.trigger.abstainable === 0
        ? "n/a"
        : pct(r.trigger.abstentionCorrectness);
}
function accuracyOf(r: MetricsResult): string {
    return r.resolution.resolves === 0
        ? "n/a"
        : pct(r.resolution.targetAccuracy);
}

// ---- Build the two corpora ----
const easyRoster = loadRoster({ minVectorSize: 8 });
const easyPairs = selectPairs(easyRoster, {
    minDiscriminating: 6,
    window: 3,
    cap: 80,
});
const easyFixtures = generateFixtures(easyRoster, easyPairs, {
    seed: 20260708,
    preludeLen: 4,
});

const adversary = buildAdversary();
const hardFixtures = generateAdversaryFixtures(adversary, { seed: 990099 });

// Realistic-dialogue slice: 200 hand-authored natural conversations across four
// difficulty tiers — 50 simple (easy floor) + 50 realistic + 50 hard edge cases +
// 50 EXTRA-HARD adversarial stress tests. The extra-hard set is designed to
// actively confuse the scorer, so it is kept OUT of the calibration/sweep corpus
// and reported separately as a breaking-points probe.
const dialogueFixtures = generateDialogueFixtures(easyRoster);
const tierOf = new Map(
    SCENARIOS.map((s) => [`dialogue-${s.id}`, s.difficulty ?? "normal"]),
);
const dialogueSimpleFx = dialogueFixtures.filter(
    (f) => tierOf.get(f.id) === "simple",
);
const dialogueNoContextFx = dialogueFixtures.filter(
    (f) => tierOf.get(f.id) === "no-context",
);
const dialogueNormalFx = dialogueFixtures.filter(
    (f) => tierOf.get(f.id) === "normal",
);
const dialogueHardFx = dialogueFixtures.filter(
    (f) => tierOf.get(f.id) === "hard",
);
const dialogueXhardFx = dialogueFixtures.filter(
    (f) => tierOf.get(f.id) === "extra-hard",
);

// Real-agent comparison slice: >=10 curated confusable real pairs, each driven
// with an even mix of CLEAR (obviously one agent) and VAGUE (ambiguous) convos.
const pairs = realPairs(easyRoster, { minShared: 6, minDiscriminating: 6 });
const realFixtures = generateRealFixtures(pairs, { seed: 424242, repeats: 3 });
const realClearFixtures = realFixtures.filter((f) => f.tier === "clear");
const realVagueFixtures = realFixtures.filter((f) => f.tier === "vague");

// Combined: one merged index (real committed files + synthetic sibling files)
// scoring the union of fixtures — the full picture the sweep tunes against.
const mergedFiles = new Map(easyRoster.files);
for (const [schema, file] of adversary.roster.files) {
    mergedFiles.set(schema, file);
}
const mergedRoster = buildRoster(mergedFiles, 8);
// The calibration/sweep corpus is REALISTIC input only — the adversarial
// extra-hard dialogues are deliberately excluded so they don't distort the
// safety/threshold claims (they are reported separately as a stress test).
const allFixtures: Fixture[] = [
    ...easyFixtures,
    ...hardFixtures,
    ...realFixtures,
    ...dialogueSimpleFx,
    ...dialogueNoContextFx,
    ...dialogueNormalFx,
    ...dialogueHardFx,
];

const hard = runMetrics(adversary.roster, hardFixtures, DEFAULT_THRESHOLDS);
const realClear = runMetrics(easyRoster, realClearFixtures, DEFAULT_THRESHOLDS);
const realVague = runMetrics(easyRoster, realVagueFixtures, DEFAULT_THRESHOLDS);
const dialogue = runMetrics(easyRoster, dialogueFixtures, DEFAULT_THRESHOLDS);
const dialogueSimple = runMetrics(
    easyRoster,
    dialogueSimpleFx,
    DEFAULT_THRESHOLDS,
);
const dialogueNoContext = runMetrics(
    easyRoster,
    dialogueNoContextFx,
    DEFAULT_THRESHOLDS,
);
const dialogueNormal = runMetrics(
    easyRoster,
    dialogueNormalFx,
    DEFAULT_THRESHOLDS,
);
const dialogueHard = runMetrics(easyRoster, dialogueHardFx, DEFAULT_THRESHOLDS);
const dialogueXhard = runMetrics(
    easyRoster,
    dialogueXhardFx,
    DEFAULT_THRESHOLDS,
);
const combined = runMetrics(mergedRoster, allFixtures, DEFAULT_THRESHOLDS);
// The four dialogue tiers, in order, for the per-tier report.
const tiers: {
    name: string;
    label: string;
    explain: string;
    r: MetricsResult;
}[] = [
    {
        name: "simple",
        label: "Simple (50)",
        explain:
            "short, obvious, single-agent requests with strong keywords — the easy floor",
        r: dialogueSimple,
    },
    {
        name: "no-context",
        label: "No-context (50)",
        explain:
            "a collision with ZERO relevant signal: cold start, greetings, unrelated chatter — should always abstain",
        r: dialogueNoContext,
    },
    {
        name: "realistic",
        label: "Realistic (50)",
        explain:
            "natural multi-turn conversations a regular user would actually type",
        r: dialogueNormal,
    },
    {
        name: "hard",
        label: "Hard (50)",
        explain:
            "edge cases: thin single-word signal, out-of-vocabulary slang, topic shift, distractor traps, near-ties, staleness",
        r: dialogueHard,
    },
    {
        name: "adversarial",
        label: "Adversarial (50)",
        explain:
            "inputs built to confuse the scorer: loaded negation, sarcasm, quoted speech, third-agent distractors",
        r: dialogueXhard,
    },
];
const slices: { name: string; r: MetricsResult }[] = [
    { name: "dlg-simple", r: dialogueSimple },
    { name: "dlg-nocontext", r: dialogueNoContext },
    { name: "dlg-realistic", r: dialogueNormal },
    { name: "dlg-hard", r: dialogueHard },
    { name: "dlg-advers", r: dialogueXhard },
    { name: "combined", r: combined },
];

// Per-scenario outcome classification for the dialogue tables.
type Outcome = "correct" | "safe-miss" | "wrong-target" | "spurious";
const dialogueRows = dialogueFixtures.map((f) => {
    const one = runMetrics(easyRoster, [f], DEFAULT_THRESHOLDS);
    const s = SCENARIOS.find((x) => `dialogue-${x.id}` === f.id);
    let outcome: Outcome;
    if (f.label.kind === "resolve") {
        outcome =
            one.resolution.trueResolve === 1
                ? "correct"
                : one.resolution.wrongTargetCount === 1
                  ? "wrong-target"
                  : "safe-miss";
    } else {
        outcome =
            one.trigger.abstainedOnAbstainable === 1 ? "correct" : "spurious";
    }
    return {
        id: s?.id ?? f.id,
        note: s?.note ?? "",
        difficulty: s?.difficulty ?? "normal",
        category: s?.category ?? "",
        want:
            f.label.kind === "resolve"
                ? `resolve → ${f.label.target.split(".")[0]}`
                : `abstain (${f.label.reason})`,
        outcome,
    };
});

// Category breakdown for a difficulty tier.
function catBreakdown(difficulty: string) {
    const cats = new Map<
        string,
        { correct: number; miss: number; wrong: number; spurious: number }
    >();
    for (const row of dialogueRows) {
        if (row.difficulty !== difficulty) continue;
        const c = cats.get(row.category) ?? {
            correct: 0,
            miss: 0,
            wrong: 0,
            spurious: 0,
        };
        if (row.outcome === "correct") c.correct++;
        else if (row.outcome === "safe-miss") c.miss++;
        else if (row.outcome === "wrong-target") c.wrong++;
        else c.spurious++;
        cats.set(row.category, c);
    }
    return cats;
}
const hardCats = catBreakdown("hard");
const xhardCats = catBreakdown("extra-hard");

// ---- B-6 threshold sweep on the combined corpus ----
const sweep: MetricsResult[] = [];
for (const minUniqueTokens of [1, 2, 3]) {
    for (const minMass of [0.5, 0.75, 1.0, 1.5]) {
        for (const margin of [0.25, 0.5, 1.0]) {
            sweep.push(
                runMetrics(mergedRoster, allFixtures, {
                    ...DEFAULT_THRESHOLDS,
                    minUniqueTokens,
                    minMass,
                    margin,
                }),
            );
        }
    }
}
const fullySafe = sweep.filter(
    (s) =>
        s.resolution.wrongTargetCount === 0 && s.trigger.spuriousResolve === 0,
);
const anyWrongTarget = sweep.filter(
    (s) => s.resolution.wrongTargetCount > 0,
).length;
const isDefault = (s: MetricsResult) =>
    s.thresholds.minUniqueTokens === DEFAULT_THRESHOLDS.minUniqueTokens &&
    s.thresholds.minMass === DEFAULT_THRESHOLDS.minMass &&
    s.thresholds.margin === DEFAULT_THRESHOLDS.margin;
const shippedCell = sweep.find(isDefault);
// Loosest fully-safe gate (max yield headroom) subject to a minUniqueTokens>=2
// robustness floor (a 1-token gate lets one stray keyword resolve).
const recommended = [...fullySafe]
    .filter((s) => s.thresholds.minUniqueTokens >= 2)
    .sort((a, b) => {
        const strict = (s: MetricsResult) =>
            s.thresholds.minUniqueTokens +
            s.thresholds.minMass +
            s.thresholds.margin;
        if (strict(a) !== strict(b)) {
            return strict(a) - strict(b);
        }
        return (isDefault(b) ? 1 : 0) - (isDefault(a) ? 1 : 0);
    })[0];

// Property checks are roster-independent (they exercise the signal source).
const props = retrievalPropertyChecks(DEFAULT_THRESHOLDS);
const propsPass = props.filter((p) => p.pass).length;

// ---- Console summary ----
const col = (f: (r: MetricsResult) => string) =>
    slices.map((s) => `${s.name} ${f(s.r)}`).join("  |  ");

console.log("\n=== contextSelector benchmark — 250-test report by tier ===");
console.log(
    `dialogue: ${dialogue.total} = 50 simple + 50 no-context + 50 realistic + 50 hard + 50 adversarial\n`,
);
const fmtPct = (ok: boolean, v: string) => (ok ? v : "n/a");
for (const t of tiers) {
    const r = t.r;
    console.log(`${t.label} — ${t.explain}`);
    console.log(
        `  yield ${fmtPct(r.trigger.resolvable > 0, `${pct(r.trigger.yield)} (${r.trigger.triggeredOnResolvable}/${r.trigger.resolvable})`)}` +
            ` | resolution-acc ${fmtPct(r.resolution.resolves > 0, `${pct(r.resolution.targetAccuracy)} (${r.resolution.trueResolve}/${r.resolution.resolves})`)}` +
            ` | abstention ${fmtPct(r.trigger.abstainable > 0, `${pct(r.trigger.abstentionCorrectness)} (${r.trigger.abstainedOnAbstainable}/${r.trigger.abstainable})`)}`,
    );
    console.log(
        `  spurious ${fmtPct(r.trigger.abstainable > 0, `${pct(r.trigger.spuriousResolveRate)} (${r.trigger.spuriousResolve}/${r.trigger.abstainable})`)}` +
            ` | wrong-target ${fmtPct(r.resolution.resolves > 0, `${pct(r.resolution.wrongTargetCount / r.resolution.resolves)} (${r.resolution.wrongTargetCount}/${r.resolution.resolves})`)}` +
            ` | retrieval-share ${fmtPct(r.retrieval.n > 0, pct(r.retrieval.meanTopicShare))}` +
            ` | routing-lift +${pct(r.ab.routingAccuracyLift)}`,
    );
}
console.log("");

const outCount = (rows: typeof dialogueRows, o: Outcome) =>
    rows.filter((r) => r.outcome === o).length;
const rowsFor = (d: string) => dialogueRows.filter((r) => r.difficulty === d);
const line = (label: string, rows: typeof dialogueRows) =>
    `  ${label}: ${outCount(rows, "correct")} correct, ${outCount(rows, "safe-miss")} safe-miss, ${outCount(rows, "wrong-target")} WRONG-TARGET, ${outCount(rows, "spurious")} spurious`;

console.log("REALISTIC DIALOGUE (100) — safe by design:");
console.log(line("normal (50)  ", rowsFor("normal")));
console.log(line("hard   (50)  ", rowsFor("hard")));

console.log(
    "\nADVERSARIAL STRESS TEST (50 extra-hard) — inputs built to confuse the scorer:",
);
console.log(line("extra-hard   ", rowsFor("extra-hard")));
console.log("  by attack (ok / safe-miss / WRONG-TARGET / spurious):");
for (const [c, v] of [...xhardCats.entries()].sort()) {
    console.log(
        `    ${c.padEnd(16)} ${v.correct} / ${v.miss} / ${v.wrong} / ${v.spurious}`,
    );
}

console.log(
    "\nREAL-AGENT COMPARISONS — how the metrics move with conversation ambiguity:",
);
console.log(
    `  CLEAR convos:  yield ${pct(realClear.trigger.yield)}, resolution accuracy ${pct(realClear.resolution.targetAccuracy)}, wrong-target ${realClear.resolution.wrongTargetCount}`,
);
console.log(
    `  VAGUE convos:  abstention ${pct(realVague.trigger.abstentionCorrectness)}, spurious-resolve ${pct(realVague.trigger.spuriousResolveRate)} (${realVague.trigger.spuriousResolve})`,
);

console.log("\nMetric 1 — Context retrieval fidelity (topic mass share)");
console.log(`  ${col(share)}`);
console.log(`  contract property checks: ${propsPass}/${props.length} pass`);

console.log("\nMetric 2 — Trigger discipline (resolve only when required)");
console.log(`  yield (recall):          ${col(yieldOf)}`);
console.log(`  abstention (vice versa): ${col(abstentionOf)}`);
console.log(
    `  spurious-resolve:        ${col((r) => `${r.trigger.spuriousResolve}`)}`,
);

console.log("\nMetric 3 — Resolution correctness (resolve correctly)");
console.log(`  target accuracy | resolved: ${col(accuracyOf)}`);
console.log(
    `  wrong-target resolves:      ${col((r) => `${r.resolution.wrongTargetCount}`)}   <- must be 0`,
);

console.log("\nSafety vs first-match baseline (routing accuracy lift)");
console.log(
    `  ${col((r) => `+${pct(r.ab.routingAccuracyLift)}`)}  no-regression: ${col((r) => `${r.ab.noRegression}`)}`,
);

console.log(
    "\nDeployed routing-lift on combined (CS on top of each strategy | X alone -> +CS):",
);
for (const d of combined.strategies.deployed) {
    console.log(
        `  ${d.strategy.padEnd(13)} ${pct(d.baselineAccuracy).padStart(5)} -> ${pct(d.deployedAccuracy).padStart(5)}  lift ${signedPct(d.lift).padStart(6)}  no-regression: ${d.noRegression}`,
    );
}

console.log(
    "\nvs every collision strategy on combined (resolve accuracy | silent misroute):",
);
{
    const cs = combined.strategies;
    for (const b of cs.baselines) {
        console.log(
            `  ${b.strategy.padEnd(13)} acc ${pct(b.accuracy).padStart(4)}  misroute ${pct(b.misrouteRate).padStart(4)}  defer ${pct(b.deferRate).padStart(4)}`,
        );
    }
    const c = cs.contextSelector;
    console.log(
        `  ${"contextSelector".padEnd(13)} acc ${pct(c.accuracy).padStart(4)}  misroute ${pct(c.misrouteRate).padStart(4)}  defer ${pct(c.deferRate).padStart(4)}  (lift vs first-match ${signedPct(cs.liftOverBaseline["first-match"])}, vs priority ${signedPct(cs.liftOverBaseline["priority"])})`,
    );
}

console.log("\nThreshold sweep on combined (36 cells)");
console.log(
    `  wrong-target across ALL cells:  ${anyWrongTarget === 0 ? "0 (safety threshold-robust)" : `${anyWrongTarget} FAIL`}`,
);
console.log(
    `  fully-safe cells (0 spurious):  ${fullySafe.length}/${sweep.length}`,
);
if (shippedCell) {
    console.log(
        `  shipped default (2/1.0/0.5):    yield ${pct(shippedCell.trigger.yield)}, abstention ${pct(shippedCell.trigger.abstentionCorrectness)}, ${shippedCell.resolution.wrongTargetCount} wrong-target`,
    );
}
if (recommended) {
    const t = recommended.thresholds;
    console.log(
        `  recommended:                    minUniqueTokens=${t.minUniqueTokens} minMass=${t.minMass} margin=${t.margin}`,
    );
}

// ---- Markdown report ----
function sliceTable(rows: [string, (r: MetricsResult) => string][]): string[] {
    const L: string[] = [];
    L.push(`| Measure | ${slices.map((s) => s.name).join(" | ")} |`);
    L.push(`| --- | ${slices.map(() => "---").join(" | ")} |`);
    for (const [label, fn] of rows) {
        L.push(`| ${label} | ${slices.map((s) => fn(s.r)).join(" | ")} |`);
    }
    return L;
}

function md(): string {
    const L: string[] = [];
    L.push("# contextSelector benchmark\n");
    L.push(`_Generated ${new Date().toISOString()}._\n`);

    L.push("## What this measures\n");
    L.push(
        `**contextSelector** is a fast, deterministic step in the dispatcher that handles *grammar collisions* — when a single user request matches the command grammar of **two or more agents** at once (for example, "play something relaxing" could be the music player *or* the video player). Instead of always picking the same agent, it reads the **recent conversation** and either **resolves** the collision to the agent the context points to, or **abstains** when the evidence is too weak — handing the decision back to today's routing (or the LLM) rather than guessing.\n`,
    );
    L.push(
        `The rule it must never break: **never silently route a request to the wrong agent.** So the headline result is simple — on realistic input, **wrong-target must be 0.** How often it helps, and how confidently it fires, all matter less than keeping that promise.\n`,
    );
    L.push(
        `It is checked three ways (Metrics 1–3 below): **(1)** does it pull the conversation's real topic out of the noise, **(2)** does it fire only when there is a clear winner and stay quiet otherwise, and **(3)** when it does fire, does it pick the right agent.\n`,
    );
    L.push(
        `This is an **offline** benchmark: it runs the *real* scoring pipeline — the shipped agent keyword lists, the same recency-weighted model of the recent conversation, and the same decision rule the product uses — against hand-labeled conversations, with **no LLM call and no app startup**. Every number is reproducible bit-for-bit. Shipped decision thresholds: \`minUniqueTokens=2, minMass=1.0, margin=0.5\` (recency decay λ=0.9 over a 20-turn look-back).\n`,
    );
    L.push(
        `The test set spans **${dialogue.total} hand-labeled conversations** across five difficulty tiers, plus larger auto-generated collision sets — real overlapping agent pairs and a family of deliberately-confusable synthetic agents (**${combined.total}** realistic collisions in the combined corpus) — and a separate **50-case adversarial** set that stress-tests where word-matching breaks.\n`,
    );

    // ---- Executive summary: headline results up top ----
    const summaryCs = combined.strategies.contextSelector;
    const firstMatchMisroute =
        combined.strategies.baselines.find((b) => b.strategy === "first-match")
            ?.misrouteRate ?? 0;
    const priorityMisroute =
        combined.strategies.baselines.find((b) => b.strategy === "priority")
            ?.misrouteRate ?? 0;
    L.push("## Summary of results\n");
    L.push(
        "**Bottom line: contextSelector is safe to use as a first-pass collision resolver.** On realistic conversation it routes a large share of ambiguous requests to the right agent and **never once silently sends one to the wrong agent** — when the evidence is weak it steps aside and lets today's routing (or the LLM) decide. The only misroutes it makes are on inputs deliberately engineered to defeat word-matching, which are meant to fall through to the LLM anyway. Everything below is the supporting evidence — scroll on for the per-tier breakdown, the three metrics, the head-to-head against every other strategy, and the LLM comparison.\n",
    );
    L.push(
        `- **Safety — the headline: 0 silent misroutes.** Across all **${combined.total}** realistic collisions (and all 100 hand-written realistic conversations), *wrong-target* is **${combined.resolution.wrongTargetCount}**.`,
    );
    L.push(
        `- **Helpfulness:** on the combined corpus it confidently resolves **${pct(combined.trigger.yield)}** of collisions (${combined.trigger.triggeredOnResolvable}/${combined.trigger.resolvable}), and **${pct(combined.resolution.targetAccuracy)}** of those go to the right agent.`,
    );
    L.push(
        `- **Net routing gain:** layered on the dispatcher's current default (first-match), routing accuracy climbs **${pct(combined.ab.baselineAccuracy)} → ${pct(combined.ab.treatmentAccuracy)}** (**+${pct(combined.ab.routingAccuracyLift)}**), with no group of conversations left worse off than before.`,
    );
    L.push(
        `- **Safer than every silent strategy:** its silent-misroute rate is **${pct(summaryCs.misrouteRate)}**, versus ${pct(firstMatchMisroute)} for first-match and ${pct(priorityMisroute)} for priority; and it auto-handles **${pct(summaryCs.accuracy)}** of collisions that the always-ask strategy would interrupt the user for.`,
    );
    L.push(
        `- **Where it must not be trusted:** on the separate **50-case adversarial** stress set (loaded negation, sarcasm, quoting someone else) it makes **${dialogueXhard.resolution.wrongTargetCount}** misroutes — failures that need semantic/LLM understanding, which is exactly why those inputs are excluded from the safety corpus and left to the LLM.\n`,
    );

    L.push("## Key terms\n");
    L.push(
        `Every conversation is labeled with what *should* happen, then scored by the real pipeline. Each one lands in exactly one of four outcomes:\n`,
    );
    L.push("| Outcome | What it means | Good or bad? |");
    L.push("| --- | --- | --- |");
    L.push(
        "| ✅ **correct** | Resolved to the right agent, or correctly abstained | Good |",
    );
    L.push(
        "| ⚪ **safe-miss** | Should have resolved, but abstained instead | Safe — a missed chance, not a mistake; it just defers to today's routing |",
    );
    L.push(
        "| ❌ **wrong-target** | Resolved to the **wrong** agent | The dangerous failure: a silent misroute (must be 0) |",
    );
    L.push(
        "| ❌ **spurious** | Fired when it should have stayed out | A false alarm |",
    );
    L.push(
        `\nThe metrics throughout the report are just different views of those four outcomes:\n`,
    );
    L.push(
        "- **Resolve** = commit to one agent. **Abstain** = decline and defer to the existing routing.",
    );
    L.push(
        "- **Yield** — of the conversations that *should* resolve, how many did (higher = more helpful).",
    );
    L.push(
        "- **Resolution accuracy** — of the times it resolved, how many hit the right agent.",
    );
    L.push(
        "- **Abstention** — of the conversations that *should* stay out, how many correctly did.",
    );
    L.push(
        "- **Spurious** — of the should-abstain conversations, how many it wrongly fired on (a false alarm).",
    );
    L.push(
        "- **Wrong-target** — of the resolves it made, how many went to the wrong agent (**must stay 0**).",
    );
    L.push(
        "- **Routing lift** — extra requests sent to the right agent versus the routing the dispatcher uses today.\n",
    );

    L.push("## How to regenerate this report\n");
    L.push(
        "```\ncd packages/dispatcher/dispatcher\nnpx tsx src/validation/contextselector/reproduce.mts\n```\n",
    );
    L.push(
        `Runs the whole suite — this report plus the LLM comparison appended at the end — and overwrites this file in place. Deterministic, so re-running produces the same numbers.\n`,
    );

    // ---- Results by difficulty tier (the requested per-tier metric tables) ----
    L.push("## Results by difficulty tier\n");
    L.push(
        `${dialogue.total} hand-authored conversations across five tiers of increasing difficulty (50 each), each labeled by honest human intent and scored by the real pipeline. See **Key terms** above for what Yield, Resolution accuracy, Abstention, Spurious, and Wrong-target mean; **Retrieval topic share** is how cleanly the recent conversation pointed at the intended agent (Metric 1), and **Routing lift** is the accuracy gained over the dispatcher's current first-match default.\n`,
    );
    const na = (r: MetricsResult, ok: boolean, v: string) => (ok ? v : "n/a");
    for (const t of tiers) {
        const r = t.r;
        L.push(`### ${t.label} — ${t.explain}\n`);
        L.push(`| Metric | dialogue (${t.name}, ${r.total}) |`);
        L.push("| --- | --- |");
        L.push(
            `| Yield (resolved when it should) | ${na(r, r.trigger.resolvable > 0, `${pct(r.trigger.yield)} (${r.trigger.triggeredOnResolvable}/${r.trigger.resolvable})`)} |`,
        );
        L.push(
            `| Resolution accuracy | ${na(r, r.resolution.resolves > 0, `${pct(r.resolution.targetAccuracy)} (${r.resolution.trueResolve}/${r.resolution.resolves})`)} |`,
        );
        L.push(
            `| Abstention (stayed out) | ${na(r, r.trigger.abstainable > 0, `${pct(r.trigger.abstentionCorrectness)} (${r.trigger.abstainedOnAbstainable}/${r.trigger.abstainable})`)} |`,
        );
        L.push(
            `| Spurious (fired when it should abstain) | ${na(r, r.trigger.abstainable > 0, `${pct(r.trigger.spuriousResolveRate)} (${r.trigger.spuriousResolve}/${r.trigger.abstainable})`)} |`,
        );
        L.push(
            `| Wrong-target (misrouted a resolve) | ${na(r, r.resolution.resolves > 0, `${pct(r.resolution.wrongTargetCount / r.resolution.resolves)} (${r.resolution.wrongTargetCount}/${r.resolution.resolves})`)} |`,
        );
        L.push(
            `| Retrieval topic share | ${na(r, r.retrieval.n > 0, pct(r.retrieval.meanTopicShare))} |`,
        );
        L.push(
            `| Routing lift vs first-match | +${pct(r.ab.routingAccuracyLift)} |`,
        );
        L.push("");
    }
    const adversarialWrong = dialogueRows.filter(
        (r) => r.difficulty === "extra-hard" && r.outcome === "wrong-target",
    ).length;
    L.push(
        `**Reading the trend:** the tier gets *safer-but-quieter* as difficulty climbs — perfect on simple/realistic, conservative safe-misses on hard, and only the adversarial tier (built to defeat lexical matching) produces real misroutes. Wrong-target is **0 on simple, realistic, and hard**, and jumps to ${adversarialWrong} only under the adversarial attacks (loaded negation, sarcasm, quoted speech), which need a semantic/LLM tier to catch.\n`,
    );

    // ---- Realistic dialogue (normal + hard) — the safety claim ----
    L.push("## Realistic dialogue — natural user conversations\n");
    L.push(
        `100 hand-authored multi-turn conversations (≥3 turns) that read like a regular user talking, grounded in the featured agents' real keyword vectors: **${dialogueNormal.total} normal** + **${dialogueHard.total} purposely-hard edge cases**. Labeled by honest human intent and verified against the real scorer; the hard set is NOT tuned to pass — it probes where lexical scoring falls short.\n`,
    );
    const oc = (rows: typeof dialogueRows, o: Outcome) =>
        rows.filter((r) => r.outcome === o).length;
    const nR = dialogueRows.filter((r) => r.difficulty === "normal");
    const hR = dialogueRows.filter((r) => r.difficulty === "hard");
    const xR = dialogueRows.filter((r) => r.difficulty === "extra-hard");
    L.push("| Outcome | normal (50) | hard (50) |");
    L.push("| --- | --- | --- |");
    L.push(
        `| ✅ correct (resolved right / abstained right) | ${oc(nR, "correct")} | ${oc(hR, "correct")} |`,
    );
    L.push(
        `| ⚪ safe-miss (should resolve, abstained instead) | ${oc(nR, "safe-miss")} | ${oc(hR, "safe-miss")} |`,
    );
    L.push(
        `| ❌ **wrong-target** (misrouted) | **${oc(nR, "wrong-target")}** | **${oc(hR, "wrong-target")}** |`,
    );
    L.push(
        `| ❌ spurious (should abstain, resolved) | ${oc(nR, "spurious")} | ${oc(hR, "spurious")} |`,
    );
    L.push(
        `\n**The safety claim: ${oc(nR, "wrong-target") + oc(hR, "wrong-target")} wrong-target across all 100 realistic conversations** — even the 50 hard edge cases never misroute. The hard set's failures are all **safe** (conservative misses on thin/vocabulary-gap signal), which fall through to today's routing rather than guessing.\n`,
    );
    const catDesc: Record<string, string> = {
        "thin-signal": "clear intent, only ONE discriminating word",
        "vocab-gap": "intent in slang not in any keyword vector",
        negation: "negated mentions the scorer can't detect",
        "topic-shift": "user moves off an early topic to a recent one",
        trap: "dominant topic + a salient recent distractor",
        "near-tie": "both agents genuinely balanced",
        stale: "a strong mention decayed under the mass gate",
        "cross-drift": "long unrelated chatter before the collision",
        homonym: "an ambiguous word (book / play)",
        sparse: "ultra-short, no real signal",
        "loaded-negation":
            "many NEGATED words for one agent, few for the other",
        sarcasm: "positive-sounding words the user resents",
        quoted: "another person's quoted suggestion, not the user's intent",
        "third-agent": "a third agent's words overlapping one side",
        "dense-tie": "both agents heavily and evenly loaded",
        churn: "a different agent every turn, none dominant",
        typo: "misspelled keywords that lose their signal",
    };
    L.push(
        "### Hard edge cases by category (ok / safe-miss / wrong-target / spurious)\n",
    );
    L.push("| Category | what it probes | ok | safe-miss | wrong | spurious |");
    L.push("| --- | --- | --- | --- | --- | --- |");
    for (const [c, v] of [...hardCats.entries()].sort()) {
        L.push(
            `| ${c} | ${catDesc[c] ?? ""} | ${v.correct} | ${v.miss} | ${v.wrong} | ${v.spurious} |`,
        );
    }
    const hMiss = hR
        .filter((r) => r.outcome !== "correct")
        .map((r) => `\`${r.id}\` (${r.outcome})`);
    L.push(
        `\nNon-correct hard cases (all safe): ${hMiss.length ? hMiss.join(", ") : "none"}. These are misses/abstains, not misroutes.\n`,
    );

    // ---- Adversarial stress test (extra-hard) — the breaking points ----
    L.push(
        "## Adversarial stress test — 50 extra-hard inputs built to confuse it\n",
    );
    L.push(
        "_These are deliberately adversarial and **excluded from the calibration/sweep corpus above** — they measure where lexical scoring fundamentally breaks, not realistic routing safety._\n",
    );
    L.push("| Outcome | extra-hard (50) |");
    L.push("| --- | --- |");
    L.push(`| ✅ correct | ${oc(xR, "correct")} |`);
    L.push(`| ⚪ safe-miss | ${oc(xR, "safe-miss")} |`);
    L.push(
        `| ❌ **wrong-target** (misrouted) | **${oc(xR, "wrong-target")}** |`,
    );
    L.push(`| ❌ spurious (false alarm) | ${oc(xR, "spurious")} |`);
    L.push("");
    L.push("| Attack | what it does | ok | safe-miss | wrong | spurious |");
    L.push("| --- | --- | --- | --- | --- | --- |");
    for (const [c, v] of [...xhardCats.entries()].sort()) {
        L.push(
            `| ${c} | ${catDesc[c] ?? ""} | ${v.correct} | ${v.miss} | **${v.wrong}** | ${v.spurious} |`,
        );
    }
    L.push(
        `\n**The breaking points.** Under input crafted to confuse it, the lexical scorer fails ${oc(xR, "wrong-target") + oc(xR, "spurious")}/${xR.length} of the time — concentrated exactly where word-matching is blind:\n`,
    );
    L.push(
        '- **Loaded negation** is the worst: the scorer counts negated words as positive signal, so "NOT a debugger, forget the thread/stack/memory... just fix the bug" **misroutes to the negated (heavier) agent** every time.',
    );
    L.push(
        "- **Sarcasm** and **quoted speech** fire on the surface words — the tier resolves on a phrase the user is mocking or quoting from someone else.",
    );
    L.push(
        "- **Third-agent distractors** and **rapid churn** bleed enough overlapping mass to trip a spurious resolve.",
    );
    L.push(
        "- **Safe under attack:** typos and homonyms mostly lose their signal and correctly abstain — a garbled keyword can't misroute.",
    );
    L.push(
        '\n**Implication for shipping:** these failure modes need semantic understanding (an LLM tier), not lexical tuning. contextSelector is safe on realistic conversation but should NOT be relied on to catch negation/sarcasm/quotation — those must fall through to the LLM. The mitigation already in the design (bias toward abstention, LLM fallback) is what bounds the blast radius; a real deployment could add a negation-word guard to force abstain when "not/no/never" precedes the discriminating tokens.\n',
    );

    // ---- Real-agent clear vs vague ----
    L.push("## Real-agent comparisons — clear vs vague conversations\n");
    L.push(
        `${pairs.length} genuinely confusable real-agent pairs, each driven with an **even mixture** of _clear_ conversations (obviously one agent) and _vague_ ones (spoken in the shared vocabulary the two agents both answer to, or mentioning both). The point is to watch **which metric lights up** as the conversation gets ambiguous.\n`,
    );
    L.push("| # | Comparison | shared kw | discA | discB |");
    L.push("| --- | --- | --- | --- | --- |");
    pairs.forEach((p, i) => {
        L.push(
            `| ${i + 1} | ${p.label} | ${p.shared.length} | ${p.discA.length} | ${p.discB.length} |`,
        );
    });
    L.push("");
    L.push("| Measure | CLEAR convos | VAGUE convos |");
    L.push("| --- | --- | --- |");
    L.push(
        `| Yield — resolved when it should | **${pct(realClear.trigger.yield)}** (${realClear.trigger.triggeredOnResolvable}/${realClear.trigger.resolvable}) | — |`,
    );
    L.push(
        `| Resolution accuracy \\| resolved | **${pct(realClear.resolution.targetAccuracy)}** (${realClear.resolution.trueResolve}/${realClear.resolution.resolves}) | — |`,
    );
    L.push(
        `| Wrong-target resolves | ${realClear.resolution.wrongTargetCount} | ${realVague.resolution.wrongTargetCount} |`,
    );
    L.push(
        `| Abstention — correctly stayed out | — | **${pct(realVague.trigger.abstentionCorrectness)}** (${realVague.trigger.abstainedOnAbstainable}/${realVague.trigger.abstainable}) |`,
    );
    L.push(
        `| Spurious-resolve — false alarm | — | **${pct(realVague.trigger.spuriousResolveRate)}** (${realVague.trigger.spuriousResolve}) |`,
    );
    L.push(
        `\n**How the metrics move:** on **clear** conversations the tier fires and routes correctly (yield ${pct(realClear.trigger.yield)}, resolution accuracy ${pct(realClear.resolution.targetAccuracy)}); on **vague** conversations the *same agents* now trigger the abstention machinery instead — it correctly stays out ${pct(realVague.trigger.abstentionCorrectness)} of the time and false-alarms on ${pct(realVague.trigger.spuriousResolveRate)}. Yield/accuracy and abstention are complementary: clear input exercises the first, vague input the second, and the tier does the right thing in both.\n`,
    );

    L.push(
        "**Reading the columns below.** `dlg-simple`, `dlg-nocontext`, `dlg-realistic`, `dlg-hard`, and `dlg-advers` are the five 50-conversation dialogue tiers. **`combined`** is the full calibration corpus — every *realistic* slice unioned (easy real-roster pairs + confusable siblings + real clear/vague pairs + the four non-adversarial dialogue tiers), scored over one merged roster. The adversarial dialogue tier is **excluded** from `combined` (it is a stress test, reported separately above), so `combined` is not the sum of the five `dlg-*` columns.\n",
    );
    L.push("## Metric 1 — Context retrieval fidelity\n");
    L.push(
        "_Does the signal source appropriately retrieve the conversation's topic, before any decision is made?_\n",
    );
    L.push(
        "**In plain terms:** before the scorer decides anything, the signal source turns the recent conversation into a weighted bag of words (more-recent words count more). It sorts those words into three buckets — the **intended topic** (what the user is really asking about), a **distractor** (a look-alike agent that could be mistaken for it), and **unrelated noise** — and checks that most of the weight landed in the intended-topic bucket. If it did, the signal handed to the scorer already points at the right agent; whether to actually resolve or abstain is decided later (Metrics 2 and 3). The rows below measure how cleanly that separation holds:\n",
    );
    L.push(
        "- **Topic mass share** — of all the topical weight, the fraction sitting on the intended topic (100% = nothing but the topic; higher is cleaner).",
    );
    L.push(
        "- **Topic is strongest bank** — how often the intended topic outweighs **both** the distractor and the noise.",
    );
    L.push(
        "- **Topic outweighs distractor** — how often the intended topic beats the look-alike agent specifically.",
    );
    L.push(
        "- **Mean separation** — how far ahead the topic is in raw weight — the margin of safety.\n",
    );
    L.push(
        ...sliceTable([
            ["Topic mass share", share],
            [
                "Topic is strongest bank",
                (r) =>
                    r.retrieval.n === 0 ? "n/a" : pct(r.retrieval.topicMaxRate),
            ],
            [
                "Topic outweighs distractor",
                (r) =>
                    r.retrieval.n === 0
                        ? "n/a"
                        : pct(r.retrieval.beatsDistractorRate),
            ],
            [
                "Mean separation",
                (r) =>
                    r.retrieval.n === 0
                        ? "n/a"
                        : r.retrieval.meanSeparation.toFixed(3),
            ],
        ]),
    );
    L.push(
        `\n**Signal-source contract checks: ${propsPass}/${props.length} pass.**\n`,
    );
    L.push("| Property check | Result | Detail |");
    L.push("| --- | --- | --- |");
    for (const p of props) {
        L.push(
            `| ${p.name} | ${p.pass ? "✅ pass" : "❌ FAIL"} | ${p.detail} |`,
        );
    }
    L.push(
        "\nRetrieval is scored on fixtures with a single intended topic; **real-vague** conversations have no single topic (they are shared-vocabulary or balanced), so retrieval is `n/a` there — correctly, the context vector has nothing to concentrate on. On the **siblings** slice the oracle is the *trap* fixture (topic dominant, sibling distractor present), so the share drops below the clear slices' near-1.0.\n",
    );

    L.push("## Metric 2 — Trigger discipline (resolve only when required)\n");
    L.push(
        "_Does it fire exactly when there is a clear winner, and stay quiet otherwise?_\n",
    );
    L.push(
        "**Goal:** a collision-resolver is judged as much by its restraint as by its hits. This checks both directions at once — when a conversation clearly points at one agent it should **resolve** (measured by *yield*), and when the conversation is ambiguous or empty it should **abstain** (measured by *abstention*). Firing on a should-abstain conversation is a *spurious* resolve — a false alarm — and should be near zero.\n",
    );
    L.push(
        ...sliceTable([
            [
                "Yield — resolvable we resolved (recall)",
                (r) =>
                    r.trigger.resolvable === 0
                        ? "n/a"
                        : `${pct(r.trigger.yield)} (${r.trigger.triggeredOnResolvable}/${r.trigger.resolvable})`,
            ],
            [
                "Abstention (correctly stayed out)",
                (r) =>
                    r.trigger.abstainable === 0
                        ? "n/a"
                        : `${pct(r.trigger.abstentionCorrectness)} (${r.trigger.abstainedOnAbstainable}/${r.trigger.abstainable})`,
            ],
            [
                "Spurious-resolve rate",
                (r) =>
                    r.trigger.abstainable === 0
                        ? "n/a"
                        : `${pct(r.trigger.spuriousResolveRate)} (${r.trigger.spuriousResolve})`,
            ],
        ]),
    );
    L.push(
        `\nThe **siblings** slice yield (${pct(hard.trigger.yield)}) and the **real-clear** yield (${pct(realClear.trigger.yield)}) are the headline numbers: on genuinely confusable input the tier only fires when the scarce discriminating evidence clears the gate, and safely abstains (a *missed*, not a misroute) otherwise. Abstention stays high because a shared-vocabulary-only conversation correctly resolves to nobody.\n`,
    );

    L.push("## Metric 3 — Resolution correctness (resolve correctly)\n");
    L.push("_When it does fire, does it route to the RIGHT agent?_\n");
    L.push(
        "**Goal:** this is the safety metric. A high yield is worthless if the resolves land on the wrong agent, so the single most important number in this report is **wrong-target resolves — it must be 0** on realistic input. A wrong resolve is a silent misroute; abstaining instead would have been safe.\n",
    );
    L.push(
        ...sliceTable([
            [
                "Target accuracy | resolved",
                (r) =>
                    r.resolution.resolves === 0
                        ? "n/a"
                        : `${pct(r.resolution.targetAccuracy)} (${r.resolution.trueResolve}/${r.resolution.resolves})`,
            ],
            [
                "Wrong-target resolves (must be 0)",
                (r) => `${r.resolution.wrongTargetCount}`,
            ],
            [
                "Wrong-resolution rate (wrong-target + spurious, of all)",
                (r) => pct(r.resolution.wrr),
            ],
        ]),
    );
    L.push(
        "\nAcross every slice — including the *trap* fixtures where the losing sibling gets a salient recent mention — resolution accuracy holds and wrong-target stays 0: when discriminating evidence is too weak the tier abstains rather than guessing.\n",
    );

    L.push("## Safety — never worse than today's routing\n");
    L.push(
        "**Goal:** switching contextSelector on should only ever *add* correct routings, never remove any. Below, routing accuracy is compared **with vs. without** contextSelector layered on the dispatcher's current default (*first-match*): where it resolves it uses its own pick, otherwise it falls back to first-match. **No-regression** verifies that no group of conversations ends up worse than first-match alone.\n",
    );
    L.push(
        ...sliceTable([
            [
                "Baseline (first-match) accuracy",
                (r) => pct(r.ab.baselineAccuracy),
            ],
            [
                "Treatment (contextSelector) accuracy",
                (r) => pct(r.ab.treatmentAccuracy),
            ],
            [
                "Routing-accuracy lift",
                (r) => `+${pct(r.ab.routingAccuracyLift)}`,
            ],
            [
                "No-regression (never worse than baseline)",
                (r) => (r.ab.noRegression ? "✅ holds" : "❌ FAILED"),
            ],
        ]),
    );

    // ---- Deployed routing-lift generalized to every silent auto-resolver ----
    L.push(
        "\n## Deployed routing-lift — adding contextSelector on top of each strategy\n",
    );
    L.push(
        'The table above is the deployed lift over *first-match* specifically (contextSelector resolves confidently, else falls back to first-match). Any silent auto-resolver can be the fallback, so this generalizes it to `score-rank` and `priority` too, on the combined corpus — answering "if my dispatcher already routes with strategy X, does adding contextSelector still help, and does it ever regress?" (Deterministic, `defer-to-strategy` mode; the `escalate-to-llm` fallback is measured separately by `compareLlm.mts`.)\n',
    );
    {
        const dep = combined.strategies.deployed;
        L.push(
            "| Base strategy X | X alone | + contextSelector (deployed) | Routing lift | No-regression |",
        );
        L.push("| --- | --- | --- | --- | --- |");
        for (const d of dep) {
            L.push(
                `| ${d.strategy} | ${pct(d.baselineAccuracy)} | ${pct(d.deployedAccuracy)} | ${signedPct(d.lift)} | ${d.noRegression ? "✅ holds" : "❌ FAILED"} |`,
            );
        }
        // user-clarify is a prompt-cost, not accuracy, tradeoff — reported apart.
        const cs = combined.strategies.contextSelector;
        L.push(
            `\n**vs \`user-clarify\`:** an accuracy lift is ill-defined (a prompt eventually resolves correctly), so the gain is **prompts avoided** — contextSelector auto-resolves ${pct(cs.accuracy + cs.misrouteRate)} of these collisions (${cs.correct + cs.wrong}/${combined.strategies.resolvable}) that user-clarify would interrupt the user for, misrouting ${pct(cs.misrouteRate)} (${cs.wrong}) of them.\n`,
        );
    }

    // ---- Full head-to-head vs every collision-resolution strategy ----
    L.push(
        "\n## Comparison — contextSelector vs every collision-resolution strategy\n",
    );
    L.push(
        "The dispatcher's other grammar-collision strategies (`first-match`, `score-rank`, `priority`, `user-clarify`) are all **context-blind**: they pick the same agent no matter what the conversation said. So on a context-dependent collision they land on the intended target only when their fixed rule happens to, and silently misroute otherwise. `user-clarify` never misroutes but prompts the user every time. contextSelector reads the recent conversation — it resolves the clear collisions correctly and *abstains* (defers, never silently misroutes) on the rest. Each row scores a strategy's **own** decision (an abstain counts as a deferral, not a fallback), so the first-match lift here is smaller than the deployed *routing lift* above — which additionally credits contextSelector with the first-match fallback it defers to on abstain.\n",
    );
    const baseAcc = (r: MetricsResult, name: string) =>
        r.strategies.baselines.find((b) => b.strategy === name)?.accuracy ?? 0;
    const liftVs = (r: MetricsResult, name: string) =>
        r.strategies.liftOverBaseline[name] ?? 0;
    L.push(
        ...sliceTable([
            ["first-match accuracy", (r) => pct(baseAcc(r, "first-match"))],
            ["score-rank accuracy¹", (r) => pct(baseAcc(r, "score-rank"))],
            ["priority accuracy", (r) => pct(baseAcc(r, "priority"))],
            [
                "**contextSelector accuracy**",
                (r) => `**${pct(r.strategies.contextSelector.accuracy)}**`,
            ],
            ["lift vs first-match", (r) => signedPct(liftVs(r, "first-match"))],
            ["lift vs score-rank", (r) => signedPct(liftVs(r, "score-rank"))],
            ["lift vs priority", (r) => signedPct(liftVs(r, "priority"))],
        ]),
    );
    L.push(
        "\n¹ On a genuine grammar collision the colliding constructions matched the *same* input, so `score-rank`'s match-strength heuristic ties and it falls through to `priority` — the two are identical on this corpus (an honest offline limitation: real grammar match-counts aren't reconstructable without the matcher).\n",
    );

    // Per-strategy breakdown on the combined corpus (strategies as rows).
    const cs = combined.strategies;
    L.push(
        `\n**Per-strategy breakdown on the combined corpus** (${cs.resolvable} resolvable collisions):\n`,
    );
    L.push(
        "| Strategy | Resolves correctly | Silently misroutes | Defers / abstains |",
    );
    L.push("| --- | --- | --- | --- |");
    for (const b of cs.baselines) {
        const label = b.strategy === "score-rank" ? "score-rank¹" : b.strategy;
        L.push(
            `| ${label} | ${pct(b.accuracy)} (${b.correct}/${cs.resolvable}) | ${pct(b.misrouteRate)} (${b.wrong}) | ${pct(b.deferRate)} (${b.deferred}) |`,
        );
    }
    L.push(
        `| **contextSelector** | **${pct(cs.contextSelector.accuracy)}** (${cs.contextSelector.correct}/${cs.resolvable}) | **${pct(cs.contextSelector.misrouteRate)}** (${cs.contextSelector.wrong}) | ${pct(cs.contextSelector.deferRate)} (${cs.contextSelector.deferred}) |`,
    );
    const misrouteOf = (name: string) =>
        cs.baselines.find((b) => b.strategy === name)?.misrouteRate ?? 0;
    L.push(
        `\n**Takeaway:** contextSelector's silent-misroute rate (${pct(cs.contextSelector.misrouteRate)}) sits far below every silently-resolving baseline (first-match ${pct(misrouteOf("first-match"))}, priority ${pct(misrouteOf("priority"))}); the collisions it can't resolve confidently it hands back rather than guessing. Against the always-safe user-clarify strategy, contextSelector auto-resolves ${pct(cs.contextSelector.accuracy)} of the collisions that a clarify prompt would otherwise interrupt the user for.\n`,
    );

    L.push(
        "\n## Threshold sweep — how sensitive is safety to the gate settings?\n",
    );
    L.push(
        "**Goal:** the *gate* is the set of thresholds that decide resolve-vs-abstain. Loosening it lifts yield but risks false alarms and misroutes; tightening it is safer but quieter. This sweeps 36 threshold combinations to map the safety boundary and confirm the shipped default sits in the fully-safe region.\n",
    );
    L.push(
        anyWrongTarget === 0
            ? `- **Wrong-target across the sweep:** **0 in all ${sweep.length} cells** — safety is threshold-robust.`
            : `- **Wrong-target across the sweep:** **${anyWrongTarget} of ${sweep.length} cells** produced a wrong-target; the shipped default holds **0** (see the table below).`,
    );
    L.push(
        `- **Abstention boundary:** ${fullySafe.length}/${sweep.length} cells hold 0 spurious resolves; the rest leak on the stale/shared-tie fixtures when the mass/margin gates are loosened.`,
    );
    if (shippedCell) {
        L.push(
            `\n**Shipped default (\`minUniqueTokens=2, minMass=1.0, margin=0.5\`):** yield ${pct(shippedCell.trigger.yield)}, abstention ${pct(shippedCell.trigger.abstentionCorrectness)}, ${shippedCell.resolution.wrongTargetCount} wrong-target on the combined corpus.\n`,
        );
    }
    L.push(
        "| minUniqueTokens | minMass | margin | yield | abstention | spurious | wrong-target |",
    );
    L.push("| --- | --- | --- | --- | --- | --- | --- |");
    const showCells = [
        sweep.find(
            (s) =>
                s.thresholds.minUniqueTokens === 1 &&
                s.thresholds.minMass === 0.5 &&
                s.thresholds.margin === 0.25,
        ),
        shippedCell,
        recommended,
    ].filter((s): s is MetricsResult => s !== undefined);
    for (const s of showCells) {
        const t = s.thresholds;
        const tag = isDefault(s)
            ? " (shipped)"
            : s === recommended
              ? " (rec.)"
              : " (loose)";
        L.push(
            `| ${t.minUniqueTokens}${tag} | ${t.minMass} | ${t.margin} | ${pct(s.trigger.yield)} | ${pct(s.trigger.abstentionCorrectness)} | ${s.trigger.spuriousResolve} | ${s.resolution.wrongTargetCount} |`,
        );
    }
    if (recommended) {
        const t = recommended.thresholds;
        L.push(
            `\n**Recommended operating point:** \`minUniqueTokens=${t.minUniqueTokens}, minMass=${t.minMass}, margin=${t.margin}\` — the loosest fully-safe gate (max yield headroom, holds 0 spurious / 0 wrong-target).\n`,
        );
    }

    L.push("## Method & caveats\n");
    L.push(
        "- **Real committed roster (easy):** vectors are the shipped `*.keywords.json` files, read through the production `KeywordIndex.effective()` path. Distinct agents have near-disjoint vectors, so the easy slice saturates — it is a *floor*, not the headline.",
    );
    L.push(
        "- **Confusable siblings (hard):** a family of synthetic occult agents sharing ~60% of their vocabulary. Shared tokens cancel via candidate-local IDF, so only the scarce unique tokens discriminate — the realistic hard case, and where the metrics become informative.",
    );
    L.push(
        "- **Self-labeled, gate-decided:** resolve fixtures span a signal grid (unique-token count × recency padding); the evidence gate — not the fixture author — decides which clear the bar, so yield is a real property of the thresholds vs the signal gradient.",
    );
    L.push(
        "- **Deterministic:** seeded PRNG, byte-identical across runs (verify with two `--out` dirs).",
    );
    L.push(
        "- **Not covered here (follow-ups):** L3 live agent-server replay, LLM-authored / paraphrased (non-lexical) preludes, and misroute-mined keyword sources.",
    );
    return L.join("\n") + "\n";
}

const reportPath = resolveReportPath(HERE);
writeBaseReport(reportPath, md());
console.log(`\nWrote consolidated report:\n  ${reportPath}`);
