// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ViewBuildJob, ViewCitation } from "./viewTypes.js";

export interface MemoryTopicService {
    queryTopics(request: TopicQueryRequest): Promise<TopicQueryPage>;
    rebuildTopics(corpusId: string): Promise<ViewBuildJob>;
}

export interface TopicSourceReference {
    sourceId: string;
    revisionId: string;
    evidence?: { kind: "event"; eventId: string };
}
export interface TopicEventReference {
    eventId: string;
    fingerprint: string;
}
export interface TopicOccurrence extends TopicSourceReference {
    id: string;
    ordinal: number;
    label: string;
    scope: string;
    citations: ViewCitation[];
}
export interface TopicNode {
    id: string;
    identity: string;
    label: string;
    scope: string;
    aliases: Array<{ label: string; scope: string }>;
    occurrenceIds: string[];
    summary: string;
    summaryState: "pending" | "ready" | "failed";
    summaryAuthorship: "generated";
    citations: ViewCitation[];
    limits: string[];
    /** Label and alias authorship; generated summaries remain separately revisable. */
    authorship: "generated" | "human";
}
export interface TopicSnapshot {
    schemaVersion: 1;
    corpusId: string;
    generation: string;
    inputFingerprint: string;
    recipe: string;
    generatedAt: string;
    occurrences: TopicOccurrence[];
    influenceSources: TopicSourceReference[];
    influenceEvents?: TopicEventReference[];
    nodes: TopicNode[];
    parents: Array<{ parentId: string; childId: string }>;
    related: Array<{ fromId: string; toId: string; kind: "related" }>;
    limits: string[];
}
export interface TopicBuildInput {
    occurrences: TopicOccurrence[];
    authoredLabels?: Array<Pick<TopicNode, "id" | "label" | "aliases">>;
    reusableSummaries?: Array<
        Pick<TopicNode, "id" | "summary" | "citations" | "limits">
    >;
    indexGeneration?: string;
}
export interface TopicQueryRequest {
    corpusId: string;
    topicId?: string;
    search?: string;
    depth?: number;
    pageSize?: number;
    continuationToken?: string;
}
export interface TopicQueryPage {
    generation: string | null;
    nodes: TopicQueryNode[];
    parents: TopicSnapshot["parents"];
    related: TopicSnapshot["related"];
    neighborhoods: Array<{
        topicId: string;
        label: string;
        scope: string;
        sharedSources: number;
        score: number;
    }>;
    totalNodes: number;
    matchingNodes: number;
    omittedNodes: number;
    omittedParents: number;
    omittedRelated: number;
    omittedNeighborhoods: number;
    nextContinuationToken?: string;
    limits: string[];
    io: { stateBytes: number; snapshotBytes: number; elapsedMs: number };
}
export interface TopicQueryNode extends TopicNode {
    occurrenceCount: number;
    citationCount: number;
    omittedOccurrences: number;
    omittedCitations: number;
}
export interface TopicFamilyState {
    enabled: boolean;
    dirty: boolean;
    indexGeneration?: string;
    error?: string;
}
export interface TopicIndexReader {
    getTopicOccurrences(
        sourceIds: ReadonlySet<string>,
    ): Promise<TopicOccurrence[]>;
}
