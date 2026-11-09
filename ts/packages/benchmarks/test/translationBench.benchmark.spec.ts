// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    generateActionActionFunctionJsonSchemas,
    parseToolsJsonSchema,
    toJSONParsedActionSchema,
} from "@typeagent/action-schema";
import fs from "node:fs";
import path from "node:path";

import {
    TRANSLATION_BENCH_PINNED_SOURCE,
    TranslationBenchBenchmarkSchema,
    TranslationBenchBuilderRole,
    TranslationBenchBuilderSelection,
    TranslationBenchPublicCandidate,
    TranslationBenchShapeOnlyProbe,
    approveTranslationBenchBenchmark,
    assertTranslationBenchBenchmarkApproved,
    buildTranslationBenchBenchmarkWithLlm,
    computeTranslationBenchCanonicalPayloadHash,
    computeTranslationBenchSourceManifestHash,
    computeTranslationBenchRawRowHash,
    computeTranslationBenchSourceSliceHash,
    formatTranslationBenchBenchmarkJsonl,
    formatTranslationBenchDatasetBuilderPrompt,
    materializeTranslationBenchBenchmark,
    parseTranslationBenchBenchmarkForEvaluation,
    parseTranslationBenchBenchmarkJsonl,
    validateTranslationBenchBenchmark,
} from "../src/translationBench/synthesizer/benchmark.js";

const HASH = "1".repeat(64);
const BUILDER_PRICING = {
    inputUsdPerMToken: 1,
    cachedInputUsdPerMToken: 0.1,
    outputUsdPerMToken: 2,
    source: "reviewed pricing snapshot",
    asOf: "2026-07-25",
};
const TARGET = { schemaName: "publicTools", actionName: "lookup" };
const LOOKUP_PARAMETERS = {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
};
const LOOKUP_PARSED_SCHEMA = parseToolsJsonSchema([
    {
        name: "lookup",
        description: "Look up a public item",
        inputSchema: LOOKUP_PARAMETERS,
    },
]);
const LOOKUP_TOOLS = generateActionActionFunctionJsonSchemas({
    entry: LOOKUP_PARSED_SCHEMA.entry.action!,
    actionSchemas: LOOKUP_PARSED_SCHEMA.actionSchemas,
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
const SCHEMA: TranslationBenchBenchmarkSchema = {
    schemaName: "publicTools",
    description: "Exact tools from the public row",
    tools: LOOKUP_TOOLS,
    typeAgent: {
        sourceHash: "a".repeat(64),
        schemaType: "LookupAction",
        parsedActionSchema: toJSONParsedActionSchema(LOOKUP_PARSED_SCHEMA),
    },
};

function candidate(
    candidateId: string,
    calls: TranslationBenchPublicCandidate["probe"]["expectedActions"],
    options: {
        utterance?: string;
        sourcePart?: string;
        schemas?: TranslationBenchBenchmarkSchema[];
        rowId?: string;
    } = {},
): TranslationBenchPublicCandidate {
    const utterance = options.utterance ?? `public utterance ${candidateId}`;
    const schemas = options.schemas ?? [SCHEMA];
    const rawRow = {
        id: options.rowId ?? `row-${candidateId}`,
        messages: [{ role: "user", content: utterance }],
    };
    const sourceSlice = { utterance, calls };
    const probe = { utterance, expectedActions: calls, order: "any" as const };
    return {
        candidateId,
        rawRow,
        sourceSlice,
        schemas,
        activeSchemas: [schemas[0]!.schemaName],
        probe,
        lineage: {
            dataset: TRANSLATION_BENCH_PINNED_SOURCE.dataset,
            revision: TRANSLATION_BENCH_PINNED_SOURCE.revision,
            config: TRANSLATION_BENCH_PINNED_SOURCE.config,
            split: TRANSLATION_BENCH_PINNED_SOURCE.split,
            rowIndex: Number(candidateId.replace(/\D/g, "")) || 0,
            rowId: options.rowId ?? `row-${candidateId}`,
            sourceUrl: TRANSLATION_BENCH_PINNED_SOURCE.sourceUrl,
            sourcePart: options.sourcePart ?? "messages[0]",
            rawRowHash: computeTranslationBenchRawRowHash(rawRow),
            sourceSliceHash:
                computeTranslationBenchSourceSliceHash(sourceSlice),
            canonicalPayloadHash: computeTranslationBenchCanonicalPayloadHash(
                probe,
                schemas,
                [schemas[0]!.schemaName],
            ),
            transformVersion: 1 as const,
        },
    };
}

function call(query: string) {
    return [{ ...TARGET, parameters: { query } }];
}

function selection(
    candidateId: string,
    role: TranslationBenchBuilderRole,
    overrides: Partial<TranslationBenchBuilderSelection> = {},
): TranslationBenchBuilderSelection {
    return {
        candidateId,
        bankId: "lookup-bank",
        role,
        targetAction: TARGET,
        dimensions: { role },
        rationale: `Use ${candidateId} as ${role}`,
        confidence: 0.9,
        ...overrides,
    };
}

function sourceBank() {
    return [
        candidate("c1", call("alpha")),
        candidate("c2", call("beta")),
        candidate("c3", []),
    ];
}

function selections(): TranslationBenchBuilderSelection[] {
    return [
        selection("c1", "seed"),
        selection("c2", "positive"),
        selection("c3", "negative"),
    ];
}

function materialize(
    overrides: Partial<
        Parameters<typeof materializeTranslationBenchBenchmark>[0]
    > = {},
) {
    return materializeTranslationBenchBenchmark({
        name: "Public lookup benchmark",
        candidates: sourceBank(),
        selections: selections(),
        construction: {
            method: "llm-assisted",
            model: "dataset-builder",
            promptHash: HASH,
            responseHash: "2".repeat(64),
            sourceManifestHash: computeTranslationBenchSourceManifestHash(
                TRANSLATION_BENCH_PINNED_SOURCE,
            ),
            catalogSchemaHashes: { publicTools: "a".repeat(64) },
        },
        ...overrides,
    });
}

describe("translation-bench benchmark JSONL", () => {
    it("writes metadata first and round-trips deterministically", () => {
        const benchmark = approveTranslationBenchBenchmark(materialize(), {
            reviewedBy: "reviewer",
            reviewedAt: "2026-07-25T12:00:00Z",
        });

        const jsonl = formatTranslationBenchBenchmarkJsonl(benchmark);
        expect(JSON.parse(jsonl.split("\n")[0]!)).toMatchObject({
            recordType: "metadata",
            approval: { status: "approved" },
        });
        expect(formatTranslationBenchBenchmarkJsonl(benchmark)).toBe(jsonl);
        expect(
            parseTranslationBenchBenchmarkForEvaluation(
                jsonl,
                "benchmark.jsonl",
            ),
        ).toEqual(benchmark);
    });

    it("canonicalizes validated object key order before writing JSONL", () => {
        const benchmark = materialize();
        const entry = benchmark.metadata.construction.decisionLedger![0]!;
        entry.lineage = Object.fromEntries(
            Object.entries(entry.lineage).reverse(),
        ) as typeof entry.lineage;

        const jsonl = formatTranslationBenchBenchmarkJsonl(benchmark);

        expect(
            formatTranslationBenchBenchmarkJsonl(
                parseTranslationBenchBenchmarkJsonl(jsonl),
            ),
        ).toBe(jsonl);
    });

    it("reports the physical line for JSON and record-shape errors", () => {
        const jsonl = formatTranslationBenchBenchmarkJsonl(materialize());
        const lines = jsonl.trimEnd().split("\n");
        lines[1] = "{not-json}";
        expect(() =>
            parseTranslationBenchBenchmarkJsonl(lines.join("\n"), "bad.jsonl"),
        ).toThrow(/bad\.jsonl:2/);

        lines[1] = JSON.stringify({ recordType: "metadata" });
        expect(() =>
            parseTranslationBenchBenchmarkJsonl(lines.join("\n"), "bad.jsonl"),
        ).toThrow(/bad\.jsonl:2/);
        expect(() => parseTranslationBenchBenchmarkJsonl(`\n${jsonl}`)).toThrow(
            /first line must be the metadata record/,
        );
    });

    it("rejects unsupported case and metadata versions", () => {
        const jsonl = formatTranslationBenchBenchmarkJsonl(materialize());
        const lines = jsonl.trimEnd().split("\n");
        const metadata = JSON.parse(lines[0]!);
        metadata.version = 99;
        expect(() =>
            parseTranslationBenchBenchmarkJsonl(
                [JSON.stringify(metadata), ...lines.slice(1)].join("\n"),
                "bad-version.jsonl",
            ),
        ).toThrow(/unsupported metadata version 99/);

        const caseRow = JSON.parse(lines[1]!);
        caseRow.version = 99;
        expect(() =>
            parseTranslationBenchBenchmarkJsonl(
                [lines[0], JSON.stringify(caseRow)].join("\n"),
                "bad-case-version.jsonl",
            ),
        ).toThrow(/unsupported case version 99/);
    });

    it("rejects multi-action seed probes under simple shape", () => {
        const benchmark = materialize();
        benchmark.cases[0]!.seed.expectedActions = [
            ...benchmark.cases[0]!.seed.expectedActions,
            {
                schemaName: benchmark.cases[0]!.targetAction.schemaName,
                actionName: benchmark.cases[0]!.targetAction.actionName,
                parameters: { extra: true },
            },
        ];
        expect(() => validateTranslationBenchBenchmark(benchmark)).toThrow(
            /exactly one/,
        );
    });

    it("rejects parameter scoring that does not align with actions", () => {
        const benchmark = materialize();
        benchmark.cases[0]!.seed.parameterScore = [];

        expect(() => validateTranslationBenchBenchmark(benchmark)).toThrow(
            /parameterScore must align 1:1 with expectedActions/,
        );
    });

    it("requires approval and detects changes after approval", () => {
        const draft = materialize();
        const jsonl = formatTranslationBenchBenchmarkJsonl(draft);
        expect(() =>
            parseTranslationBenchBenchmarkForEvaluation(jsonl),
        ).toThrow(/not approved/);

        const approved = approveTranslationBenchBenchmark(draft, {
            reviewedBy: "reviewer",
            reviewedAt: "2026-07-25T12:00:00Z",
        });
        approved.cases[0]!.seed.utterance = "changed after review";
        expect(() => assertTranslationBenchBenchmarkApproved(approved)).toThrow(
            /changed after approval/,
        );

        const reviewerChanged = approveTranslationBenchBenchmark(draft, {
            reviewedBy: "reviewer",
            reviewedAt: "2026-07-25T12:00:00Z",
        });
        if (reviewerChanged.metadata.approval.status === "approved") {
            reviewerChanged.metadata.approval.reviewedBy = "forged";
        }
        expect(() =>
            assertTranslationBenchBenchmarkApproved(reviewerChanged),
        ).toThrow(/changed after approval/);
    });

    it("rejects approval of schemas that are not pinned to TypeAgent", () => {
        const draft = materialize();
        delete draft.metadata.schemas[0]!.typeAgent;
        delete draft.metadata.construction.catalogSchemaHashes;
        for (const probe of [
            draft.cases[0]!.seed,
            ...draft.cases[0]!.generalizations,
        ]) {
            probe.lineage.canonicalPayloadHash =
                computeTranslationBenchCanonicalPayloadHash(
                    probe,
                    draft.metadata.schemas,
                    draft.cases[0]!.activeSchemas,
                );
        }

        expect(() =>
            approveTranslationBenchBenchmark(draft, {
                reviewedBy: "reviewer",
                reviewedAt: "2026-07-25T12:00:00Z",
            }),
        ).toThrow(/TypeAgent catalog hashes|existing TypeAgent schema/);
    });

    it("keeps checked JSONL benchmark schemas pinned to TypeAgent", () => {
        const fixtureDirectory = path.resolve("data/translationBench");
        if (!fs.existsSync(fixtureDirectory)) {
            return;
        }
        const jsonlFiles = fs
            .readdirSync(fixtureDirectory)
            .filter((file) => file.endsWith(".jsonl"));

        for (const file of jsonlFiles) {
            const [metadataLine] = fs
                .readFileSync(path.join(fixtureDirectory, file), "utf8")
                .split("\n");
            const metadata = JSON.parse(metadataLine!);
            for (const schema of metadata.schemas ?? []) {
                expect(schema.typeAgent).toBeDefined();
            }
        }
    });
});

describe("LLM-assisted translation-bench materialization", () => {
    it("invokes the dataset-builder LLM with a deterministic candidate prompt", async () => {
        const candidates = sourceBank();
        const prompts: string[] = [];
        const benchmark = await buildTranslationBenchBenchmarkWithLlm({
            name: "Public lookup benchmark",
            candidates,
            llm: {
                model: "dataset-builder",
                async complete(prompt) {
                    prompts.push(prompt);
                    return {
                        text: JSON.stringify([...selections()].reverse()),
                        usage: {
                            promptTokens: 120,
                            cachedTokens: 20,
                            completionTokens: 40,
                            reasoningTokens: 10,
                        },
                        estimatedCostUsd: 0.000182,
                        pricing: BUILDER_PRICING,
                    };
                },
            },
        });

        expect(prompts).toHaveLength(1);
        expect(prompts[0]).toBe(
            formatTranslationBenchDatasetBuilderPrompt(
                [...candidates].reverse(),
            ),
        );
        expect(benchmark.metadata.construction).toMatchObject({
            method: "llm-assisted",
            model: "dataset-builder",
            promptHash: expect.stringMatching(/^[a-f0-9]{64}$/),
            responseHash: expect.stringMatching(/^[a-f0-9]{64}$/),
            usage: {
                promptTokens: 120,
                cachedTokens: 20,
                completionTokens: 40,
                reasoningTokens: 10,
            },
            estimatedCostUsd: 0.000182,
            pricing: BUILDER_PRICING,
        });
        expect(benchmark.cases[0]!.seed.utterance).toBe(
            candidates[0]!.probe.utterance,
        );
    });

    it("keeps unavailable dataset-builder usage and cost unknown", async () => {
        const benchmark = await buildTranslationBenchBenchmarkWithLlm({
            name: "Public lookup benchmark",
            candidates: sourceBank(),
            llm: {
                model: "dataset-builder",
                async complete() {
                    return JSON.stringify(selections());
                },
            },
        });

        expect(benchmark.metadata.construction).not.toHaveProperty("usage");
        expect(benchmark.metadata.construction).not.toHaveProperty(
            "estimatedCostUsd",
        );
        expect(benchmark.metadata.construction).not.toHaveProperty("pricing");
    });

    it("repairs a rejected response and aggregates every builder attempt", async () => {
        const prompts: string[] = [];
        let attempt = 0;
        const benchmark = await buildTranslationBenchBenchmarkWithLlm({
            name: "Public lookup benchmark",
            candidates: sourceBank(),
            llm: {
                model: "dataset-builder",
                async complete(prompt) {
                    prompts.push(prompt);
                    attempt += 1;
                    return {
                        text:
                            attempt === 1
                                ? "not json"
                                : JSON.stringify(selections()),
                        usage: {
                            promptTokens: attempt * 100,
                            cachedTokens: attempt * 10,
                            completionTokens: attempt * 20,
                            reasoningTokens: attempt * 5,
                        },
                        estimatedCostUsd: attempt * 0.001,
                        pricing: BUILDER_PRICING,
                    };
                },
            },
        });

        expect(prompts).toHaveLength(2);
        expect(prompts[1]).toContain("Previous response rejected");
        expect(prompts[1]).toContain("not json");
        expect(benchmark.metadata.construction).toMatchObject({
            attemptCount: 2,
            repairTranscriptHash: expect.stringMatching(/^[a-f0-9]{64}$/),
            usage: {
                promptTokens: 300,
                cachedTokens: 30,
                completionTokens: 60,
                reasoningTokens: 15,
            },
            estimatedCostUsd: 0.003,
            pricing: BUILDER_PRICING,
        });
    });

    it("rejects incoherent dataset-builder usage", async () => {
        await expect(
            buildTranslationBenchBenchmarkWithLlm({
                name: "Public lookup benchmark",
                candidates: sourceBank(),
                llm: {
                    model: "dataset-builder",
                    async complete() {
                        return {
                            text: JSON.stringify(selections()),
                            usage: {
                                promptTokens: 1,
                                cachedTokens: 2,
                                completionTokens: 1,
                            },
                        };
                    },
                },
            }),
        ).rejects.toThrow(/cachedTokens.*cannot exceed promptTokens/);
    });

    it("accepts one fenced JSON dataset-builder response", async () => {
        const benchmark = await buildTranslationBenchBenchmarkWithLlm({
            name: "Public lookup benchmark",
            candidates: sourceBank(),
            llm: {
                model: "dataset-builder",
                async complete() {
                    return `\n\`\`\`json\r\n${JSON.stringify(selections())}\r\n\`\`\`\n`;
                },
            },
        });

        expect(benchmark.cases).toHaveLength(1);
    });

    it("rejects prose-wrapped dataset-builder responses", async () => {
        await expect(
            buildTranslationBenchBenchmarkWithLlm({
                name: "Public lookup benchmark",
                candidates: sourceBank(),
                llm: {
                    model: "dataset-builder",
                    async complete() {
                        return `Here is the JSON:\n${JSON.stringify(selections())}`;
                    },
                },
            }),
        ).rejects.toThrow(/invalid JSON/);
    });

    it("copies scored source fields exactly and keeps authored paraphrases shape-only", () => {
        const shapeOnly: TranslationBenchShapeOnlyProbe = {
            id: "generated-1",
            scored: false,
            origin: "llm-authored",
            utterance: "a model-authored paraphrase",
            order: "any",
            expectedActions: call("gamma"),
            generator: { model: "dataset-builder", promptHash: HASH },
        };
        const sources = sourceBank();
        const benchmark = materialize({
            candidates: sources,
            shapeOnly: { "lookup-bank": [shapeOnly] },
        });

        expect(benchmark.cases[0]!.seed.utterance).toBe(
            sources[0]!.probe.utterance,
        );
        expect(benchmark.cases[0]!.seed.expectedActions).toEqual(
            sources[0]!.probe.expectedActions,
        );
        expect(benchmark.cases[0]!.explainer).toEqual({
            valueInRequest: true,
            noReferences: true,
        });
        expect(benchmark.cases[0]!.shapeOnly).toEqual([shapeOnly]);
        expect(benchmark.cases[0]!.shapeOnly![0]).not.toHaveProperty("lineage");
    });

    it("rejects any model-authored field outside the selection contract", () => {
        const invalid = selections() as unknown as Record<string, unknown>[];
        invalid[0] = {
            ...invalid[0],
            utterance: "the model must not write scored text",
        };

        expect(() => materialize({ selections: invalid })).toThrow(
            /unrecognized key/i,
        );
    });

    it("rejects unknown candidates and every kind of source hash drift", () => {
        expect(() =>
            materialize({
                selections: [
                    ...selections().slice(0, 2),
                    selection("missing", "negative"),
                ],
            }),
        ).toThrow(/Unknown public candidate/);

        for (const mutate of [
            (c: TranslationBenchPublicCandidate) => {
                c.rawRow = { changed: true };
            },
            (c: TranslationBenchPublicCandidate) => {
                c.sourceSlice = { changed: true };
            },
            (c: TranslationBenchPublicCandidate) => {
                c.probe.utterance = "changed";
            },
        ]) {
            const candidates = sourceBank();
            mutate(candidates[0]!);
            expect(() => materialize({ candidates })).toThrow(/hash drift/);
        }
    });

    it("requires one seed, a positive, and a negative with valid call semantics", () => {
        expect(() =>
            materialize({ selections: selections().slice(0, 2) }),
        ).toThrow(/at least one negative/);

        expect(() =>
            materialize({
                selections: [
                    selection("c1", "negative"),
                    selection("c2", "positive"),
                    selection("c3", "seed"),
                ],
            }),
        ).toThrow(
            /no expected actions|negative role must have no expected calls|seed.*requires/,
        );

        expect(() =>
            materialize({
                selections: selections().map((item) => ({
                    ...item,
                    targetAction: {
                        schemaName: "publicTools",
                        actionName: "not-selected",
                    },
                })),
            }),
        ).toThrow(/does not contain target action/);
    });

    it("rejects mixed toolsets within a generalization bank", () => {
        const alternateSchema: TranslationBenchBenchmarkSchema = {
            ...SCHEMA,
            tools: [
                {
                    ...SCHEMA.tools[0]!,
                    function: {
                        ...SCHEMA.tools[0]!.function,
                        description: "A changed public tool definition",
                    },
                },
            ],
        };
        const candidates = sourceBank();
        candidates[1] = candidate("c2", call("beta"), {
            schemas: [alternateSchema],
        });

        expect(() => materialize({ candidates })).toThrow(
            /mixes public toolsets/,
        );
    });

    it("requires every scored probe to own a unique public turn", () => {
        const candidates = sourceBank();
        const duplicate = candidates[0]!;
        candidates[1] = candidate("c2", call("beta"), {
            rowId: duplicate.lineage.rowId,
            sourcePart: duplicate.lineage.sourcePart,
        });
        candidates[1]!.lineage.rowIndex = duplicate.lineage.rowIndex;

        expect(() => materialize({ candidates })).toThrow(
            /Public turn.*selected more than once/,
        );
    });

    it("produces the same JSONL regardless of selection ordering", () => {
        const forward = materialize();
        const reverse = materialize({
            selections: [...selections()].reverse(),
        });

        expect(formatTranslationBenchBenchmarkJsonl(reverse)).toBe(
            formatTranslationBenchBenchmarkJsonl(forward),
        );
    });
});
