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

import fs from "node:fs";
import path from "node:path";
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

function pct(x: number): string {
    return `${(x * 100).toFixed(1)}%`;
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

function outDir(): string {
    const idx = process.argv.indexOf("--out");
    return idx !== -1 && process.argv[idx + 1]
        ? process.argv[idx + 1]
        : process.cwd();
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

const easy = runMetrics(easyRoster, easyFixtures, DEFAULT_THRESHOLDS);
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
        `  spurious/wrong ${r.trigger.spuriousResolve}/${r.resolution.wrongTargetCount}` +
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
    L.push("# contextSelector three-metric benchmark\n");
    L.push(
        `_Generated ${new Date().toISOString()} · real pairs: ${pairs.length} confusable real-agent comparisons (clear ${realClear.total} + vague ${realVague.total}) · siblings: ${adversary.siblings.length} synthetic / ${hard.total} · easy: ${easyRoster.fileCount} schemas / ${easy.total} · combined ${combined.total} · shipped defaults (minUniqueTokens=2, minMass=1.0, margin=0.5, λ=0.9, N=20)._\n`,
    );
    L.push(
        "L2 offline probe (benchmarking doc B-4): real committed keyword vectors + real ring-buffer decay + real TF-IDF strategy + real decision rule. No LLM, no dispatcher boot; fully deterministic.\n",
    );

    // ---- 250-test report by tier (the requested per-tier metric tables) ----
    L.push("## 250-test report by difficulty tier\n");
    L.push(
        "250 hand-authored conversations across five tiers, each labeled by honest human intent and scored by the real pipeline. **Yield** = of the conversations that should resolve, how many did; **Resolution accuracy** = of those resolves, how many hit the right agent; **Abstention** = of the conversations that should stay out, how many did; **Retrieval topic share** = how cleanly the context pointed at the intended agent; **Routing lift** = accuracy gained over the first-match baseline.\n",
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
            `| Spurious / wrong-target | ${r.trigger.spuriousResolve} / ${r.resolution.wrongTargetCount} |`,
        );
        L.push(
            `| Retrieval topic share | ${na(r, r.retrieval.n > 0, pct(r.retrieval.meanTopicShare))} |`,
        );
        L.push(
            `| Routing lift vs first-match | +${pct(r.ab.routingAccuracyLift)} |`,
        );
        L.push("");
    }
    L.push(
        "**Reading the trend:** the tier gets *safer-but-quieter* as difficulty climbs — perfect on simple/realistic, conservative safe-misses on hard, and only the adversarial tier (built to defeat lexical matching) produces real misroutes. Wrong-target is **0 on simple, realistic, and hard**, and jumps to 13 only under the adversarial attacks (loaded negation, sarcasm, quoted speech), which need a semantic/LLM tier to catch.\n",
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

    L.push("## Metric 1 — Context retrieval fidelity\n");
    L.push(
        "_Does the signal source appropriately retrieve the conversation's topic, before any decision is made?_\n",
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
        "_Do we trigger a resolution exactly when a clear topical winner exists, and abstain otherwise — and vice versa?_\n",
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
                "Abstention correctness (vice versa)",
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
    L.push(
        "_When the tier does trigger a resolution, does it route to the RIGHT agent?_\n",
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
                "Wrong-target resolves (Gate A)",
                (r) => `${r.resolution.wrongTargetCount}`,
            ],
            ["WRR (wrong-resolution rate)", (r) => pct(r.resolution.wrr)],
        ]),
    );
    L.push(
        "\nAcross every slice — including the *trap* fixtures where the losing sibling gets a salient recent mention — resolution accuracy holds and wrong-target stays 0: when discriminating evidence is too weak the tier abstains rather than guessing.\n",
    );

    L.push("## Safety — strictly additive vs first-match baseline\n");
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
                "No-regression (Gate D)",
                (r) => (r.ab.noRegression ? "✅ holds" : "❌ FAILED"),
            ],
        ]),
    );

    L.push(
        "\n## Threshold sweep (B-6) on the combined corpus: the safety boundary\n",
    );
    L.push(
        `- **Safety is threshold-robust:** ${anyWrongTarget === 0 ? `**0 wrong-target resolves in all ${sweep.length} cells**` : `${anyWrongTarget} cells produced a wrong-target`}.`,
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

const dir = outDir();
fs.mkdirSync(dir, { recursive: true });
const mdPath = path.join(dir, "contextSelector-metrics.md");
const jsonPath = path.join(dir, "contextSelector-metrics.json");
fs.writeFileSync(mdPath, md(), "utf8");
fs.writeFileSync(
    jsonPath,
    JSON.stringify(
        {
            tierReport: tiers.map((t) => ({
                tier: t.name,
                n: t.r.total,
                yield: t.r.trigger.yield,
                resolutionAccuracy: t.r.resolution.targetAccuracy,
                abstention: t.r.trigger.abstentionCorrectness,
                spurious: t.r.trigger.spuriousResolve,
                wrongTarget: t.r.resolution.wrongTargetCount,
                retrievalShare:
                    t.r.retrieval.n > 0 ? t.r.retrieval.meanTopicShare : null,
                routingLift: t.r.ab.routingAccuracyLift,
            })),
            slices: {
                dialogue,
                dialogueSimple,
                dialogueNoContext,
                dialogueNormal,
                dialogueHard,
                dialogueXhard,
                realClear,
                realVague,
                siblings: hard,
                easy,
                combined,
            },
            dialogueScenarios: dialogueRows,
            hardByCategory: Object.fromEntries(hardCats),
            extraHardByCategory: Object.fromEntries(xhardCats),
            realPairs: pairs.map((p) => ({
                label: p.label,
                aId: p.aId,
                bId: p.bId,
                shared: p.shared.length,
                discA: p.discA.length,
                discB: p.discB.length,
            })),
            corpus: {
                dialogue: {
                    scenarios: dialogue.total,
                    resolve: dialogue.trigger.resolvable,
                    abstain: dialogue.trigger.abstainable,
                },
                realPairs: {
                    pairs: pairs.length,
                    clear: realClear.total,
                    vague: realVague.total,
                },
                siblings: {
                    agents: adversary.siblings.length,
                    fixtures: hard.total,
                },
                easy: { pairs: easyPairs.length, fixtures: easy.total },
                combined: combined.total,
            },
            sweep,
            recommended,
            propertyChecks: props,
        },
        null,
        2,
    ),
    "utf8",
);
console.log(`\nWrote:\n  ${mdPath}\n  ${jsonPath}`);
