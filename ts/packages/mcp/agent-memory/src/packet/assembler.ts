// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DomainError } from "../domain/index.js";
import {
    hashQuery,
    normalizeQuery,
    type EvaluatedQueryRecord,
    type QueryEvaluatorResult,
    type QueryIrV1,
} from "../query/index.js";
import type {
    PacketContinuationCodec,
    PacketContinuationState,
} from "./cursor.js";
import { renderFacetSummary, renderPacketRecord } from "./render.js";
import {
    ConservativeTokenEstimator,
    type TokenEstimator,
} from "./tokenEstimator.js";
import type {
    FacetSummaryTail,
    PacketReference,
    WorkingMemoryPacket,
} from "./types.js";

type PacketCandidate = {
    id: string;
    entityId: string;
    entityKind: PacketReference["entityKind"];
    revision: number;
    hitCount: number;
    quality: number;
    noveltyKeys: readonly string[];
    requiresId?: string;
    sequence?: number;
    render(citation: string): string;
};

export type AssemblePacketInput = {
    query: QueryIrV1;
    evaluation: QueryEvaluatorResult;
    summaries?: readonly FacetSummaryTail[];
    continuation?: string;
    repeatTopicBrief?: boolean;
};

export type WorkingMemoryPacketAssemblerOptions = {
    continuationCodec: PacketContinuationCodec;
    tokenEstimator?: TokenEstimator;
};

export class WorkingMemoryPacketAssembler {
    readonly #codec: PacketContinuationCodec;
    readonly #estimator: TokenEstimator;

    public constructor(options: WorkingMemoryPacketAssemblerOptions) {
        this.#codec = options.continuationCodec;
        this.#estimator =
            options.tokenEstimator ?? new ConservativeTokenEstimator();
    }

    public assemble(input: AssemblePacketInput): WorkingMemoryPacket {
        const query = normalizeQuery(input.query);
        const queryHash = hashQuery(query);
        if (
            input.evaluation.queryHash !== queryHash ||
            input.evaluation.indexVersion < 0
        ) {
            throw new DomainError(
                "INVALID_ARGUMENT",
                "Packet input does not match the evaluated query",
            );
        }
        const continuation = this.decodeContinuation(
            input.continuation,
            queryHash,
            input.evaluation.indexVersion,
        );
        const consumedIds = new Set(continuation?.consumedIds ?? []);
        const candidates = createCandidates(
            input.evaluation.records,
            input.summaries ?? [],
            query.detail,
        ).filter((candidate) => !consumedIds.has(candidate.id));
        const targetTokenBudget = Math.floor(query.tokenBudget * 0.9);
        const topicBriefRequested =
            query.topic !== undefined &&
            (input.repeatTopicBrief === true ||
                continuation?.topicBriefIncluded !== true);
        const requestedTopicBrief = topicBriefRequested
            ? `Context: ${query.topic!.rootPath} (${query.topic!.traversal})`
            : "";
        const topicBrief =
            this.#estimator.estimate(requestedTopicBrief) <= targetTokenBudget
                ? requestedTopicBrief
                : "";
        const selected: PacketCandidate[] = [];
        const rendered: string[] = [];
        const novelty = new Set<string>();
        let estimatedTokens =
            topicBrief === "" ? 0 : this.#estimator.estimate(topicBrief);

        while (true) {
            const fitting = candidates.filter((candidate) => {
                if (
                    consumedIds.has(candidate.id) ||
                    selected.some((item) => item.id === candidate.id) ||
                    (candidate.requiresId !== undefined &&
                        !consumedIds.has(candidate.requiresId) &&
                        !selected.some(
                            (item) => item.id === candidate.requiresId,
                        ))
                ) {
                    return false;
                }
                const text = candidate.render(`[m${selected.length + 1}]`);
                const prospective = [topicBrief, ...rendered, text]
                    .filter((section) => section.length > 0)
                    .join("\n\n");
                return (
                    this.#estimator.estimate(prospective) <= targetTokenBudget
                );
            });
            if (fitting.length === 0) {
                break;
            }
            const highestHitCount = Math.max(
                ...fitting.map((candidate) => candidate.hitCount),
            );
            const next = fitting
                .filter((candidate) => candidate.hitCount === highestHitCount)
                .sort((left, right) => {
                    if (
                        left.requiresId !== undefined &&
                        left.requiresId === right.requiresId &&
                        left.sequence !== undefined &&
                        right.sequence !== undefined &&
                        left.sequence !== right.sequence
                    ) {
                        return left.sequence - right.sequence;
                    }
                    const leftRatio =
                        utility(left, novelty) /
                        estimatedCost(left, this.#estimator);
                    const rightRatio =
                        utility(right, novelty) /
                        estimatedCost(right, this.#estimator);
                    return (
                        rightRatio - leftRatio ||
                        right.quality - left.quality ||
                        left.id.localeCompare(right.id)
                    );
                })[0]!;
            const citation = `[m${selected.length + 1}]`;
            const text = next.render(citation);
            selected.push(next);
            rendered.push(text);
            estimatedTokens = this.#estimator.estimate(
                [topicBrief, ...rendered]
                    .filter((section) => section.length > 0)
                    .join("\n\n"),
            );
            next.noveltyKeys.forEach((key) => novelty.add(key));
        }

        const omittedOversizedEntityIds: string[] = [];
        const selectedIds = new Set(selected.map((candidate) => candidate.id));
        const remaining = candidates.filter(
            (candidate) => !selectedIds.has(candidate.id),
        );
        if (
            selected.length === 0 &&
            remaining.length > 0 &&
            (topicBrief === "" ||
                continuation?.topicBriefIncluded === true ||
                input.repeatTopicBrief === true)
        ) {
            const oversized = remaining[0]!;
            consumedIds.add(oversized.id);
            omittedOversizedEntityIds.push(oversized.entityId);
            for (const dependent of remaining.filter(
                (candidate) => candidate.requiresId === oversized.id,
            )) {
                consumedIds.add(dependent.id);
                omittedOversizedEntityIds.push(dependent.entityId);
            }
        }
        selected.forEach((candidate) => consumedIds.add(candidate.id));
        const text = [topicBrief, ...rendered]
            .filter((section) => section.length > 0)
            .join("\n\n");
        estimatedTokens = this.#estimator.estimate(text);
        const hasRemaining = candidates.some(
            (candidate) => !consumedIds.has(candidate.id),
        );
        const truncated = hasRemaining;
        const references = selected.map((candidate, index) => ({
            citation: `[m${index + 1}]`,
            entityId: candidate.entityId,
            entityKind: candidate.entityKind,
            revision: candidate.revision,
        }));
        const topicBriefIncluded =
            continuation?.topicBriefIncluded === true || topicBriefRequested;
        const nextState: PacketContinuationState = {
            queryHash,
            indexVersion: input.evaluation.indexVersion,
            consumedIds: [...consumedIds],
            topicBriefIncluded,
        };
        return {
            text,
            references,
            queryHash,
            indexVersion: input.evaluation.indexVersion,
            estimatedTokens,
            requestedTokenBudget: query.tokenBudget,
            targetTokenBudget,
            truncated,
            resultLimitReached: input.evaluation.truncated,
            omittedOversizedEntityIds,
            ...(truncated
                ? { continuation: this.#codec.encode(nextState) }
                : {}),
        };
    }

    private decodeContinuation(
        cursor: string | undefined,
        queryHash: string,
        indexVersion: number,
    ): PacketContinuationState | undefined {
        if (cursor === undefined) {
            return undefined;
        }
        const state = this.#codec.decode(cursor);
        if (
            state.queryHash !== queryHash ||
            state.indexVersion !== indexVersion
        ) {
            throw new DomainError(
                "REVISION_CONFLICT",
                "Continuation does not match the query and search index",
            );
        }
        return state;
    }
}

function createCandidates(
    records: readonly EvaluatedQueryRecord[],
    summaries: readonly FacetSummaryTail[],
    detail: QueryIrV1["detail"],
): PacketCandidate[] {
    const recordsById = deduplicateRecords(records);
    const coveredIds = new Set<string>();
    const summaryCandidates: PacketCandidate[] = [];
    const tailRequirements = new Map<string, string>();
    for (const summary of summaries) {
        const summaryCandidateId = `summary:${summary.summaryId}`;
        summaryCandidates.push({
            id: summaryCandidateId,
            entityId: summary.summaryId,
            entityKind: "summary",
            revision: summary.sourceWatermark,
            hitCount: Number.MAX_SAFE_INTEGER,
            quality: 1,
            noveltyKeys: [`summary:${summary.facetKind}`],
            render: (citation) =>
                renderFacetSummary(
                    summary.facetKind,
                    summary.summary,
                    summary.sourceWatermark,
                    citation,
                ),
        });
        for (const record of summary.records) {
            const sequence = record.fields.sequence;
            if (!Number.isSafeInteger(sequence)) {
                throw new DomainError(
                    "INVALID_ARGUMENT",
                    "Summary-tail record requires an integer sequence field",
                    { entityId: record.entityId },
                );
            }
            if ((sequence as number) <= summary.sourceWatermark) {
                coveredIds.add(record.entityId);
            } else {
                recordsById.set(record.entityId, record);
                tailRequirements.set(record.entityId, summaryCandidateId);
            }
        }
    }
    const recordCandidates = [...recordsById.values()]
        .filter((record) => !coveredIds.has(record.entityId))
        .map(
            (record): PacketCandidate => ({
                id: `record:${record.entityId}`,
                entityId: record.entityId,
                entityKind: record.entityKind,
                revision: record.revision,
                hitCount: tailRequirements.has(record.entityId)
                    ? Number.MAX_SAFE_INTEGER - 1
                    : record.hitCount,
                quality: record.quality,
                noveltyKeys: [
                    `kind:${record.entityKind}`,
                    ...record.evidence.map((item) => `clause:${item.clauseId}`),
                ],
                ...(tailRequirements.has(record.entityId)
                    ? {
                          requiresId: tailRequirements.get(record.entityId)!,
                          sequence: record.fields.sequence as number,
                      }
                    : {}),
                render: (citation) =>
                    renderPacketRecord(record, detail, citation),
            }),
        );
    return [...summaryCandidates, ...recordCandidates];
}

function deduplicateRecords(
    records: readonly EvaluatedQueryRecord[],
): Map<string, EvaluatedQueryRecord> {
    const recordsById = new Map<string, EvaluatedQueryRecord>();
    for (const record of records) {
        const existing = recordsById.get(record.entityId);
        if (
            existing === undefined ||
            record.revision > existing.revision ||
            (record.revision === existing.revision &&
                (record.hitCount > existing.hitCount ||
                    (record.hitCount === existing.hitCount &&
                        record.quality > existing.quality)))
        ) {
            recordsById.set(record.entityId, record);
        }
    }
    return recordsById;
}

function utility(
    candidate: PacketCandidate,
    novelty: ReadonlySet<string>,
): number {
    const novelEvidence = candidate.noveltyKeys.filter(
        (key) => !novelty.has(key),
    ).length;
    return 1 + candidate.quality + novelEvidence * 2;
}

function estimatedCost(
    candidate: PacketCandidate,
    estimator: TokenEstimator,
): number {
    return Math.max(1, estimator.estimate(candidate.render("[m100]")));
}
