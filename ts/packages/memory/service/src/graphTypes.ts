// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    MemoryEventFilter,
    MemoryEventAuthority,
    MemoryEventSender,
} from "./types.js";
import type { TopicNode } from "./topicTypes.js";

export type GraphReadState =
    | "ready"
    | "building"
    | "stale"
    | "error"
    | "unsupported";
export type GraphEvidenceKind = "document" | "event";
export interface KnowledgeGraphRequest {
    corpusId: string;
    kind: "entities" | "topics" | "hierarchy";
    nodeId?: string;
    search?: string;
    maxNodes?: number;
    maxEdges?: number;
    pageBy?: "nodes" | "edges";
    evidenceKinds?: GraphEvidenceKind[];
    eventFilter?: MemoryEventFilter;
    expectedGeneration?: string;
    continuationToken?: string;
}
export interface KnowledgeGraphNode {
    id: string;
    kind: "entity" | "topic";
    label: string;
    types: string[];
    mentionCount: number;
    supportCount: number;
    distinctEventCount?: number;
    distinctTurnCount?: number;
    scope?: string;
    topicId?: string;
    summaryState?: TopicNode["summaryState"];
}
export interface KnowledgeGraphEdge {
    id: string;
    source: string;
    target: string;
    type: string;
    label?: string;
    count: number;
    supportCount: number;
    distinctEventCount?: number;
    distinctTurnCount?: number;
}
export type GraphSupport =
    | {
          kind: "document";
          corpusId: string;
          sourceId: string;
          revisionId: string;
          title?: string;
          locator?: string;
      }
    | {
          kind: "event";
          corpusId: string;
          eventId: string;
          conversationId?: string;
          turnId?: string;
          eventTime: string;
          sender?: MemoryEventSender;
          authority?: MemoryEventAuthority;
          title?: string;
      };
export interface KnowledgeGraphCoverage {
    documents: {
        state: GraphReadState;
        total: number;
        eligible: number;
        indexed: number;
    };
    events: {
        state: GraphReadState;
        total: number;
        eligible: number;
        indexed: number;
    };
    topics?: { state: GraphReadState; generation?: string };
    reasons: string[];
}
export interface KnowledgeGraphResponse {
    corpusId: string;
    generation: string;
    state: GraphReadState;
    nodes: KnowledgeGraphNode[];
    edges: KnowledgeGraphEdge[];
    counts: {
        nodes: number;
        edges: number;
        omittedNodes: number;
        omittedEdges: number;
    };
    limits: { maxNodes: number; maxEdges: number; maxBytes?: number };
    coverage: KnowledgeGraphCoverage;
    nextContinuationToken?: string;
}
export interface GraphSupportRequest {
    corpusId: string;
    generation: string;
    nodeId?: string;
    edgeId?: string;
    pageSize?: number;
    continuationToken?: string;
}
export interface GraphSupportPage {
    items: GraphSupport[];
    total: number;
    nextContinuationToken?: string;
    generation: string;
}
export interface MemoryGraphService {
    queryKnowledgeGraph?(
        request: KnowledgeGraphRequest,
    ): Promise<KnowledgeGraphResponse>;
    queryGraphSupport?(request: GraphSupportRequest): Promise<GraphSupportPage>;
}
export type MemoryGraphQueryRequest = KnowledgeGraphRequest;
export type MemoryGraphQueryResult = KnowledgeGraphResponse;
export type MemoryGraphSupportRequest = GraphSupportRequest;
export type MemoryGraphSupportPage = GraphSupportPage;
export type MemoryGraphNode = KnowledgeGraphNode;
export type MemoryGraphEdge = KnowledgeGraphEdge;
export type MemoryGraphSupport = GraphSupport;
