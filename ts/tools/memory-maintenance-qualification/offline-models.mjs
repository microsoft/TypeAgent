// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";

export async function createOfflineOptions(load, counters, controls = {}) {
    const { createDocMemorySettings } = await load(
        "packages\\memory\\conversation\\dist\\docMemory.js",
    );
    const { KnowProCorpusIndex } = await load(
        "packages\\memory\\service\\dist\\knowProCorpusIndex.js",
    );
    const { hydrateInformational } = await load(
        "packages\\memory\\service\\dist\\informationalWiki.js",
    );
    const { hydrateProjectSummary } = await load(
        "packages\\memory\\service\\dist\\informationalProject.js",
    );
    const { createTopicSnapshot } = await load(
        "packages\\memory\\service\\dist\\topicGeneration.js",
    );
    const model = {
        completionSettings: {},
        complete: async () => {
            counters.unexpectedCompletion++;
            throw new Error(
                "Offline extractor must use deterministic injection",
            );
        },
    };
    const settings = () => {
        const value = createDocMemorySettings(64, undefined, model);
        assert.equal(value.languageModel, model);
        value.embeddingSize = 0;
        const extract = async (text) => {
            counters.extraction++;
            assert.equal(typeof text, "string");
            assert.ok(!text.includes("MAINTENANCE_EVALUATOR_ONLY"));
            const topics =
                controls.contextOnlyNeedle &&
                text.includes(controls.contextOnlyNeedle)
                    ? []
                    : [
                          "command",
                          "lease",
                          "Orders",
                          "Identity",
                          "routing",
                          "capacity review",
                          "resident memory",
                          "Governing tail exception",
                          ...(controls.p6
                              ? [
                                    "lease-budget review",
                                    "connection-hold review",
                                    "application connection pool",
                                    "checkout waiting",
                                    "overlap review",
                                    "Identity token rotation",
                                    "Orders schema migration",
                                ]
                              : []),
                      ].filter((term) =>
                          text.toLowerCase().includes(term.toLowerCase()),
                      );
            return { entities: [], actions: [], inverseActions: [], topics };
        };
        value.conversationSettings.semanticRefIndexSettings.knowledgeExtractor =
            {
                settings: { maxContextLength: 100_000 },
                extract,
                extractWithRetry: async (text) => ({
                    success: true,
                    data: await extract(text),
                }),
            };
        return value;
    };
    const synopsis = {
        identity: "qualification-offline-synopsis-v1",
        fits: (prompt) => Buffer.byteLength(prompt) <= 7000,
        complete: async (prompt, signal) => {
            signal.throwIfAborted();
            counters.synopsis++;
            assert.ok(!prompt.includes("MAINTENANCE_EVALUATOR_ONLY"));
            const input = JSON.parse(
                prompt.slice(prompt.lastIndexOf("\n") + 1),
            );
            if (input.summaries) {
                const selected =
                    input.summaries.find(
                        (item) => item.qualifications.length,
                    ) ?? input.summaries[0];
                const contributors = input.summaries.filter(
                    (item) =>
                        item === selected ||
                        item.qualifications.length ||
                        item.contrasts.length,
                );
                const qualifications = [
                    ...new Set(
                        contributors.flatMap((item) => item.qualifications),
                    ),
                ];
                const contrasts = [
                    ...new Set(contributors.flatMap((item) => item.contrasts)),
                ];
                const overview = [
                    selected.overview,
                    ...[...qualifications, ...contrasts].filter(
                        (item) => !selected.overview.includes(item),
                    ),
                ].join("\n");
                const evidence = [
                    ...new Map(
                        contributors.flatMap((item) =>
                            item.evidence.map(({ id }) => [id, { id }]),
                        ),
                    ).values(),
                ];
                assert.ok(
                    overview.length <= 6000 && evidence.length <= 32,
                    "Offline synopsis composition exceeds supported bounds",
                );
                return JSON.stringify({
                    preview: selected.overview.slice(0, 300),
                    overview,
                    evidence,
                    qualifications,
                    contrasts,
                    limitations: [
                        "Deterministic orchestration, not semantic qualification",
                    ],
                });
            }
            const marker = input.text.indexOf("Governing tail exception:");
            const from = marker >= 0 ? marker : 0;
            const excerpt = input.text.slice(
                from,
                from + (marker >= 0 ? 822 : Math.min(160, input.text.length)),
            );
            const evidence = input.evidence
                .filter(
                    (item) =>
                        item.start < input.start + from + excerpt.length &&
                        item.end > input.start + from,
                )
                .map(({ id }) => ({ id }));
            assert.ok(
                evidence.length > 0 && evidence.length <= 32,
                "Offline synopsis excerpt requires bounded supplied evidence",
            );
            return JSON.stringify({
                preview: excerpt.slice(0, 300),
                overview: excerpt,
                evidence,
                qualifications: marker >= 0 ? [excerpt] : [],
                contrasts: [],
                limitations: [
                    "Deterministic orchestration, not semantic qualification",
                ],
            });
        },
    };
    const adapter = {
        identity: "qualification-offline-original-evidence-v1",
        assessWikiSubject: async () => {
            counters.assessment++;
            return {
                disposition: "distinct",
                purpose: "Offline independently scoped explanation",
                reason: "Overlap does not prove equivalent purpose",
                canonicalViewId: "",
                sharedFragmentIds: [],
                essentialDistinctions: [],
                ambiguousViewIds: [],
            };
        },
        generate: async (input, signal) => {
            counters.article++;
            counters.callsByView ??= {};
            counters.callsByView[input.definition.viewId] =
                (counters.callsByView[input.definition.viewId] ?? 0) + 1;
            signal.throwIfAborted();
            assert.ok(
                !JSON.stringify(input).includes("MAINTENANCE_EVALUATOR_ONLY"),
            );
            const query = (
                input.definition.wiki ?? input.definition.projectSummary
            ).query;
            if (controls.holdQuery === query) {
                controls.entered = true;
                await controls.hold;
            }
            signal.throwIfAborted();
            const fragments = input.inputs.flatMap(
                (source) => source.passages ?? [],
            );
            assert.ok(fragments.length, "Actual indexed passages required");
            const emitted = fragments
                .map((fragment, index) => ({ fragment, index }))
                .filter(
                    ({ fragment }) =>
                        !controls.omitQueries?.includes(query.toLowerCase()) ||
                        fragment.sourceId !== controls.omitSourceId,
                );
            assert.ok(
                emitted.length,
                "Context omission may not produce an empty artifact",
            );
            const body =
                (controls.p6 ? `Subject: ${query}\n\n` : "") +
                emitted.map(({ fragment }) => fragment.excerpt).join("\n\n");
            const title =
                controls.overlapQuery === query
                    ? "Proposed protected-title overlap"
                    : (input.editorial?.generatedBase.content.title ?? query);
            const citationIds = emitted.map(({ index }) => `f${index}`);
            if (input.definition.projectSummary)
                return hydrateProjectSummary(input, {
                    title,
                    summary: emitted[0].fragment.excerpt.slice(0, 1000),
                    completeness: "partial",
                    assignments: [],
                    milestoneItems: [],
                    decisionItems: [],
                    openQuestions: [],
                    riskItems: [],
                    goalsScope: body,
                    owners: "Owner interpretation not qualified by deterministic copy",
                    status: body,
                    milestones: "No inferred production cutover date",
                    decisions: body,
                    risks: "Scope interpretation requires independent review",
                    context: "Original indexed evidence",
                    limits: "Offline selected-evidence copy, not model qualification",
                    projectState: "unknown",
                    incidentState: "unknown",
                    capacityState: "notApplicable",
                    citationIds,
                });
            return hydrateInformational(input, {
                title,
                summary: emitted[0].fragment.excerpt.slice(0, 1000),
                status: "partial",
                prose: body,
                limits: "Offline selected-evidence copy, not model qualification",
                citationIds,
            });
        },
        generateTopics: async (input, signal) => {
            signal.throwIfAborted();
            counters.topic++;
            if (controls.topicHold) {
                controls.topicEntered = true;
                await controls.topicHold;
                signal.throwIfAborted();
            }
            const snapshot = createTopicSnapshot(input, input.model);
            for (const node of snapshot.nodes) {
                node.summary = node.citations[0].excerpt.slice(0, 1000);
                node.summaryState = "ready";
                node.citations = node.citations.slice(0, 1);
                node.limits.push(
                    "Offline copy; semantic organization unqualified",
                );
            }
            return snapshot;
        },
        checkEditorial: async () => {
            counters.editorial++;
            return { safe: true, failures: [] };
        },
        validate: async () => {
            counters.unexpectedValidation++;
            throw new Error(
                "Informational build must not invoke universal support",
            );
        },
    };
    return {
        sourceSynopsisModel: synopsis,
        viewSynthesisAdapter: adapter,
        indexFactory: (id, directory) =>
            new KnowProCorpusIndex(id, directory, settings),
    };
}

// This loader is deliberately not called by offline preparation.
export async function configuredRoleOptions(load, authorization) {
    if (
        authorization?.verifiedP6 !== true ||
        authorization?.verifiedOfflinePreflight !== true ||
        authorization?.coordinatorHandoff !== true
    )
        throw new Error(
            "Configured roles require a separate verified coordinator handoff",
        );
    const { createKnowProCorpusIndex } = await load(
        "packages\\memory\\service\\dist\\knowProCorpusIndex.js",
    );
    return { indexFactory: createKnowProCorpusIndex };
}
