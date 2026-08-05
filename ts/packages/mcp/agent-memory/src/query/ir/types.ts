// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export const queryIrVersion = 1 as const;

export type QueryEntityKind =
    | "topic"
    | "turn"
    | "action"
    | "term"
    | "artifact"
    | "artifactChange"
    | "goal"
    | "designNote"
    | "output"
    | "property"
    | "memory";

export type RetrievalChannel =
    | "lexical"
    | "topic"
    | "term"
    | "artifact"
    | "facet";

export type MatchExpression = {
    type: "match";
    clauseId: string;
    text: string;
    channels?: readonly RetrievalChannel[];
};

export type QueryScalar = string | number | boolean;

export type FilterExpression = {
    type: "filter";
    field: string;
    operator: "equals" | "in" | "exists" | "prefix";
    value?: QueryScalar | readonly QueryScalar[];
};

export type AndExpression = {
    type: "and";
    children: readonly QueryExpression[];
};

export type OrExpression = {
    type: "or";
    children: readonly QueryExpression[];
};

export type SoftAndExpression = {
    type: "softAnd";
    children: readonly QueryExpression[];
    minimumShouldMatch?: number;
};

export type NotExpression = {
    type: "not";
    child: QueryExpression;
};

export type QueryExpression =
    | MatchExpression
    | FilterExpression
    | AndExpression
    | OrExpression
    | SoftAndExpression
    | NotExpression;

export type TopicSelector = {
    rootPath: string;
    traversal: "exact" | "children" | "descendants";
    roles?: readonly ("primary" | "secondary")[];
};

export type StructuralSource =
    | {
          type: "term";
          term: string;
      }
    | {
          type: "artifact";
          artifactId: string;
      }
    | {
          type: "turn";
          turnId: string;
      };

export type TemporalSelector =
    | {
          type: "during";
          start: string;
          end: string;
      }
    | {
          type: "asOf";
          instant: string;
      }
    | {
          type: "changedDuring";
          start: string;
          end: string;
          projection: "matchingEvents" | "endState";
      };

export type QueryInclude =
    | "topics"
    | "terms"
    | "actions"
    | "artifacts"
    | "goals"
    | "designNotes"
    | "outputs"
    | "properties"
    | "provenance"
    | "lineage";

export type QueryOrderField =
    | "hitCount"
    | "quality"
    | "occurredAt"
    | "recordedAt"
    | "entityId";

export type QueryOrder = {
    field: QueryOrderField;
    direction: "asc" | "desc";
};

export type ResolvedTimezone = {
    timeZone: string;
    utcOffsetMinutes: number;
    resolvedAt: string;
};

export type QueryContinuation = {
    queryHash: string;
    indexVersion: number;
    lastEntityId: string;
    sortValues: readonly QueryScalar[];
};

export type QueryIrV1 = {
    version: typeof queryIrVersion;
    scopeId: string;
    targetKinds: readonly QueryEntityKind[];
    expression: QueryExpression;
    source?: StructuralSource;
    topic?: TopicSelector;
    temporal?: TemporalSelector;
    include?: readonly QueryInclude[];
    projection?: readonly string[];
    orderBy?: readonly QueryOrder[];
    detail: "cards" | "snippets" | "full";
    tokenBudget: number;
    maxResults: number;
    timezone: ResolvedTimezone;
    continuation?: QueryContinuation;
};

export type NormalizedQueryIrV1 = QueryIrV1;

export type CandidateFieldValue =
    | QueryScalar
    | readonly QueryScalar[]
    | undefined;

export type QueryCandidate = {
    candidateId: string;
    clauseEvidence: Readonly<
        Record<string, number | readonly number[] | undefined>
    >;
    fields: Readonly<Record<string, CandidateFieldValue>>;
};

export type QueryEvaluation = {
    candidateId: string;
    matches: boolean;
    hitCount: number;
    quality: number;
};
