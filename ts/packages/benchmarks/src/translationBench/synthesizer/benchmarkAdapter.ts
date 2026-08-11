// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    assertTranslationBenchBenchmarkApproved,
    assertTranslationBenchBenchmarkReadyForEvaluation,
    type TranslationBenchBenchmark,
    type TranslationBenchPublicProbe,
    type TranslationBenchPublicTurnLineage,
} from "./benchmark.js";
import type {
    TranslationBenchCase,
    TranslationBenchExplainerProbe,
    TranslationBenchLineage,
    TranslationBenchSuiteSourceIndex,
    TranslationBenchSuite,
} from "../runner/runner.js";

function toRunnerLineage(
    lineage: TranslationBenchPublicTurnLineage,
): TranslationBenchLineage {
    return {
        dataset: lineage.dataset,
        revision: lineage.revision,
        config: lineage.config,
        split: lineage.split,
        rowIndex: lineage.rowIndex,
        rowId: lineage.rowId,
        sourceUrl: lineage.sourceUrl,
        sourceHash: lineage.canonicalPayloadHash,
        sourcePart: lineage.sourcePart,
        rawRowHash: lineage.rawRowHash,
        sourceSliceHash: lineage.sourceSliceHash,
        canonicalPayloadHash: lineage.canonicalPayloadHash,
        transformVersion: lineage.transformVersion,
        ...(lineage.transformVersion >= 2 ? { derived: true as const } : {}),
    };
}

function toExplainerProbe(
    caseId: string,
    probe: TranslationBenchPublicProbe,
): TranslationBenchExplainerProbe {
    if (probe.selection.role === "seed") {
        throw new Error(
            `Case '${caseId}' contains a seed in its generalization probes`,
        );
    }
    return {
        id: `${caseId}:${probe.lineage.rowId}:${probe.lineage.sourcePart}${
            probe.lineage.transformVersion >= 2
                ? `:${probe.lineage.canonicalPayloadHash}`
                : ""
        }`,
        role: probe.selection.role,
        lineage: toRunnerLineage(probe.lineage),
        utterance: probe.utterance,
        expectedActions: structuredClone(probe.expectedActions),
        order: probe.order,
        dimensions: structuredClone(probe.selection.dimensions),
        ...(probe.history !== undefined
            ? { history: structuredClone(probe.history) }
            : {}),
    };
}

export function translationBenchBenchmarkToSuite(benchmark: TranslationBenchBenchmark): {
    suite: TranslationBenchSuite;
    sourceManifest: TranslationBenchSuiteSourceIndex;
} {
    assertTranslationBenchBenchmarkReadyForEvaluation(benchmark);
    assertTranslationBenchBenchmarkApproved(benchmark);
    const suite: TranslationBenchSuite = {
        version: 1,
        name: benchmark.metadata.name,
        schemas: structuredClone(benchmark.metadata.schemas),
        cases: benchmark.cases.flatMap((evalCase): TranslationBenchCase[] => {
            const primary: TranslationBenchCase = {
                id: evalCase.id,
                lineage: toRunnerLineage(evalCase.seed.lineage),
                activeSchemas: structuredClone(evalCase.activeSchemas),
                seed: {
                    utterance: evalCase.seed.utterance,
                    expectedActions: structuredClone(
                        evalCase.seed.expectedActions,
                    ),
                    order: evalCase.seed.order,
                    ...(evalCase.seed.history !== undefined
                        ? { history: structuredClone(evalCase.seed.history) }
                        : {}),
                    ...(evalCase.seed.parameterScore !== undefined
                        ? {
                              parameterScore: structuredClone(
                                  evalCase.seed.parameterScore,
                              ),
                          }
                        : {}),
                },
                explainer: {
                    valueInRequest: evalCase.explainer.valueInRequest,
                    noReferences: evalCase.explainer.noReferences,
                    probes: evalCase.generalizations.map((probe) =>
                        toExplainerProbe(evalCase.id, probe),
                    ),
                },
                ...(evalCase.dimensions !== undefined
                    ? { dimensions: structuredClone(evalCase.dimensions) }
                    : {}),
            };
            const translationNegatives = evalCase.generalizations
                .filter((probe) => probe.selection.role === "negative")
                .map(
                    (probe): TranslationBenchCase => ({
                        id: `${evalCase.id}:translation-negative:${probe.lineage.rowId}:${probe.lineage.sourcePart}${
                            probe.lineage.transformVersion >= 2
                                ? `:${probe.lineage.canonicalPayloadHash}`
                                : ""
                        }`,
                        lineage: toRunnerLineage(probe.lineage),
                        activeSchemas: structuredClone(evalCase.activeSchemas),
                        seed: {
                            utterance: probe.utterance,
                            expectedActions: [],
                            order: probe.order,
                            ...(probe.history !== undefined
                                ? { history: structuredClone(probe.history) }
                                : {}),
                        },
                        dimensions: structuredClone(probe.selection.dimensions),
                    }),
                );
            return [primary, ...translationNegatives];
        }),
        ...(benchmark.metadata.scenarios !== undefined
            ? { scenarios: structuredClone(benchmark.metadata.scenarios) }
            : {}),
        ...(benchmark.metadata.pricing !== undefined
            ? { pricing: structuredClone(benchmark.metadata.pricing) }
            : {}),
    };
    const sourceManifest: TranslationBenchSuiteSourceIndex = {
        version: 1,
        sources: benchmark.cases.flatMap((evalCase) => [
            toRunnerLineage(evalCase.seed.lineage),
            ...evalCase.generalizations.map((probe) =>
                toRunnerLineage(probe.lineage),
            ),
        ]),
    };
    return { suite, sourceManifest };
}
