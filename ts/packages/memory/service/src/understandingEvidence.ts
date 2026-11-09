// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    parseTemporalValue,
    temporalContextFromHeaders,
    type TemporalValue,
} from "@typeagent/knowpro";
import type { AnswerEvidence } from "./types.js";
import type {
    UnderstandingCandidates,
    UnderstandingCitation,
    UnderstandingDate,
    UnderstandingHost,
    UnderstandingModule,
    UnderstandingReaderResult,
    UnderstandingRequest,
} from "./understandingTypes.js";

export function understandingCitations(
    evidence: AnswerEvidence[],
): UnderstandingCitation[] {
    return evidence.map((item): UnderstandingCitation => {
        if (item.kind === "source")
            return { id: item.id, kind: "source", source: item.source };
        if (item.kind === "derived")
            return { id: item.id, kind: "derived", reference: item.reference };
        return {
            id: item.id,
            kind: "userAssertion",
            reference: item.reference,
        };
    });
}

function sourceDates(item: AnswerEvidence): UnderstandingDate[] {
    if (item.kind !== "source") return [];
    const dates: UnderstandingDate[] = [];
    const add = (
        value: TemporalValue,
        kind: UnderstandingDate["kind"],
        label: string,
    ) =>
        dates.push({
            id: `date:${item.id}:${dates.length}`,
            evidenceId: item.id,
            date: value.instantUtc ?? value.localDateTime,
            precision: value.precision,
            kind,
            label: label.slice(0, 180),
        });
    const context = item.source.temporalContext;
    if (context?.messageTime)
        add(context.messageTime, "sourceSession", item.source.title);
    for (const mention of context?.eventMentions ?? [])
        if (mention.resolution === "resolved" && mention.value)
            add(mention.value, "event", mention.text);
    for (const found of context?.discoveredDateEvidence ?? [])
        if (found.role === "eventTime")
            add(found.value, "event", found.quote ?? found.value.raw);
    if (dates.length) return dates;
    const headers =
        temporalContextFromHeaders(item.source.snippet) ??
        temporalContextFromHeaders(item.source.title);
    for (const scope of headers?.scopes ?? []) {
        if (scope.messageTime)
            add(
                typeof scope.messageTime === "string"
                    ? parseTemporalValue(scope.messageTime)
                    : scope.messageTime,
                "sourceSession",
                item.source.title,
            );
    }
    return dates;
}

export function understandingDates(
    evidence: AnswerEvidence[],
    warnings: string[],
): UnderstandingDate[] {
    const seen = new Set<string>();
    return evidence
        .flatMap((item) => {
            try {
                return sourceDates(item);
            } catch (error) {
                warnings.push(
                    `Date metadata unavailable for ${item.id}: ${error instanceof Error ? error.message : String(error)}`,
                );
                return [];
            }
        })
        .filter((date) => {
            const key = JSON.stringify([
                date.evidenceId,
                date.date,
                date.kind,
                date.precision,
                date.label,
            ]);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .slice(0, 16);
}

export function wantsExplanation(request: UnderstandingRequest): boolean {
    return (
        request.selection?.mode !== "only" ||
        !!request.selection.modules?.includes("explanation")
    );
}

function wantsGraph(request: UnderstandingRequest): boolean {
    return (
        request.selection?.mode !== "only" ||
        !!request.selection.modules?.some(
            (kind) => kind === "relationships" || kind === "concepts",
        )
    );
}

export async function understandingCandidates(
    host: UnderstandingHost,
    request: UnderstandingRequest,
    evidence: AnswerEvidence[],
): Promise<UnderstandingCandidates> {
    const candidates: UnderstandingCandidates = {
        dates: [],
        entities: [],
        warnings: [],
    };
    candidates.dates = understandingDates(evidence, candidates.warnings);
    if (!wantsGraph(request) || !host.queryKnowledgeGraph) return candidates;
    try {
        if (request.focus) {
            if (!host.queryGraphSupport)
                throw new Error("Focused graph validation is unavailable");
            const page = await host.queryGraphSupport({
                corpusId: request.corpusId,
                generation: request.focus.generation,
                nodeId: request.focus.nodeId,
                pageSize: 1,
            });
            if (
                page.generation !== request.focus.generation ||
                !page.items.length
            )
                throw new Error("Focused graph identity changed; reload it");
        }
        const graph = await host.queryKnowledgeGraph({
            corpusId: request.corpusId,
            kind: "entities",
            ...(request.focus
                ? {
                      nodeId: request.focus.nodeId,
                  }
                : {}),
            maxNodes: 100,
            maxEdges: 1,
            evidenceKinds: ["document"],
        });
        if (graph.state !== "ready") {
            candidates.warnings.push(
                `Relationship inventory is ${graph.state}.`,
            );
            return candidates;
        }
        const question = request.question.toLocaleLowerCase();
        candidates.entities = graph.nodes
            .filter(
                (node) =>
                    node.id === request.focus?.nodeId ||
                    (node.label.length >= 3 &&
                        question.includes(node.label.toLocaleLowerCase())),
            )
            .slice(0, 6)
            .map((node, index) => ({
                id: `entity:${index}`,
                nodeId: node.id,
                label: node.label,
                generation: graph.generation,
            }));
    } catch (error) {
        candidates.warnings.push(
            `Relationship inventory unavailable: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
    return candidates;
}

export function understandingModules(
    request: UnderstandingRequest,
    result: UnderstandingReaderResult | undefined,
    candidates: UnderstandingCandidates,
): UnderstandingModule[] {
    const requested =
        request.selection?.mode === "only"
            ? (request.selection.modules ?? [])
            : undefined;
    const modules: UnderstandingModule[] = [];
    if (result) modules.push({ kind: "explanation", status: "ready" });
    if (!requested || requested.includes("sources"))
        modules.push({ kind: "sources", status: "ready" });
    for (const kind of ["timeline", "relationships", "concepts"] as const) {
        const signal = result?.moduleSignals.find((item) => item.kind === kind);
        if (requested ? !requested.includes(kind) : !signal) continue;
        const dates = candidates.dates.filter(
            (date) =>
                !signal ||
                (signal.candidateIds.includes(date.id) &&
                    signal.evidenceIds.includes(date.evidenceId)),
        );
        const eligible =
            kind === "timeline"
                ? new Set(dates.map((item) => item.date)).size >= 2
                : candidates.entities.some(
                      (item) =>
                          !signal || signal.candidateIds.includes(item.id),
                  );
        modules.push({
            kind,
            status: eligible ? "planned" : "unavailable",
            ...(!eligible
                ? {
                      reason:
                          kind === "timeline"
                              ? "No two distinct supported dates; capture/import timestamps are not events."
                              : "No matching existing graph identity in the bounded inventory.",
                  }
                : {}),
        });
    }
    return modules;
}
