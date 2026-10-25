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
} from "./topicTypes.js";
import type { ViewBuildSnapshot } from "./viewTypes.js";
import { viewHash } from "./viewMerge.js";
import { initialTopicNodes } from "./topicSnapshot.js";

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

export async function captureTopicBuild(options: {
    corpusId: string;
    actor: string;
    index: CorpusIndex;
    sources: TopicSourceReference[];
    indexGeneration?: string;
    suppressions: SourceKnowledgeSuppression[];
    model: string;
    current?: TopicSnapshot;
    eventOccurrences?: TopicOccurrence[];
    influenceEvents?: TopicEventReference[];
}): Promise<ViewBuildSnapshot> {
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
        fingerprint: topicInputFingerprint(
            sources,
            indexGeneration,
            suppressions,
            model,
            options.influenceEvents,
        ),
        topicInput: {
            occurrences,
            ...(indexGeneration ? { indexGeneration } : {}),
            reusableSummaries,
            authoredLabels: (current?.nodes ?? [])
                .filter((node) => node.authorship === "human")
                .map(({ id, label, aliases }) => ({ id, label, aliases })),
        },
    };
}

export function reconcileTopicFamily(
    family: TopicFamilyState,
    indexGeneration: string | undefined,
): TopicFamilyState {
    if (family.indexGeneration === indexGeneration) return family;
    return {
        enabled: family.enabled,
        dirty: true,
        ...(family.indexGeneration
            ? { indexGeneration: family.indexGeneration }
            : {}),
    };
}
