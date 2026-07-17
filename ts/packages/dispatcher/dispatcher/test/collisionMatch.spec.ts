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
import { CollisionEvent } from "../src/context/collisionTelemetry.js";
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
                const candidates = decision.clarify.parameters.candidates.map(
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

// Tier 1.5 — contextSelector over the registry-expanded neighborhood (§13.3).
// The construction cache commits an ambiguous phrase to a SINGLE namespace, so
// the grammar path sees one match and `isCollision` is false. The neighborhood
// registry re-expands that single match into its siblings, and contextSelector
// scores the whole neighborhood: a confident recent-topic winner resolves with
// no LLM (cache match) or via pin+fallthrough (a sibling the cache never
// produced); a weak/absent signal abstains to the Tier 2 clarify.

// Disjoint keyword vocabularies so every matched token is discriminating
// (candidate-local IDF = 1) — a clean neighborhood where only the conversation
// can break the tie.
const CALENDAR_KEYWORDS = new Set(["meeting", "appointment", "agenda"]);
const TASKFLOW_KEYWORDS = new Set(["inbox", "digest", "recipient"]);
const NEIGHBORHOOD_KEYWORDS: Record<string, Set<string>> = {
    "calendar.findTodaysEvents": CALENDAR_KEYWORDS,
    "taskflow.dailyAgendaEmail": TASKFLOW_KEYWORDS,
};

function makeContextCtx(opts: {
    registry: CollisionRegistry;
    registryPath: string;
    contextVector: Map<string, number>;
    detect?: boolean;
    registryFirst?: boolean;
    keywords?: Record<string, Set<string>>;
    oneShot?: Set<string>;
    preferences?: CollisionPreferenceStore;
    preferenceEnabled?: boolean;
    events?: CollisionEvent[];
}): CommandHandlerContext {
    const events = opts.events ?? [];
    const keywords = opts.keywords ?? NEIGHBORHOOD_KEYWORDS;
    return {
        session: {
            sessionDirPath: undefined,
            getConfig: () => ({
                collision: {
                    preference: {
                        registryFirst: opts.registryFirst ?? true,
                        registryPath: opts.registryPath,
                        enabled: opts.preferenceEnabled ?? true,
                        ambiguitySource: "both",
                    },
                    grammarMatch: { classifier: "distinctActions" },
                    contextSelector: {
                        detect: opts.detect ?? true,
                        windowTurns: 20,
                        decay: 0.9,
                        minUniqueTokens: 2,
                        minMass: 1.0,
                        margin: 0.5,
                        abstainFallback: "defer-to-strategy",
                    },
                    telemetry: { emit: true, debugLog: false },
                    priorityOrder: "",
                },
            }),
        },
        collisionRegistry: opts.registry,
        collisionRegistryPath: opts.registryPath,
        collisionOneShotPicks: opts.oneShot ?? new Set<string>(),
        pendingTopicalRoute: undefined,
        collisionPreferences:
            opts.preferences ?? CollisionPreferenceStore.load(undefined),
        collisionEvents: events,
        agents: { getAgentRank: () => 0 },
        conversationSignal: { getContextVector: () => opts.contextVector },
        contextSelectorKeywords: {
            effective: (s: string, a: string) =>
                keywords[`${s}.${a}`] ?? new Set<string>(),
        },
    } as unknown as CommandHandlerContext;
}

function primaryOf(match: MatchResult): {
    schemaName?: string;
    actionName?: string;
} {
    const action = match.match.actions[0]?.action;
    return {
        schemaName: action?.schemaName,
        actionName: action?.actionName,
    };
}

describe("matchCollision.resolveGrammarRegistryFirst — contextSelector tier (§13.3)", () => {
    it("resolves a cache-masked collision to the cached match on clear topic", () => {
        const dir = tmpdir();
        try {
            const file = writePreview(dir, [calendarNeighborhood]);
            const registry = CollisionRegistry.load(file);
            const events: CollisionEvent[] = [];
            const ctx = makeContextCtx({
                registry,
                registryPath: file,
                // Recent conversation is squarely about the calendar.
                contextVector: new Map([
                    ["meeting", 2],
                    ["appointment", 2],
                ]),
                events,
            });
            const decision = resolveGrammarRegistryFirst(
                [makeMatch("calendar", "findTodaysEvents")],
                ctx,
                "what's on for today",
            );
            expect(decision?.kind).toBe("match");
            if (decision?.kind === "match") {
                expect(primaryOf(decision.match).schemaName).toBe("calendar");
                expect(primaryOf(decision.match).actionName).toBe(
                    "findTodaysEvents",
                );
                // A routing note is surfaced for the U-2 affordance.
                expect(decision.note).toContain("calendar");
                expect(decision.note).toContain("routed");
            }
            // The topical decision emits a context-weight telemetry event.
            expect(
                events.some(
                    (e) =>
                        e.strategy === "context-weight" &&
                        e.chosen?.schemaName === "calendar",
                ),
            ).toBe(true);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it("records a request-scoped topical route (no preemptive note) for a non-matched sibling", () => {
        const dir = tmpdir();
        try {
            const file = writePreview(dir, [calendarNeighborhood]);
            const registry = CollisionRegistry.load(file);
            const oneShot = new Set<string>();
            const ctx = makeContextCtx({
                registry,
                registryPath: file,
                oneShot,
                // Recent conversation is about email/digests — the taskflow
                // sibling the grammar never matched.
                contextVector: new Map([
                    ["inbox", 2],
                    ["digest", 2],
                ]),
            });
            const decision = resolveGrammarRegistryFirst(
                [makeMatch("calendar", "findTodaysEvents")],
                ctx,
                "send me the rundown",
            );
            // The sibling has no cache MatchResult, so we fall through to
            // translation. The route + note are stashed request-scoped so the
            // note is shown only when translation actually commits the route —
            // NOT preemptively on the decision, and NOT via the durable
            // cross-turn one-shot pin (which would leak).
            expect(decision?.kind).toBe("fallthrough");
            if (decision?.kind === "fallthrough") {
                expect("note" in decision).toBe(false);
            }
            expect(ctx.pendingTopicalRoute?.schemaName).toBe("taskflow");
            expect(ctx.pendingTopicalRoute?.note).toContain("taskflow");
            // Must NOT use the durable one-shot pin for the topical route.
            expect(oneShot.size).toBe(0);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it("abstains to the Tier 2 clarify when the topic gives no signal", () => {
        const dir = tmpdir();
        try {
            const file = writePreview(dir, [calendarNeighborhood]);
            const registry = CollisionRegistry.load(file);
            const oneShot = new Set<string>();
            const ctx = makeContextCtx({
                registry,
                registryPath: file,
                oneShot,
                // Conversation matches neither neighbor -> contextSelector abstains.
                contextVector: new Map([
                    ["weather", 5],
                    ["forecast", 3],
                ]),
            });
            const decision = resolveGrammarRegistryFirst(
                [makeMatch("calendar", "findTodaysEvents")],
                ctx,
                "what's on for today",
            );
            expect(decision?.kind).toBe("clarify");
            // Abstain must not pin anything.
            expect(oneShot.size).toBe(0);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it("skips the tier and clarifies when contextSelector.detect is off", () => {
        const dir = tmpdir();
        try {
            const file = writePreview(dir, [calendarNeighborhood]);
            const registry = CollisionRegistry.load(file);
            const ctx = makeContextCtx({
                registry,
                registryPath: file,
                detect: false,
                // A clear calendar signal that WOULD resolve if the tier ran.
                contextVector: new Map([
                    ["meeting", 2],
                    ["appointment", 2],
                ]),
            });
            const decision = resolveGrammarRegistryFirst(
                [makeMatch("calendar", "findTodaysEvents")],
                ctx,
                "what's on for today",
            );
            expect(decision?.kind).toBe("clarify");
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it("honors a one-shot pick ahead of a conflicting topical signal", () => {
        const dir = tmpdir();
        try {
            const file = writePreview(dir, [calendarNeighborhood]);
            const registry = CollisionRegistry.load(file);
            // The user previously picked calendar; the topic now leans taskflow.
            const oneShot = new Set<string>(["calendar.findTodaysEvents"]);
            const ctx = makeContextCtx({
                registry,
                registryPath: file,
                oneShot,
                contextVector: new Map([
                    ["inbox", 2],
                    ["digest", 2],
                ]),
            });
            const decision = resolveGrammarRegistryFirst(
                [makeMatch("calendar", "findTodaysEvents")],
                ctx,
                "what's on for today",
            );
            // Tier 0 (one-shot) wins over Tier 1.5 (contextSelector).
            expect(decision?.kind).toBe("match");
            if (decision?.kind === "match") {
                expect(primaryOf(decision.match).schemaName).toBe("calendar");
            }
            expect(oneShot.size).toBe(0);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it("honors a learned preference ahead of a conflicting topical signal", () => {
        const dir = tmpdir();
        try {
            const file = writePreview(dir, [calendarNeighborhood]);
            const registry = CollisionRegistry.load(file);
            const members: PreferenceMember[] = [
                { schemaName: "calendar", actionName: "findTodaysEvents" },
                { schemaName: "taskflow", actionName: "dailyAgendaEmail" },
            ];
            const store = CollisionPreferenceStore.load(undefined);
            store.set(members, members[0], "learned"); // prefer calendar
            const ctx = makeContextCtx({
                registry,
                registryPath: file,
                preferences: store,
                // Topic leans taskflow, but the learned preference is calendar.
                contextVector: new Map([
                    ["inbox", 2],
                    ["digest", 2],
                ]),
            });
            const decision = resolveGrammarRegistryFirst(
                [makeMatch("calendar", "findTodaysEvents")],
                ctx,
                "what's on for today",
            );
            // Tier 1 (preference) wins over Tier 1.5 (contextSelector).
            expect(decision?.kind).toBe("match");
            if (decision?.kind === "match") {
                expect(primaryOf(decision.match).schemaName).toBe("calendar");
            }
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it("scores every validated match, not only the flagged neighborhood", () => {
        const dir = tmpdir();
        try {
            const file = writePreview(dir, [calendarNeighborhood]);
            const registry = CollisionRegistry.load(file);
            // A genuine 2-way cache collision: calendar (registry-flagged) and
            // weather (NOT in the neighborhood). The registry only re-expands
            // calendar's neighborhood {calendar, taskflow}; weather must still be
            // scored so it is not silently dropped.
            const ctx = makeContextCtx({
                registry,
                registryPath: file,
                keywords: {
                    "calendar.findTodaysEvents": CALENDAR_KEYWORDS,
                    "taskflow.dailyAgendaEmail": TASKFLOW_KEYWORDS,
                    "weather.getForecast": new Set([
                        "forecast",
                        "humidity",
                        "sunrise",
                    ]),
                },
                // Conversation is about the weather — the validated match that is
                // absent from the flagged neighborhood.
                contextVector: new Map([
                    ["forecast", 2],
                    ["humidity", 2],
                ]),
            });
            const decision = resolveGrammarRegistryFirst(
                [
                    makeMatch("calendar", "findTodaysEvents"),
                    makeMatch("weather", "getForecast"),
                ],
                ctx,
                "what's it like out",
            );
            // Resolves to weather's cache match — proof the union included it.
            expect(decision?.kind).toBe("match");
            if (decision?.kind === "match") {
                expect(primaryOf(decision.match).schemaName).toBe("weather");
                expect(primaryOf(decision.match).actionName).toBe(
                    "getForecast",
                );
            }
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it("does not route to a registry sibling whose schema is inactive", () => {
        const dir = tmpdir();
        try {
            const file = writePreview(dir, [calendarNeighborhood]);
            const registry = CollisionRegistry.load(file);
            const oneShot = new Set<string>();
            const ctx = makeContextCtx({
                registry,
                registryPath: file,
                oneShot,
                // Topic squarely favors the taskflow sibling...
                contextVector: new Map([
                    ["inbox", 2],
                    ["digest", 2],
                ]),
            });
            const decision = resolveGrammarRegistryFirst(
                [makeMatch("calendar", "findTodaysEvents")],
                ctx,
                "send me the rundown",
                // ...but taskflow is NOT active this turn.
                new Set(["calendar"]),
            );
            // The only routable candidate is calendar -> below the collision
            // threshold -> abstain to the Tier 2 clarify; nothing is pinned.
            expect(decision?.kind).toBe("clarify");
            expect(oneShot.size).toBe(0);
            expect(ctx.pendingTopicalRoute).toBeUndefined();
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
