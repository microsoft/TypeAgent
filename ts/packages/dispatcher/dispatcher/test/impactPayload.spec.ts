// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    buildImpactPayload,
    classifyTransition,
} from "../src/neighborhoods/optimize/impactPayload.js";
import type {
    TranslationProbeFile,
    TranslationProbeRow,
} from "../src/translation/translationProbeRunner.js";
import type {
    AttemptRecord,
    CaseResult,
} from "../src/neighborhoods/optimize/types.js";

function row(overrides: Partial<TranslationProbeRow>): TranslationProbeRow {
    return {
        expectedSchema: "player",
        expectedAction: "playTrack",
        phraseText: "play X",
        phraseSources: [],
        outcome: "CLEAN",
        multipleActions: false,
        model: "default",
        elapsedMs: 1,
        chosenSchema: "player",
        chosenAction: "playTrack",
        ...overrides,
    };
}

function probeFile(rows: TranslationProbeRow[]): TranslationProbeFile {
    return {
        summary: {
            scannedAt: new Date().toISOString(),
            elapsedMs: 0,
            totalPhrases: rows.length,
            counts: {
                CLEAN: 0,
                MISROUTE: 0,
                CLARIFY: 0,
                INVALID: 0,
                ERROR: 0,
            },
            strategyUsed: "first-match",
            strategyRestored: "first-match",
            corpusModels: [],
            userContextMode: "none",
        },
        results: rows,
    };
}

function caseWithWinner(
    schemas: string[],
    attemptId = "h01-jsdoc",
    neighborhoodId = "nbh-a",
): CaseResult {
    const members = schemas.map((s, i) => ({
        schemaName: s,
        actionName: `act${i}`,
    }));
    const winner: AttemptRecord = {
        hypothesis: {
            id: attemptId,
            lever: "jsdoc",
            depth: 0,
            rationale: { free: "" },
            mechanism: "widen-identity",
            guidelineHook: null,
            diffSummary: {
                addedLines: 0,
                removedLines: 0,
                touchesIdentityLine: false,
                addsAntiExample: false,
            },
            payload: null,
        },
        evaluation: {
            schemaVersion: 1,
            probeType: "translator",
            rescues: 0,
            regressions: 0,
            netDelta: 0,
            score: 1,
            regressionPhrases: [],
        },
        artifactPath: "/x",
    };
    return {
        case: {
            schemaVersion: 1,
            neighborhoodId,
            members,
            severityTier: "leaky",
            failurePattern: "similar-verb",
            failurePatternHeuristic: "similar-verb",
            misroutePhrases: [],
            cleanPhrases: [],
            reverseDirectionPhrases: [],
            currentJSDoc: {},
            currentManifestDescriptions: {},
            currentPasDescriptions: {},
            originalChecksum: {},
        },
        attempts: [winner],
        winner,
    };
}

describe("classifyTransition", () => {
    it("classifies rescues and regressions correctly", () => {
        expect(classifyTransition("MISROUTE", "CLEAN")).toBe("rescue");
        expect(classifyTransition("CLARIFY", "CLEAN")).toBe("rescue");
        expect(classifyTransition("CLEAN", "MISROUTE")).toBe("regression");
        expect(classifyTransition("CLEAN", "CLARIFY")).toBe("regression");
        expect(classifyTransition("CLEAN", "CLEAN")).toBe("clean-stable");
        expect(classifyTransition("MISROUTE", "MISROUTE")).toBe("still-broken");
        expect(classifyTransition("CLARIFY", "CLARIFY")).toBe("still-clarify");
        expect(classifyTransition("MISROUTE", "CLARIFY")).toBe("other");
    });
});

describe("buildImpactPayload", () => {
    it("counts rescues and regressions in transitions tally", () => {
        const baseline = probeFile([
            row({
                phraseText: "play Yellow",
                outcome: "MISROUTE",
                chosenSchema: "music",
                chosenAction: "playSong",
            }),
            row({ phraseText: "play X", outcome: "CLEAN" }),
            row({ phraseText: "play Y", outcome: "CLEAN" }),
        ]);
        const candidate = probeFile([
            row({ phraseText: "play Yellow", outcome: "CLEAN" }), // rescue
            row({
                phraseText: "play X",
                outcome: "MISROUTE",
                chosenSchema: "music",
                chosenAction: "playSong",
            }), // regression
            row({ phraseText: "play Y", outcome: "CLEAN" }), // clean-stable
        ]);
        const result = buildImpactPayload({
            baseline,
            candidate,
            baselinePath: "/baseline",
            candidatePath: "/candidate",
            caseResults: [],
        });
        expect(result.transitions.rescued).toBe(1);
        expect(result.transitions.regressed).toBe(1);
        expect(result.transitions.cleanStable).toBe(1);
        expect(result.transitions.total).toBe(3);
    });

    it("skips phrases unique to one side", () => {
        const baseline = probeFile([
            row({ phraseText: "shared", outcome: "MISROUTE" }),
            row({ phraseText: "baseline-only", outcome: "CLEAN" }),
        ]);
        const candidate = probeFile([
            row({ phraseText: "shared", outcome: "CLEAN" }),
            row({ phraseText: "candidate-only", outcome: "CLEAN" }),
        ]);
        const result = buildImpactPayload({
            baseline,
            candidate,
            baselinePath: "/b",
            candidatePath: "/c",
            caseResults: [],
        });
        expect(result.transitions.total).toBe(1);
        expect(result.transitions.rescued).toBe(1);
    });

    it("builds per-schema rescue/regression rollup", () => {
        const baseline = probeFile([
            row({
                expectedSchema: "player",
                phraseText: "a",
                outcome: "MISROUTE",
            }),
            row({
                expectedSchema: "email",
                expectedAction: "send",
                phraseText: "b",
                outcome: "CLEAN",
                chosenSchema: "email",
                chosenAction: "send",
            }),
        ]);
        const candidate = probeFile([
            row({
                expectedSchema: "player",
                phraseText: "a",
                outcome: "CLEAN",
            }),
            row({
                expectedSchema: "email",
                expectedAction: "send",
                phraseText: "b",
                outcome: "MISROUTE",
                chosenSchema: "other",
                chosenAction: "do",
            }),
        ]);
        const result = buildImpactPayload({
            baseline,
            candidate,
            baselinePath: "/b",
            candidatePath: "/c",
            caseResults: [],
        });
        const player = result.bySchema.find((s) => s.schema === "player");
        const email = result.bySchema.find((s) => s.schema === "email");
        expect(player?.rescued).toBe(1);
        expect(player?.regressed).toBe(0);
        expect(email?.rescued).toBe(0);
        expect(email?.regressed).toBe(1);
    });

    it("populates transition matrix", () => {
        const baseline = probeFile([
            row({ phraseText: "a", outcome: "MISROUTE" }),
            row({ phraseText: "b", outcome: "MISROUTE" }),
            row({ phraseText: "c", outcome: "CLEAN" }),
        ]);
        const candidate = probeFile([
            row({ phraseText: "a", outcome: "CLEAN" }),
            row({ phraseText: "b", outcome: "CLEAN" }),
            row({
                phraseText: "c",
                outcome: "MISROUTE",
                chosenSchema: "x",
                chosenAction: "y",
            }),
        ]);
        const result = buildImpactPayload({
            baseline,
            candidate,
            baselinePath: "/b",
            candidatePath: "/c",
            caseResults: [],
        });
        // MISROUTE → CLEAN happens twice.
        expect(result.transitionMatrix.MISROUTE.CLEAN).toBe(2);
        // CLEAN → MISROUTE happens once.
        expect(result.transitionMatrix.CLEAN.MISROUTE).toBe(1);
    });

    it("attributes rescues + regressions via expected-side + caused-side", () => {
        const baseline = probeFile([
            // Local rescue for player winner.
            row({
                expectedSchema: "player",
                phraseText: "a",
                outcome: "MISROUTE",
            }),
            // Local regression for player winner.
            row({
                expectedSchema: "player",
                phraseText: "b",
                outcome: "CLEAN",
            }),
            // Caused regression for player winner — candidate pulls to
            // player even though expected was email.
            row({
                expectedSchema: "email",
                phraseText: "c",
                outcome: "CLEAN",
                chosenSchema: "email",
                chosenAction: "send",
            }),
        ]);
        const candidate = probeFile([
            row({
                expectedSchema: "player",
                phraseText: "a",
                outcome: "CLEAN",
            }),
            row({
                expectedSchema: "player",
                phraseText: "b",
                outcome: "MISROUTE",
                chosenSchema: "other",
                chosenAction: "x",
            }),
            row({
                expectedSchema: "email",
                phraseText: "c",
                outcome: "MISROUTE",
                chosenSchema: "player",
                chosenAction: "playTrack",
            }),
        ]);
        const playerCase = caseWithWinner(["player"], "h01-jsdoc", "nbh-p");
        const result = buildImpactPayload({
            baseline,
            candidate,
            baselinePath: "/b",
            candidatePath: "/c",
            caseResults: [playerCase],
        });
        expect(result.winners).toHaveLength(1);
        const w = result.winners[0]!;
        expect(w.attemptId).toBe("h01-jsdoc");
        expect(w.schemasTouched).toEqual(["player"]);
        expect(w.localRescues).toBe(1);
        expect(w.localRegressions).toBe(1);
        // Phrase "c" regressed and candidate chose player (which IS in
        // schemasTouched). That's a caused regression.
        expect(w.causedRegressions).toBe(1);
        // localNet = 1 - 1 - 1 = -1
        expect(w.localNet).toBe(-1);
        // causedRegressions (1) > localRescues (1)? No (equal). Flag off.
        expect(w.causedRegression).toBe(false);
        // Backward-compat fields zeroed out.
        expect(w.crossNeighborhoodRegressions).toBe(0);
        expect(w.crossNeighborhoodRegression).toBe(false);
    });

    it("flags causedRegression when candidate pulls more wrong-targets than it rescues", () => {
        const baseline = probeFile([
            row({
                expectedSchema: "email",
                phraseText: "c",
                outcome: "CLEAN",
                chosenSchema: "email",
                chosenAction: "send",
            }),
            row({
                expectedSchema: "email",
                phraseText: "d",
                outcome: "CLEAN",
                chosenSchema: "email",
                chosenAction: "send",
            }),
        ]);
        const candidate = probeFile([
            row({
                expectedSchema: "email",
                phraseText: "c",
                outcome: "MISROUTE",
                chosenSchema: "player",
                chosenAction: "playTrack",
            }),
            row({
                expectedSchema: "email",
                phraseText: "d",
                outcome: "MISROUTE",
                chosenSchema: "player",
                chosenAction: "playTrack",
            }),
        ]);
        const playerCase = caseWithWinner(["player"], "h01-jsdoc", "nbh-p");
        const result = buildImpactPayload({
            baseline,
            candidate,
            baselinePath: "/b",
            candidatePath: "/c",
            caseResults: [playerCase],
        });
        const w = result.winners[0]!;
        expect(w.localRescues).toBe(0);
        expect(w.causedRegressions).toBe(2);
        expect(w.causedRegression).toBe(true);
    });

    it("ignores regressions where the candidate routed AWAY from the winner's schemas", () => {
        // Phrase expected on player, baseline routed to player (clean),
        // candidate routed to "other" (regression). The winner touches
        // player, but the regression's candidate did NOT route to
        // player — so it doesn't count as "caused" by this winner.
        const baseline = probeFile([
            row({
                expectedSchema: "player",
                phraseText: "x",
                outcome: "CLEAN",
                chosenSchema: "player",
                chosenAction: "playTrack",
            }),
        ]);
        const candidate = probeFile([
            row({
                expectedSchema: "player",
                phraseText: "x",
                outcome: "MISROUTE",
                chosenSchema: "elsewhere",
                chosenAction: "doThing",
            }),
        ]);
        const playerCase = caseWithWinner(["player"], "h01-jsdoc", "nbh-p");
        const result = buildImpactPayload({
            baseline,
            candidate,
            baselinePath: "/b",
            candidatePath: "/c",
            caseResults: [playerCase],
        });
        const w = result.winners[0]!;
        expect(w.localRegressions).toBe(1); // expected-side hit
        expect(w.causedRegressions).toBe(0); // candidate didn't pull TO player
    });

    it("skips cases without winners", () => {
        const baseline = probeFile([
            row({ phraseText: "x", outcome: "CLEAN" }),
        ]);
        const candidate = baseline;
        const caseWithoutWinner: CaseResult = {
            case: {
                schemaVersion: 1,
                neighborhoodId: "nbh-empty",
                members: [],
                severityTier: "leaky",
                failurePattern: "unclassified",
                failurePatternHeuristic: "unclassified",
                misroutePhrases: [],
                cleanPhrases: [],
                reverseDirectionPhrases: [],
                currentJSDoc: {},
                currentManifestDescriptions: {},
                currentPasDescriptions: {},
                originalChecksum: {},
            },
            attempts: [],
            winner: null,
        };
        const result = buildImpactPayload({
            baseline,
            candidate,
            baselinePath: "/b",
            candidatePath: "/c",
            caseResults: [caseWithoutWinner],
        });
        expect(result.winners).toEqual([]);
    });

    it("caps rows at rowCap and reports truncation in length only", () => {
        const baseRows = [];
        const candRows = [];
        for (let i = 0; i < 12; i++) {
            baseRows.push(row({ phraseText: `p${i}`, outcome: "MISROUTE" }));
            candRows.push(row({ phraseText: `p${i}`, outcome: "CLEAN" }));
        }
        const result = buildImpactPayload({
            baseline: probeFile(baseRows),
            candidate: probeFile(candRows),
            baselinePath: "/b",
            candidatePath: "/c",
            caseResults: [],
            rowCap: 5,
        });
        expect(result.rows).toHaveLength(5);
        expect(result.transitions.total).toBe(12);
        expect(result.transitions.rescued).toBe(12);
    });
});
