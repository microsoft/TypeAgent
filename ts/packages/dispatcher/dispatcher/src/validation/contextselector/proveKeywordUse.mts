// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// PROOF (used correctly): drives the REAL contextSelector decision function
// (`TfIdfStrategy.evaluate`, the exact call matchContextSelector.ts makes) with
// the REAL default decision config and REAL committed keyword vectors loaded via
// the production read path (`keywordFilePathFor` + `loadKeywordFile`). Shows that
// committed-only synonyms (tokens the LLM added, provably absent from the schema
// source) FLIP a two-agent collision from a misroute to the correct agent — and
// that the lexical floor alone (those tokens removed) makes the opposite choice.
// Deterministic, no LLM, no dispatcher boot. Not committed.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TfIdfStrategy } from "../../context/contextSelector/strategy.js";
import {
    keywordFilePathFor,
    loadKeywordFile,
} from "../../context/contextSelector/keywordFile.js";
import type { ContextVector } from "../../context/contextSelector/conversationSignal.js";
import type { ScorerCandidate } from "../../context/contextSelector/scorer.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// contextSelector -> benchmark -> dispatcher -> dispatcher -> packages -> ts
const TS_ROOT = path.resolve(HERE, "..", "..", "..", "..", "..", "..");

// The REAL production defaults (session.ts:467-473).
const CONFIG = { minUniqueTokens: 2, minMass: 1.0, margin: 0.5 };

function fail(msg: string): never {
    console.error(`\n❌ VALIDATION FAILED: ${msg}`);
    process.exit(1);
}
function ok(msg: string) {
    console.log(`  ✅ ${msg}`);
}

// Load a real committed vector via the production read path.
function loadVector(srcAbs: string, action: string): Set<string> {
    const p = keywordFilePathFor(srcAbs, undefined);
    if (p === undefined)
        fail(`keywordFilePathFor returned undefined for ${srcAbs}`);
    const file = loadKeywordFile(p, path.basename(srcAbs));
    if (file === undefined) fail(`no committed keyword file at ${p}`);
    const vec = file.actions[action];
    if (vec === undefined) fail(`action ${action} not in ${p}`);
    return new Set(vec);
}

const LIST_SRC = path.join(TS_ROOT, "packages/agents/list/src/listSchema.ts");
const CAL_SRC = path.join(
    TS_ROOT,
    "packages/agents/calendar/src/calendarActionsSchemaV3.ts",
);

const listVec = loadVector(LIST_SRC, "addItems");
const calVec = loadVector(CAL_SRC, "findTodaysEvents");
const listText = fs.readFileSync(LIST_SRC, "utf8").toLowerCase();
const calText = fs.readFileSync(CAL_SRC, "utf8").toLowerCase();

console.log("=== contextSelector committed-keyword USE validation ===\n");
console.log(`Config (production defaults): ${JSON.stringify(CONFIG)}\n`);

// Target = calendar.findTodaysEvents; competitor = list.addItems.
// Two committed-only calendar tokens (in the committed vector, absent from the
// calendar schema source, and not shared with list) — the LLM's contribution.
const targetOnly = [...calVec].filter(
    (t) => !calText.includes(t) && !listVec.has(t),
);
// Two list tokens the calendar vector lacks (the competitor's pull).
const compPull = [...listVec].filter((t) => !calVec.has(t));

if (targetOnly.length < 2 || compPull.length < 2) {
    fail(
        `not enough discriminating tokens (targetOnly=${targetOnly.length}, compPull=${compPull.length})`,
    );
}
const [L1, L2] = targetOnly;
const [C1, C2] = compPull;
console.log(
    `calendar.findTodaysEvents committed-only synonyms: { ${L1}, ${L2} }`,
);
console.log(`  (both proven absent from the calendar schema — LLM-authored)`);
console.log(
    `list.addItems pull tokens:                         { ${C1}, ${C2} }\n`,
);

const strategy = new TfIdfStrategy();
const context: ContextVector = new Map([
    [L1, 2],
    [L2, 2],
    [C1, 1],
    [C2, 1],
]);
console.log(
    `Conversation context vector: { ${[...context].map(([t, w]) => `${t}:${w}`).join(", ")} }\n`,
);

// --- With the committed file (real derived vectors) ---
const withFile: ScorerCandidate[] = [
    {
        schemaName: "calendar",
        actionName: "findTodaysEvents",
        keywords: calVec,
    },
    { schemaName: "list", actionName: "addItems", keywords: listVec },
];
const a = strategy.evaluate(context, withFile, CONFIG);
console.log("WITH committed keyword files:");
for (const s of a.decision.ranked) {
    console.log(
        `  ${s.schemaName}.${s.actionName}: score ${s.score.toFixed(3)}, uniqueTokens ${s.uniqueTokenCount ?? 0}`,
    );
}
console.log(
    `  -> decision: ${a.decision.kind}${a.decision.kind === "resolve" ? ` (winner ${a.decision.winner.schemaName})` : ` (${a.decision.reason})`}  ${a.winnerNote}`,
);
if (
    a.decision.kind !== "resolve" ||
    a.decision.winner.schemaName !== "calendar"
) {
    fail("committed vectors did NOT resolve the collision to calendar.");
}
ok("committed synonyms resolve the collision to calendar (the correct agent)");

// --- Lexical floor only (the two committed-only tokens removed) ---
const targetFloor = new Set([...calVec].filter((t) => t !== L1 && t !== L2));
const withoutFile: ScorerCandidate[] = [
    {
        schemaName: "calendar",
        actionName: "findTodaysEvents",
        keywords: targetFloor,
    },
    { schemaName: "list", actionName: "addItems", keywords: listVec },
];
const b = strategy.evaluate(context, withoutFile, CONFIG);
console.log("\nWITHOUT the committed synonyms (lexical floor only):");
for (const s of b.decision.ranked) {
    console.log(
        `  ${s.schemaName}.${s.actionName}: score ${s.score.toFixed(3)}, uniqueTokens ${s.uniqueTokenCount ?? 0}`,
    );
}
console.log(
    `  -> decision: ${b.decision.kind}${b.decision.kind === "resolve" ? ` (winner ${b.decision.winner.schemaName})` : ` (${b.decision.reason})`}`,
);
const flipped = !(
    b.decision.kind === "resolve" && b.decision.winner.schemaName === "calendar"
);
if (!flipped) {
    fail(
        "removing the committed synonyms still resolved to calendar — not decisive.",
    );
}
ok("without them, the outcome flips away from calendar (misroute or abstain)");

console.log(
    `\n✅ VALIDATED: the committed keyword vectors are USED by the real decision function.\n   The LLM synonyms { ${L1}, ${L2} } move calendar.findTodaysEvents from ${
        b.decision.kind === "resolve"
            ? `LOSING to ${(b.decision as any).winner.schemaName}`
            : `an ABSTAIN (${(b.decision as any).reason})`
    } to WINNING the collision — a decision the lexical floor cannot make.`,
);
process.exit(0);
