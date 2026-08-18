// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it } from "@jest/globals";

import {
    applyTranslationBenchNegativeFairnessIssues,
    checkTranslationBenchCandidateNegativeFairness,
    checkTranslationBenchNegativeFairnessAssessment,
    decomposedFlagsAreFair,
    parseTranslationBenchNegativeFairnessAssessments,
    type TranslationBenchNegativeFairnessAssessment,
    type TranslationBenchNegativeKind,
} from "../src/translationBench/synthesizer/negativeFairness.js";

const targetOpenWebPage = {
    schemaName: "browser",
    actionName: "openWebPage",
};

function fairCandidate(negativeUtterance: string) {
    return {
        seed: {
            utterance: "Go to the Apple stock quote website",
            expectedActions: [
                {
                    schemaName: "browser",
                    actionName: "openWebPage",
                    parameters: { site: "apple.com" },
                },
            ],
            order: "strict" as const,
        },
        genCases: [
            {
                id: "pos-1",
                role: "positive" as const,
                utterance: "Navigate to apple.com/investor in the browser",
                expectedActions: [
                    {
                        schemaName: "browser",
                        actionName: "openWebPage",
                        parameters: { site: "apple.com/investor" },
                    },
                ],
                order: "strict" as const,
                dimensions: { variation: "paraphrase" },
            },
            {
                id: "neg-1",
                role: "negative" as const,
                utterance: negativeUtterance,
                expectedActions: [],
                order: "strict" as const,
                dimensions: { negativeKind: "pure_refusal" },
            },
        ],
    };
}

function assess(options: {
    path: string;
    kind: TranslationBenchNegativeKind;
    fairEmptyGold: boolean;
    reason: string;
    opensAsHardAbstain?: boolean;
    hasAlternateOrSiblingTask?: boolean;
    hasQuestionOrExplanationRequest?: boolean;
    mapsToAnyLoadedTool?: boolean;
}): TranslationBenchNegativeFairnessAssessment {
    const fair = options.fairEmptyGold && options.kind === "pure_refusal";
    return {
        path: options.path,
        kind: options.kind,
        fairEmptyGold: options.fairEmptyGold,
        reason: options.reason,
        opensAsHardAbstain: options.opensAsHardAbstain ?? fair,
        hasAlternateOrSiblingTask: options.hasAlternateOrSiblingTask ?? !fair,
        hasQuestionOrExplanationRequest:
            options.hasQuestionOrExplanationRequest ?? false,
        mapsToAnyLoadedTool: options.mapsToAnyLoadedTool ?? !fair,
    };
}

describe("translation bench negative fairness LLM assessment parsing", () => {
    it("parses structured assessments", () => {
        const assessments = parseTranslationBenchNegativeFairnessAssessments([
            assess({
                path: "$.genCases[1].utterance",
                kind: "pure_refusal",
                fairEmptyGold: true,
                reason: "explicit don't of the target",
            }),
        ]);
        expect(assessments).toHaveLength(1);
        expect(assessments[0]!.kind).toBe("pure_refusal");
        expect(decomposedFlagsAreFair(assessments[0]!)).toBe(true);
    });

    it("rejects assessments missing atomic flags", () => {
        expect(() =>
            parseTranslationBenchNegativeFairnessAssessments([
                {
                    path: "$.genCases[1].utterance",
                    kind: "pure_refusal",
                    fairEmptyGold: true,
                    reason: "missing flags",
                },
            ]),
        ).toThrow(/opensAsHardAbstain|required/i);
    });

    it("accepts consistent fair assessments", () => {
        const r = checkTranslationBenchNegativeFairnessAssessment(
            assess({
                path: "$.genCases[0].utterance",
                kind: "pure_refusal",
                fairEmptyGold: true,
                reason: "don't screenshot banking",
            }),
            "Don't take a screenshot of my online banking page.",
            { schemaName: "browser", actionName: "captureScreenshot" },
        );
        expect(r.ok).toBe(true);
        expect(r.kind).toBe("pure_refusal");
    });

    it("rejects unfair assessments and inconsistent fairEmptyGold flags", () => {
        const unfair = checkTranslationBenchNegativeFairnessAssessment(
            assess({
                path: "$.n",
                kind: "unfair_imperative",
                fairEmptyGold: false,
                reason: "still requests close this tab",
            }),
            "Close only the current web page.",
            targetOpenWebPage,
        );
        expect(unfair.ok).toBe(false);

        const inconsistent = checkTranslationBenchNegativeFairnessAssessment(
            assess({
                path: "$.n",
                kind: "unfair_contrastive",
                fairEmptyGold: true,
                reason: "model lied",
            }),
            "Search Bing for MSFT",
            targetOpenWebPage,
        );
        expect(inconsistent.ok).toBe(false);
    });

    it("rejects fairEmptyGold=true when atomic flags are not a hard abstain", () => {
        const sibling = checkTranslationBenchNegativeFairnessAssessment(
            assess({
                path: "$.n",
                kind: "pure_refusal",
                fairEmptyGold: true,
                reason: "LLM mislabeled sibling imperative as refusal",
                opensAsHardAbstain: false,
                hasAlternateOrSiblingTask: true,
                mapsToAnyLoadedTool: true,
            }),
            "Search Bing for Microsoft's current stock price.",
            targetOpenWebPage,
        );
        expect(sibling.ok).toBe(false);
        expect(sibling.reason).toMatch(/inconsistent/i);

        const question = checkTranslationBenchNegativeFairnessAssessment(
            assess({
                path: "$.n",
                kind: "pure_refusal",
                fairEmptyGold: true,
                reason: "LLM mislabeled how-to as refusal",
                opensAsHardAbstain: false,
                hasQuestionOrExplanationRequest: true,
                mapsToAnyLoadedTool: true,
            }),
            "What keyboard shortcut can I use to take a screenshot?",
            targetOpenWebPage,
        );
        expect(question.ok).toBe(false);
        expect(question.reason).toMatch(/inconsistent|hasQuestion/i);
    });

    it("rejects definition/status questions even when fairEmptyGold is true", () => {
        const definition = checkTranslationBenchNegativeFairnessAssessment(
            assess({
                path: "$.n",
                kind: "non_action_question",
                fairEmptyGold: true,
                reason: "definition only — but invites chat/help under full catalog",
            }),
            "What does openWebPage mean?",
            targetOpenWebPage,
        );
        expect(definition.ok).toBe(false);

        const status = checkTranslationBenchNegativeFairnessAssessment(
            assess({
                path: "$.n",
                kind: "non_action_question",
                fairEmptyGold: true,
                reason: "status question",
            }),
            "Is Bluetooth currently enabled?",
            targetOpenWebPage,
        );
        expect(status.ok).toBe(false);

        const missing = checkTranslationBenchNegativeFairnessAssessment(
            assess({
                path: "$.n",
                kind: "missing_info",
                fairEmptyGold: true,
                reason: "underspecified",
            }),
            "I'm not sure which tab — please clarify.",
            targetOpenWebPage,
        );
        expect(missing.ok).toBe(false);
    });
});

describe("translation bench candidate negative fairness from LLM assessments", () => {
    it("flags unfair negatives from assessments", () => {
        const candidate = fairCandidate(
            'Click the link titled "Museum Opening Hours."',
        );
        const issues = checkTranslationBenchCandidateNegativeFairness(
            candidate,
            targetOpenWebPage,
            [
                assess({
                    path: "$.genCases[1].utterance",
                    kind: "unfair_imperative",
                    fairEmptyGold: false,
                    reason: "Requests followLinkByText; empty gold would FP a correct translator",
                }),
            ],
        );
        expect(issues.length).toBeGreaterThan(0);
        expect(issues[0]!.code).toBe("BAD_NEGATIVE");
        expect(issues[0]!.path).toContain("genCases[1]");
    });

    it("accepts pure-refusal assessments", () => {
        const candidate = fairCandidate(
            "Don't open any websites right now — leave my browser alone.",
        );
        const issues = checkTranslationBenchCandidateNegativeFairness(
            candidate,
            targetOpenWebPage,
            [
                assess({
                    path: "$.genCases[1].utterance",
                    kind: "pure_refusal",
                    fairEmptyGold: true,
                    reason: "leave-alone refusal of opening sites",
                }),
            ],
        );
        expect(issues).toEqual([]);
    });

    it("rejects LLM-approved pure_refusal when atomic flags say sibling command", () => {
        const candidate = fairCandidate(
            "Search Bing for Microsoft's current stock price.",
        );
        const issues = checkTranslationBenchCandidateNegativeFairness(
            candidate,
            targetOpenWebPage,
            [
                assess({
                    path: "$.genCases[1].utterance",
                    kind: "pure_refusal",
                    fairEmptyGold: true,
                    reason: "LLM wrongly approved contrastive sibling as empty gold",
                    opensAsHardAbstain: false,
                    hasAlternateOrSiblingTask: true,
                    mapsToAnyLoadedTool: true,
                }),
            ],
        );
        expect(issues.length).toBeGreaterThan(0);
        expect(issues[0]!.code).toBe("BAD_NEGATIVE");
        expect(issues[0]!.message).toMatch(/inconsistent|mapsToAnyLoadedTool/i);
    });

    it("rejects refuse-then-alternate when flags mark an alternate task", () => {
        const candidate = fairCandidate(
            "Don't close all tabs; just close this one.",
        );
        const issues = checkTranslationBenchCandidateNegativeFairness(
            candidate,
            targetOpenWebPage,
            [
                assess({
                    path: "$.genCases[1].utterance",
                    kind: "pure_refusal",
                    fairEmptyGold: true,
                    reason: "LLM missed refuse-then-alternate",
                    opensAsHardAbstain: true,
                    hasAlternateOrSiblingTask: true,
                    mapsToAnyLoadedTool: true,
                }),
            ],
        );
        expect(issues.some((i) => i.code === "BAD_NEGATIVE")).toBe(true);
        expect(issues[0]!.message).toMatch(
            /inconsistent|hasAlternateOrSiblingTask/i,
        );
    });

    it("rejects definition question assessments as empty gold", () => {
        const candidate = fairCandidate("What does openWebPage mean?");
        candidate.genCases[1]!.dimensions = {
            negativeKind: "non_action_question",
        };
        const issues = checkTranslationBenchCandidateNegativeFairness(
            candidate,
            targetOpenWebPage,
            [
                assess({
                    path: "$.genCases[1].utterance",
                    kind: "non_action_question",
                    fairEmptyGold: true,
                    reason: "definition only",
                }),
            ],
        );
        expect(issues.length).toBeGreaterThan(0);
        expect(issues[0]!.code).toBe("BAD_NEGATIVE");
        expect(issues[0]!.path).toBe("$.genCases[1].utterance");
    });

    it("rejects soft solicit and refuse-then-alternate empties", () => {
        const soft = checkTranslationBenchCandidateNegativeFairness(
            fairCandidate("Can you open google.com for me?"),
            targetOpenWebPage,
            [
                assess({
                    path: "$.genCases[1].utterance",
                    kind: "unfair_imperative",
                    fairEmptyGold: false,
                    reason: "soft solicit still requests openWebPage",
                }),
            ],
        );
        expect(soft.some((i) => i.code === "BAD_NEGATIVE")).toBe(true);

        const alternate = checkTranslationBenchCandidateNegativeFairness(
            fairCandidate("Don't close all tabs; just close this one."),
            targetOpenWebPage,
            [
                assess({
                    path: "$.genCases[1].utterance",
                    kind: "unfair_contrastive",
                    fairEmptyGold: false,
                    reason: "refuse-then-alternate still requests closeWebPage",
                }),
            ],
        );
        expect(alternate.some((i) => i.code === "BAD_NEGATIVE")).toBe(true);
    });

    it("rejects pure_refusal assessment when dimensions.negativeKind is a Q&A kind", () => {
        const candidate = fairCandidate("What does openWebPage mean?");
        candidate.genCases[1]!.dimensions = {
            negativeKind: "non_action_question",
        };
        const issues = checkTranslationBenchCandidateNegativeFairness(
            candidate,
            targetOpenWebPage,
            [
                assess({
                    path: "$.genCases[1].utterance",
                    kind: "pure_refusal",
                    fairEmptyGold: true,
                    reason: "LLM mislabeled a definition question as refusal",
                }),
            ],
        );
        expect(issues.length).toBeGreaterThan(0);
        expect(issues[0]!.code).toBe("BAD_NEGATIVE");
        expect(issues[0]!.message).toMatch(
            /negativeKind|zero-action|pure_refusal/i,
        );
    });

    it("rejects a fair pure_refusal assessment when dimensions.negativeKind is missing", () => {
        const candidate = fairCandidate("Leave my browser alone.");
        delete candidate.genCases[1]!.dimensions.negativeKind;
        const issues = checkTranslationBenchCandidateNegativeFairness(
            candidate,
            targetOpenWebPage,
            [
                assess({
                    path: "$.genCases[1].utterance",
                    kind: "pure_refusal",
                    fairEmptyGold: true,
                    reason: "leave-alone refusal but label omitted",
                }),
            ],
        );
        expect(issues.length).toBeGreaterThan(0);
        expect(issues[0]!.code).toBe("BAD_NEGATIVE");
        expect(issues[0]!.message).toMatch(/pure_refusal/);
    });

    it("requires one assessment per negative", () => {
        const candidate = fairCandidate("Leave my tabs alone.");
        const issues = checkTranslationBenchCandidateNegativeFairness(
            candidate,
            targetOpenWebPage,
            [],
        );
        expect(issues.some((i) => i.path === "$.negativeAssessments")).toBe(
            true,
        );
    });

    it("canonicalizes mechanical path aliases onto $.genCases[N].utterance", () => {
        const candidate = fairCandidate("Leave my tabs alone.");
        const issues = checkTranslationBenchCandidateNegativeFairness(
            candidate,
            targetOpenWebPage,
            [
                assess({
                    path: "genCases[1]",
                    kind: "pure_refusal",
                    fairEmptyGold: true,
                    reason: "leave-alone refusal",
                }),
            ],
        );
        expect(issues).toEqual([]);
    });

    it("rejects assessments whose path does not match a negative genCase", () => {
        const candidate = fairCandidate(
            "Don't close all tabs; just close this one.",
        );
        const issues = checkTranslationBenchCandidateNegativeFairness(
            candidate,
            targetOpenWebPage,
            [
                assess({
                    path: "$.wrong.path",
                    kind: "unfair_contrastive",
                    fairEmptyGold: false,
                    reason: "refuse-then-alternate still requests an action",
                }),
            ],
        );
        expect(issues).toHaveLength(1);
        expect(issues[0]!.code).toBe("BAD_NEGATIVE");
        expect(issues[0]!.path).toBe("$.negativeAssessments");
        expect(issues[0]!.message).toMatch(/path/i);
    });

    it("matches assessments by exact path, not array order", () => {
        const candidate = {
            seed: fairCandidate("Leave my browser alone.").seed,
            genCases: [
                fairCandidate("Leave my browser alone.").genCases[0]!,
                {
                    id: "neg-fair",
                    role: "negative" as const,
                    utterance: "Leave my browser alone.",
                    expectedActions: [],
                    order: "strict" as const,
                    dimensions: { negativeKind: "pure_refusal" },
                },
                {
                    id: "neg-unfair",
                    role: "negative" as const,
                    utterance: "Don't close all tabs; just close this one.",
                    expectedActions: [],
                    order: "strict" as const,
                    dimensions: { negativeKind: "unfair_contrastive" },
                },
            ],
        };
        // Assessments deliberately reordered vs genCases; paths are the join key.
        const issues = checkTranslationBenchCandidateNegativeFairness(
            candidate,
            targetOpenWebPage,
            [
                assess({
                    path: "$.genCases[2].utterance",
                    kind: "unfair_contrastive",
                    fairEmptyGold: false,
                    reason: "refuse-then-alternate still requests closeWebPage",
                }),
                assess({
                    path: "$.genCases[1].utterance",
                    kind: "pure_refusal",
                    fairEmptyGold: true,
                    reason: "leave-alone pure refusal",
                }),
            ],
        );
        expect(issues).toHaveLength(1);
        expect(issues[0]!.code).toBe("BAD_NEGATIVE");
        expect(issues[0]!.path).toBe("$.genCases[2].utterance");
    });

    it("does not bind reordered assessments by index when paths are correct", () => {
        const candidate = {
            seed: fairCandidate("Leave my browser alone.").seed,
            genCases: [
                fairCandidate("Leave my browser alone.").genCases[0]!,
                {
                    id: "neg-unfair",
                    role: "negative" as const,
                    utterance: "Don't close all tabs; just close this one.",
                    expectedActions: [],
                    order: "strict" as const,
                    dimensions: { negativeKind: "unfair_contrastive" },
                },
                {
                    id: "neg-fair",
                    role: "negative" as const,
                    utterance: "Leave my browser alone.",
                    expectedActions: [],
                    order: "strict" as const,
                    dimensions: { negativeKind: "pure_refusal" },
                },
            ],
        };
        // Array order is [fair-for-path2, unfair-for-path1] — opposite of
        // genCase negative order. Index pairing would mark path1 fair; path
        // join must keep the unfair judgment on $.genCases[1].
        const issues = checkTranslationBenchCandidateNegativeFairness(
            candidate,
            targetOpenWebPage,
            [
                assess({
                    path: "$.genCases[2].utterance",
                    kind: "pure_refusal",
                    fairEmptyGold: true,
                    reason: "leave-alone pure refusal",
                }),
                assess({
                    path: "$.genCases[1].utterance",
                    kind: "unfair_contrastive",
                    fairEmptyGold: false,
                    reason: "refuse-then-alternate still requests closeWebPage",
                }),
            ],
        );
        expect(issues).toHaveLength(1);
        expect(issues[0]!.path).toBe("$.genCases[1].utterance");
        expect(issues[0]!.code).toBe("BAD_NEGATIVE");
    });

    it("rejects duplicate assessment paths", () => {
        const candidate = {
            seed: fairCandidate("Leave my browser alone.").seed,
            genCases: [
                fairCandidate("Leave my browser alone.").genCases[0]!,
                {
                    id: "neg-a",
                    role: "negative" as const,
                    utterance: "Leave my browser alone.",
                    expectedActions: [],
                    order: "strict" as const,
                    dimensions: { negativeKind: "pure_refusal" },
                },
                {
                    id: "neg-b",
                    role: "negative" as const,
                    utterance: "Do not open any websites.",
                    expectedActions: [],
                    order: "strict" as const,
                    dimensions: { negativeKind: "pure_refusal" },
                },
            ],
        };
        const issues = checkTranslationBenchCandidateNegativeFairness(
            candidate,
            targetOpenWebPage,
            [
                assess({
                    path: "$.genCases[1].utterance",
                    kind: "pure_refusal",
                    fairEmptyGold: true,
                    reason: "fair",
                }),
                assess({
                    path: "$.genCases[1].utterance",
                    kind: "pure_refusal",
                    fairEmptyGold: true,
                    reason: "duplicate path",
                }),
            ],
        );
        expect(issues).toHaveLength(1);
        expect(issues[0]!.path).toBe("$.negativeAssessments");
        expect(issues[0]!.message).toMatch(/duplicate|missing|path/i);
    });

    it("forces reject when applying unfair issues to an approve decision", () => {
        const decision = applyTranslationBenchNegativeFairnessIssues(
            {
                candidateHash: "e".repeat(64),
                decision: "approve",
                issues: [],
                summary: "ok",
                scores: {
                    anchorFidelity: 0.9,
                    groundTruthCorrectness: 0.9,
                    naturalness: 0.9,
                    generalizationDiversity: 0.9,
                    negativeQuality: 0.95,
                    historyCoherence: 0.9,
                },
            },
            [
                {
                    code: "BAD_NEGATIVE",
                    path: "$.genCases[1].utterance",
                    message: "unfair",
                    suggestedFix: "rewrite",
                },
            ],
        );
        expect(decision.decision).toBe("reject");
        expect(decision.issues).toHaveLength(1);
        expect(decision.scores.negativeQuality).toBeLessThanOrEqual(0.4);
    });
});
