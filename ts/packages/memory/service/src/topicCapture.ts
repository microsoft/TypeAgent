// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { CorpusIndex, SourceKnowledgeSuppression } from "./types.js";
import type {
    TopicFamilyState,
    TopicIndexReader,
    TopicSnapshot,
    TopicSourceReference,
    TopicOccurrence,
    TopicEventReference,
    TopicNode,
} from "./topicTypes.js";
import type { ViewBuildSnapshot } from "./viewTypes.js";
import { recordSearchTiming } from "@typeagent/knowpro";
import { viewHash } from "./viewMerge.js";
import { initialTopicNodes, validateTopicSnapshot } from "./topicSnapshot.js";
import { topicClusterSignature } from "./topicDecision.js";
import { topicMaintenanceSignature } from "./topicClusterMaintenance.js";
import { topicCurationPolicy } from "./topicCurationSettings.js";

export function supportsTopicIndex(
    index: CorpusIndex,
): index is CorpusIndex & TopicIndexReader {
    return (
        "getTopicOccurrences" in index &&
        typeof index.getTopicOccurrences === "function"
    );
}

export function requireTopicIndex(
    index: CorpusIndex,
): CorpusIndex & TopicIndexReader {
    if (!supportsTopicIndex(index))
        throw new Error(
            "Complete topic incidence is not supported by this corpus index",
        );
    return index;
}

export function topicInputFingerprint(
    sources: TopicSourceReference[],
    indexGeneration: string | undefined,
    suppressions: SourceKnowledgeSuppression[],
    model: string,
    events: TopicEventReference[] = [],
): string {
    return viewHash({
        sources: [...sources].sort((a, b) =>
            a.sourceId.localeCompare(b.sourceId),
        ),
        indexGeneration: indexGeneration ?? null,
        suppressions,
        model,
        ...(events.length ? { events } : {}),
        recipe: "topics-v2:curated-v1:editorial-v1",
    });
}

function curationNodeInput({
    id,
    identity,
    label,
    scope,
    aliases,
    occurrenceIds,
    citations,
}: TopicNode) {
    return { id, identity, label, scope, aliases, occurrenceIds, citations };
}

type TopicCaptureOptions = {
    corpusId: string;
    actor: string;
    index: CorpusIndex;
    sources: TopicSourceReference[];
    indexGeneration?: string;
    suppressions: SourceKnowledgeSuppression[];
    model: string;
    curationRecipe?: string;
    topicCurationReuse?: boolean;
    topicWatermark?: boolean;
    continuation?: TopicSnapshot;
    current?: TopicSnapshot;
    eventOccurrences?: TopicOccurrence[];
    influenceEvents?: TopicEventReference[];
};

export function topicSourceClosurePreserved(
    previous: Pick<TopicSnapshot, "influenceSources" | "influenceEvents">,
    sources: TopicSourceReference[],
    events: TopicEventReference[],
): boolean {
    const active = new Map(sources.map((source) => [source.sourceId, source]));
    return (
        previous.influenceSources.every((source) => {
            const current = active.get(source.sourceId);
            return (
                current !== undefined && viewHash(source) === viewHash(current)
            );
        }) && viewHash(previous.influenceEvents ?? []) === viewHash(events)
    );
}

function reusableTopicPackets(
    options: TopicCaptureOptions,
    occurrences: TopicOccurrence[],
    nodes: TopicNode[],
) {
    const previous = options.continuation ?? options.current;
    if (
        !options.topicWatermark ||
        !previous?.curationPackets ||
        !previous.curationInputFingerprint ||
        previous.corpusId !== options.corpusId ||
        previous.recipe !==
            `${options.model}:editorial-v1:${options.curationRecipe ?? topicCurationPolicy(true)}` ||
        previous.curationSuppressionFingerprint !==
            viewHash(options.suppressions) ||
        !topicSourceClosurePreserved(
            previous,
            options.sources,
            options.influenceEvents ?? [],
        ) ||
        !previous.nodes.every((node) => node.authorship === "generated") ||
        options.current?.nodes.some(
            (node) => node.authorship !== "generated",
        ) ||
        !nodes.every((node) => node.authorship === "generated")
    )
        return undefined;
    const previousSources = new Set(
        previous.influenceSources.map((source) => source.sourceId),
    );
    const currentNodes = new Map(nodes.map((node) => [node.id, node]));
    if (
        viewHash(previous.occurrences) !==
            viewHash(
                occurrences.filter((occurrence) =>
                    previousSources.has(occurrence.sourceId),
                ),
            ) ||
        previous.nodes.some(
            (node) =>
                viewHash(curationNodeInput(node)) !==
                viewHash(
                    currentNodes.has(node.id)
                        ? curationNodeInput(currentNodes.get(node.id)!)
                        : null,
                ),
        )
    )
        return undefined;
    validateTopicSnapshot(previous);
    return structuredClone(previous.curationPackets);
}

function curationDependencyFingerprint(
    options: TopicCaptureOptions,
    occurrences: TopicOccurrence[],
): string | undefined {
    if (!options.topicCurationReuse) return undefined;
    const representedSources = new Set(
        occurrences.map((occurrence) => occurrence.sourceId),
    );
    return viewHash({
        recipe: "topic-curation-input-v1",
        corpusId: options.corpusId,
        sources: options.sources
            .filter((source) => representedSources.has(source.sourceId))
            .sort((a, b) => a.sourceId.localeCompare(b.sourceId)),
        occurrences,
        suppressions: options.suppressions,
        model: options.model,
        curationRecipe: options.curationRecipe ?? topicCurationPolicy(true),
        events: options.influenceEvents ?? [],
    });
}

function reusableTopicCuration(
    options: TopicCaptureOptions,
    occurrences: TopicOccurrence[],
    nodes: TopicNode[],
    fingerprint: string,
    curationInputFingerprint: string | undefined,
) {
    const { current, corpusId, model } = options;
    if (
        !current ||
        current.corpusId !== corpusId ||
        current.recipe !==
            `${model}:editorial-v1:${options.curationRecipe ?? topicCurationPolicy(true)}` ||
        viewHash(current.occurrences) !== viewHash(occurrences) ||
        !current.nodes.every((node) => node.authorship === "generated")
    )
        return undefined;
    const samePhysicalInput = current.inputFingerprint === fingerprint;
    const sameSemanticInput =
        curationInputFingerprint !== undefined &&
        current.curationInputFingerprint === curationInputFingerprint &&
        viewHash(current.nodes.map(curationNodeInput)) ===
            viewHash(nodes.map(curationNodeInput));
    if (!samePhysicalInput && !sameSemanticInput) return undefined;
    const reusable = current.curation ?? current.curationProgress;
    if (!reusable) return undefined;
    const curation = structuredClone(reusable);
    if (!samePhysicalInput) {
        validateTopicSnapshot(current);
        const rebound = { ...current, inputFingerprint: fingerprint };
        // Cluster receipts bind physical input identity as well as evidence.
        // Validate the old receipt before rebinding unchanged semantic support.
        for (const concept of curation.concepts) {
            if (concept.validation) {
                concept.validation.inputFingerprint = fingerprint;
                concept.validation.signature = topicClusterSignature(
                    rebound,
                    concept,
                    concept.validation.modelIdentity,
                );
            }
            if (concept.maintenance)
                concept.maintenance.signature = topicMaintenanceSignature(
                    rebound,
                    concept,
                );
        }
    }
    return curation;
}

function captureCurationState(
    options: TopicCaptureOptions,
    occurrences: TopicOccurrence[],
    nodes: TopicNode[],
    fingerprint: string,
) {
    const { current } = options;
    const curationInputFingerprint = curationDependencyFingerprint(
        options,
        occurrences,
    );
    let curation = reusableTopicCuration(
        options.topicWatermark &&
            options.continuation &&
            (current?.nodes.every((node) => node.authorship === "generated") ??
                true)
            ? { ...options, current: options.continuation }
            : options,
        occurrences,
        nodes,
        fingerprint,
        curationInputFingerprint,
    );
    const packets = reusableTopicPackets(options, occurrences, nodes);
    if (options.topicWatermark && curation) {
        const processed =
            curation.concepts.reduce(
                (count, concept) => count + concept.memberIds.length,
                0,
            ) + curation.deferred.length;
        if ((packets?.at(-1)?.end ?? 0) !== processed) curation = undefined;
    }
    recordSearchTiming("topic.capture.curation-reuse", 0, {
        reused: curation !== undefined,
        rebound:
            curation !== undefined && current?.inputFingerprint !== fingerprint,
        concepts: curation?.concepts.length ?? 0,
        deferred: curation?.deferred.length ?? 0,
        pending: curation?.pending?.length ?? 0,
        fingerprint: curationInputFingerprint,
    });
    return {
        ...(curation ? { reusableCuration: curation } : {}),
        ...(curationInputFingerprint ? { curationInputFingerprint } : {}),
        ...(options.topicWatermark
            ? {
                  packetReplay: true,
                  suppressionFingerprint: viewHash(options.suppressions),
              }
            : {}),
        ...(packets ? { reusableCurationPackets: packets } : {}),
    };
}

export async function captureTopicBuild(
    options: TopicCaptureOptions,
): Promise<ViewBuildSnapshot> {
    const {
        corpusId,
        actor,
        sources,
        indexGeneration,
        suppressions,
        model,
        current,
    } = options;
    const active = new Map(
        sources.map((source) => [source.sourceId, source.revisionId]),
    );
    const documentOccurrences = (
        await requireTopicIndex(options.index).getTopicOccurrences(
            new Set(active.keys()),
        )
    ).filter(
        (occurrence) =>
            active.get(occurrence.sourceId) === occurrence.revisionId &&
            !suppressions.some(
                (entry) =>
                    entry.kind === "topic" &&
                    entry.sourceId === occurrence.sourceId &&
                    entry.name.trim().toLocaleLowerCase() ===
                        occurrence.label.trim().toLocaleLowerCase(),
            ),
    );
    const occurrences = [
        ...documentOccurrences,
        ...(options.eventOccurrences ?? []),
    ];
    const nodes = initialTopicNodes(corpusId, occurrences);
    const fingerprint = topicInputFingerprint(
        sources,
        indexGeneration,
        suppressions,
        model,
        options.influenceEvents,
    );
    const curationState = captureCurationState(
        options,
        occurrences,
        nodes,
        fingerprint,
    );
    const reusableSummaries =
        current?.corpusId === corpusId &&
        current.recipe === `${model}:editorial-v1`
            ? current.nodes
                  .filter((node) => {
                      const next = nodes.find((entry) => entry.id === node.id);
                      if (!next || node.summaryState !== "ready") return false;
                      const original = current.occurrences.filter((entry) =>
                          node.occurrenceIds.includes(entry.id),
                      );
                      const captured = occurrences.filter((entry) =>
                          next.occurrenceIds.includes(entry.id),
                      );
                      if (viewHash(original) !== viewHash(captured))
                          return false;
                      // Summaries can use qualifications from other topics in the
                      // same source revision, not only their own cited fragments.
                      const revisions = new Set(
                          captured.map(
                              (entry) =>
                                  `${entry.sourceId}\n${entry.revisionId}`,
                          ),
                      );
                      const context = (entries: typeof occurrences) =>
                          entries.filter((entry) =>
                              revisions.has(
                                  `${entry.sourceId}\n${entry.revisionId}`,
                              ),
                          );
                      return (
                          viewHash(context(current.occurrences)) ===
                          viewHash(context(occurrences))
                      );
                  })
                  .map(({ id, summary, citations, limits }) => ({
                      id,
                      summary,
                      citations,
                      limits,
                  }))
            : [];
    return {
        corpusId,
        actor,
        definition: {
            viewId: "topic-snapshot",
            kind: "wiki",
            selector: { kind: "sources", sources: [] },
            wiki: {
                construction: "informational-wiki-v1",
                query: "Complete topic incidence",
                aliases: [],
                excludedSourceIds: [],
            },
        },
        expectedVersion: current ? 1 : 0,
        ...(current ? { targetRevisionId: current.generation } : {}),
        bounds: {},
        inputs: [],
        influenceSources: sources,
        ...(options.influenceEvents?.length
            ? { influenceEvents: options.influenceEvents }
            : {}),
        pipeline: "topics-v1",
        model,
        fingerprint,
        topicInput: {
            occurrences,
            ...(indexGeneration ? { indexGeneration } : {}),
            reusableSummaries,
            ...curationState,
            authoredLabels: (current?.nodes ?? [])
                .filter((node) => node.authorship === "human")
                .map(({ id, label, aliases }) => ({ id, label, aliases })),
        },
    };
}

export function reconcileTopicFamily(
    family: TopicFamilyState,
    indexGeneration: string | undefined,
    currentFingerprint?: string,
    expectedFingerprint?: string,
): TopicFamilyState {
    if (
        family.indexGeneration === indexGeneration &&
        (expectedFingerprint === undefined ||
            currentFingerprint === expectedFingerprint)
    )
        return family;
    return {
        enabled: family.enabled,
        dirty: true,
        ...(family.indexGeneration
            ? { indexGeneration: family.indexGeneration }
            : {}),
    };
}
