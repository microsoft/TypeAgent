// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    QueryEntityKind,
    QueryScalar,
    RetrievalChannel,
} from "../ir/index.js";

export type QueryMatchEvidence = {
    clauseId: string;
    channels: readonly RetrievalChannel[];
    quality: number;
    references: readonly string[];
};

export type EvaluatedQueryRecord = {
    entityId: string;
    entityKind: QueryEntityKind;
    revision: number;
    title: string;
    content: string;
    occurredAt: string;
    recordedAt: string;
    hitCount: number;
    quality: number;
    fields: Readonly<
        Record<string, QueryScalar | readonly QueryScalar[] | undefined>
    >;
    evidence: readonly QueryMatchEvidence[];
    eventReferences: readonly string[];
};

export type QueryEvaluatorResult = {
    queryHash: string;
    indexVersion: number;
    records: readonly EvaluatedQueryRecord[];
    candidateCount: number;
    truncated: boolean;
};
