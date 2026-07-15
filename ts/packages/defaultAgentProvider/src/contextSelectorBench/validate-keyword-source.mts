// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Validation: prove the committed keyword file (§5 Source 1) is actually
// leveraged during contextSelector weighing — not merely read. Uses the REAL
// read path (loadKeywordFile + KeywordIndex.derived precedence) over the REAL
// compiled `list` schema, plus the REAL TfIdfScorer, and shows that a distilled
// synonym present ONLY in the committed file (never in the schema text) both (a)
// changes the derived vector and (b) flips a scorer decision that the lexical
// floor alone cannot make. Deterministic, no LLM, no dispatcher boot. Writes a
// temporary keyword file and cleans it up. Not committed.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fromJSONParsedActionSchema } from "@typeagent/action-schema";
import {
    KeywordIndex,
    ActionSchemaSource,
} from "agent-dispatcher/contextSelector";
import { KeywordSidecar } from "agent-dispatcher/contextSelector";
import {
    loadKeywordFile,
    writeKeywordFile,
    keywordFilePathFor,
    KeywordFile,
} from "agent-dispatcher/contextSelector";
import { TfIdfScorer } from "agent-dispatcher/contextSelector";
import { ContextVector } from "agent-dispatcher/contextSelector";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TS_ROOT = path.resolve(HERE, "..", "..", "..", "..");
const LIST_SRC = path.join(TS_ROOT, "packages/agents/list/src/listSchema.ts");
const LIST_PAS = path.join(
    TS_ROOT,
    "packages/agents/list/dist/listSchema.pas.json",
);

function fail(msg: string): never {
    console.error(`\n❌ VALIDATION FAILED: ${msg}`);
    process.exit(1);
}
function ok(msg: string) {
    console.log(`  ✅ ${msg}`);
}

// The synonym we plant ONLY in the committed file. "wishlist" is not present in
// the list schema text, so the lexical floor can never produce it.
const PLANTED = "wishlist";
const SCHEMA = "list";
const ACTION = "addItems";

const parsed = fromJSONParsedActionSchema(
    JSON.parse(fs.readFileSync(LIST_PAS, "utf8")),
);
const listActions = parsed.actionSchemas;

// Per-agent keyword path: a sibling of the REAL `list` schema source, resolved
// exactly as production does (keywordFilePathFor over the ActionConfig paths).
const filePath = keywordFilePathFor(LIST_SRC, LIST_PAS);
if (filePath === undefined) {
    fail("keywordFilePathFor returned undefined for the list schema paths.");
}

// A source mirroring the production `agentSchemaSource`: getKeywordFile uses the
// SAME loadKeywordFile the dispatcher uses, against the SAME per-agent path;
// getActionDefinition comes from the real parsed schema.
const source: ActionSchemaSource = {
    getKeywordFile: (s) =>
        s === SCHEMA ? loadKeywordFile(filePath, s) : undefined,
    getSchemaDescription: (s) =>
        s === SCHEMA
            ? "List agent: create lists, add and remove list items"
            : undefined,
    getActionDefinition: (s, a) =>
        s === SCHEMA ? listActions.get(a) : undefined,
};

const preexisting = fs.existsSync(filePath);
if (preexisting) {
    fail(
        `a real ${filePath} already exists — refusing to clobber it. Remove it first if this is expected.`,
    );
}

console.log("=== contextSelector committed-keyword-file validation ===\n");

try {
    // ---- Step 1: baseline (no committed file) uses the lexical floor ----
    const indexA = new KeywordIndex(source, () =>
        KeywordSidecar.load(undefined),
    );
    const lexical = indexA.derived(SCHEMA, ACTION);
    console.log(
        `Step 1 — lexical floor (no file). derived(${SCHEMA}.${ACTION}) = { ${[...lexical].sort().join(", ")} }`,
    );
    if (lexical.has(PLANTED)) {
        fail(
            `lexical floor unexpectedly contains "${PLANTED}" — pick a synonym truly absent from the schema.`,
        );
    }
    ok(`lexical floor does NOT contain the planted synonym "${PLANTED}"`);
    if (lexical.size === 0) {
        fail("lexical floor is empty — schema did not load correctly.");
    }
    ok(`lexical floor is non-empty (${lexical.size} tokens), schema loaded`);

    // ---- Step 2: write a committed keyword file with the planted synonym ----
    const committed: KeywordFile = {
        schemaVersion: 1,
        schema: SCHEMA,
        generatedBy: "llm",
        generatedAt: new Date().toISOString(),
        actions: { [ACTION]: [PLANTED, "grocery", "registry"] },
    };
    const written = writeKeywordFile(filePath, committed);
    if (written === undefined) {
        fail("writeKeywordFile returned undefined (write failed).");
    }
    ok(`wrote committed file: ${written}`);

    // ---- Step 3: the read path now PREFERS the committed file ----
    const indexB = new KeywordIndex(source, () =>
        KeywordSidecar.load(undefined),
    );
    const fromFile = indexB.derived(SCHEMA, ACTION);
    console.log(
        `\nStep 3 — with committed file. derived(${SCHEMA}.${ACTION}) = { ${[...fromFile].sort().join(", ")} }`,
    );
    if (!fromFile.has(PLANTED)) {
        fail(
            `derived() did NOT pick up the committed synonym "${PLANTED}" — the committed file is not being read.`,
        );
    }
    ok(`derived() now contains the committed synonym "${PLANTED}"`);
    if (fromFile.has("shopping") || fromFile.has("book")) {
        // The file replaces the lexical vector (it is the baseline, not merged);
        // lexical-only tokens absent from the file should not appear.
        fail("committed vector unexpectedly merged with lexical tokens.");
    }
    ok(
        "committed file vector supersedes the live lexical vector (as designed)",
    );

    // ---- Step 4: the committed synonym actually drives the SCORER ----
    // A conversation about a "wishlist" collides list.addItems vs vampire.addItems.
    const contextVector: ContextVector = new Map([
        [PLANTED, 2],
        ["birthday", 1],
    ]);
    const scorer = new TfIdfScorer();

    // Candidates as the scorer sees them: list uses the COMMITTED vector; the
    // colliding vampire action has its own (gothic) keywords, none overlapping.
    const withFile = scorer.score(contextVector, [
        { schemaName: "list", actionName: ACTION, keywords: fromFile },
        {
            schemaName: "vampire",
            actionName: ACTION,
            keywords: new Set(["vampire", "coffin", "blood"]),
        },
    ]);
    const listScoreWith = withFile.find((c) => c.schemaName === "list")!.score;
    const vampScoreWith = withFile.find(
        (c) => c.schemaName === "vampire",
    )!.score;
    console.log(
        `\nStep 4 — scorer with committed file: list=${listScoreWith.toFixed(3)} vampire=${vampScoreWith.toFixed(3)}`,
    );
    if (!(listScoreWith > 0 && listScoreWith > vampScoreWith)) {
        fail(
            "committed synonym did not make list win — the source is not leveraged in weighing.",
        );
    }
    ok(`committed synonym "${PLANTED}" makes list win the weighing`);

    // Counterfactual: the SAME conversation with the LEXICAL vector (no file) —
    // list has no "wishlist", so it scores zero: the committed source is what
    // changed the outcome.
    const withoutFile = scorer.score(contextVector, [
        { schemaName: "list", actionName: ACTION, keywords: lexical },
        {
            schemaName: "vampire",
            actionName: ACTION,
            keywords: new Set(["vampire", "coffin", "blood"]),
        },
    ]);
    const listScoreWithout = withoutFile.find(
        (c) => c.schemaName === "list",
    )!.score;
    console.log(
        `Step 4 — scorer with lexical floor only: list=${listScoreWithout.toFixed(3)} vampire=${vampScoreWith.toFixed(3)}`,
    );
    if (listScoreWithout !== 0) {
        fail(
            "lexical floor unexpectedly scored on the planted synonym — counterfactual invalid.",
        );
    }
    ok(
        "lexical floor scores 0 on the same conversation (no committed synonym)",
    );

    console.log(
        `\n✅ VALIDATED: the committed keyword file is leveraged during weighing.\n   list.addItems went from score ${listScoreWithout.toFixed(3)} (lexical) to ${listScoreWith.toFixed(3)} (committed) on a "${PLANTED}" conversation — a decision the lexical floor cannot make.`,
    );
} finally {
    // Always clean up the temp committed file.
    if (!preexisting && fs.existsSync(filePath)) {
        fs.rmSync(filePath, { force: true });
        console.log(`\n(cleaned up ${filePath})`);
    }
}
