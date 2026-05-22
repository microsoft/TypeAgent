// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ChatModel } from "aiclient";
import type {
    Neighborhood,
    NeighborhoodMember,
} from "../src/neighborhoods/types.js";
import type { TranslationProbeFile } from "../src/translation/translationProbeRunner.js";
import type { ActionConfigProvider } from "../src/translation/actionConfigProvider.js";
import {
    analyzeCase,
    classifyHeuristic,
    extractVerb,
} from "../src/neighborhoods/optimize/caseAnalyzer.js";

const GUIDELINES = "(test guidelines)";

function member(schema: string, action: string): NeighborhoodMember {
    return { schemaName: schema, actionName: action };
}

function neighborhood(
    members: NeighborhoodMember[],
    overrides: Partial<Neighborhood> = {},
): Neighborhood {
    return {
        id: "nbh-test",
        kind: new Set(members.map((m) => m.schemaName)).size === 1
            ? "same-schema"
            : "cross-schema",
        members,
        evidence: {},
        sources: ["corpus"],
        ...overrides,
    };
}

function probeFile(rows: TranslationProbeFile["results"]): TranslationProbeFile {
    return {
        summary: {
            scannedAt: new Date().toISOString(),
            elapsedMs: 0,
            totalPhrases: rows.length,
            counts: { CLEAN: 0, MISROUTE: 0, CLARIFY: 0, INVALID: 0, ERROR: 0 },
            strategyUsed: "first-match",
            strategyRestored: "first-match",
            corpusModels: [],
            userContextMode: "none",
        },
        results: rows,
    };
}

function emptyProvider(): ActionConfigProvider {
    return {
        tryGetActionConfig: () => undefined,
        getActionConfig: () => {
            throw new Error("no");
        },
        getActionConfigs: () => [],
        getActionSchemaFileForConfig: () => {
            throw new Error("no");
        },
    };
}

function mockModel(returnText: string): ChatModel {
    return {
        complete: async () => ({ success: true, data: returnText }),
    } as unknown as ChatModel;
}

describe("extractVerb", () => {
    it("pulls the leading lowercase run from camelCase", () => {
        expect(extractVerb("playTrack")).toBe("play");
        expect(extractVerb("addNote")).toBe("add");
        expect(extractVerb("get_thing")).toBe("get");
        expect(extractVerb("playSong")).toBe("play");
    });

    it("returns empty when no leading lowercase letters", () => {
        expect(extractVerb("PlayTrack")).toBe("");
        expect(extractVerb("123abc")).toBe("");
    });
});

describe("classifyHeuristic", () => {
    it("returns unclassified for fewer than 2 members", () => {
        expect(classifyHeuristic([])).toBe("unclassified");
        expect(classifyHeuristic([member("a", "b")])).toBe("unclassified");
    });

    it("identifies singular-plural pairs in the same schema", () => {
        expect(
            classifyHeuristic([
                member("player", "playTrack"),
                member("player", "playTracks"),
            ]),
        ).toBe("singular-plural");
        // Order-independent.
        expect(
            classifyHeuristic([
                member("player", "playTracks"),
                member("player", "playTrack"),
            ]),
        ).toBe("singular-plural");
    });

    it("identifies similar-verb (same schema, shared verb)", () => {
        expect(
            classifyHeuristic([
                member("player", "playTrack"),
                member("player", "playAlbum"),
            ]),
        ).toBe("similar-verb");
    });

    it("identifies cross-agent-verb (different schemas, shared verb)", () => {
        expect(
            classifyHeuristic([
                member("player", "playTrack"),
                member("music", "playSong"),
            ]),
        ).toBe("cross-agent-verb");
    });

    it("falls back to unclassified for mixed signals", () => {
        // Different verbs entirely.
        expect(
            classifyHeuristic([
                member("player", "playTrack"),
                member("email", "sendNote"),
            ]),
        ).toBe("unclassified");
    });
});

describe("analyzeCase", () => {
    it("populates bidirectional phrase filter (expectation + result side)", async () => {
        const members = [
            member("player", "playTrack"),
            member("music", "playSong"),
        ];
        const rows: TranslationProbeFile["results"] = [
            // Expectation-side MISROUTE — rescue candidate.
            {
                expectedSchema: "player",
                expectedAction: "playTrack",
                phraseText: "play Yellow Submarine",
                phraseSources: [],
                outcome: "MISROUTE",
                chosenSchema: "music",
                chosenAction: "playSong",
                multipleActions: false,
                model: "default",
                elapsedMs: 1,
            },
            // Expectation-side CLEAN — regression candidate.
            {
                expectedSchema: "player",
                expectedAction: "playTrack",
                phraseText: "play song X",
                phraseSources: [],
                outcome: "CLEAN",
                chosenSchema: "player",
                chosenAction: "playTrack",
                multipleActions: false,
                model: "default",
                elapsedMs: 1,
            },
            // Result-side MISROUTE — chosen IS a member but expected isn't.
            // Reverse-direction regression candidate.
            {
                expectedSchema: "other",
                expectedAction: "doThing",
                phraseText: "do the thing",
                phraseSources: [],
                outcome: "MISROUTE",
                chosenSchema: "player",
                chosenAction: "playTrack",
                multipleActions: false,
                model: "default",
                elapsedMs: 1,
            },
            // Unrelated phrase — filtered out.
            {
                expectedSchema: "other",
                expectedAction: "doThing",
                phraseText: "unrelated",
                phraseSources: [],
                outcome: "CLEAN",
                chosenSchema: "other",
                chosenAction: "doThing",
                multipleActions: false,
                model: "default",
                elapsedMs: 1,
            },
        ];

        const caseDesc = await analyzeCase({
            neighborhood: neighborhood(members),
            translationResults: probeFile(rows),
            provider: emptyProvider(),
            createModel: () => mockModel('{"failurePattern":"cross-agent-verb"}'),
            schemaGuidelines: GUIDELINES,
            skipChecksumValidation: true,
        });

        expect(caseDesc.misroutePhrases).toHaveLength(1);
        expect(caseDesc.misroutePhrases[0]!.phraseText).toBe(
            "play Yellow Submarine",
        );
        expect(caseDesc.cleanPhrases).toHaveLength(1);
        expect(caseDesc.cleanPhrases[0]!.phraseText).toBe("play song X");
        expect(caseDesc.reverseDirectionPhrases).toHaveLength(1);
        expect(caseDesc.reverseDirectionPhrases[0]!.phraseText).toBe(
            "do the thing",
        );
    });

    it("records BOTH heuristic and LLM-refined failurePattern", async () => {
        const members = [
            member("player", "playTrack"),
            member("player", "playAlbum"),
        ];
        // Heuristic will say similar-verb. LLM mock returns
        // synonymous-actions (a different valid label).
        const caseDesc = await analyzeCase({
            neighborhood: neighborhood(members),
            translationResults: probeFile([]),
            provider: emptyProvider(),
            createModel: () =>
                mockModel('{"failurePattern":"synonymous-actions"}'),
            schemaGuidelines: GUIDELINES,
            skipChecksumValidation: true,
        });

        expect(caseDesc.failurePatternHeuristic).toBe("similar-verb");
        expect(caseDesc.failurePattern).toBe("synonymous-actions");
    });

    it("falls back to heuristic when LLM returns garbage", async () => {
        const members = [
            member("player", "playTrack"),
            member("player", "playAlbum"),
        ];
        const caseDesc = await analyzeCase({
            neighborhood: neighborhood(members),
            translationResults: probeFile([]),
            provider: emptyProvider(),
            createModel: () => mockModel("nope, not JSON, no fields"),
            schemaGuidelines: GUIDELINES,
            skipChecksumValidation: true,
        });

        expect(caseDesc.failurePatternHeuristic).toBe("similar-verb");
        expect(caseDesc.failurePattern).toBe("similar-verb");
    });

    it("falls back to heuristic when LLM throws", async () => {
        const members = [
            member("player", "playTrack"),
            member("player", "playAlbum"),
        ];
        const failingModel: ChatModel = {
            complete: async () => ({
                success: false,
                message: "rate limit",
            }),
        } as unknown as ChatModel;
        const caseDesc = await analyzeCase({
            neighborhood: neighborhood(members),
            translationResults: probeFile([]),
            provider: emptyProvider(),
            createModel: () => failingModel,
            schemaGuidelines: GUIDELINES,
            skipChecksumValidation: true,
        });
        expect(caseDesc.failurePattern).toBe("similar-verb");
    });

    it("ignores invalid LLM labels (coerces back to heuristic)", async () => {
        const members = [
            member("player", "playTrack"),
            member("player", "playAlbum"),
        ];
        const caseDesc = await analyzeCase({
            neighborhood: neighborhood(members),
            translationResults: probeFile([]),
            provider: emptyProvider(),
            createModel: () =>
                mockModel('{"failurePattern":"not-a-real-label"}'),
            schemaGuidelines: GUIDELINES,
            skipChecksumValidation: true,
        });
        expect(caseDesc.failurePattern).toBe("similar-verb");
    });

    it("skipLLM=true short-circuits and uses heuristic only", async () => {
        const members = [
            member("player", "playTrack"),
            member("player", "playAlbum"),
        ];
        let modelCalls = 0;
        const tracker: ChatModel = {
            complete: async () => {
                modelCalls++;
                return { success: true, data: "{}" };
            },
        } as unknown as ChatModel;
        const caseDesc = await analyzeCase({
            neighborhood: neighborhood(members),
            translationResults: probeFile([]),
            provider: emptyProvider(),
            createModel: () => tracker,
            schemaGuidelines: GUIDELINES,
            skipLLM: true,
            skipChecksumValidation: true,
        });
        expect(modelCalls).toBe(0);
        expect(caseDesc.failurePattern).toBe("similar-verb");
        expect(caseDesc.failurePatternHeuristic).toBe("similar-verb");
    });
});
