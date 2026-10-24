// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ChatModel } from "@typeagent/aiclient";
import {
    readIntegratedEvidence,
    serializeAnswerEvidence,
} from "./integratedAnswerReader.js";
import type {
    AnswerEvidence,
    AnswerSourceReference,
    AnswerViewEvidence,
    IntegratedAnswerDiagnostics,
    MemoryAnswerRequest,
    MemoryAnswerResult,
    MemoryEvidence,
    MemorySearchResult,
} from "./types.js";

export interface IntegratedAnswerHost {
    searchOriginal(request: MemoryAnswerRequest): Promise<MemorySearchResult>;
    /** Return ranked, access-scoped, current, publication-eligible matches only. */
    getEligibleViewMatches?(request: MemoryAnswerRequest): Promise<{
        matches: AnswerViewEvidence[];
        warnings?: string[];
        omittedCandidates?: number;
    }>;
    /** Read an exact retained original passage, never a view's cached excerpt. */
    expandSource(
        reference: AnswerSourceReference,
        request: MemoryAnswerRequest,
    ): Promise<MemoryEvidence | undefined>;
    /** Recheck source locators/revisions, view eligibility, assertion state and access. */
    validateEvidence(input: {
        request: MemoryAnswerRequest;
        evidence: AnswerEvidence[];
    }): Promise<boolean>;
}

export interface IntegratedAnswerOptions {
    outputTokens?: number;
    endpoint?: string;
    model?: ChatModel;
    maxEvidenceChars?: number;
    maxSourceFragments?: number;
    maxDerivedBlocks?: number;
    /** Ceiling for serialized messages plus structured-output schema, not just evidence. */
    maxRequestChars?: number;
}

interface EvidenceBudget {
    chars: number;
    sources: number;
    views: number;
}

function boundedLimit(value: number | undefined, maximum: number): number {
    if (value === undefined) return maximum;
    if (!Number.isFinite(value) || value < 0)
        throw new Error("Invalid integrated answer evidence budget");
    return Math.min(Math.floor(value), maximum);
}

function sourceKey(source: MemoryEvidence): string {
    return JSON.stringify([
        source.corpusId,
        source.sourceId,
        source.revisionId,
        source.locator ?? source.snippet,
    ]);
}

function sourceAllowed(
    source: MemoryEvidence,
    request: MemoryAnswerRequest,
): boolean {
    return (
        source.corpusId === request.corpusId &&
        (!request.sourceIds || request.sourceIds.includes(source.sourceId))
    );
}

function viewAllowed(
    view: AnswerViewEvidence,
    request: MemoryAnswerRequest,
): boolean {
    if (!request.sourceIds) return true;
    const allowed = new Set(request.sourceIds);
    return [
        ...view.influencingSourceIds,
        ...view.supportingSources.map((source) => source.sourceId),
        ...view.opposingSources.map((source) => source.sourceId),
    ].every((sourceId) => allowed.has(sourceId));
}

function exactSource(
    source: MemoryEvidence,
    reference: AnswerSourceReference,
    request: MemoryAnswerRequest,
): boolean {
    return (
        sourceAllowed(source, request) &&
        source.sourceId === reference.sourceId &&
        source.revisionId === reference.revisionId &&
        source.locator === reference.locator &&
        (!reference.evidenceId || source.evidenceId === reference.evidenceId)
    );
}

function sourceEnvelope(
    source: MemoryEvidence,
    ordinal: number,
): AnswerEvidence {
    return { kind: "source", id: `s${ordinal}`, source };
}

function fits(
    request: MemoryAnswerRequest,
    evidence: AnswerEvidence[],
    budget: EvidenceBudget,
): boolean {
    return (
        evidence.filter((item) => item.kind === "source").length <=
            budget.sources &&
        serializeAnswerEvidence(request, evidence).length <= budget.chars
    );
}

function viewKey(view: AnswerViewEvidence): string {
    // Identical interpretations of identical originals are not additional votes.
    return JSON.stringify([
        view.kind,
        view.reference.state,
        view.text,
        view.selectedValue,
        view.alternatives,
        [...view.influencingSourceIds].sort(),
        view.reference.contractVersion,
        view.reference.rubricVersion,
        view.supportingSources,
        view.opposingSources,
        ...(view.kind === "userAssertion" || view.reference.state !== "selected"
            ? [view.reference]
            : []),
    ]);
}

async function expandView(
    view: AnswerViewEvidence,
    request: MemoryAnswerRequest,
    host: IntegratedAnswerHost,
    cache: Map<string, Promise<MemoryEvidence | undefined>>,
): Promise<MemoryEvidence[] | undefined> {
    if (
        view.kind === "derived" &&
        view.reference.state === "selected" &&
        !view.supportingSources.length
    )
        return undefined;
    const sources: MemoryEvidence[] = [];
    for (const reference of [
        ...view.supportingSources,
        ...view.opposingSources,
    ]) {
        const key = JSON.stringify(reference);
        let pending = cache.get(key);
        if (!pending) {
            pending = host.expandSource(reference, request);
            cache.set(key, pending);
        }
        const source = await pending;
        if (!source || !exactSource(source, reference, request))
            return undefined;
        sources.push(source);
    }
    return sources;
}

function attachView(
    view: AnswerViewEvidence,
    expanded: MemoryEvidence[],
    current: AnswerEvidence[],
    ordinal: number,
): AnswerEvidence[] {
    const evidence = [...current];
    const ids = new Map(
        current.flatMap((item) =>
            item.kind === "source"
                ? [[sourceKey(item.source), item.id] as const]
                : [],
        ),
    );
    const expandedIds = expanded.map((source) => {
        const key = sourceKey(source);
        let id = ids.get(key);
        if (!id) {
            const item = sourceEnvelope(source, ids.size);
            id = item.id;
            ids.set(key, id);
            evidence.push(item);
        } else {
            const index = evidence.findIndex((item) => item.id === id);
            evidence[index] = { kind: "source", id, source };
        }
        return id;
    });
    evidence.push({
        ...view,
        id: `${view.kind === "derived" ? "d" : "a"}${ordinal}`,
        supportingEvidenceIds: [
            ...new Set(expandedIds.slice(0, view.supportingSources.length)),
        ],
        opposingEvidenceIds: [
            ...new Set(expandedIds.slice(view.supportingSources.length)),
        ],
    });
    return evidence;
}

function addDirectSources(
    request: MemoryAnswerRequest,
    direct: MemoryEvidence[],
    evidence: AnswerEvidence[],
    budget: EvidenceBudget,
    maxSourceChars: number = budget.chars,
): AnswerEvidence[] {
    const result = [...evidence];
    const keys = new Set(
        result.flatMap((item) =>
            item.kind === "source" ? [sourceKey(item.source)] : [],
        ),
    );
    for (const source of direct) {
        if (!sourceAllowed(source, request) || keys.has(sourceKey(source)))
            continue;
        const candidate = [...result, sourceEnvelope(source, keys.size)];
        const sourceChars = JSON.stringify(
            candidate.filter((item) => item.kind === "source"),
        ).length;
        if (sourceChars > maxSourceChars || !fits(request, candidate, budget))
            continue;
        keys.add(sourceKey(source));
        result.push(candidate[candidate.length - 1]);
    }
    return result;
}

async function assembleEvidence(
    request: MemoryAnswerRequest,
    host: IntegratedAnswerHost,
    direct: MemoryEvidence[],
    views: AnswerViewEvidence[],
    budget: EvidenceBudget,
    diagnostics: IntegratedAnswerDiagnostics,
): Promise<AnswerEvidence[]> {
    // Reserve half of the context for ranked direct originals before adding bundles.
    let evidence = addDirectSources(
        request,
        direct,
        [],
        {
            ...budget,
            sources: Math.ceil(budget.sources / 2),
        },
        Math.floor(budget.chars / 2),
    );
    const expansionCache = new Map<
        string,
        Promise<MemoryEvidence | undefined>
    >();
    const seen = new Set<string>();
    let selectedViews = 0;
    // Even a misbehaving host cannot cause unbounded source expansion.
    const candidates = views.slice(0, 32);
    diagnostics.omittedViewCandidates += Math.max(
        0,
        views.length - candidates.length,
    );
    for (const view of candidates) {
        if (
            selectedViews >= budget.views ||
            !viewAllowed(view, request) ||
            seen.has(viewKey(view))
        ) {
            diagnostics.omittedViewBlocks++;
            continue;
        }
        seen.add(viewKey(view));
        if (
            view.supportingSources.length + view.opposingSources.length >
            budget.sources
        ) {
            diagnostics.omittedViewBlocks++;
            continue;
        }
        let expanded: MemoryEvidence[] | undefined;
        try {
            expanded = await expandView(view, request, host, expansionCache);
        } catch (error) {
            if (request.retrievalPolicy === "sourcesAndViews") throw error;
            diagnostics.retrievalMode = "degraded";
            diagnostics.warnings.push(
                "Derived evidence expansion failed; its complete claim bundle was omitted.",
            );
        }
        if (!expanded) {
            diagnostics.omittedViewBlocks++;
            diagnostics.warnings.push(
                "A maintained-view claim was omitted because exact original support or opposition was unavailable.",
            );
            continue;
        }
        const candidate = attachView(view, expanded, evidence, selectedViews);
        const viewChars = JSON.stringify(
            candidate.filter((item) => item.kind !== "source"),
        ).length;
        if (
            viewChars > Math.floor(budget.chars / 2) ||
            !fits(request, candidate, budget)
        ) {
            diagnostics.omittedViewBlocks++;
            continue;
        }
        evidence = candidate;
        selectedViews++;
    }
    evidence = addDirectSources(request, direct, evidence, budget);
    const supplied = new Set(
        evidence.flatMap((item) =>
            item.kind === "source" ? [sourceKey(item.source)] : [],
        ),
    );
    diagnostics.omittedSourceFragments = new Set(
        direct
            .filter(
                (item) =>
                    sourceAllowed(item, request) &&
                    !supplied.has(sourceKey(item)),
            )
            .map(sourceKey),
    ).size;
    if (
        diagnostics.omittedViewBlocks ||
        diagnostics.omittedViewCandidates ||
        diagnostics.omittedSourceFragments
    )
        diagnostics.warnings.push(
            "Bounded answer retrieval omitted evidence; coverage is not exhaustive.",
        );
    return evidence;
}

async function retrieve(
    request: MemoryAnswerRequest,
    host: IntegratedAnswerHost,
    diagnostics: IntegratedAnswerDiagnostics,
) {
    const original = await host.searchOriginal(request);
    if (original.indexedSelection)
        diagnostics.sourceSelection = original.indexedSelection;
    diagnostics.warnings.push(...original.warnings);
    if (request.retrievalPolicy === "sourcesOnly")
        return { original, views: [] };
    try {
        if (!host.getEligibleViewMatches)
            throw new Error("Host does not support maintained-view retrieval");
        const result = await host.getEligibleViewMatches(request);
        diagnostics.warnings.push(...(result.warnings ?? []));
        diagnostics.omittedViewCandidates = result.omittedCandidates ?? 0;
        return { original, views: result.matches };
    } catch (error) {
        if (request.retrievalPolicy === "sourcesAndViews") throw error;
        diagnostics.retrievalMode = "degraded";
        diagnostics.warnings.push(
            "Maintained-view retrieval failed; returning an explicitly degraded source-only answer.",
        );
        return { original, views: [] };
    }
}

function selectedEvidence(
    evidence: AnswerEvidence[],
    ids: string[],
): AnswerEvidence[] {
    const selectedIds = new Set(ids);
    const selected = evidence.filter((item) => selectedIds.has(item.id));
    for (const item of selected) {
        if (item.kind !== "derived" || item.reference.state !== "selected")
            continue;
        if (
            ![...item.supportingEvidenceIds, ...item.opposingEvidenceIds].every(
                (id) => selectedIds.has(id),
            )
        )
            throw new Error(
                "Derived factual answer omitted its original support or opposition references",
            );
    }
    return selected;
}

/** Ground an answer in originals plus exact maintained-view state, with one delivery-race retry. */
export async function answerIntegratedEvidence(
    request: MemoryAnswerRequest,
    host: IntegratedAnswerHost,
    options: IntegratedAnswerOptions = {},
): Promise<MemoryAnswerResult> {
    const budget = {
        chars: boundedLimit(options.maxEvidenceChars, 24000),
        sources: boundedLimit(options.maxSourceFragments, 12),
        views: boundedLimit(options.maxDerivedBlocks, 4),
    };
    if (serializeAnswerEvidence(request, []).length > budget.chars)
        throw new Error(
            "Question exceeds the serialized answer evidence budget",
        );
    for (let attempt = 0; attempt < 2; attempt++) {
        const diagnostics: IntegratedAnswerDiagnostics = {
            retrievalPolicy: request.retrievalPolicy ?? "default",
            retrievalMode:
                request.retrievalPolicy === "sourcesOnly"
                    ? "sourcesOnly"
                    : "sourcesAndViews",
            suppliedEvidence: [],
            selectedEvidenceIds: [],
            omittedViewCandidates: 0,
            omittedSourceFragments: 0,
            omittedViewBlocks: 0,
            warnings: [],
            reconstructionCount: attempt,
        };
        const { original, views } = await retrieve(request, host, diagnostics);
        const evidence = await assembleEvidence(
            request,
            host,
            original.matches,
            views,
            budget,
            diagnostics,
        );
        const response = await readIntegratedEvidence(
            request,
            evidence,
            options,
        );
        const selected = selectedEvidence(evidence, response.evidenceIds);
        // Validate everything supplied, not only what the reader chose: omitted
        // context can still influence prose, and forget barriers take precedence.
        if (!(await host.validateEvidence({ request, evidence }))) continue;
        const citations = selected.flatMap((item) =>
            item.kind === "source" ? [item.source] : [],
        );
        diagnostics.suppliedEvidence = evidence;
        diagnostics.selectedEvidenceIds = response.evidenceIds;
        const sourceIds = [
            ...new Set(
                evidence.flatMap((item) =>
                    item.kind === "source" ? [item.source.sourceId] : [],
                ),
            ),
        ];
        return {
            question: request.question,
            answer: response.answer,
            mode: "synthesized",
            citations,
            derivedReferences: selected.flatMap((item) =>
                item.kind === "derived" ? [item.reference] : [],
            ),
            assertionReferences: selected.flatMap((item) =>
                item.kind === "userAssertion" ? [item.reference] : [],
            ),
            grounded: true,
            indexVersion: original.indexVersion,
            warnings: [...new Set(diagnostics.warnings)],
            ...(request.includeDiagnostics
                ? {
                      readerContext: {
                          answerPath: "sources-and-views" as const,
                          integratedAnswer: diagnostics,
                          retrievedMessageOrdinals: [],
                          messageOrdinals: [],
                          knowledgeMessageOrdinals: [],
                          completedChunks: evidence.length ? 1 : 0,
                          serializedContextChars: serializeAnswerEvidence(
                              request,
                              evidence,
                          ).length,
                          retrievedSourceIds: [
                              ...new Set(
                                  original.matches
                                      .filter((item) =>
                                          sourceAllowed(item, request),
                                      )
                                      .map((item) => item.sourceId),
                              ),
                          ],
                          messageSourceIds: sourceIds,
                          knowledgeSourceIds: [],
                      },
                  }
                : {}),
        };
    }
    throw new Error(
        "Answer evidence changed before delivery after one bounded reconstruction",
    );
}
