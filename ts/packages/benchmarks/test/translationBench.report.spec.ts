// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    TranslationBenchReport,
    renderTranslationBenchHtml,
} from "../src/translationBench/runner/report.js";
import {
    aggregateTranslationBenchExplainerResults,
    scoreTranslationBenchExplainer,
    type TranslationBenchExplainerCaseResult,
    type TranslationBenchExplainerProbeRow,
} from "../src/translationBench/runner/explainer.js";
import { scoreTranslationBench } from "../src/translationBench/runner/runner.js";

function explainerProbe(
    probeId: string,
    kind: "positive" | "negative",
    utterance: string,
    expectedActions: TranslationBenchExplainerProbeRow["expectedActions"],
    chosenActions: TranslationBenchExplainerProbeRow["chosenActions"],
    hit: boolean,
    history?: TranslationBenchExplainerProbeRow["history"],
): TranslationBenchExplainerProbeRow {
    return {
        probeId,
        kind,
        utterance,
        ...(history === undefined ? {} : { history }),
        order: "any",
        lineage: {
            dataset: "pinned-source/function-calling-v1",
            revision: "revision",
            config: "source_func_calling",
            split: "train",
            rowIndex: 2,
            rowId: probeId,
            sourceUrl: `https://example.test/${probeId}`,
            sourceHash: "e".repeat(64),
            sourcePart: "conversations[1]",
            transformVersion: 1,
        },
        expectedActions,
        chosenActions,
        score: scoreTranslationBench(expectedActions, chosenActions, "any"),
        hit,
        matchCount: hit ? 1 : 0,
        elapsedMs: 3.5,
    };
}

function explainerRows(): TranslationBenchExplainerCaseResult[] {
    const action = {
        schemaName: "discord",
        actionName: "getUser",
        parameters: { user_id: "12345" },
    };
    const seedReplay = explainerProbe(
        "seed-profile",
        "positive",
        "Find <seed> profile & details",
        [action],
        [action],
        true,
    );
    const probes = [
        explainerProbe(
            "positive-history",
            "positive",
            "My user ID is 12345.",
            [action],
            [action],
            true,
            [
                {
                    user: "Use <history> & the saved account",
                    assistant: { text: "Which account?", source: "test" },
                },
            ],
        ),
        explainerProbe(
            "negative-abstain",
            "negative",
            'Which user did you mean, "exactly"?',
            [],
            [],
            false,
        ),
    ];
    const first: TranslationBenchExplainerCaseResult = {
        caseId: "profile-row",
        model: "copilot:gpt-5.6-luna",
        explainerName: "v5",
        valueInRequest: true,
        noReferences: true,
        ruleCreated: true,
        ruleText: 'discord.getUser when ID is <known> & "explicit"',
        ruleJson: { action: "discord.getUser" },
        explanationData: { source: "seed" },
        explanationElapsedMs: 8,
        explanationUsage: {
            calls: 1,
            promptTokens: 12,
            completionTokens: 4,
            cachedTokens: 2,
            reasoningTokens: 1,
            estimatedCostUsd: 0.001,
        },
        cacheReplayElapsedMs: 7,
        seedReplay,
        probes,
        summary: scoreTranslationBenchExplainer(probes, true, true),
        rubric: {
            correctness: 1,
            coverage: 1,
            overGeneralization: 1,
            slotBinding: 1,
            specificity: 1,
            rationale: "The rule remains specific.",
            score: 1,
        },
    };
    return [
        first,
        {
            ...first,
            caseId: "profile-row-2",
            seedReplay: {
                ...seedReplay,
                probeId: "seed-profile-2",
                lineage: {
                    ...seedReplay.lineage,
                    rowId: "seed-profile-2",
                },
            },
        },
    ];
}

describe("renderTranslationBenchHtml", () => {
    it("renders model headlines, shape breakdowns, and escaped failure details", () => {
        const renderedExplainerRows = explainerRows();
        const report = {
            version: 1,
            suiteName: "source <camera>",
            settings: {
                models: ["copilot:gpt-5.6-luna"],
                strategy: "first-match",
                concurrency: 1,
                streaming: false,
                sourceManifestHash: "manifest-hash",
            },
            schemaHashes: { "source.camera": "abc" },
            catalog: {
                schemaCount: 23,
                actionCount: 578,
                qualifiedActionKeys: ['["email","sendEmail"]'],
                catalogDigest: "d".repeat(64),
            },
            pricing: {},
            summary: {
                totalCases: 1,
                passedCases: 0,
                exactPassedCases: 0,
                schemaValidCases: 0,
                expectedCount: 1,
                routed: 0,
                paramMatches: 0,
                negativeRows: 0,
                negativeRowsFired: 0,
                negativeRowErrors: 0,
                errors: 0,
                passRate: 0,
                exactPassRate: 0,
                schemaValidRate: 0,
                toolScore: 0,
                paramScore: undefined,
                falseNegativeRate: 1,
                falsePositiveRate: undefined,
                diagnostics: {
                    wrongRouteOrAction: 1,
                    missingRequiredParameter: 0,
                    extraneousParameter: 0,
                    wrongParameterType: 0,
                    wrongValue: 0,
                    invalidJsonOrTranslationFailure: 0,
                },
                avgLatencyMs: 10,
                p50LatencyMs: 10,
                p95LatencyMs: 10,
                usage: {
                    promptTokens: undefined,
                    completionTokens: undefined,
                    cachedTokens: undefined,
                    reasoningTokens: 2,
                    estimatedCostUsd: undefined,
                },
            },
            byModel: [],
            byScenario: [],
            byActionCount: [],
            byDimension: [],
            byShape: [
                {
                    key: "actions=single;params=one;history=no;order=any;nested=no;array=no",
                    summary: {
                        totalCases: 1,
                        passedCases: 0,
                        exactPassedCases: 0,
                        schemaValidCases: 0,
                        expectedCount: 1,
                        routed: 0,
                        paramMatches: 0,
                        negativeRows: 0,
                        negativeRowsFired: 0,
                        negativeRowErrors: 0,
                        errors: 0,
                        passRate: 0,
                        exactPassRate: 0,
                        schemaValidRate: 0,
                        toolScore: 0,
                        paramScore: undefined,
                        falseNegativeRate: 1,
                        falsePositiveRate: undefined,
                        diagnostics: {
                            wrongRouteOrAction: 1,
                            missingRequiredParameter: 0,
                            extraneousParameter: 0,
                            wrongParameterType: 0,
                            wrongValue: 0,
                            invalidJsonOrTranslationFailure: 0,
                        },
                        avgLatencyMs: 10,
                        p50LatencyMs: 10,
                        p95LatencyMs: 10,
                        usage: {
                            promptTokens: undefined,
                            completionTokens: undefined,
                            cachedTokens: undefined,
                            reasoningTokens: 2,
                            estimatedCostUsd: undefined,
                        },
                    },
                },
            ],
            rows: [
                {
                    caseId: "profile-row",
                    scenarioId: "baseline",
                    scenario: {
                        id: "baseline",
                        history: { mode: "case", limit: 20 },
                        recentActions: { enabled: false, limit: 0 },
                        additionalInstructions: false,
                        entityPromptShape: "facets",
                        userContext: "none",
                        activityContext: "none",
                        schemaOptimization: {
                            enabled: false,
                            numInitialActions: 0,
                        },
                    },
                    lineage: {
                        dataset: "source",
                        revision: "revision",
                        config: "config",
                        split: "train",
                        rowIndex: 1,
                        rowId: "row-1",
                        sourceUrl: "https://example.test/row-1",
                        sourceHash: "f".repeat(64),
                        sourcePart: "conversations[1]",
                        transformVersion: 1,
                    },
                    model: "copilot:gpt-5.6-luna",
                    activeSchemas: ["discord"],
                    activeSchemaCount: 1,
                    activeActionCount: 578,
                    utterance: "Find <user> 12345",
                    order: "any",
                    expectedActions: [
                        {
                            schemaName: "discord",
                            actionName: "getUser",
                            parameters: { user_id: "12345" },
                        },
                    ],
                    chosenActions: [
                        {
                            schemaName: "discord",
                            actionName: "getUser",
                            parameters: { user_id: "<wrong>" },
                        },
                    ],
                    rawChosenActions: [
                        {
                            schemaName: "discord",
                            actionName: "getUser",
                            parameters: { user_id: "<wrong>" },
                        },
                    ],
                    score: {
                        passed: false,
                        exactPassed: false,
                        schemaValid: false,
                        expectedCount: 1,
                        chosenCount: 1,
                        routed: 1,
                        paramMatches: 0,
                        exactParamMatches: 0,
                        isNegative: false,
                        firedOnNegative: false,
                        diagnostics: {
                            wrongRouteOrAction: 0,
                            missingRequiredParameter: 0,
                            extraneousParameter: 0,
                            wrongParameterType: 0,
                            wrongValue: 1,
                            invalidJsonOrTranslationFailure: 0,
                        },
                    },
                    shape: {
                        actionCount: "single",
                        parameterCount: "one",
                        history: false,
                        order: "any",
                        nested: false,
                        array: false,
                        resultReference: false,
                        key: "actions=single;params=one;history=no;order=any;nested=no;array=no;resultRef=no",
                    },
                    elapsedMs: 12,
                    usage: {
                        calls: 1,
                        promptTokens: 10,
                        completionTokens: 2,
                        cachedTokens: 0,
                        reasoningTokens: undefined,
                        estimatedCostUsd: 0.01,
                    },
                },
            ],
            explainer: {
                summary: aggregateTranslationBenchExplainerResults(
                    renderedExplainerRows,
                ),
                byModel: [
                    {
                        key: "copilot:gpt-5.6-luna",
                        summary: aggregateTranslationBenchExplainerResults(
                            renderedExplainerRows,
                        ),
                    },
                ],
                rows: renderedExplainerRows,
            },
            provenance: {
                source: {
                    dataset: "pinned-source/function-calling-v1",
                    revision: "revision",
                    config: "source_func_calling",
                    split: "train",
                    sourceUrl: "https://example.test/source.json",
                    sourceFileHash: "a".repeat(64),
                },
                disclosure:
                    "source is a public synthetic dataset and is not directly comparable.",
                construction: {
                    method: "llm-assisted",
                    decisionLedger: [
                        {
                            decision: "skip",
                            candidateId: "candidate-1",
                            lineage: {
                                dataset: "dataset",
                                revision: "revision",
                                config: "config",
                                split: "train",
                                rowIndex: 0,
                                rowId: "row-1",
                                sourceUrl: "https://example.test/row-1",
                                sourcePart: "conversations[1]",
                                rawRowHash: "b".repeat(64),
                                sourceSliceHash: "c".repeat(64),
                                transformVersion: 1,
                            },
                            rationale: "No faithful existing TypeAgent action",
                        },
                    ],
                },
                approval: { status: "draft" },
                decisions: {
                    candidates: 1,
                    scored: 0,
                    skipped: 1,
                    shapeOnly: 0,
                    scoredRate: 0,
                },
            },
        } satisfies TranslationBenchReport;

        const html = renderTranslationBenchHtml(report);
        expect(html).toContain("copilot:gpt-5.6-luna");
        expect(html).toContain("Model × action shape");
        expect(html).toContain("Visible existing TypeAgent catalog");
        expect(html).toContain("578");
        expect(html).toContain("catalogDigest");
        expect(html).toContain("Model × settings scenario");
        expect(html).toContain("Model × action count (active × expected)");
        expect(html).toContain("Model × builder dimension");
        expect(html).toContain("Deterministic diagnostic counts");
        expect(html).toContain("Wrong route/action");
        expect(html).toContain("Action reliability");
        expect(html).toContain("Exact rate");
        expect(html).toContain("Schema-valid");
        expect(html).toContain("honest denominators");
        expect(html).toContain("Soft pass");
        expect(html).toContain("Exact pass");
        expect(html).toContain("Single-row translation trace");
        expect(html).toContain('id="translation-bench-row-select"');
        expect(html).toContain('id="translation-bench-rows-json"');
        expect(html).toContain('id="translation-bench-cases-json"');
        // Row detail is virtualized client-side; labels live in the renderer script.
        expect(html).toContain("1 · Public intent");
        expect(html).toContain("2 · Expected TypeAgent action");
        expect(html).toContain("3 · Chosen action");
        expect(html).toContain("4 · Deterministic score");
        // Payload is JSON-embedded (not HTML-escaped entity form inside the script).
        expect(html).toContain("discord.getUser");
        expect(html).toContain("Find <user> 12345");
        expect(html).toContain('"<wrong>"');
        expect(html).toContain("Deterministic explainer score");
        expect(html).toContain("qualitative rubric");
        expect(html).toContain("Full benchmark row · seed and generalizations");
        expect(html).toContain('id="translation-bench-case-bank-select"');
        expect(html).toContain('id="translation-bench-case-banks"');
        expect(html).toContain('data-translation-bench-case-bank="0"');
        expect(html).toContain('data-translation-bench-case-bank="1" hidden');
        expect(html).toContain("Seed case");
        expect(html).toContain("Positive generalization 1");
        expect(html).toContain("1 history turn");
        expect(html).toContain("Negative generalization 2");
        expect(html).toContain("No action expected (abstain)");
        expect(html).toContain("No action chosen");
        expect(html).toContain("Constructed explainer rule");
        expect(html).toContain(
            "discord.getUser when ID is &lt;known&gt; &amp; &quot;explicit&quot;",
        );
        expect(html).toContain("Find &lt;seed&gt; profile &amp; details");
        expect(html).toContain("Use &lt;history&gt; &amp; the saved account");
        expect(html).toContain(
            "panel.hidden=panel.dataset.translationBenchCaseBank!==select.value",
        );
        const casePanels =
            html.match(
                /<article class="case-bank [^"]+" data-translation-bench-case-bank="\d+"(?: hidden)?>/g,
            ) ?? [];
        expect(casePanels).toHaveLength(2);
        expect(
            casePanels.filter((panel) => !panel.endsWith(" hidden>")),
        ).toHaveLength(1);
        expect(html).toContain("Evaluation settings");
        expect(html).toContain("Benchmark provenance and selection ledger");
        expect(html).toContain("public synthetic dataset");
        expect(html).toContain("No faithful existing TypeAgent action");
        expect(html).toContain("source &lt;camera&gt;");
        expect(html).toContain("N/A");
        expect(html).toContain("virtualized");
        expect(html).not.toContain("undefined");
        expect(html).not.toContain("Generated ");
        // Provenance pre still HTML-escapes angle brackets.
        expect(html).not.toContain("source <camera>");
        // Seed/explainer HTML panels still entity-escape.
        expect(html).not.toContain("Find <seed> profile & details");
        expect(html).not.toContain("Use <history> & the saved account");
        expect(html).not.toContain(
            'discord.getUser when ID is <known> & "explicit"',
        );
    });
});
