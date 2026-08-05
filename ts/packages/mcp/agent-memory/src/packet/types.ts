// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { EvaluatedQueryRecord, QueryEntityKind } from "../query/index.js";

export type PacketReference = {
    citation: string;
    entityId: string;
    entityKind: QueryEntityKind | "summary";
    revision: number;
};

export type FacetSummaryTail = {
    summaryId: string;
    topicId: string;
    facetKind: QueryEntityKind;
    summary: string;
    sourceWatermark: number;
    records: readonly EvaluatedQueryRecord[];
};

export type WorkingMemoryPacket = {
    text: string;
    references: readonly PacketReference[];
    queryHash: string;
    indexVersion: number;
    estimatedTokens: number;
    requestedTokenBudget: number;
    targetTokenBudget: number;
    truncated: boolean;
    resultLimitReached: boolean;
    omittedOversizedEntityIds: readonly string[];
    continuation?: string;
};
