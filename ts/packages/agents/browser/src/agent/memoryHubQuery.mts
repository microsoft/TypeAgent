// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    conversationCorpusName,
    conversationProducerId,
    type MemoryService,
    type PersonalHowToService,
    type MemoryEvent,
    type ProcedureSearchMatch,
} from "@typeagent/memory-service";
import type {
    MemoryHubAnswer,
    MemoryHubEvidence,
    MemoryHubEvidenceContent,
    MemoryHubEvidenceRequest,
    MemoryHubFunctions,
    MemoryHubSearchRequest,
    MemoryHubSearchResult,
} from "@typeagent/browser-control-rpc/viewRpc";
import type { MemoryCenterCorpus } from "@typeagent/browser-control-rpc/serviceTypes";
import { z } from "zod";
import { loadMemoryHubCorpora, mapMemoryHubCorpora } from "./memoryHub.mjs";
import { timed } from "./memoryHubQuerySupport.mjs";
import { memoryHubSearchInsights } from "./memoryHubSearchInsights.mjs";
export { timed } from "./memoryHubQuerySupport.mjs";

export type MemoryHubReadService = MemoryService &
    Partial<PersonalHowToService>;
export type MemoryHubSynthesizer = (
    question: string,
    evidence: MemoryHubEvidence[],
) => Promise<MemoryHubAnswer>;

function message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export async function queryCorpora(
    service: MemoryHubReadService,
    corpusId?: string,
) {
    return timed(
        loadMemoryHubCorpora(
            { memoryListCorpora: () => service.listCorpora() },
            corpusId,
        ),
    );
}

function validateRequest(request: MemoryHubSearchRequest): void {
    if (!request.query.trim())
        throw new Error("Memory search query cannot be empty.");
    if (
        request.limit !== undefined &&
        (!Number.isInteger(request.limit) ||
            request.limit < 1 ||
            request.limit > 100)
    )
        throw new Error("Memory search limit must be between 1 and 100.");
    for (const date of [request.dateFrom, request.dateTo])
        if (
            date !== undefined &&
            (!z.iso.datetime({ offset: true }).safeParse(date).success ||
                !Number.isFinite(Date.parse(date)))
        )
            throw new Error("Invalid Memory search date.");
    if (
        request.dateFrom &&
        request.dateTo &&
        Date.parse(request.dateFrom) > Date.parse(request.dateTo)
    )
        throw new Error("Memory search date range is reversed.");
}

function inDateRange(
    date: string | undefined,
    request: MemoryHubSearchRequest,
): boolean {
    if (!request.dateFrom && !request.dateTo) return true;
    if (!date || !Number.isFinite(Date.parse(date))) return false;
    const time = Date.parse(date);
    return (
        (!request.dateFrom || time >= Date.parse(request.dateFrom)) &&
        (!request.dateTo || time <= Date.parse(request.dateTo))
    );
}

async function procedureMatchesFilters(
    service: MemoryHubReadService,
    corpusId: string,
    match: ProcedureSearchMatch,
    request: MemoryHubSearchRequest,
    deadline: number,
): Promise<boolean> {
    if (!inDateRange(match.version.createdAt, request)) return false;
    if (!request.sourceTypes?.length && !request.tags?.length) return true;
    for (const citation of match.version.document.citations) {
        const remaining = deadline - Date.now();
        if (remaining <= 0)
            throw new Error(
                "Procedure filter deadline exceeded; the underlying read may still finish.",
            );
        const source = await timed(
            service.getSource(corpusId, citation.sourceId),
            remaining,
        );
        if (
            source &&
            (!request.sourceTypes?.length ||
                request.sourceTypes.includes(source.sourceType)) &&
            (!request.tags?.length ||
                request.tags.every((tag) => source.tags?.includes(tag)))
        )
            return true;
    }
    return false;
}

async function documentResults(
    service: MemoryHubReadService,
    corpus: MemoryCenterCorpus,
    request: MemoryHubSearchRequest,
    result: MemoryHubSearchResult,
): Promise<MemoryHubEvidence[]> {
    const searched = await timed(
        service.search({
            corpusId: corpus.corpusId,
            query: request.query,
            limit: 100,
            maxResponseChars: 100_000,
            ...(request.sourceTypes === undefined
                ? {}
                : { sourceTypes: request.sourceTypes }),
            ...(request.tags === undefined ? {} : { tags: request.tags }),
            ...(request.dateFrom === undefined
                ? {}
                : { dateFrom: request.dateFrom }),
            ...(request.dateTo === undefined ? {} : { dateTo: request.dateTo }),
        }),
    );
    result.warnings.push(
        ...searched.warnings.map((warning) => `${corpus.name}: ${warning}`),
    );
    return searched.matches.map((evidence, index) => ({
        id: JSON.stringify([
            "source",
            corpus.corpusId,
            evidence.sourceId,
            evidence.revisionId,
            evidence.locator ?? evidence.evidenceId,
        ]),
        kind: "source",
        corpusId: corpus.corpusId,
        corpusName: corpus.name,
        objectId: evidence.sourceId,
        title: evidence.title,
        snippet: evidence.snippet,
        score: evidence.score,
        rank: index + 1,
        sourceId: evidence.sourceId,
        revisionId: evidence.revisionId,
        sourceType: evidence.sourceType,
        ...(evidence.locator === undefined
            ? {}
            : { locator: evidence.locator }),
        ...(evidence.canonicalUri === undefined
            ? {}
            : { canonicalUri: evidence.canonicalUri }),
        ...(evidence.capturedAt === undefined
            ? {}
            : { eventTime: evidence.capturedAt }),
    }));
}

async function procedureResults(
    service: MemoryHubReadService,
    corpus: MemoryCenterCorpus,
    request: MemoryHubSearchRequest,
): Promise<MemoryHubEvidence[]> {
    if (!service.searchProcedures)
        throw new Error("Procedure retrieval is unavailable in this host.");
    const deadline = Date.now() + 30_000;
    const matches = await timed(
        service.searchProcedures({
            corpusId: corpus.corpusId,
            query: request.query,
            states: ["saved", "stale"],
            limit: 100,
        }),
    );
    const result: MemoryHubEvidence[] = [];
    for (const match of matches) {
        if (
            !(await procedureMatchesFilters(
                service,
                corpus.corpusId,
                match,
                request,
                deadline,
            ))
        )
            continue;
        result.push({
            id: JSON.stringify([
                "procedure",
                corpus.corpusId,
                match.procedure.procedureId,
                match.version.version,
            ]),
            kind: "procedure",
            corpusId: corpus.corpusId,
            corpusName: corpus.name,
            objectId: match.procedure.procedureId,
            title: match.procedure.title,
            snippet: match.version.markdown.slice(0, 4_000),
            score: match.score,
            rank: result.length + 1,
            procedureVersion: match.version.version,
            procedureState: match.procedure.state,
        });
    }
    return result;
}

async function conversationResults(
    service: MemoryHubReadService,
    corpus: MemoryCenterCorpus,
    request: MemoryHubSearchRequest,
    conversationId: string | undefined,
): Promise<MemoryHubEvidence[]> {
    if (
        request.conversationScope === "none" ||
        request.sourceTypes?.length ||
        request.tags?.length
    )
        return [];
    if (request.conversationScope === "current" && !conversationId)
        throw new Error(
            "The host has not provided the current conversation identity.",
        );
    const searched = await timed(
        service.searchEvents({
            corpusId: corpus.corpusId,
            query: request.query,
            limit: 100,
            producerIds: [conversationProducerId],
            sourceKinds: ["conversation"],
            ...(request.conversationScope === "current" && conversationId
                ? { conversationIds: [conversationId] }
                : {}),
            ...(request.dateFrom === undefined
                ? {}
                : { eventFrom: request.dateFrom }),
            ...(request.dateTo === undefined
                ? {}
                : { eventTo: request.dateTo }),
        }),
    );
    return searched.matches.map(({ event, snippet, score }, index) => ({
        id: JSON.stringify(["conversation", corpus.corpusId, event.eventId]),
        kind: "conversation",
        corpusId: corpus.corpusId,
        corpusName: corpus.name,
        objectId: event.eventId,
        title: `${event.eventType} · ${event.eventTime}`,
        snippet,
        score,
        rank: index + 1,
        ...(event.conversationId === undefined
            ? {}
            : { conversationId: event.conversationId }),
        ...(event.turnId === undefined ? {} : { turnId: event.turnId }),
        eventTime: event.eventTime,
        authoritative:
            event.metadata?.authority === "verified-observation" ||
            event.metadata?.authority === "explicit",
    }));
}

export function fuseEvidence(
    lists: MemoryHubEvidence[][],
    limit: number,
): MemoryHubEvidence[] {
    const fused = new Map<
        string,
        { evidence: MemoryHubEvidence; fusedScore: number }
    >();
    for (const list of lists) {
        const seen = new Set<string>();
        for (const item of list) {
            if (seen.has(item.id)) continue;
            seen.add(item.id);
            if (!Number.isFinite(item.score))
                throw new Error(
                    "Memory retrieval returned a non-finite score.",
                );
            const previous = fused.get(item.id);
            const score = 1 / (60 + item.rank);
            if (previous) previous.fusedScore += score;
            else fused.set(item.id, { evidence: item, fusedScore: score });
        }
    }
    return [...fused.values()]
        .sort(
            (a, b) =>
                b.fusedScore - a.fusedScore ||
                a.evidence.id.localeCompare(b.evidence.id),
        )
        .slice(0, limit)
        .map(({ evidence }) => evidence);
}

async function collectResults(
    service: MemoryHubReadService,
    corpora: MemoryCenterCorpus[],
    request: MemoryHubSearchRequest,
    result: MemoryHubSearchResult,
    conversationId: string | undefined,
): Promise<MemoryHubEvidence[][]> {
    const lists: MemoryHubEvidence[][] = [];
    const collect = async (
        corpus: MemoryCenterCorpus,
        operation: "search" | "procedures" | "conversations",
        work: () => Promise<MemoryHubEvidence[]>,
    ) => {
        try {
            const list = await work();
            if (list.some((item) => !Number.isFinite(item.score)))
                throw new Error(
                    "Memory retrieval returned a non-finite score.",
                );
            lists.push(list);
        } catch (error) {
            result.errors.push({
                corpusId: corpus.corpusId,
                operation,
                message: message(error),
            });
        }
    };
    await mapMemoryHubCorpora(corpora, async (corpus) => {
        if (corpus.name === conversationCorpusName) {
            await collect(corpus, "conversations", () =>
                conversationResults(service, corpus, request, conversationId),
            );
        } else {
            await Promise.all([
                collect(corpus, "search", () =>
                    documentResults(service, corpus, request, result),
                ),
                collect(corpus, "procedures", () =>
                    procedureResults(service, corpus, request),
                ),
            ]);
        }
    });
    return lists;
}

function pageText(
    title: string,
    text: string,
    request: MemoryHubEvidenceRequest,
    provenance: MemoryHubEvidenceContent["provenance"],
): MemoryHubEvidenceContent {
    const offset = request.offset ?? 0;
    if (!Number.isInteger(offset) || offset < 0 || offset > text.length)
        throw new Error("Invalid evidence content offset.");
    const content = text.slice(offset, offset + 12_000);
    const next = offset + content.length;
    return {
        title,
        content,
        offset,
        totalChars: text.length,
        ...(next < text.length ? { nextOffset: next } : {}),
        provenance,
    };
}

function validateConversation(event: MemoryEvent | undefined): MemoryEvent {
    if (
        !event ||
        event.sourceKind !== "conversation" ||
        event.producer.producerId !== conversationProducerId
    )
        throw new Error("Conversation evidence is no longer available.");
    return event;
}

async function evidenceContent(
    service: MemoryHubReadService,
    request: MemoryHubEvidenceRequest,
): Promise<MemoryHubEvidenceContent> {
    await queryCorpora(service, request.corpusId);
    if (request.kind === "source") {
        const source = await timed(
            service.getSource(request.corpusId, request.objectId),
        );
        if (!source) throw new Error("Cited source is no longer available.");
        const content = await timed(
            service.getSourceContent({
                corpusId: request.corpusId,
                sourceId: request.objectId,
                ...(request.revisionId === undefined
                    ? {}
                    : { revisionId: request.revisionId }),
                ...(request.offset === undefined
                    ? {}
                    : { offset: request.offset }),
                maxChars: 12_000,
            }),
        );
        return {
            title: source.title,
            content: content.content,
            offset: content.offset,
            totalChars: content.totalChars,
            ...(content.truncated
                ? { nextOffset: content.offset + content.content.length }
                : {}),
            provenance: { ...request, revisionId: content.revisionId },
        };
    }
    if (request.kind === "procedure") {
        if (!service.getProcedure)
            throw new Error("Procedure evidence is unavailable.");
        const version = await timed(
            service.getProcedure(
                request.corpusId,
                request.objectId,
                request.procedureVersion,
            ),
        );
        if (!version)
            throw new Error("Cited procedure version is no longer available.");
        return pageText(version.document.title, version.markdown, request, {
            ...request,
            procedureVersion: version.version,
        });
    }
    const event = validateConversation(
        await timed(service.getEvent(request.corpusId, request.objectId)),
    );
    return pageText(
        `${event.eventType} · ${event.eventTime}`,
        event.content ?? "",
        request,
        {
            ...request,
            ...(event.conversationId === undefined
                ? {}
                : { conversationId: event.conversationId }),
            ...(event.turnId === undefined ? {} : { turnId: event.turnId }),
        },
    );
}

export function createMemoryHubQueryFunctions(
    getService: () => MemoryHubReadService,
    getConversationId: () => string | undefined,
    synthesize: MemoryHubSynthesizer,
): Pick<MemoryHubFunctions, "memoryHubSearch" | "memoryHubEvidence"> {
    return {
        async memoryHubSearch(request) {
            validateRequest(request);
            const service = getService();
            const corpora = await queryCorpora(service, request.corpusId);
            const result: MemoryHubSearchResult = {
                query: request.query.trim(),
                matches: [],
                ranking: "reciprocal-rank-fusion",
                warnings: [],
                errors: [],
            };
            result.matches = fuseEvidence(
                await collectResults(
                    service,
                    corpora,
                    request,
                    result,
                    getConversationId(),
                ),
                request.limit ?? 30,
            );
            result.insights = await memoryHubSearchInsights(
                service,
                request,
                result.matches,
            );
            result.errors.sort(
                (a, b) =>
                    a.corpusId.localeCompare(b.corpusId) ||
                    a.operation.localeCompare(b.operation),
            );
            result.warnings = [...new Set(result.warnings)].sort();
            result.warnings.push(
                "Results are a bounded evidence selection, not complete corpus totals. Procedure retrieval is limited to 100 candidates per corpus.",
            );
            if (request.generateAnswer && result.matches.length) {
                result.warnings.push(
                    "Answer context uses at most 20 evidence records, 800 characters per excerpt and 32,000 characters overall. Open cited evidence to inspect the original.",
                );
                try {
                    result.answer = await timed(
                        synthesize(result.query, result.matches),
                    );
                    const ids = new Set(result.matches.map((item) => item.id));
                    if (
                        (result.answer.status !== "noAnswer" &&
                            !result.answer.citationIds.length) ||
                        result.answer.citationIds.some((id) => !ids.has(id))
                    ) {
                        delete result.answer;
                        throw new Error(
                            "Answer generation returned unsupported citations.",
                        );
                    }
                } catch (error) {
                    result.errors.push({
                        corpusId: "*",
                        operation: "answer",
                        message: message(error),
                    });
                }
            }
            return result;
        },
        memoryHubEvidence: (request) => evidenceContent(getService(), request),
    };
}
