// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    isCollision,
    resolveGrammarRegistryFirst,
} from "../src/translation/matchCollision.js";
import {
    MatchResult,
    RequestAction,
    createExecutableAction,
} from "agent-cache";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CollisionRegistry } from "../src/context/collisionRegistry.js";
import {
    CollisionPreferenceStore,
    PreferenceMember,
} from "../src/context/collisionPreferences.js";
import type {
    Neighborhood,
    NeighborhoodPreview,
} from "../src/neighborhoods/types.js";
import type { CommandHandlerContext } from "../src/context/commandHandlerContext.js";

function makeMatch(
    schemaName: string,
    actionName: string,
    overrides: Partial<MatchResult> = {},
): MatchResult {
    const action = createExecutableAction(schemaName, actionName);
    const ra = new RequestAction("test request", [action]);
    return {
        type: "grammar",
        match: ra,
        matchedCount: 5,
        nonOptionalCount: 5,
        wildcardCharCount: 0,
        implicitParameterCount: 0,
        entityWildcardPropertyNames: [],
        ...overrides,
    };
}

describe("matchCollision.isCollision", () => {
    describe("classifier=distinctActions", () => {
        it("returns false for a single match", () => {
            expect(
                isCollision([makeMatch("a", "play")], "distinctActions"),
            ).toBe(false);
        });

        it("returns false when all matches share schema and action", () => {
            const matches = [makeMatch("a", "play"), makeMatch("a", "play")];
            expect(isCollision(matches, "distinctActions")).toBe(false);
        });

        it("returns true when two matches differ in schema", () => {
            const matches = [
                makeMatch("player", "play"),
                makeMatch("video", "play"),
            ];
            expect(isCollision(matches, "distinctActions")).toBe(true);
        });

        it("returns true when two matches differ in action", () => {
            const matches = [
                makeMatch("list", "addItems"),
                makeMatch("list", "removeItems"),
            ];
            // distinctActions is keyed on (schema, action) tuples — same schema
            // but different actions still counts as distinct.
            expect(isCollision(matches, "distinctActions")).toBe(true);
        });
    });

    describe("classifier=tiedHeuristics", () => {
        it("returns false for a single match", () => {
            expect(
                isCollision([makeMatch("a", "play")], "tiedHeuristics"),
            ).toBe(false);
        });

        it("returns true when top two share matchedCount/nonOptional/wildcard", () => {
            const matches = [
                makeMatch("a", "x", {
                    matchedCount: 5,
                    nonOptionalCount: 5,
                    wildcardCharCount: 2,
                }),
                makeMatch("b", "y", {
                    matchedCount: 5,
                    nonOptionalCount: 5,
                    wildcardCharCount: 2,
                }),
            ];
            expect(isCollision(matches, "tiedHeuristics")).toBe(true);
        });

        it("returns false when top two differ in matchedCount", () => {
            const matches = [
                makeMatch("a", "x", { matchedCount: 5 }),
                makeMatch("b", "y", { matchedCount: 4 }),
            ];
            expect(isCollision(matches, "tiedHeuristics")).toBe(false);
        });

        it("returns false when top two differ in wildcardCharCount", () => {
            const matches = [
                makeMatch("a", "x", { wildcardCharCount: 0 }),
                makeMatch("b", "y", { wildcardCharCount: 5 }),
            ];
            expect(isCollision(matches, "tiedHeuristics")).toBe(false);
        });
    });
});

// Registry-first detection on the grammar/cache path. The cache can return a
// single confident match (isCollision needs >=2), so the registry must be
// able to escalate even one match to a clarify when it is known-ambiguous.

function tmpdir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "typeagent-collmatch-"));
}

function writePreview(dir: string, neighborhoods: Neighborhood[]): string {
    const preview: NeighborhoodPreview = {
        builtAt: new Date().toISOString(),
        sources: {
            similarityStrategy: "test",
            similarityThreshold: 0.5,
            minMisrouteCount: 1,
            includeSameSchema: true,
        },
        neighborhoods,
    };
    const file = path.join(dir, "neighborhoods.json");
    fs.writeFileSync(file, JSON.stringify(preview), "utf8");
    return file;
}

const calendarNeighborhood: Neighborhood = {
    id: "calendar--taskflow.findTodaysEvents",
    kind: "cross-schema",
    members: [
        { schemaName: "calendar", actionName: "findTodaysEvents" },
        { schemaName: "taskflow", actionName: "dailyAgendaEmail" },
    ],
    evidence: {},
    sources: ["similarity"],
};

function makeGrammarCtx(
    registryFirst: boolean,
    registry: CollisionRegistry,
    registryPath: string,
    oneShot: Set<string> = new Set<string>(),
    preferences: CollisionPreferenceStore = CollisionPreferenceStore.load(
        undefined,
    ),
    preferenceEnabled = true,
): CommandHandlerContext {
    return {
        session: {
            getConfig: () => ({
                collision: {
                    preference: {
                        registryFirst,
                        registryPath,
                        enabled: preferenceEnabled,
                        ambiguitySource: "both",
                    },
                    grammarMatch: { classifier: "distinctActions" },
                    telemetry: { emit: false, debugLog: false },
                    priorityOrder: "",
                },
            }),
        },
        collisionRegistry: registry,
        collisionRegistryPath: registryPath,
        collisionOneShotPicks: oneShot,
        collisionPreferences: preferences,
        agents: { getAgentRank: () => 0 },
    } as unknown as CommandHandlerContext;
}

describe("matchCollision.resolveGrammarRegistryFirst", () => {
    it("escalates a single confident known-ambiguous match to clarify", () => {
        const dir = tmpdir();
        try {
            const file = writePreview(dir, [calendarNeighborhood]);
            const registry = CollisionRegistry.load(file);
            const ctx = makeGrammarCtx(true, registry, file);
            const decision = resolveGrammarRegistryFirst(
                [makeMatch("calendar", "findTodaysEvents")],
                ctx,
                "what's on my calendar today",
            );
            expect(decision).toBeDefined();
            expect(decision?.kind).toBe("clarify");
            if (decision?.kind === "clarify") {
                const candidates =
                    decision.clarify.parameters.candidates.map(
                        (c) => `${c.schemaName}.${c.actionName}`,
                    );
                // The single cache match plus its registry sibling.
                expect(candidates).toEqual(
                    expect.arrayContaining([
                        "calendar.findTodaysEvents",
                        "taskflow.dailyAgendaEmail",
                    ]),
                );
                expect(candidates).toHaveLength(2);
                // The flagging neighborhood id is stamped on the card.
                expect(
                    decision.clarify.parameters.clarifyingQuestion,
                ).toContain("calendar--taskflow.findTodaysEvents");
            }
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it("returns undefined when registry-first is off", () => {
        const dir = tmpdir();
        try {
            const file = writePreview(dir, [calendarNeighborhood]);
            const registry = CollisionRegistry.load(file);
            const ctx = makeGrammarCtx(false, registry, file);
            const decision = resolveGrammarRegistryFirst(
                [makeMatch("calendar", "findTodaysEvents")],
                ctx,
                "what's on my calendar today",
            );
            expect(decision).toBeUndefined();
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it("returns undefined when the match is not a registry member", () => {
        const dir = tmpdir();
        try {
            const file = writePreview(dir, [calendarNeighborhood]);
            const registry = CollisionRegistry.load(file);
            const ctx = makeGrammarCtx(true, registry, file);
            const decision = resolveGrammarRegistryFirst(
                [makeMatch("player", "play")],
                ctx,
                "play something",
            );
            expect(decision).toBeUndefined();
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it("returns undefined with an empty registry", () => {
        const ctx = makeGrammarCtx(true, CollisionRegistry.empty(), "");
        const decision = resolveGrammarRegistryFirst(
            [makeMatch("calendar", "findTodaysEvents")],
            ctx,
            "what's on my calendar today",
        );
        expect(decision).toBeUndefined();
    });

    it("resolves to the in-set match when a one-shot pick names it", () => {
        const dir = tmpdir();
        try {
            const file = writePreview(dir, [calendarNeighborhood]);
            const registry = CollisionRegistry.load(file);
            const oneShot = new Set<string>(["calendar.findTodaysEvents"]);
            const ctx = makeGrammarCtx(true, registry, file, oneShot);
            const decision = resolveGrammarRegistryFirst(
                [makeMatch("calendar", "findTodaysEvents")],
                ctx,
                "what's on my calendar today",
            );
            expect(decision?.kind).toBe("match");
            if (decision?.kind === "match") {
                const primary = decision.match.match.actions[0]?.action;
                expect(primary?.schemaName).toBe("calendar");
                expect(primary?.actionName).toBe("findTodaysEvents");
            }
            // The pick is consumed so a later request clarifies again.
            expect(oneShot.size).toBe(0);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it("falls through when a one-shot pick names a non-matched sibling", () => {
        const dir = tmpdir();
        try {
            const file = writePreview(dir, [calendarNeighborhood]);
            const registry = CollisionRegistry.load(file);
            // The grammar matched calendar; the user picked the sibling
            // taskflow.dailyAgendaEmail, which the grammar can't produce.
            const oneShot = new Set<string>(["taskflow.dailyAgendaEmail"]);
            const ctx = makeGrammarCtx(true, registry, file, oneShot);
            const decision = resolveGrammarRegistryFirst(
                [makeMatch("calendar", "findTodaysEvents")],
                ctx,
                "what's on my calendar today",
            );
            expect(decision?.kind).toBe("fallthrough");
            // The pick is left intact so translation can pin the schema.
            expect(oneShot.has("taskflow.dailyAgendaEmail")).toBe(true);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it("auto-resolves to a learned preference in the validated set", () => {
        const dir = tmpdir();
        try {
            const file = writePreview(dir, [calendarNeighborhood]);
            const registry = CollisionRegistry.load(file);
            const members: PreferenceMember[] = [
                { schemaName: "calendar", actionName: "findTodaysEvents" },
                { schemaName: "taskflow", actionName: "dailyAgendaEmail" },
            ];
            const store = CollisionPreferenceStore.load(undefined);
            store.set(members, members[0], "learned");
            const ctx = makeGrammarCtx(
                true,
                registry,
                file,
                new Set<string>(),
                store,
            );
            const decision = resolveGrammarRegistryFirst(
                [makeMatch("calendar", "findTodaysEvents")],
                ctx,
                "what's on my calendar today",
            );
            // Preference picks calendar, which is the grammar match → resolve.
            expect(decision?.kind).toBe("match");
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it("falls through when the preferred option is a non-matched sibling", () => {
        const dir = tmpdir();
        try {
            const file = writePreview(dir, [calendarNeighborhood]);
            const registry = CollisionRegistry.load(file);
            const members: PreferenceMember[] = [
                { schemaName: "calendar", actionName: "findTodaysEvents" },
                { schemaName: "taskflow", actionName: "dailyAgendaEmail" },
            ];
            const store = CollisionPreferenceStore.load(undefined);
            store.set(members, members[1], "learned"); // prefer taskflow
            const oneShot = new Set<string>();
            const ctx = makeGrammarCtx(true, registry, file, oneShot, store);
            const decision = resolveGrammarRegistryFirst(
                [makeMatch("calendar", "findTodaysEvents")],
                ctx,
                "what's on my calendar today",
            );
            // Preferred taskflow isn't in the grammar set → pin via one-shot.
            expect(decision?.kind).toBe("fallthrough");
            expect(oneShot.has("taskflow.dailyAgendaEmail")).toBe(true);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it("clarifies again once the preference is cleared", () => {
        const dir = tmpdir();
        try {
            const file = writePreview(dir, [calendarNeighborhood]);
            const registry = CollisionRegistry.load(file);
            const members: PreferenceMember[] = [
                { schemaName: "calendar", actionName: "findTodaysEvents" },
                { schemaName: "taskflow", actionName: "dailyAgendaEmail" },
            ];
            const store = CollisionPreferenceStore.load(undefined);
            store.set(members, members[0], "learned");
            store.clear();
            const ctx = makeGrammarCtx(
                true,
                registry,
                file,
                new Set<string>(),
                store,
            );
            const decision = resolveGrammarRegistryFirst(
                [makeMatch("calendar", "findTodaysEvents")],
                ctx,
                "what's on my calendar today",
            );
            // No preference left → back to clarifying.
            expect(decision?.kind).toBe("clarify");
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
