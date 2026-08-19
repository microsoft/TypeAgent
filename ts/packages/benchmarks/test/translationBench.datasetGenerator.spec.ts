// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    generateActionActionFunctionJsonSchemas,
    parseActionSchemaSource,
    parseToolsJsonSchema,
    toJSONParsedActionSchema,
} from "@typeagent/action-schema";

import {
    createTranslationBenchGenerationSchedule,
    finalizeTranslationBenchGeneratedCaseLineage,
    parseTranslationBenchGeneratedCandidate,
    parseTranslationBenchReviewerDecision,
    runTranslationBenchGenerationQualityLoop,
} from "../src/translationBench/synthesizer/datasetGenerator.js";
import type {
    TranslationBenchBenchmarkAction,
    TranslationBenchBenchmarkCaseRecord,
    TranslationBenchBenchmarkSchema,
    TranslationBenchTargetAction,
} from "../src/translationBench/synthesizer/benchmark.js";
import { computeTranslationBenchCanonicalPayloadHash } from "../src/translationBench/synthesizer/benchmark.js";

const HASH = "a".repeat(64);

function catalogSchema(
    schemaName: string,
    actionNames: string[],
): TranslationBenchBenchmarkSchema {
    const parsed = parseToolsJsonSchema(
        actionNames.map((actionName) => ({
            name: actionName,
            description: `Run ${actionName}`,
            inputSchema: {
                type: "object",
                properties: { query: { type: "string" } },
                required: ["query"],
                additionalProperties: false,
            },
        })),
    );
    const tools = generateActionActionFunctionJsonSchemas({
        entry: parsed.entry.action!,
        actionSchemas: parsed.actionSchemas,
    }).map((tool) => ({
        type: "function" as const,
        function: {
            name: tool.function.name,
            ...(tool.function.description !== undefined
                ? { description: tool.function.description }
                : {}),
            parameters: tool.function.parameters as Record<string, unknown>,
        },
    }));
    return {
        schemaName,
        description: `${schemaName} actions`,
        tools,
        typeAgent: {
            sourceHash: `${schemaName}-${HASH}`,
            schemaType: `${schemaName}Action`,
            parsedActionSchema: toJSONParsedActionSchema(parsed),
        },
    };
}

function parameterlessCatalogSchema(
    schemaName: string,
    actionName: string,
): TranslationBenchBenchmarkSchema {
    const parsed = parseActionSchemaSource(
        `export type AgentActions = { actionName: "${actionName}" };`,
        schemaName,
        "AgentActions",
    );
    const tools = generateActionActionFunctionJsonSchemas({
        entry: parsed.entry.action!,
        actionSchemas: parsed.actionSchemas,
    }).map((tool) => ({
        type: "function" as const,
        function: {
            name: tool.function.name,
            ...(tool.function.description !== undefined
                ? { description: tool.function.description }
                : {}),
            parameters: tool.function.parameters as Record<string, unknown>,
        },
    }));
    return {
        schemaName,
        description: `${schemaName} actions`,
        tools,
        typeAgent: {
            sourceHash: `${schemaName}-${HASH}`,
            schemaType: "AgentActions",
            parsedActionSchema: toJSONParsedActionSchema(parsed),
        },
    };
}

function targetAction(
    schemaName = "tools",
    actionName = "lookup",
): TranslationBenchTargetAction {
    return { schemaName, actionName };
}

function expectedAction(
    target: TranslationBenchTargetAction,
    query: string,
): TranslationBenchBenchmarkAction {
    return {
        ...target,
        parameters: { query },
    };
}

function generatedCandidate(target = targetAction(), genCaseCount = 20) {
    const positiveCount = genCaseCount / 2;
    return {
        seed: {
            utterance: "Look up the seed item",
            expectedActions: [expectedAction(target, "seed")],
            order: "any" as const,
        },
        genCases: Array.from({ length: genCaseCount }, (_, index) => {
            const positive = index < positiveCount;
            return {
                id: `gen-${index}`,
                role: positive ? ("positive" as const) : ("negative" as const),
                utterance: positive
                    ? `Look up positive item ${index}`
                    : `Please clarify negative item ${index}`,
                expectedActions: positive
                    ? [expectedAction(target, `positive-${index}`)]
                    : [],
                order: "any" as const,
                dimensions: { variation: index },
            };
        }),
    };
}

function reviewerDecision(
    candidateHash: string,
    decision: "approve" | "reject",
    feedback = "Make the seed more natural",
) {
    return {
        candidateHash,
        decision,
        scores: {
            anchorFidelity: decision === "approve" ? 1 : 0.7,
            groundTruthCorrectness: 1,
            naturalness: decision === "approve" ? 1 : 0.7,
            generalizationDiversity: 1,
            negativeQuality: 1,
            historyCoherence: 1,
        },
        issues:
            decision === "approve"
                ? []
                : [
                      {
                          code: "UNNATURAL_TEXT",
                          path: "/seed/utterance",
                          message: feedback,
                          suggestedFix: "Use a natural, direct request",
                      },
                  ],
        summary:
            decision === "approve"
                ? "The row is ready"
                : "The row needs revision",
    };
}

function candidateHashFromPrompt(prompt: string): string {
    const named = /"candidateHash"\s*:\s*"([a-f0-9]{64})"/.exec(prompt);
    if (named !== null) return named[1]!;
    const hashes = prompt.match(/[a-f0-9]{64}/g);
    if (hashes === null || hashes.length === 0) {
        throw new Error("Reviewer prompt has no candidate hash");
    }
    return hashes.at(-1)!;
}

function sourceAnchor() {
    return {
        candidateId: "source-row-1:conversations[0]",
        lineage: {
            dataset: "public/source",
            revision: "pinned-revision",
            config: "tools",
            split: "train",
            rowIndex: 1,
            rowId: "source-row-1",
            sourceUrl: "https://example.test/source.json",
            sourcePart: "conversations[0]",
            rawRowHash: "1".repeat(64),
            sourceSliceHash: "2".repeat(64),
            transformVersion: 1 as const,
        },
        rawRow: { id: "source-row-1" },
        sourceSlice: { utterance: "Find the public item" },
        utterance: "Find the public item",
        order: "any" as const,
        sourceTools: [],
        sourceCalls: [],
        sourceResponses: [],
        dimensions: {},
    };
}

function qualityLoopOptions(
    generatorComplete: (
        prompt: string,
        jsonSchema?: unknown,
    ) => Promise<string>,
    reviewerComplete: (prompt: string, jsonSchema?: unknown) => Promise<string>,
) {
    const schema = catalogSchema("tools", ["lookup"]);
    return {
        targetAction: targetAction(),
        schema,
        anchor: sourceAnchor(),
        activeSchemas: [schema.schemaName],
        genCaseCount: 20,
        maxAttempts: 5,
        generator: {
            model: "generator-model",
            complete: generatorComplete,
        },
        reviewer: {
            model: "reviewer-model",
            complete: reviewerComplete,
        },
    } as Parameters<typeof runTranslationBenchGenerationQualityLoop>[0];
}

describe("translation bench generation schedule", () => {
    it("covers every action and balances repeated targets deterministically", () => {
        const catalog = [
            catalogSchema("alpha", ["one", "two"]),
            catalogSchema("beta", ["three", "four"]),
        ];
        const options = { caseCount: 6, requireCompleteCoverage: true };

        const first = createTranslationBenchGenerationSchedule(
            catalog,
            options,
        );
        const second = createTranslationBenchGenerationSchedule(
            catalog,
            options,
        );

        expect(second).toEqual(first);
        expect(first.entries).toHaveLength(6);
        expect(first.coverage).toMatchObject({
            schemaCount: 2,
            actionCount: 4,
            scheduledActionCount: 4,
            complete: true,
            catalogDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        });
        const counts = new Map<string, number>();
        for (const entry of first.entries) {
            const key = JSON.stringify([entry.schemaName, entry.actionName]);
            counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        expect(counts.size).toBe(4);
        const frequencies = [...counts.values()];
        expect(
            Math.max(...frequencies) - Math.min(...frequencies),
        ).toBeLessThanOrEqual(1);
    });

    it("creates a deterministic partial 10-row smoke schedule", () => {
        const catalog = [
            catalogSchema("alpha", ["a1", "a2", "a3", "a4"]),
            catalogSchema("beta", ["b1", "b2", "b3", "b4"]),
            catalogSchema("gamma", ["c1", "c2", "c3", "c4"]),
        ];
        const options = { caseCount: 10, requireCompleteCoverage: false };

        const schedule = createTranslationBenchGenerationSchedule(
            catalog,
            options,
        );

        expect(schedule).toEqual(
            createTranslationBenchGenerationSchedule(catalog, options),
        );
        expect(schedule.entries).toHaveLength(10);
        expect(schedule.coverage).toMatchObject({
            schemaCount: 3,
            actionCount: 12,
            scheduledActionCount: 10,
            complete: false,
        });
        expect(
            new Set(
                schedule.entries.map(
                    (entry: { schemaName: string; actionName: string }) =>
                        JSON.stringify([entry.schemaName, entry.actionName]),
                ),
            ).size,
        ).toBe(10);
    });

    it("fails before generation when complete coverage is impossible", () => {
        const catalog = [catalogSchema("tools", ["one", "two", "three"])];

        expect(() =>
            createTranslationBenchGenerationSchedule(catalog, {
                caseCount: 2,
                requireCompleteCoverage: true,
            }),
        ).toThrow(/cover|coverage|action/i);
    });

    it("treats complete coverage as eligible actions after exclusions", () => {
        const catalog = [
            catalogSchema("alpha", ["keepAlpha", "drop"]),
            catalogSchema("beta", ["keepBeta"]),
        ];
        const schedule = createTranslationBenchGenerationSchedule(catalog, {
            caseCount: 2,
            requireCompleteCoverage: true,
            excludedActionIds: new Set(["alpha.drop"]),
        });

        expect(schedule.entries).toHaveLength(2);
        expect(schedule.coverage).toMatchObject({
            actionCount: 3,
            scheduledActionCount: 2,
            complete: true,
        });
        expect(
            schedule.entries.map(
                (entry) => `${entry.schemaName}.${entry.actionName}`,
            ),
        ).not.toContain("alpha.drop");
    });

    it("keeps same-named actions from different schemas eligible", () => {
        const catalog = [
            catalogSchema("alpha", ["shared", "onlyAlpha"]),
            catalogSchema("beta", ["shared", "onlyBeta"]),
        ];
        const schedule = createTranslationBenchGenerationSchedule(catalog, {
            caseCount: 4,
            requireCompleteCoverage: true,
        });

        const targeted = schedule.entries.map(
            (entry) => `${entry.schemaName}.${entry.actionName}`,
        );
        expect(schedule.coverage.complete).toBe(true);
        expect(new Set(targeted)).toEqual(
            new Set([
                "alpha.shared",
                "alpha.onlyAlpha",
                "beta.shared",
                "beta.onlyBeta",
            ]),
        );
    });
});

describe("generated translation bench candidate validation", () => {
    const schema = catalogSchema("tools", ["lookup", "search"]);
    const context = {
        targetAction: targetAction(),
        schema,
        genCaseCount: 20,
    };

    it("accepts exactly 20 generalizations split into 10 positive and 10 negative", () => {
        const parsed = parseTranslationBenchGeneratedCandidate(
            generatedCandidate(),
            context,
        );

        expect(parsed.genCases).toHaveLength(20);
        expect(
            parsed.genCases.filter(
                (item: { role: string }) => item.role === "positive",
            ),
        ).toHaveLength(10);
        expect(
            parsed.genCases.filter(
                (item: { role: string }) => item.role === "negative",
            ),
        ).toHaveLength(10);
    });

    it("rejects the wrong count, duplicate generalizations, and wrong targets", () => {
        expect(() =>
            parseTranslationBenchGeneratedCandidate(
                generatedCandidate(targetAction(), 18),
                context,
            ),
        ).toThrow(/20|count|generalization/i);

        const duplicate = generatedCandidate();
        duplicate.genCases[1]!.id = duplicate.genCases[0]!.id;
        duplicate.genCases[1]!.utterance = duplicate.genCases[0]!.utterance;
        expect(() =>
            parseTranslationBenchGeneratedCandidate(duplicate, context),
        ).toThrow(/duplicate|unique/i);

        const wrongTarget = generatedCandidate();
        wrongTarget.seed.expectedActions = [
            expectedAction(targetAction("tools", "search"), "seed"),
        ];
        expect(() =>
            parseTranslationBenchGeneratedCandidate(wrongTarget, context),
        ).toThrow(/target|lookup|action/i);
    });

    it("rejects after strip when a required parameter was only an empty placeholder", () => {
        const emptyRequired = generatedCandidate();
        for (const probe of [emptyRequired.seed, ...emptyRequired.genCases]) {
            if (probe.expectedActions.length === 0) continue;
            probe.expectedActions = [
                {
                    schemaName: "tools",
                    actionName: "lookup",
                    parameters: { query: "" },
                },
            ];
        }
        expect(() =>
            parseTranslationBenchGeneratedCandidate(emptyRequired, context),
        ).toThrow(/required|query|missing/i);
    });

    it("canonicalizes generated payload hashes across checkpoint key sorting", () => {
        const schemas = [catalogSchema("tools", ["lookup"])] as const;
        const canonicalHash = computeTranslationBenchCanonicalPayloadHash as (
            probe: Parameters<
                typeof computeTranslationBenchCanonicalPayloadHash
            >[0],
            catalog: Parameters<
                typeof computeTranslationBenchCanonicalPayloadHash
            >[1],
            activeSchemas: string[],
            canonicalize?: boolean,
        ) => string;
        const first = {
            utterance: "Look up the item",
            expectedActions: [
                {
                    schemaName: "tools",
                    actionName: "lookup",
                    parameters: { query: "item" },
                },
            ],
            order: "any" as const,
        };
        const checkpointSorted = {
            utterance: "Look up the item",
            expectedActions: [
                {
                    actionName: "lookup",
                    parameters: { query: "item" },
                    schemaName: "tools",
                },
            ],
            order: "any" as const,
        };

        expect(canonicalHash(first, [...schemas], ["tools"], true)).toBe(
            canonicalHash(checkpointSorted, [...schemas], ["tools"], true),
        );
    });
});

describe("generated translation bench lineage finalization", () => {
    it("rebinds checkpoint hashes to the exact catalog order written to the final JSONL", () => {
        const checkpointCatalog = [
            catalogSchema("tools", ["search", "lookup"]),
        ];
        const outputCatalog = [catalogSchema("tools", ["lookup", "search"])];
        const payload = generatedCandidate().seed;
        const staleHash = computeTranslationBenchCanonicalPayloadHash(
            payload,
            checkpointCatalog,
            ["tools"],
            true,
        );
        const probe = {
            ...payload,
            lineage: {
                ...sourceAnchor().lineage,
                transformVersion: 2 as const,
                canonicalPayloadHash: staleHash,
            },
            selection: {
                role: "seed" as const,
                targetAction: targetAction(),
                dimensions: {},
                rationale: "generated test row",
                confidence: 1,
            },
        };
        const evalCase = {
            recordType: "case",
            version: 1,
            id: "generated-test",
            activeSchemas: ["tools"],
            targetAction: targetAction(),
            explainer: { valueInRequest: true, noReferences: true },
            seed: probe,
            generalizations: [],
        } as TranslationBenchBenchmarkCaseRecord;

        const finalized = finalizeTranslationBenchGeneratedCaseLineage(
            evalCase,
            outputCatalog,
        );

        expect(finalized.seed.lineage.canonicalPayloadHash).toBe(
            computeTranslationBenchCanonicalPayloadHash(
                finalized.seed,
                outputCatalog,
                finalized.activeSchemas,
                true,
            ),
        );
        expect(finalized.seed.lineage.canonicalPayloadHash).not.toBe(staleHash);
        expect(evalCase.seed.lineage.canonicalPayloadHash).toBe(staleHash);
    });
});

describe("translation bench reviewer decision validation", () => {
    it("binds approval to the exact candidate hash", () => {
        expect(
            parseTranslationBenchReviewerDecision(
                reviewerDecision(HASH, "approve"),
                HASH,
            ),
        ).toMatchObject({ decision: "approve", candidateHash: HASH });

        expect(() =>
            parseTranslationBenchReviewerDecision(
                reviewerDecision("b".repeat(64), "approve"),
                HASH,
            ),
        ).toThrow(/hash/i);
    });

    it("keeps structural parse free of score floor; optional threshold is explicit", () => {
        const lowApprove = {
            ...reviewerDecision(HASH, "approve"),
            scores: {
                anchorFidelity: 0.5,
                groundTruthCorrectness: 1,
                naturalness: 1,
                generalizationDiversity: 1,
                negativeQuality: 1,
                historyCoherence: 1,
            },
        };
        // Structural parse alone does not own the pack threshold.
        expect(
            parseTranslationBenchReviewerDecision(lowApprove, HASH).decision,
        ).toBe("approve");
        expect(() =>
            parseTranslationBenchReviewerDecision(lowApprove, HASH, 0.8),
        ).toThrow(/below 0\.8/);
    });
});

describe("translation bench generation quality loop", () => {
    it("constrains optional history to TypeAgent's accepted import shape", async () => {
        let generatorPrompt = "";
        let generationSchema: unknown;
        const options = qualityLoopOptions(
            async (prompt, jsonSchema) => {
                generatorPrompt = prompt;
                generationSchema = jsonSchema;
                return JSON.stringify(generatedCandidate());
            },
            async (prompt) =>
                JSON.stringify(
                    reviewerDecision(
                        candidateHashFromPrompt(prompt),
                        "approve",
                    ),
                ),
        );

        await runTranslationBenchGenerationQualityLoop(options);

        expect(generatorPrompt).toContain("non-empty JSON array of");
        expect(generatorPrompt).toContain("{user, assistant:{text, source}}");
        expect(JSON.stringify(generationSchema)).toContain(
            '\"history\":{\"type\":\"array\",\"minItems\":1',
        );
    });

    it("omits parameters from the structured contract for parameterless actions", async () => {
        const schema = parameterlessCatalogSchema("tools", "refresh");
        const target = targetAction("tools", "refresh");
        const withoutParameters = generatedCandidate(target);
        for (const probe of [
            withoutParameters.seed,
            ...withoutParameters.genCases,
        ]) {
            for (const action of probe.expectedActions) {
                delete (action as Partial<TranslationBenchBenchmarkAction>)
                    .parameters;
            }
        }
        let generatorPrompt = "";
        let generationSchema: unknown;
        const result = await runTranslationBenchGenerationQualityLoop({
            targetAction: target,
            schema,
            anchor: sourceAnchor(),
            activeSchemas: [schema.schemaName],
            genCaseCount: 20,
            maxAttempts: 5,
            generator: {
                model: "generator-model",
                async complete(prompt, jsonSchema) {
                    generatorPrompt = prompt;
                    generationSchema = jsonSchema;
                    return JSON.stringify(withoutParameters);
                },
            },
            reviewer: {
                model: "reviewer-model",
                async complete(prompt) {
                    return JSON.stringify(
                        reviewerDecision(
                            candidateHashFromPrompt(prompt),
                            "approve",
                        ),
                    );
                },
            },
        });

        expect(result.acceptedAttempt).toBe(1);
        expect(generatorPrompt).toContain("omit parameters entirely");
        expect(JSON.stringify(generationSchema)).not.toContain(
            '\"required\":[\"schemaName\",\"actionName\",\"parameters\"]',
        );
    });

    it("strips empty gold placeholders and prompts grounded-param rules", async () => {
        const parsed = parseToolsJsonSchema([
            {
                name: "authLogin",
                description: "Log in to GitHub CLI",
                inputSchema: {
                    type: "object",
                    properties: {
                        hostname: { type: "string" },
                        token: { type: "string" },
                        web: { type: "boolean" },
                    },
                    required: ["hostname"],
                    additionalProperties: false,
                },
            },
        ]);
        const tools = generateActionActionFunctionJsonSchemas({
            entry: parsed.entry.action!,
            actionSchemas: parsed.actionSchemas,
        }).map((tool) => ({
            type: "function" as const,
            function: {
                name: tool.function.name,
                ...(tool.function.description !== undefined
                    ? { description: tool.function.description }
                    : {}),
                parameters: tool.function.parameters as Record<string, unknown>,
            },
        }));
        const schema: TranslationBenchBenchmarkSchema = {
            schemaName: "github-cli",
            description: "github-cli actions",
            tools,
            typeAgent: {
                sourceHash: `github-cli-${HASH}`,
                schemaType: "GithubCliAction",
                parsedActionSchema: toJSONParsedActionSchema(parsed),
            },
        };
        const target = targetAction("github-cli", "authLogin");
        const dirty = generatedCandidate(target, 2);
        for (const probe of [dirty.seed, ...dirty.genCases]) {
            if (probe.expectedActions.length === 0) continue;
            probe.expectedActions = [
                {
                    ...target,
                    parameters: {
                        hostname: "github.acme.example",
                        web: true,
                        token: "",
                    },
                },
            ];
        }
        let generatorPrompt = "";
        const result = await runTranslationBenchGenerationQualityLoop({
            targetAction: target,
            schema,
            anchor: sourceAnchor(),
            activeSchemas: [schema.schemaName],
            genCaseCount: 2,
            maxAttempts: 5,
            generator: {
                model: "generator-model",
                async complete(prompt) {
                    generatorPrompt = prompt;
                    return JSON.stringify(dirty);
                },
            },
            reviewer: {
                model: "reviewer-model",
                async complete(prompt) {
                    return JSON.stringify(
                        reviewerDecision(
                            candidateHashFromPrompt(prompt),
                            "approve",
                        ),
                    );
                },
            },
        });
        expect(generatorPrompt).toContain(
            "Only include parameters clearly supported by the utterance",
        );
        expect(result.candidate.seed.expectedActions[0]!.parameters).toEqual({
            hostname: "github.acme.example",
            web: true,
        });
        for (const probe of result.candidate.genCases) {
            if (probe.role !== "positive") continue;
            expect(probe.expectedActions[0]!.parameters).toEqual({
                hostname: "github.acme.example",
                web: true,
            });
            expect(probe.expectedActions[0]!.parameters).not.toHaveProperty(
                "token",
            );
        }
    });

    it("uses separate generator and reviewer passes", async () => {
        const generatorPrompts: string[] = [];
        const reviewerPrompts: string[] = [];
        const options = qualityLoopOptions(
            async (prompt) => {
                generatorPrompts.push(prompt);
                return JSON.stringify(generatedCandidate());
            },
            async (prompt) => {
                reviewerPrompts.push(prompt);
                return JSON.stringify(
                    reviewerDecision(
                        candidateHashFromPrompt(prompt),
                        "approve",
                    ),
                );
            },
        );

        await expect(
            runTranslationBenchGenerationQualityLoop(options),
        ).resolves.toBeDefined();
        expect(generatorPrompts).toHaveLength(1);
        expect(reviewerPrompts).toHaveLength(1);
        expect(generatorPrompts[0]).not.toBe(reviewerPrompts[0]);
    });

    it("feeds reviewer feedback into the next generator attempt", async () => {
        const generatorPrompts: string[] = [];
        let reviews = 0;
        const options = qualityLoopOptions(
            async (prompt) => {
                generatorPrompts.push(prompt);
                return JSON.stringify(generatedCandidate());
            },
            async (prompt) => {
                reviews += 1;
                return JSON.stringify(
                    reviewerDecision(
                        candidateHashFromPrompt(prompt),
                        reviews === 1 ? "reject" : "approve",
                        "The seed sounds mechanical",
                    ),
                );
            },
        );

        await runTranslationBenchGenerationQualityLoop(options);

        expect(generatorPrompts).toHaveLength(2);
        expect(reviews).toBe(2);
        expect(generatorPrompts[1]).toContain("The seed sounds mechanical");
        expect(generatorPrompts[1]).toContain("/seed/utterance");
        expect(generatorPrompts[1]).toContain("Attempt: 2");
        expect(generatorPrompts[1]).toContain("Previous rejected candidate");
        expect(generatorPrompts[1]).toContain("Look up the seed item");
    });

    it("records malformed reviewer output as a bounded rejection and retries", async () => {
        let generations = 0;
        let reviews = 0;
        const options = qualityLoopOptions(
            async () => {
                generations += 1;
                return JSON.stringify(generatedCandidate());
            },
            async (prompt) => {
                reviews += 1;
                return JSON.stringify(
                    reviews === 1
                        ? reviewerDecision("not-a-candidate-hash", "approve")
                        : reviewerDecision(
                              candidateHashFromPrompt(prompt),
                              "approve",
                          ),
                );
            },
        );

        const accepted =
            await runTranslationBenchGenerationQualityLoop(options);

        expect(generations).toBe(2);
        expect(reviews).toBe(2);
        expect(accepted.acceptedAttempt).toBe(2);
        expect(accepted.attempts[0]!.reviewer).toMatchObject({
            decision: "reject",
            candidateHash: expect.stringMatching(/^[a-f0-9]{64}$/),
            issues: [
                expect.objectContaining({
                    code: "OTHER",
                    path: "$quality_verifier.semantic_checker",
                }),
            ],
        });
    });

    it("can approve on the fifth and final attempt", async () => {
        let generations = 0;
        let reviews = 0;
        const options = qualityLoopOptions(
            async () => {
                generations += 1;
                return JSON.stringify(generatedCandidate());
            },
            async (prompt) => {
                reviews += 1;
                return JSON.stringify(
                    reviewerDecision(
                        candidateHashFromPrompt(prompt),
                        reviews === 5 ? "approve" : "reject",
                    ),
                );
            },
        );

        await expect(
            runTranslationBenchGenerationQualityLoop(options),
        ).resolves.toBeDefined();
        expect(generations).toBe(5);
        expect(reviews).toBe(5);
    });

    it("fails closed after five reviewer rejections", async () => {
        let generations = 0;
        let reviews = 0;
        const options = qualityLoopOptions(
            async () => {
                generations += 1;
                return JSON.stringify(generatedCandidate());
            },
            async (prompt) => {
                reviews += 1;
                return JSON.stringify(
                    reviewerDecision(candidateHashFromPrompt(prompt), "reject"),
                );
            },
        );

        await expect(
            runTranslationBenchGenerationQualityLoop(options),
        ).rejects.toThrow(/5|attempt|quality|reject/i);
        expect(generations).toBe(5);
        expect(reviews).toBe(5);
    });

    it("rejects a core quality-loop limit above five before calling a model", async () => {
        let generations = 0;
        const options = qualityLoopOptions(
            async () => {
                generations += 1;
                return JSON.stringify(generatedCandidate());
            },
            async (prompt) =>
                JSON.stringify(
                    reviewerDecision(
                        candidateHashFromPrompt(prompt),
                        "approve",
                    ),
                ),
        );
        options.maxAttempts = 6;

        await expect(
            runTranslationBenchGenerationQualityLoop(options),
        ).rejects.toThrow(/five|5|maximum/i);
        expect(generations).toBe(0);
    });

    it("rejects odd genCaseCount before calling a model", async () => {
        let generations = 0;
        const options = qualityLoopOptions(
            async () => {
                generations += 1;
                return JSON.stringify(generatedCandidate());
            },
            async (prompt) =>
                JSON.stringify(
                    reviewerDecision(
                        candidateHashFromPrompt(prompt),
                        "approve",
                    ),
                ),
        );
        options.genCaseCount = 3;

        await expect(
            runTranslationBenchGenerationQualityLoop(options),
        ).rejects.toThrow(/even/i);
        expect(generations).toBe(0);
    });

    it("fails closed when generator always returns non-JSON", async () => {
        let generations = 0;
        let reviews = 0;
        const options = qualityLoopOptions(
            async () => {
                generations += 1;
                return "not-json";
            },
            async () => {
                reviews += 1;
                return "{}";
            },
        );
        options.maxAttempts = 2;

        await expect(
            runTranslationBenchGenerationQualityLoop(options),
        ).rejects.toThrow(/2 attempts/i);
        expect(generations).toBe(2);
        expect(reviews).toBe(0);
    });
});
