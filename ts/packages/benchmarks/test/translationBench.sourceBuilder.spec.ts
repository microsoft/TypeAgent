import { createHash } from "node:crypto";

import { parseToolsJsonSchema } from "@typeagent/action-schema";

import {
    TRANSLATION_BENCH_EXAMPLE_SOURCE_PIN,
    approveTranslationBenchBenchmark,
    assertTranslationBenchBenchmarkMatchesTypeAgentCatalog,
    computeTranslationBenchSourceManifestHash,
    createTranslationBenchTypeAgentSchemaCatalog,
    formatTranslationBenchBenchmarkJsonl,
    parseTranslationBenchBenchmarkForEvaluation,
    parseTranslationBenchBenchmarkJsonl,
} from "../src/translationBench/synthesizer/benchmark.js";
import {
    buildTranslationBenchBenchmarkFromSourceWithLlm,
    formatTranslationBenchSourceBuilderPrompt,
    importTranslationBenchSourceCandidates,
    materializeTranslationBenchBenchmarkFromSource,
    type TranslationBenchSourceBuilderDecision,
    type TranslationBenchSourceManifest,
} from "../src/translationBench/synthesizer/sourceBuilder.js";
import type {
    ActionConfig,
    ActionConfigProvider,
} from "agent-dispatcher/internal";

type ActionSchemaFile = ReturnType<
    ActionConfigProvider["getActionSchemaFileForConfig"]
>;

const TYPEAGENT_TOOLS = [
    {
        name: "setTimer",
        description: "Set an existing TypeAgent timer",
        inputSchema: {
            type: "object" as const,
            properties: {
                durationMinutes: { type: "number" as const },
                message: { type: "string" as const },
            },
            required: ["durationMinutes", "message"],
        },
    },
];

function provider(
    overrides: { sourceHash?: string; schemaType?: unknown } = {},
): ActionConfigProvider {
    const config = {
        schemaName: "timer",
        description: "The existing TypeAgent timer schema",
        schemaType: overrides.schemaType ?? "TimerAction",
    } as ActionConfig;
    const schemaFile: ActionSchemaFile = {
        schemaName: "timer",
        sourceHash: overrides.sourceHash ?? "a".repeat(64),
        parsedActionSchema: parseToolsJsonSchema(TYPEAGENT_TOOLS),
    };
    return {
        tryGetActionConfig(schemaName) {
            return schemaName === "timer" ? config : undefined;
        },
        getActionConfig(schemaName) {
            if (schemaName !== "timer") throw new Error("unknown schema");
            return config;
        },
        getActionConfigs() {
            return [config];
        },
        getActionSchemaFileForConfig() {
            return schemaFile;
        },
    };
}

function sourceText(): string {
    return [
        JSON.stringify({
            id: "row-missing-duration",
            query: "Set a timer for my tea.",
            function_calls: [],
            dimensions: { scenario: "clarification" },
        }),
        JSON.stringify({
            id: "row-tea",
            query: "Five minutes, and label it tea.",
            function_calls: [
                {
                    function_name: "create_timer",
                    arguments: { durationMinutes: 5, message: "tea" },
                },
            ],
            history: [
                {
                    user: "Set a timer for my tea.",
                    assistant: {
                        text: "How many minutes should the timer run?",
                        source: "timer",
                    },
                },
            ],
            dimensions: { scenario: "contextual" },
        }),
        JSON.stringify({
            id: "row-stretch",
            query: "Start a ten minute timer called stretch.",
            function_calls: [
                {
                    function_name: "create_timer",
                    arguments: { durationMinutes: 10, message: "stretch" },
                },
            ],
            dimensions: { scenario: "direct" },
        }),
        JSON.stringify({
            id: "row-joke",
            query: "Tell me a joke.",
            function_calls: [],
            dimensions: { scenario: "chitchat" },
        }),
    ].join("\n");
}

function manifest(text = sourceText()): TranslationBenchSourceManifest {
    return {
        ...TRANSLATION_BENCH_EXAMPLE_SOURCE_PIN,
        sourceFileHash: createHash("sha256").update(text).digest("hex"),
    };
}

function decisions(): TranslationBenchSourceBuilderDecision[] {
    return [
        {
            decision: "score",
            candidateId: "row-missing-duration:query",
            bankId: "timer-bank",
            role: "negative",
            targetAction: { schemaName: "timer", actionName: "setTimer" },
            actionMappings: [],
            dimensions: { source: "clarification" },
            rationale: "Missing the required duration",
            confidence: 1,
        },
        {
            decision: "score",
            candidateId: "row-tea:query",
            bankId: "timer-bank",
            role: "seed",
            targetAction: { schemaName: "timer", actionName: "setTimer" },
            actionMappings: [
                {
                    sourceCallIndex: 0,
                    targetAction: {
                        schemaName: "timer",
                        actionName: "setTimer",
                    },
                },
            ],
            dimensions: { source: "contextual" },
            rationale: "Exact timer arguments fit the TypeAgent timer",
            confidence: 1,
        },
        {
            decision: "score",
            candidateId: "row-stretch:query",
            bankId: "timer-bank",
            role: "positive",
            targetAction: { schemaName: "timer", actionName: "setTimer" },
            actionMappings: [
                {
                    sourceCallIndex: 0,
                    targetAction: {
                        schemaName: "timer",
                        actionName: "setTimer",
                    },
                },
            ],
            dimensions: { source: "direct" },
            rationale: "Exact timer arguments fit the TypeAgent timer",
            confidence: 1,
        },
        {
            decision: "skip",
            candidateId: "row-joke:query",
            rationale: "The turn has no faithful TypeAgent timer intent",
        },
    ];
}

function imported() {
    const text = sourceText();
    return importTranslationBenchSourceCandidates(text, {
        adapter: "seed-qa-jsonl",
        manifest: manifest(text),
    });
}

function materialize(
    overrides: {
        decisions?: unknown;
        candidates?: ReturnType<typeof imported>;
        catalog?: ReturnType<
            typeof createTranslationBenchTypeAgentSchemaCatalog
        >;
    } = {},
) {
    return materializeTranslationBenchBenchmarkFromSource({
        name: "seed-qa to existing TypeAgent timers",
        candidates: overrides.candidates ?? imported(),
        catalog:
            overrides.catalog ??
            createTranslationBenchTypeAgentSchemaCatalog(provider()),
        decisions: overrides.decisions ?? decisions(),
        construction: {
            model: "builder-model",
            promptHash: "b".repeat(64),
            responseHash: "c".repeat(64),
            sourceManifestHash: computeTranslationBenchSourceManifestHash(
                TRANSLATION_BENCH_EXAMPLE_SOURCE_PIN,
            ),
        },
    });
}

describe("seed-qa source import (generic adapter)", () => {
    it("imports seed-qa JSONL into candidates", () => {
        const candidates = imported();
        expect(candidates.map((c) => c.candidateId).sort()).toEqual([
            "row-joke:query",
            "row-missing-duration:query",
            "row-stretch:query",
            "row-tea:query",
        ]);
        const tea = candidates.find((c) => c.candidateId === "row-tea:query")!;
        expect(tea.sourceCalls).toEqual([
            {
                name: "create_timer",
                parameters: { durationMinutes: 5, message: "tea" },
            },
        ]);
        expect(tea.history).toBeDefined();
    });

    it("rejects hash mismatches against the manifest pin", () => {
        const text = sourceText();
        expect(() =>
            importTranslationBenchSourceCandidates(text + "\n", {
                adapter: "seed-qa-jsonl",
                manifest: manifest(text),
            }),
        ).toThrow(/hash/i);
    });

    it("rejects unknown adapter ids", () => {
        const text = sourceText();
        expect(() =>
            importTranslationBenchSourceCandidates(text, {
                adapter: "vendor-private-dump",
                manifest: manifest(text),
            }),
        ).toThrow(/Unknown source adapter/);
    });
});

describe("source builder materialize", () => {
    it("materializes a draft benchmark from seed-qa candidates", () => {
        const benchmark = materialize();
        expect(benchmark.cases.length).toBeGreaterThan(0);
        expect(benchmark.metadata.approval.status).toBe("draft");
        expect(benchmark.metadata.construction.model).toBe("builder-model");
    });

    it("approves a simple-action draft with exactly one expected action per seed", () => {
        const approved = approveTranslationBenchBenchmark(materialize(), {
            reviewedBy: "tester",
            reviewedAt: "2020-01-01T00:00:00.000Z",
        });
        expect(approved.cases.length).toBeGreaterThan(0);
        expect(approved.metadata.approval.status).toBe("approved");
        for (const c of approved.cases) {
            expect(c.seed.expectedActions).toHaveLength(1);
        }
    });

    it("round-trips JSONL and can be approved", () => {
        const draft = materialize();
        const jsonl = formatTranslationBenchBenchmarkJsonl(draft);
        const parsed = parseTranslationBenchBenchmarkJsonl(jsonl);
        const approved = approveTranslationBenchBenchmark(parsed, {
            reviewedBy: "tester",
            reviewedAt: "2020-01-01T00:00:00.000Z",
        });
        expect(approved.metadata.approval.status).toBe("approved");
        expect(() =>
            parseTranslationBenchBenchmarkForEvaluation(
                formatTranslationBenchBenchmarkJsonl(approved),
            ),
        ).not.toThrow();
    });

    it("formats a builder prompt over candidates and catalog", () => {
        const prompt = formatTranslationBenchSourceBuilderPrompt(
            imported(),
            createTranslationBenchTypeAgentSchemaCatalog(provider()),
        );
        expect(prompt).toContain("row-tea:query");
        expect(prompt).toContain("setTimer");
    });

    it("builds with an LLM stub and records construction provenance", async () => {
        const text = sourceText();
        const benchmark = await buildTranslationBenchBenchmarkFromSourceWithLlm(
            {
                name: "llm seed build",
                sourceText: text,
                sourceManifest: manifest(text),
                adapter: "seed-qa-jsonl",
                provider: provider(),
                llm: {
                    model: "builder-model",
                    async complete() {
                        return JSON.stringify(decisions());
                    },
                },
                minimumActionCount: 1,
            },
        );
        expect(benchmark.metadata.construction.model).toBe("builder-model");
        assertTranslationBenchBenchmarkMatchesTypeAgentCatalog(
            approveTranslationBenchBenchmark(benchmark, {
                reviewedBy: "tester",
                reviewedAt: "2020-01-01T00:00:00.000Z",
            }),
            provider(),
        );
    });
});
