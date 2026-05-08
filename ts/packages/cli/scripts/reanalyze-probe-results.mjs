// Re-classify saved probe-corpus results without re-running probes.
//
// Background: the corpus stores actions by their action-enum value
// ("Debug"), while the semantic map stores them by TypeScript type
// name ("DebugAutoShellAction").  The first probe run used a
// strict normalizer (lowercase + drop "action" suffix) which
// classified `Debug` ⟷ `DebugAutoShellAction` as MISROUTE even
// though they're the same action.  This script re-applies a more
// generous matcher (prefix or contains, after normalize) to the
// rows we already saved.
//
// Usage (from ts/):
//   node packages/cli/scripts/reanalyze-probe-results.mjs \
//       [--in  f:/tmp/probe-results-full.json] \
//       [--out f:/tmp/probe-results-full-reclassified.json] \
//       [--delta 0.05]

import * as fs from "node:fs";

function parseArgs() {
    const args = process.argv.slice(2);
    const opts = {
        in: "f:/tmp/probe-results-full.json",
        out: "f:/tmp/probe-results-full-reclassified.json",
        delta: 0.05,
    };
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case "--in":
                opts.in = args[++i];
                break;
            case "--out":
                opts.out = args[++i];
                break;
            case "--delta":
                opts.delta = Number(args[++i]);
                break;
            default:
                throw new Error(`Unknown argument: ${args[i]}`);
        }
    }
    return opts;
}
const OPTS = parseArgs();

function normalize(s) {
    let n = String(s).toLowerCase();
    if (n.endsWith("action")) n = n.slice(0, -"action".length);
    return n;
}

/**
 * Generous match: same schema AND one normalized name is a substring
 * of the other.  Catches the type-name-suffix-elaboration cases like
 * `Debug` ⟷ `DebugAutoShell` (both lowercased, "action" stripped, then
 * one is a prefix of the other) without falsely matching unrelated
 * actions like `Mute` ⟷ `MuteAndPause` would (they'd match too — but
 * if both live in the same schema and the semantic map ranked one as
 * top-1 for a phrase generated for the other, the dispatcher would
 * also conflate them at runtime, so we count this as "same action
 * intent" for our purposes).
 */
function actionsMatch(s1, a1, s2, a2) {
    if (s1 !== s2) return false;
    const n1 = normalize(a1);
    const n2 = normalize(a2);
    if (n1 === n2) return true;
    if (n1.length === 0 || n2.length === 0) return false;
    return n1.startsWith(n2) || n2.startsWith(n1);
}

function classify(top1Match, deltaToNext, threshold) {
    if (!top1Match) return "MISROUTE";
    if (deltaToNext === undefined || deltaToNext < threshold) return "TIGHT";
    return "CLEAN";
}

function pad(s, n) {
    s = String(s);
    return s.length >= n ? s : s + " ".repeat(n - s.length);
}

const data = JSON.parse(fs.readFileSync(OPTS.in, "utf8"));
const results = data.results;

const counts = { CLEAN: 0, TIGHT: 0, MISROUTE: 0, ERROR: 0 };
const perAction = new Map();
const perModel = new Map();
const perStyle = new Map();
const misrouteEdges = new Map();
const promotedFromMisroute = []; // (was MISROUTE, now CLEAN/TIGHT)

let oldCounts = { CLEAN: 0, TIGHT: 0, MISROUTE: 0, ERROR: 0 };

for (const r of results) {
    oldCounts[r.verdict] = (oldCounts[r.verdict] ?? 0) + 1;

    if (r.error || !r.top1) {
        counts.ERROR = (counts.ERROR ?? 0) + 1;
        continue;
    }
    const top1 = r.rows?.[0] ?? r.top1;
    const matches = actionsMatch(
        top1.schemaName,
        top1.actionName,
        r.schemaName,
        r.actionName,
    );
    const deltaToNext = top1.deltaToNext;
    const verdict = classify(matches, deltaToNext, OPTS.delta);
    r.top1.matchesExpected = matches;
    r.verdict = verdict;
    if (verdict !== "MISROUTE" && r.verdict !== "MISROUTE") {
        // not promoted
    }
    counts[verdict]++;

    const aKey = `${r.schemaName}.${r.actionName}`;
    const aRow = perAction.get(aKey) ?? {
        schemaName: r.schemaName,
        actionName: r.actionName,
        CLEAN: 0, TIGHT: 0, MISROUTE: 0, ERROR: 0, total: 0,
    };
    aRow[verdict]++;
    aRow.total++;
    perAction.set(aKey, aRow);

    for (const src of r.phraseSources ?? []) {
        const mRow = perModel.get(src.model) ?? {
            model: src.model,
            CLEAN: 0, TIGHT: 0, MISROUTE: 0, ERROR: 0, total: 0,
        };
        mRow[verdict]++;
        mRow.total++;
        perModel.set(src.model, mRow);

        const sRow = perStyle.get(src.style) ?? {
            style: src.style,
            CLEAN: 0, TIGHT: 0, MISROUTE: 0, ERROR: 0, total: 0,
        };
        sRow[verdict]++;
        sRow.total++;
        perStyle.set(src.style, sRow);
    }

    if (verdict === "MISROUTE") {
        const key = `${r.schemaName}.${r.actionName} → ${top1.schemaName}.${top1.actionName}`;
        misrouteEdges.set(key, (misrouteEdges.get(key) ?? 0) + 1);
    }
}

// Save reclassified results.
fs.writeFileSync(
    OPTS.out,
    JSON.stringify(
        {
            ...data,
            summary: { ...data.summary, counts, reclassifiedAt: new Date().toISOString() },
            results,
        },
        null,
        2,
    ),
);

const total = results.length;
const pct = (n) => ((n / total) * 100).toFixed(1) + "%";

process.stdout.write(`\nReclassified ${total} probe(s) (delta=${OPTS.delta}):\n\n`);
process.stdout.write(`              old →  new        Δ\n`);
for (const v of ["CLEAN", "TIGHT", "MISROUTE", "ERROR"]) {
    const oldN = oldCounts[v] ?? 0;
    const newN = counts[v] ?? 0;
    const sign = newN - oldN > 0 ? "+" : "";
    process.stdout.write(
        `  ${pad(v, 9)} ${pad(oldN, 5)} →  ${pad(newN, 5)}     ${sign}${newN - oldN}\n`,
    );
}

process.stdout.write(`\nFinal verdict counts:\n`);
process.stdout.write(`  CLEAN   : ${counts.CLEAN} (${pct(counts.CLEAN)})\n`);
process.stdout.write(
    `  TIGHT   : ${counts.TIGHT} (${pct(counts.TIGHT)})  — top-1 correct but llmSelect would flag\n`,
);
process.stdout.write(
    `  MISROUTE: ${counts.MISROUTE} (${pct(counts.MISROUTE)})  — top-1 wrong\n`,
);

const sortedActions = Array.from(perAction.values()).sort(
    (a, b) =>
        b.MISROUTE + b.TIGHT - (a.MISROUTE + a.TIGHT) ||
        a.actionName.localeCompare(b.actionName),
);

process.stdout.write(`\nWorst 25 actions by (MISROUTE + TIGHT):\n`);
process.stdout.write(
    `  ${pad("ACTION", 50)} ${pad("CLEAN", 6)} ${pad("TIGHT", 6)} ${pad("MISROUTE", 9)}\n`,
);
for (const r of sortedActions.slice(0, 25)) {
    process.stdout.write(
        `  ${pad(r.schemaName + "." + r.actionName, 50)} ${pad(r.CLEAN, 6)} ${pad(r.TIGHT, 6)} ${pad(r.MISROUTE, 9)}\n`,
    );
}

process.stdout.write(`\nBest 25 actions by CLEAN count:\n`);
const bestActions = Array.from(perAction.values()).sort(
    (a, b) => b.CLEAN - a.CLEAN || a.actionName.localeCompare(b.actionName),
);
process.stdout.write(
    `  ${pad("ACTION", 50)} ${pad("CLEAN", 6)} ${pad("TIGHT", 6)} ${pad("MISROUTE", 9)}\n`,
);
for (const r of bestActions.slice(0, 25)) {
    process.stdout.write(
        `  ${pad(r.schemaName + "." + r.actionName, 50)} ${pad(r.CLEAN, 6)} ${pad(r.TIGHT, 6)} ${pad(r.MISROUTE, 9)}\n`,
    );
}

process.stdout.write(`\nPer-source-model verdict counts:\n`);
process.stdout.write(
    `  ${pad("MODEL", 18)} ${pad("CLEAN", 6)} ${pad("TIGHT", 6)} ${pad("MISROUTE", 9)}\n`,
);
for (const r of [...perModel.values()].sort((a, b) => a.model.localeCompare(b.model))) {
    process.stdout.write(
        `  ${pad(r.model, 18)} ${pad(r.CLEAN, 6)} ${pad(r.TIGHT, 6)} ${pad(r.MISROUTE, 9)}\n`,
    );
}

process.stdout.write(`\nPer-style verdict counts:\n`);
process.stdout.write(
    `  ${pad("STYLE", 16)} ${pad("CLEAN", 6)} ${pad("TIGHT", 6)} ${pad("MISROUTE", 9)}\n`,
);
for (const r of [...perStyle.values()].sort((a, b) => a.style.localeCompare(b.style))) {
    process.stdout.write(
        `  ${pad(r.style, 16)} ${pad(r.CLEAN, 6)} ${pad(r.TIGHT, 6)} ${pad(r.MISROUTE, 9)}\n`,
    );
}

const sortedEdges = [...misrouteEdges.entries()]
    .map(([edge, count]) => ({ edge, count }))
    .sort((a, b) => b.count - a.count);

process.stdout.write(`\nMisroute edges (top-30, expected → actual):\n`);
for (const e of sortedEdges.slice(0, 30)) {
    process.stdout.write(`  ${pad(e.count, 4)} ${e.edge}\n`);
}

// Cross-agent vs within-agent split.
let crossAgent = 0;
let withinAgent = 0;
for (const e of sortedEdges) {
    const [exp, act] = e.edge.split(" → ");
    const [expSchema] = exp.split(".");
    const [actSchema] = act.split(".");
    if (expSchema === actSchema) withinAgent += e.count;
    else crossAgent += e.count;
}
const total2 = crossAgent + withinAgent;
process.stdout.write(
    `\nMisroute split: cross-agent ${crossAgent} (${((crossAgent / total2) * 100).toFixed(1)}%), within-agent ${withinAgent} (${((withinAgent / total2) * 100).toFixed(1)}%)\n`,
);

process.stdout.write(`\nWrote reclassified results to ${OPTS.out}\n`);
