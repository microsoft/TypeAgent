// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { MatchResult } from "agent-cache";
import type { CommandHandlerContext } from "../src/context/commandHandlerContext.js";
import { resolveContextSelector } from "../src/translation/matchContextSelector.js";
import { ContextVector } from "../src/context/contextSelector/conversationSignal.js";
import { CollisionEvent } from "../src/context/collisionTelemetry.js";

type Overrides = {
    contextVector: ContextVector;
    keywords: Record<string, Set<string>>;
    contextSelector?: Record<string, unknown>;
};

function makeCtx(o: Overrides): {
    ctx: CommandHandlerContext;
    events: CollisionEvent[];
} {
    const contextSelector = {
        detect: true,
        windowTurns: 20,
        decay: 0.9,
        minUniqueTokens: 2,
        minMass: 1.0,
        margin: 1.0,
        abstainFallback: "defer-to-strategy",
        ...o.contextSelector,
    };
    const events: CollisionEvent[] = [];
    const ctx = {
        collisionEvents: events,
        session: {
            sessionDirPath: undefined,
            getConfig: () => ({
                collision: {
                    contextSelector,
                    grammarMatch: { classifier: "distinctActions" },
                    telemetry: { emit: true, debugLog: false },
                },
            }),
        },
        conversationSignal: { getContextVector: () => o.contextVector },
        contextSelectorKeywords: {
            effective: (s: string, a: string) =>
                o.keywords[`${s}.${a}`] ?? new Set<string>(),
        },
    } as unknown as CommandHandlerContext;
    return { ctx, events };
}

function fakeMatch(schemaName: string, actionName: string): MatchResult {
    return {
        match: { actions: [{ action: { schemaName, actionName } }] },
    } as unknown as MatchResult;
}

const excelMatch = fakeMatch("excel", "addRow");
const listMatch = fakeMatch("list", "addItems");

function vector(entries: Record<string, number>): ContextVector {
    return new Map(Object.entries(entries));
}

describe("resolveContextSelector", () => {
    it("resolves to the topical winner and emits a context-weight event", () => {
        const { ctx, events } = makeCtx({
            contextVector: vector({ spreadsheet: 2, formula: 1.5 }),
            keywords: {
                "excel.addRow": new Set(["spreadsheet", "formula", "cell"]),
                "list.addItems": new Set(["grocery", "shopping"]),
            },
        });
        const res = resolveContextSelector(
            [excelMatch, listMatch],
            ctx,
            "add a row",
        );
        expect(res).toBeDefined();
        expect(res!.match).toBe(excelMatch);
        expect(res!.note).toContain("excel");
        expect(res!.note).toContain("routed");
        expect(events).toHaveLength(1);
        expect(events[0].strategy).toBe("context-weight");
        expect(events[0].chosen?.schemaName).toBe("excel");
    });

    it("abstains (coverage) when a candidate has no keywords", () => {
        const { ctx, events } = makeCtx({
            contextVector: vector({ spreadsheet: 8, formula: 5 }),
            keywords: {
                "excel.addRow": new Set(["spreadsheet", "formula"]),
                "list.addItems": new Set(),
            },
        });
        const res = resolveContextSelector(
            [excelMatch, listMatch],
            ctx,
            "add a row",
        );
        expect(res).toBeUndefined();
        expect(events[0].note).toBe("abstain:coverage");
    });

    it("abstains (margin) on a genuine tie", () => {
        const { ctx, events } = makeCtx({
            contextVector: vector({
                spreadsheet: 1,
                formula: 1,
                grocery: 1,
                shopping: 1,
            }),
            keywords: {
                "excel.addRow": new Set(["spreadsheet", "formula"]),
                "list.addItems": new Set(["grocery", "shopping"]),
            },
        });
        const res = resolveContextSelector(
            [excelMatch, listMatch],
            ctx,
            "add a row",
        );
        expect(res).toBeUndefined();
        expect(events[0].note).toBe("abstain:margin");
    });

    it("abstains (no-signal) when the conversation matches neither", () => {
        const { ctx, events } = makeCtx({
            contextVector: vector({ meeting: 6, calendar: 3 }),
            keywords: {
                "excel.addRow": new Set(["spreadsheet", "formula"]),
                "list.addItems": new Set(["grocery", "shopping"]),
            },
        });
        const res = resolveContextSelector(
            [excelMatch, listMatch],
            ctx,
            "add a row",
        );
        expect(res).toBeUndefined();
        expect(events[0].note).toBe("abstain:no-signal");
    });

    it("returns undefined when there are fewer than two distinct candidates", () => {
        const { ctx } = makeCtx({
            contextVector: vector({ spreadsheet: 5 }),
            keywords: { "excel.addRow": new Set(["spreadsheet"]) },
        });
        const res = resolveContextSelector(
            [excelMatch, fakeMatch("excel", "addRow")],
            ctx,
            "add a row",
        );
        expect(res).toBeUndefined();
    });
});
