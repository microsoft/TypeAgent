// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Scenario validation for contextSelector against REAL agent schemas.
//
// Loads the compiled list + vampire action schemas, builds the real KeywordIndex
// (lexical extraction), and runs labeled multi-turn conversation fixtures through
// the real signal -> strategy -> decision pipeline — the benchmark doc's L1/L2
// levels on real keywords. The hard gate (design §10, benchmark Gate A) is
// ZERO wrong-target resolves: contextSelector must never confidently reroute to
// the wrong agent.

import fs from "node:fs";
import path from "node:path";
import {
    ActionSchemaTypeDefinition,
    fromJSONParsedActionSchema,
} from "@typeagent/action-schema";
import {
    ActionSchemaSource,
    KeywordIndex,
} from "../src/context/contextSelector/keywordIndex.js";
import { KeywordSidecar } from "../src/context/contextSelector/keywordSidecar.js";
import { RingBufferSignalSource } from "../src/context/contextSelector/conversationSignal.js";
import { TfIdfStrategy } from "../src/context/contextSelector/strategy.js";
import { ScorerCandidate } from "../src/context/contextSelector/scorer.js";

// (schemaName, compiled .pas.json path relative to ts/, manifest schema description)
const SCHEMA_SPECS: readonly [string, string, string][] = [
    [
        "list",
        "packages/agents/list/dist/listSchema.pas.json",
        "List agent with actions to create lists, show list items, add and remove list items",
    ],
    [
        "vampire",
        "packages/agents/vampire/dist/vampireSchema.pas.json",
        "Vampire test agent — generic-purpose handler that overlaps with player, list, and calendar action names and grammar patterns",
    ],
];

// ts/ root — jest runs with cwd = packages/dispatcher/dispatcher.
const TS_ROOT = path.resolve(process.cwd(), "..", "..", "..");

function loadRealSource(): ActionSchemaSource | undefined {
    const defs = new Map<string, Map<string, ActionSchemaTypeDefinition>>();
    const descs = new Map<string, string>();
    for (const [name, rel, desc] of SCHEMA_SPECS) {
        const full = path.join(TS_ROOT, rel);
        if (!fs.existsSync(full)) {
            return undefined; // build not present — skip suite
        }
        const parsed = fromJSONParsedActionSchema(
            JSON.parse(fs.readFileSync(full, "utf8")),
        );
        descs.set(name, desc);
        defs.set(name, parsed.actionSchemas);
    }
    return {
        getSchemaDescription: (s) => descs.get(s),
        getActionDefinition: (s, a) => defs.get(s)?.get(a),
    };
}

type Fixture = {
    id: string;
    prelude: string[];
    collisionInput: string;
    candidates: string[]; // "schema.action"
    label:
        | { kind: "resolve"; target: string }
        | { kind: "abstain"; reason?: string };
};

// Fixtures authored against the REAL extracted keywords (see probeKeywords.mts):
//   list.addItems  unique: grocery, shopping, book, movie, gift, garden, task, …
//   vampire.addItems unique: vampire, test, overlap, generic, collide, …
//   shared (cancel via candidate-local IDF): agent, item, list, name
const FIXTURES: Fixture[] = [
    {
        id: "list-resolve-groceries",
        prelude: [
            "what books are on my reading list",
            "add the movie to my watch list",
            "planning the grocery shopping run",
            "sort out the garden tasks",
        ],
        collisionInput: "add eggs to my grocery list",
        candidates: ["list.addItems", "vampire.addItems"],
        label: { kind: "resolve", target: "list.addItems" },
    },
    {
        id: "list-resolve-getlist",
        prelude: [
            "show my grocery items",
            "what gifts are on the shopping list",
            "the book and movie lists",
        ],
        collisionInput: "what is on my grocery list",
        candidates: ["list.getList", "vampire.getList"],
        label: { kind: "resolve", target: "list.getList" },
    },
    {
        id: "vampire-resolve-topic",
        prelude: [
            "tell me about vampires",
            "the vampire test agent",
            "vampires overlap with other agents",
        ],
        collisionInput: "add eggs to my grocery list",
        candidates: ["list.addItems", "vampire.addItems"],
        label: { kind: "resolve", target: "vampire.addItems" },
    },
    {
        id: "vampire-resolve-plural-stemming",
        // Exercises the stemming fix: plural "vampires" must match keyword
        // "vampire"; "test"/"overlap" give the ≥2 distinct-token evidence.
        prelude: [
            "the vampires are just a test",
            "vampires overlap with everything",
        ],
        collisionInput: "remove eggs from my grocery list",
        candidates: ["list.removeItems", "vampire.removeItems"],
        label: { kind: "resolve", target: "vampire.removeItems" },
    },
    {
        id: "abstain-tie",
        prelude: [
            "my grocery shopping list",
            "tell me about a vampire overlap",
        ],
        collisionInput: "add eggs to my grocery list",
        candidates: ["list.addItems", "vampire.addItems"],
        label: { kind: "abstain", reason: "margin" },
    },
    {
        id: "abstain-no-signal",
        prelude: [
            "what is the weather forecast",
            "how tall is mount everest",
            "who won the football game",
        ],
        collisionInput: "add eggs to my grocery list",
        candidates: ["list.addItems", "vampire.addItems"],
        label: { kind: "abstain", reason: "no-signal" },
    },
    {
        id: "abstain-coverage",
        // "ghost.action" has no schema -> empty keyword vector -> coverage guard.
        prelude: ["grocery shopping and books"],
        collisionInput: "add eggs to my grocery list",
        candidates: ["list.addItems", "ghost.action"],
        label: { kind: "abstain", reason: "coverage" },
    },
    {
        id: "abstain-stale",
        // Two vampire tokens, then many unrelated turns -> decayed below minMass.
        prelude: [
            "the vampire test",
            "what is the weather",
            "how tall is everest",
            "who won the game",
            "what time is it",
            "tell me a joke",
            "what is two plus two",
            "how far is the moon",
            "what is the capital of france",
        ],
        collisionInput: "add eggs to my grocery list",
        candidates: ["list.addItems", "vampire.addItems"],
        label: { kind: "abstain", reason: "min-mass" },
    },
];

const DECISION_CFG = { minUniqueTokens: 2, minMass: 1.0, margin: 0.5 };

type Outcome =
    | { kind: "resolve"; target: string }
    | { kind: "abstain"; reason: string };

function runFixture(source: ActionSchemaSource, fixture: Fixture): Outcome {
    const index = new KeywordIndex(source, () =>
        KeywordSidecar.load(undefined),
    );
    const signal = new RingBufferSignalSource(() => ({
        windowTurns: 20,
        decay: 0.9,
    }));
    for (const turn of fixture.prelude) {
        signal.recordRequest(turn);
    }
    const candidates: ScorerCandidate[] = fixture.candidates.map((id) => {
        const dot = id.lastIndexOf(".");
        const schemaName = id.slice(0, dot);
        const actionName = id.slice(dot + 1);
        return {
            schemaName,
            actionName,
            keywords: index.effective(schemaName, actionName),
        };
    });
    const { decision } = new TfIdfStrategy().evaluate(
        signal.getContextVector(),
        candidates,
        DECISION_CFG,
    );
    if (decision.kind === "resolve") {
        return {
            kind: "resolve",
            target: `${decision.winner.schemaName}.${decision.winner.actionName}`,
        };
    }
    return { kind: "abstain", reason: decision.reason };
}

const source = loadRealSource();
const describeOrSkip = source ? describe : describe.skip;

describeOrSkip("contextSelector scenarios (real schemas)", () => {
    // Sanity: the real extraction actually discriminates the headline pair.
    it("real list vs vampire addItems keywords are non-empty and discriminating", () => {
        const index = new KeywordIndex(source!, () =>
            KeywordSidecar.load(undefined),
        );
        const list = index.effective("list", "addItems");
        const vamp = index.effective("vampire", "addItems");
        expect(list.size).toBeGreaterThan(3);
        expect(vamp.size).toBeGreaterThan(3);
        expect(list.has("grocery")).toBe(true);
        expect(vamp.has("vampire")).toBe(true);
    });

    for (const fixture of FIXTURES) {
        it(`${fixture.id} -> ${fixture.label.kind}${
            fixture.label.kind === "resolve" ? ` ${fixture.label.target}` : ""
        }`, () => {
            const outcome = runFixture(source!, fixture);
            if (fixture.label.kind === "resolve") {
                expect(outcome.kind).toBe("resolve");
                if (outcome.kind === "resolve") {
                    expect(outcome.target).toBe(fixture.label.target);
                }
            } else {
                expect(outcome.kind).toBe("abstain");
                if (outcome.kind === "abstain" && fixture.label.reason) {
                    expect(outcome.reason).toBe(fixture.label.reason);
                }
            }
        });
    }

    // Gate A (safety): across all fixtures, ZERO confident resolves to a
    // non-labeled target. A wrong-target resolve is the one failure mode that
    // makes routing worse than today.
    it("Gate A: zero wrong-target resolves across all fixtures", () => {
        const wrongTargets: string[] = [];
        for (const fixture of FIXTURES) {
            const outcome = runFixture(source!, fixture);
            if (outcome.kind !== "resolve") {
                continue;
            }
            const allowed =
                fixture.label.kind === "resolve"
                    ? fixture.label.target
                    : undefined;
            if (outcome.target !== allowed) {
                wrongTargets.push(`${fixture.id}: resolved ${outcome.target}`);
            }
        }
        expect(wrongTargets).toEqual([]);
    });

    // Determinism (Gate B): identical inputs -> identical decision across runs.
    it("Gate B: decisions are deterministic across repeated runs", () => {
        for (const fixture of FIXTURES) {
            const a = runFixture(source!, fixture);
            const b = runFixture(source!, fixture);
            expect(a).toEqual(b);
        }
    });
});
