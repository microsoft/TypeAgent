// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// PROOF (context flip): for five colliding requests, drives the REAL
// contextSelector decision function (`TfIdfStrategy.evaluate`, the exact call
// matchContextSelector.ts makes) with the REAL production decision config, the
// REAL committed `list` keyword vectors (loaded through the production read path
// `keywordFilePathFor` + `loadKeywordFile`), and the REAL context-vector builder
// (`RingBufferSignalSource`, production window/decay). Each scenario shows the
// SAME collision (`list.<action>` vs `vampire.<action>`) resolving to `list`
// after the initial dialogue, then FLIPPING to `vampire` after additional
// dialogue — routing driven purely by the evolving conversation. Deterministic,
// no dispatcher boot, no LLM. `vampire` is the synthetic test agent; its
// discriminating keywords are the sidecar-seeded occult set (§5 Source 2),
// defined inline. Not committed.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { TfIdfStrategy } from "agent-dispatcher/contextSelector";
import { RingBufferSignalSource } from "agent-dispatcher/contextSelector";
import type { ScorerCandidate } from "agent-dispatcher/contextSelector";
import { tokenize } from "agent-dispatcher/contextSelector";
import {
    keywordFilePathFor,
    loadKeywordFile,
} from "agent-dispatcher/contextSelector";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// contextSelectorBench -> src -> defaultAgentProvider -> packages -> ts
const TS_ROOT = path.resolve(HERE, "..", "..", "..", "..");
const LIST_SRC = path.join(TS_ROOT, "packages/agents/list/src/listSchema.ts");

// REAL production defaults (session.ts:467-473).
const CONFIG = { minUniqueTokens: 2, minMass: 1.0, margin: 0.5 };
// REAL production signal config (conversationSignal.ts defaults).
const SIGNAL = { windowTurns: 20, decay: 0.9 };

const strategy = new TfIdfStrategy();

// --- Load the committed list vectors through the production read path --------
const keywordPath = keywordFilePathFor(LIST_SRC, undefined);
if (keywordPath === undefined) {
    throw new Error(
        "keywordFilePathFor returned undefined for the list schema",
    );
}
const listFile = loadKeywordFile(keywordPath, "list");
if (listFile === undefined) {
    throw new Error(`no committed keyword file at ${keywordPath}`);
}
const listVector = (action: string): Set<string> => {
    const vec = listFile.actions[action];
    if (vec === undefined) {
        throw new Error(`list.${action} missing from ${keywordPath}`);
    }
    return new Set(vec);
};

// vampire's discriminating keywords (sidecar Source 2). Canonicalized through
// the SAME tokenizer the scorer/context vector use, so forms match at scoring.
const OCCULT_WORDS = [
    "blood",
    "ritual",
    "crypt",
    "coffin",
    "undead",
    "altar",
    "chalice",
    "coven",
    "sacrifice",
    "grimoire",
    "relic",
    "exorcism",
    "banish",
    "spectral",
    "seance",
    "necromancy",
    "tomb",
    "shroud",
    "curse",
    "fang",
    "cauldron",
    "spell",
    "hex",
    "wraith",
    "phantom",
    "ghoul",
    "occult",
    "nocturnal",
    "moon",
    "midnight",
];
const vampVector = new Set<string>(
    OCCULT_WORDS.flatMap((w) => [...tokenize(w)]),
);

type Scenario = {
    request: string;
    action: string;
    initial: string[]; // prior turns before the first ask
    additional: string[]; // further prior turns added before the second ask
};

const scenarios: Scenario[] = [
    {
        request: "add the offerings to the list",
        action: "addItems",
        initial: [
            "I keep a grocery checklist and a todo list of items",
            "add milk and bread as new entries on my shopping list",
        ],
        additional: [
            "tonight the coven performs the blood ritual at the altar",
            "we place the chalice and relic beside the coffin in the crypt",
            "the sacrifice summons the undead under the nocturnal moon",
        ],
    },
    {
        request: "remove the items from the list",
        action: "removeItems",
        initial: [
            "clean up my grocery checklist and my todo list",
            "take the stale items and old entries off the roster",
        ],
        additional: [
            "we must banish the wraith and lift the cursed crypt",
            "unwind the shroud, break the hex, and open the coffin",
            "the exorcism drives the undead phantom from the tomb",
        ],
    },
    {
        request: "what's on the list",
        action: "getList",
        initial: [
            "show me my grocery checklist and my todo items",
            "what's on the shopping list and the task roster",
        ],
        additional: [
            "reveal the grimoire and the necromancy relics",
            "recite the spell from the spectral seance",
            "the coven guards the tomb, the crypt, and the altar",
        ],
    },
    {
        request: "add the ingredients to the list",
        action: "addItems",
        initial: [
            "I'm planning my weekly grocery list and meal checklist",
            "add these items and notes to my todo list",
        ],
        additional: [
            "gather the ritual ingredients: blood, fang, and cauldron",
            "the necromancy rite needs a relic and a chalice",
            "prepare the altar, the coffin, and the grimoire for midnight",
        ],
    },
    {
        request: "show me the list",
        action: "getList",
        initial: [
            "review my grocery inventory and shopping checklist",
            "what items are on my todo list and catalog",
        ],
        additional: [
            "consult the grimoire and the occult ledger of curses",
            "the seance summons a spectral wraith and a phantom",
            "banish the ghoul to the crypt beneath the tomb",
        ],
    },
];

function candidates(action: string): ScorerCandidate[] {
    return [
        {
            schemaName: "list",
            actionName: action,
            keywords: listVector(action),
        },
        { schemaName: "vampire", actionName: action, keywords: vampVector },
    ];
}

function runPhase(ring: RingBufferSignalSource, action: string) {
    const context = ring.getContextVector();
    const evaluation = strategy.evaluate(context, candidates(action), CONFIG);
    const d = evaluation.decision;
    const chosen =
        d.kind === "resolve"
            ? `${d.winner.schemaName}.${d.winner.actionName}`
            : `ABSTAIN (${d.reason})`;
    const runnerUp = d.ranked[1];
    return {
        kind: d.kind,
        winnerSchema: d.kind === "resolve" ? d.winner.schemaName : undefined,
        chosen,
        note: evaluation.winnerNote,
        runnerUp: runnerUp
            ? `${runnerUp.schemaName} score ${runnerUp.score.toFixed(3)}`
            : "(none)",
    };
}

console.log("=== contextSelector 5-scenario context-flip validation ===\n");
console.log(`Decision config (production defaults): ${JSON.stringify(CONFIG)}`);
console.log(
    `Signal config    (production defaults): ${JSON.stringify(SIGNAL)}`,
);
console.log(
    `list vectors: committed file ${path.relative(TS_ROOT, keywordPath)} ` +
        `(generatedBy=${listFile.generatedBy}) — loaded via production read path`,
);
console.log(
    `vampire vectors: sidecar-seeded occult set (${vampVector.size} tokens)\n`,
);

let passed = 0;
scenarios.forEach((s, i) => {
    const ring = new RingBufferSignalSource(() => SIGNAL);

    console.log(`\n──────────────────────────────────────────────────────────`);
    console.log(
        `Scenario ${i + 1}: "${s.request}"  (collision: list.${s.action} vs vampire.${s.action})`,
    );

    for (const turn of s.initial) {
        ring.recordRequest(turn);
    }
    console.log(`\n  Initial dialogue (${s.initial.length} turns):`);
    s.initial.forEach((t) => console.log(`    • ${t}`));
    const a = runPhase(ring, s.action);
    console.log(`  → "${s.request}"  routes to  ${a.chosen}   [${a.note}]`);
    console.log(`      runner-up: ${a.runnerUp}`);

    for (const turn of s.additional) {
        ring.recordRequest(turn);
    }
    console.log(
        `\n  + Additional dialogue (${s.additional.length} more turns):`,
    );
    s.additional.forEach((t) => console.log(`    • ${t}`));
    const b = runPhase(ring, s.action);
    console.log(`  → "${s.request}"  now routes to  ${b.chosen}   [${b.note}]`);
    console.log(`      runner-up: ${b.runnerUp}`);

    const flipped =
        a.kind === "resolve" &&
        a.winnerSchema === "list" &&
        b.kind === "resolve" &&
        b.winnerSchema === "vampire";
    console.log(
        `\n  ${flipped ? "✅ FLIP" : "❌ NO FLIP"}: list.${s.action} → vampire.${s.action} on the same request`,
    );
    if (flipped) {
        passed++;
    }
});

console.log(`\n──────────────────────────────────────────────────────────`);
console.log(
    `\nRESULT: ${passed}/${scenarios.length} scenarios flipped as expected.`,
);
if (passed !== scenarios.length) {
    console.error("❌ VALIDATION FAILED");
    process.exit(1);
}
console.log(
    "✅ VALIDATED: the same request routes to list, then to vampire, driven\n" +
        "   purely by the evolving conversation — through the real decision\n" +
        "   function, real committed list vectors, and real context builder.",
);
process.exit(0);
