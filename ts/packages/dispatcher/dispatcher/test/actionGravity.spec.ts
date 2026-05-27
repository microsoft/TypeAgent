// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    computeActionGravity,
    topOffender,
    type PairScoreLookup,
} from "../src/neighborhoods/actionGravity.js";
import type {
    MisrouteEdgeEvidence,
    Neighborhood,
    NeighborhoodMember,
} from "../src/neighborhoods/types.js";

function m(schemaName: string, actionName: string): NeighborhoodMember {
    return { schemaName, actionName };
}

function edge(
    fromSchema: string,
    fromAction: string,
    toSchema: string,
    toAction: string,
    count: number,
    extras: Partial<MisrouteEdgeEvidence> = {},
): MisrouteEdgeEvidence {
    return {
        from: `${fromSchema}.${fromAction}`,
        to: `${toSchema}.${toAction}`,
        count,
        ...extras,
    };
}

function nbhd(
    members: NeighborhoodMember[],
    overrides: Partial<Neighborhood["evidence"]> = {},
): Neighborhood {
    return {
        id: members.map((x) => `${x.schemaName}.${x.actionName}`).join("--"),
        kind: "cross-schema",
        members,
        evidence: overrides,
        sources: ["corpus"],
    };
}

describe("computeActionGravity", () => {
    it("computes owedTraffic and stolenTraffic from corpus edges", () => {
        const n = nbhd([m("music", "setVolume"), m("desktop", "setVolume")], {
            misrouteEdges: [
                edge("music", "setVolume", "desktop", "setVolume", 17),
            ],
        });
        const g = computeActionGravity(n);
        const music = g.find((x) => x.member.schemaName === "music")!;
        const desktop = g.find((x) => x.member.schemaName === "desktop")!;
        expect(music.owedTraffic).toBe(17);
        expect(music.stolenTraffic).toBe(0);
        expect(desktop.owedTraffic).toBe(0);
        expect(desktop.stolenTraffic).toBe(17);
    });

    it("handles bidirectional edges and counts entanglement correctly", () => {
        const n = nbhd([m("a", "x"), m("b", "y")], {
            misrouteEdges: [
                edge("a", "x", "b", "y", 3),
                edge("b", "y", "a", "x", 5),
            ],
        });
        const g = computeActionGravity(n);
        const ax = g.find((x) => x.member.schemaName === "a")!;
        expect(ax.owedTraffic).toBe(3);
        expect(ax.stolenTraffic).toBe(5);
        expect(ax.partners).toBe(1);
        expect(ax.bidirectionalPartners).toBe(1);
        expect(ax.entanglement).toBe(2);
    });

    it("computes shareInNeighborhood as a fraction of total owed", () => {
        const n = nbhd([m("a", "x"), m("b", "y"), m("c", "z")], {
            misrouteEdges: [
                edge("a", "x", "c", "z", 6),
                edge("b", "y", "c", "z", 4),
            ],
        });
        const g = computeActionGravity(n);
        const ax = g.find((x) => x.member.schemaName === "a")!;
        const by = g.find((x) => x.member.schemaName === "b")!;
        const cz = g.find((x) => x.member.schemaName === "c")!;
        expect(ax.shareInNeighborhood).toBeCloseTo(0.6, 5);
        expect(by.shareInNeighborhood).toBeCloseTo(0.4, 5);
        expect(cz.shareInNeighborhood).toBe(0); // pure attractor, no outflow
    });

    it("weightedConfusion multiplies count by pair similarity, default 1", () => {
        const n = nbhd([m("a", "x"), m("b", "y")], {
            misrouteEdges: [edge("a", "x", "b", "y", 10)],
        });
        const noLookup = computeActionGravity(n);
        expect(
            noLookup.find((x) => x.member.schemaName === "a")!
                .weightedConfusion,
        ).toBe(10);
        const lookup: PairScoreLookup = (a, b) => {
            const k1 = `${a.schemaName}.${a.actionName}`;
            const k2 = `${b.schemaName}.${b.actionName}`;
            if (
                (k1 === "a.x" && k2 === "b.y") ||
                (k1 === "b.y" && k2 === "a.x")
            ) {
                return 0.7;
            }
            return undefined;
        };
        const withLookup = computeActionGravity(n, lookup);
        expect(
            withLookup.find((x) => x.member.schemaName === "a")!
                .weightedConfusion,
        ).toBeCloseTo(7, 5);
    });

    it("similarity-only neighborhoods leave owed/stolen at 0 and set semanticGravity", () => {
        const n: Neighborhood = {
            id: "sim-only",
            kind: "cross-schema",
            members: [m("a", "x"), m("b", "y"), m("c", "z")],
            evidence: { similarityScore: 0.82, similarityStrategy: "balanced" },
            sources: ["similarity"],
        };
        const lookup: PairScoreLookup = (a, b) => {
            const ka = `${a.schemaName}.${a.actionName}`;
            const kb = `${b.schemaName}.${b.actionName}`;
            const pair = [ka, kb].sort().join("|");
            const scores: Record<string, number> = {
                "a.x|b.y": 0.8,
                "a.x|c.z": 0.6,
                "b.y|c.z": 0.7,
            };
            return scores[pair];
        };
        const g = computeActionGravity(n, lookup);
        const ax = g.find((x) => x.member.schemaName === "a")!;
        expect(ax.owedTraffic).toBe(0);
        expect(ax.stolenTraffic).toBe(0);
        expect(ax.semanticGravity).toBeCloseTo((0.8 + 0.6) / 2, 5);
        expect(ax.endUserOwedTraffic).toBeUndefined();
    });

    it("translator-derived fields stay undefined when no translator data", () => {
        const n = nbhd([m("a", "x"), m("b", "y")], {
            misrouteEdges: [edge("a", "x", "b", "y", 5)],
        });
        const g = computeActionGravity(n);
        for (const a of g) {
            expect(a.endUserOwedTraffic).toBeUndefined();
            expect(a.translatorOwedTraffic).toBeUndefined();
            expect(a.translatorRecoveryRate).toBeUndefined();
            expect(a.severityTier).toBeUndefined();
        }
    });

    it("translator-derived fields populate when crossVerdict counts are present on edges", () => {
        const n = nbhd([m("a", "x"), m("b", "y"), m("c", "z")], {
            misrouteEdges: [
                // a→b: 10 misroutes; 6 confirmed by translator, 4 rescued
                edge("a", "x", "b", "y", 10, {
                    translatorConfirmedCount: 6,
                    translatorRescuedCount: 4,
                }),
            ],
            translatorMisrouteEdges: [
                // c→a: NEW_FAILURE — ranker said correct, translator wrong
                edge("c", "z", "a", "x", 3),
            ],
            crossVerdicts: { CONFIRMED: 6, RESCUED: 4, NEW_FAILURE: 3 },
        });
        const g = computeActionGravity(n);
        const ax = g.find((x) => x.member.schemaName === "a")!;
        const cz = g.find((x) => x.member.schemaName === "c")!;
        // a.x is the `from` of a CONFIRMED edge with 6 confirmed phrases.
        // a.x is also the `to` of a NEW_FAILURE edge — that affects neither
        // owedTraffic (NEW_FAILURE doesn't go in misrouteEdges) nor
        // endUserOwedTraffic for a.x (it's a `to`, not a `from`).
        expect(ax.endUserOwedTraffic).toBe(6);
        expect(ax.translatorOwedTraffic).toBe(0);
        expect(ax.translatorRecoveryRate).toBeCloseTo(4 / 10, 5);
        // c.z is the `from` of a NEW_FAILURE edge with 3 phrases.
        expect(cz.endUserOwedTraffic).toBe(3);
        expect(cz.translatorOwedTraffic).toBe(3);
        expect(cz.severityTier).toBe("blocker");
    });

    it("severityTier marks an action as 'leaky' when LLM rescues most ranker misroutes", () => {
        const n = nbhd([m("a", "x"), m("b", "y")], {
            misrouteEdges: [
                edge("a", "x", "b", "y", 10, {
                    translatorConfirmedCount: 0,
                    translatorRescuedCount: 10,
                }),
            ],
            crossVerdicts: { RESCUED: 10 },
        });
        const g = computeActionGravity(n);
        const ax = g.find((x) => x.member.schemaName === "a")!;
        expect(ax.endUserOwedTraffic).toBe(0);
        expect(ax.translatorRecoveryRate).toBe(1);
        expect(ax.severityTier).toBe("leaky");
    });

    it("7-member neighborhood with a hub action: hub has highest entanglement", () => {
        const hub = m("hub", "do");
        const others = ["a", "b", "c", "d", "e", "f"].map((s) => m(s, "do"));
        const members = [hub, ...others];
        const edges = others.map((other) =>
            edge(other.schemaName, "do", "hub", "do", 2),
        );
        edges.push(edge("hub", "do", "a", "do", 1));
        const n = nbhd(members, { misrouteEdges: edges });
        const g = computeActionGravity(n);
        const hubGravity = g.find((x) => x.member.schemaName === "hub")!;
        expect(hubGravity.partners).toBe(6);
        // hub is bidirectional only with 'a' (a→hub and hub→a both exist).
        expect(hubGravity.bidirectionalPartners).toBe(1);
        expect(hubGravity.entanglement).toBe(7);
        // Every other action has just hub as a partner.
        for (const other of others) {
            const og = g.find((x) => x.member.schemaName === other.schemaName)!;
            expect(og.partners).toBe(1);
        }
    });
});

describe("topOffender", () => {
    it("picks the action with the highest owedTraffic by default", () => {
        const n = nbhd([m("a", "x"), m("b", "y"), m("c", "z")], {
            misrouteEdges: [
                edge("a", "x", "c", "z", 7),
                edge("b", "y", "c", "z", 3),
            ],
        });
        const t = topOffender(n);
        expect(t).toBeDefined();
        expect(t!.member.schemaName).toBe("a");
    });

    it("prefers endUserOwedTraffic when translator data is present", () => {
        const n = nbhd([m("a", "x"), m("b", "y"), m("c", "z")], {
            misrouteEdges: [
                // a is a heavy ranker-loser but the LLM rescues all of it.
                edge("a", "x", "c", "z", 100, {
                    translatorRescuedCount: 100,
                }),
                // b loses fewer but the LLM does NOT rescue them.
                edge("b", "y", "c", "z", 5, {
                    translatorConfirmedCount: 5,
                }),
            ],
            crossVerdicts: { CONFIRMED: 5, RESCUED: 100 },
        });
        const t = topOffender(n);
        expect(t!.member.schemaName).toBe("b");
    });

    it("returns undefined for an empty neighborhood", () => {
        const n: Neighborhood = {
            id: "empty",
            kind: "cross-schema",
            members: [],
            evidence: {},
            sources: [],
        };
        expect(topOffender(n)).toBeUndefined();
    });
});
