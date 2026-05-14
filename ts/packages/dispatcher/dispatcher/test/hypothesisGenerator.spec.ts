// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    _clearRegistryForTest,
    registerLever,
    type LeverPlugin,
    type ProposeContext,
} from "../src/neighborhoods/optimize/registry.js";
import {
    generateHypotheses,
    selectLevers,
} from "../src/neighborhoods/optimize/hypothesisGenerator.js";
import type {
    CaseDescription,
    Hypothesis,
} from "../src/neighborhoods/optimize/types.js";
import { pmap } from "../src/neighborhoods/optimize/util.js";

function stubHypothesis(lever: string, idSuffix = "01"): Hypothesis {
    return {
        id: `h${idSuffix}-${lever}-original`,
        lever,
        depth: 0,
        rationale: { free: "test" },
        mechanism: "widen-identity",
        guidelineHook: null,
        diffSummary: {
            addedLines: 0,
            removedLines: 0,
            touchesIdentityLine: false,
            addsAntiExample: false,
        },
        payload: null,
    };
}

function stubLever(
    name: string,
    hypothesesPerCall: Hypothesis[] = [],
): LeverPlugin {
    return {
        name,
        description: `${name} stub`,
        consumes: ["neighborhoods"],
        probeType: "translator",
        async proposeHypotheses() {
            return hypothesesPerCall;
        },
        async applyToSandbox() {
            return { filesWritten: [] };
        },
    };
}

const STUB_CASE: CaseDescription = {
    schemaVersion: 1,
    neighborhoodId: "nbh-test",
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
};

const STUB_CTX: ProposeContext = {
    createModel: () => ({} as any),
    pmap,
    workdir: "",
    outDir: "",
    schemaGuidelines: "(test)",
};

describe("selectLevers", () => {
    beforeEach(() => {
        _clearRegistryForTest();
    });

    afterEach(() => {
        _clearRegistryForTest();
    });

    it("returns all registered levers when filter is undefined", () => {
        registerLever(stubLever("a"));
        registerLever(stubLever("b"));
        const levers = selectLevers();
        expect(levers.map((l) => l.name)).toEqual(["a", "b"]);
    });

    it("returns all when filter is empty array", () => {
        registerLever(stubLever("a"));
        registerLever(stubLever("b"));
        const levers = selectLevers([]);
        expect(levers.map((l) => l.name)).toEqual(["a", "b"]);
    });

    it("filters to the requested names", () => {
        registerLever(stubLever("a"));
        registerLever(stubLever("b"));
        registerLever(stubLever("c"));
        const levers = selectLevers(["a", "c"]);
        expect(levers.map((l) => l.name)).toEqual(["a", "c"]);
    });

    it("drops unknown names silently", () => {
        registerLever(stubLever("a"));
        const levers = selectLevers(["a", "nope"]);
        expect(levers.map((l) => l.name)).toEqual(["a"]);
    });
});

describe("generateHypotheses", () => {
    beforeEach(() => {
        _clearRegistryForTest();
    });

    afterEach(() => {
        _clearRegistryForTest();
    });

    it("concatenates hypotheses across registered levers", async () => {
        registerLever(
            stubLever("a", [stubHypothesis("a"), stubHypothesis("a", "02")]),
        );
        registerLever(stubLever("b", [stubHypothesis("b")]));
        const out = await generateHypotheses({
            caseDesc: STUB_CASE,
            priorAttempts: [],
            ctx: STUB_CTX,
        });
        expect(out).toHaveLength(3);
        // Renumbered sequentially across levers.
        expect(out.map((h) => h.id)).toEqual([
            "h01-a",
            "h02-a",
            "h03-b",
        ]);
    });

    it("renumbers ids ignoring lever-supplied original ids", async () => {
        // Levers may return whatever id they want; the generator
        // replaces with a deterministic seq tag.
        registerLever(
            stubLever("a", [
                { ...stubHypothesis("a"), id: "garbage-id-1" },
                { ...stubHypothesis("a"), id: "another-bogus" },
            ]),
        );
        const out = await generateHypotheses({
            caseDesc: STUB_CASE,
            priorAttempts: [],
            ctx: STUB_CTX,
        });
        expect(out.map((h) => h.id)).toEqual(["h01-a", "h02-a"]);
    });

    it("applies idOffset for depth-N rounds", async () => {
        registerLever(
            stubLever("a", [stubHypothesis("a"), stubHypothesis("a", "02")]),
        );
        const out = await generateHypotheses({
            caseDesc: STUB_CASE,
            priorAttempts: [],
            ctx: STUB_CTX,
            idOffset: 5,
        });
        expect(out.map((h) => h.id)).toEqual(["h06-a", "h07-a"]);
    });

    it("respects leverFilter", async () => {
        registerLever(stubLever("a", [stubHypothesis("a")]));
        registerLever(stubLever("b", [stubHypothesis("b")]));
        const out = await generateHypotheses({
            caseDesc: STUB_CASE,
            priorAttempts: [],
            leverFilter: ["b"],
            ctx: STUB_CTX,
        });
        expect(out).toHaveLength(1);
        expect(out[0]!.lever).toBe("b");
    });

    it("returns empty array when filter matches nothing", async () => {
        registerLever(stubLever("a", [stubHypothesis("a")]));
        const out = await generateHypotheses({
            caseDesc: STUB_CASE,
            priorAttempts: [],
            leverFilter: ["nope"],
            ctx: STUB_CTX,
        });
        expect(out).toEqual([]);
    });

    it("passes priorAttempts through to each lever", async () => {
        let captured: any = undefined;
        const tracker: LeverPlugin = {
            name: "tracker",
            description: "x",
            consumes: ["neighborhoods"],
            probeType: "translator",
            async proposeHypotheses(_caseDesc, priorAttempts) {
                captured = priorAttempts;
                return [];
            },
            async applyToSandbox() {
                return { filesWritten: [] };
            },
        };
        registerLever(tracker);
        const fakePrior = [
            {
                hypothesis: stubHypothesis("a"),
                evaluation: {
                    schemaVersion: 1 as const,
                    probeType: "translator" as const,
                    rescues: 0,
                    regressions: 2,
                    netDelta: -2,
                    score: -2,
                    regressionPhrases: ["bad"],
                },
                artifactPath: "/x",
            },
        ];
        await generateHypotheses({
            caseDesc: STUB_CASE,
            priorAttempts: fakePrior,
            ctx: STUB_CTX,
        });
        expect(captured).toBe(fakePrior);
    });
});
