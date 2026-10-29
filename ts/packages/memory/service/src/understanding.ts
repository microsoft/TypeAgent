// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash, randomUUID } from "node:crypto";
import {
    runWithSearchTiming,
    timeSearchStage,
    recordSearchTiming,
    runWithSearchCancellation,
    currentSearchAbortSignal,
} from "@typeagent/knowpro";
import { ImmutableReadCache } from "./immutableReadCache.js";
import { boundedSupportMap } from "./memoryPerformanceExperiments.js";
import type { IntegratedAnswerReader } from "./integratedAnswer.js";
import type { AnswerEvidence, MemoryAnswerRequest } from "./types.js";
import {
    understandingCandidates,
    understandingCitations,
    understandingModules,
    wantsExplanation,
} from "./understandingEvidence.js";
import {
    readUnderstanding,
    UnderstandingReaderUnavailable,
} from "./understandingReader.js";
import { UnderstandingStore } from "./understandingStore.js";
import type {
    UnderstandingCandidates,
    UnderstandingHost,
    UnderstandingModuleRequest,
    UnderstandingModuleResult,
    UnderstandingOptions,
    UnderstandingReaderResult,
    UnderstandingRequest,
    UnderstandingResult,
} from "./understandingTypes.js";

interface Snapshot {
    corpusId: string;
    request: MemoryAnswerRequest;
    input: UnderstandingRequest;
    result: UnderstandingResult;
    evidence: AnswerEvidence[];
    influence: AnswerEvidence[];
    candidates: UnderstandingCandidates;
    reader?: UnderstandingReaderResult;
    indexVersion?: string;
    leaseExpiresAt?: number | undefined;
}

export function assertUnderstandingBytes(
    value: unknown,
    maximum: number,
): void {
    if (Buffer.byteLength(JSON.stringify(value), "utf8") > maximum)
        throw new Error(
            `Understanding response exceeds ${maximum} byte budget`,
        );
}

function validateRequest(request: UnderstandingRequest): void {
    if (request.phase === "refine" && !request.evidenceSnapshotId)
        throw new Error("Refinement requires a prepared evidence snapshot");
    if (
        !request.corpusId ||
        !request.question.trim() ||
        request.question.length > 2000
    )
        throw new Error(
            "Understanding needs a collection and a question of 1–2000 characters",
        );
    if (!!request.parentSnapshotId !== !!request.parentTurnId)
        throw new Error(
            "Understanding parent snapshot and turn must be supplied together",
        );
    const selection = request.selection;
    if (
        selection?.mode === "only" &&
        (!selection.modules?.length || selection.modules.length > 5)
    )
        throw new Error("Explicit understanding selection needs 1–5 modules");
    if (selection?.mode === "auto" && selection.modules !== undefined)
        throw new Error("Automatic selection does not accept a module list");
}

function mergeInfluence(groups: AnswerEvidence[][]): AnswerEvidence[] {
    const items = new Map<string, AnswerEvidence>();
    for (const item of groups.flat()) items.set(JSON.stringify(item), item);
    if (items.size > 64)
        throw new Error(
            "Follow-on evidence limit reached; start a new question",
        );
    return [...items.values()];
}

function publicAnswer(reader: UnderstandingReaderResult) {
    const {
        schemaVersion: _version,
        moduleSignals: _signals,
        retrievalQueries: _queries,
        ...answer
    } = reader;
    return answer;
}

function retrievalQuestion(question: string, parent?: Snapshot): string {
    if (!parent) return question;
    const context: string[] = [];
    for (const part of [
        parent.result.answer?.summary.text
            ? `Previous grounded summary (retrieval context, not independent evidence): ${parent.result.answer.summary.text}`
            : undefined,
        `Previous question: ${parent.result.question}`,
    ]) {
        if (
            part &&
            [...context, part, `Follow-on: ${question}`].join("\n").length <=
                2000
        )
            context.push(part);
    }
    return context.length
        ? [...context, `Follow-on: ${question}`].join("\n")
        : question;
}

function answerRequest(
    input: UnderstandingRequest,
    question: string,
): MemoryAnswerRequest {
    return {
        corpusId: input.corpusId,
        question,
        ...(input.evidenceSnapshotId
            ? { evidenceSnapshotId: input.evidenceSnapshotId }
            : {}),
        ...(input.phase === "retrieve" ? { prepareOnly: true } : {}),
        ...(input.phase === "initial" ? { deferRefinement: true } : {}),
        ...(input.phase === "refine" ? { resumeRefinement: true } : {}),
        ...(input.knowledgeCheckpointId
            ? { knowledgeCheckpointId: input.knowledgeCheckpointId }
            : {}),
        ...(input.retrievalPolicy
            ? { retrievalPolicy: input.retrievalPolicy }
            : {}),
        includeDiagnostics: true,
    };
}

export class MemoryUnderstanding {
    private readonly operations = new Map<
        string,
        { corpusId: string; controller: AbortController }
    >();
    private readonly moduleResults =
        new ImmutableReadCache<UnderstandingModuleResult>(
            "understanding.module",
            64,
            8 * 1024 * 1024,
        );
    private readonly store: UnderstandingStore<Snapshot>;
    private readonly initialSnapshots: UnderstandingStore<{
        corpusId: string;
        snapshotId: string;
    }>;
    private active = 0;
    private readonly now: () => number;

    constructor(
        private readonly host: UnderstandingHost,
        private readonly options: UnderstandingOptions = {},
    ) {
        this.now = options.now ?? Date.now;
        this.store = new UnderstandingStore(this.now);
        this.initialSnapshots = new UnderstandingStore(this.now);
    }

    invalidate(corpusId?: string): void {
        this.store.invalidate(corpusId);
        this.initialSnapshots.invalidate(corpusId);
        this.moduleResults.invalidate(corpusId);
        for (const operation of this.operations.values())
            if (!corpusId || operation.corpusId === corpusId)
                operation.controller.abort(
                    new Error("Understanding invalidated by evidence removal"),
                );
    }
    close(): void {
        this.invalidate();
        this.moduleResults.close();
        this.store.close();
        this.initialSnapshots.close();
    }

    cancel(request: { corpusId: string; requestId: string }): boolean {
        const operation = this.operations.get(
            this.validatedRequestId(request.requestId),
        );
        if (!operation || operation.corpusId !== request.corpusId) return false;
        operation.controller.abort(
            new DOMException("Understanding request cancelled", "AbortError"),
        );
        return true;
    }

    private validatedRequestId(id: string): string {
        if (
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
                id,
            )
        )
            throw new Error("Understanding request ID must be a UUID");
        return id;
    }

    private async operation<T>(
        input: { corpusId: string; requestId?: string | undefined },
        work: (signal: AbortSignal) => Promise<T>,
    ): Promise<T> {
        const id = this.validatedRequestId(input.requestId ?? randomUUID());
        if (this.operations.has(id))
            throw new Error("Understanding request ID is already active");
        const controller = new AbortController();
        this.operations.set(id, { corpusId: input.corpusId, controller });
        try {
            const result = await runWithSearchCancellation(
                controller.signal,
                () => work(controller.signal),
            );
            controller.signal.throwIfAborted();
            return result;
        } finally {
            this.operations.delete(id);
        }
    }

    private async checked(id: string, corpusId: string): Promise<Snapshot> {
        const snapshot = this.store.get(id);
        if (snapshot.corpusId !== corpusId)
            throw new Error(
                "Understanding scope does not match the requested collection",
            );
        if (!(await this.current(snapshot))) {
            this.store.delete(id);
            throw new Error(
                "Understanding evidence changed or was forgotten; start a new question",
            );
        }
        this.store.get(id);
        return snapshot;
    }

    private async current(snapshot: Snapshot): Promise<boolean> {
        if (this.host.validateSnapshot)
            return this.host.validateSnapshot(
                snapshot.request,
                snapshot.influence,
                snapshot.indexVersion,
                snapshot.leaseExpiresAt,
            );
        if (!(await this.host.validate(snapshot.request, snapshot.influence)))
            return false;
        return (
            !this.host.indexVersion ||
            snapshot.indexVersion ===
                (await this.host.indexVersion(snapshot.corpusId))
        );
    }

    private async parent(
        request: UnderstandingRequest,
    ): Promise<Snapshot | undefined> {
        if (!request.parentSnapshotId) return undefined;
        const parent = await this.checked(
            request.parentSnapshotId,
            request.corpusId,
        );
        if (
            parent.result.turnId !== request.parentTurnId ||
            parent.input.knowledgeCheckpointId !==
                request.knowledgeCheckpointId ||
            parent.input.retrievalPolicy !== request.retrievalPolicy
        )
            throw new Error(
                "Follow-on turn or scope does not match its parent",
            );
        return parent;
    }

    async understand(
        input: UnderstandingRequest,
    ): Promise<UnderstandingResult> {
        validateRequest(input);
        if (this.active >= 8)
            throw new Error("Understanding is busy; retry shortly");
        this.active++;
        try {
            return await runWithSearchTiming(
                undefined,
                "memory.understand",
                () =>
                    this.operation(input, (signal) =>
                        timeSearchStage("understanding.total", () =>
                            this.prepare(input, signal),
                        ),
                    ),
                {
                    corpusId: input.corpusId,
                    operationId: input.requestId,
                    phase: input.phase ?? "direct",
                    origin: input.parentTurnId ? "follow-on" : "initial",
                },
            );
        } finally {
            this.active--;
        }
    }

    private async preview(
        input: UnderstandingRequest,
        question: string,
        signal: AbortSignal,
    ): Promise<UnderstandingResult> {
        if (!this.host.preview)
            throw new Error(
                "Provisional source previews are disabled by this host",
            );
        const evidence = await this.host.preview({
            corpusId: input.corpusId,
            question,
            ...(input.knowledgeCheckpointId
                ? { knowledgeCheckpointId: input.knowledgeCheckpointId }
                : {}),
        });
        signal.throwIfAborted();
        return {
            schemaVersion: 1,
            provisional: true,
            snapshotId: randomUUID(),
            turnId: randomUUID(),
            corpusId: input.corpusId,
            question: input.question.trim(),
            expiresAt: new Date(this.now()).toISOString(),
            citations: understandingCitations(
                evidence.map((source, index) => ({
                    id: `preview-${index}`,
                    kind: "source",
                    source,
                })),
            ),
            modules: [],
            warnings: [
                "Provisional lexical matches only; semantic and temporal interpretation is still pending. These are not a validated answer.",
            ],
        };
    }

    private async retainInitial(
        input: UnderstandingRequest,
        error: unknown,
        signal: AbortSignal,
    ): Promise<UnderstandingResult> {
        signal.throwIfAborted();
        if (
            input.phase !== "refine" ||
            !this.options.refinementFallback ||
            !(error instanceof UnderstandingReaderUnavailable)
        )
            throw error;
        const initial = this.initialSnapshots.get(input.evidenceSnapshotId!);
        const previous = await this.checked(initial.snapshotId, input.corpusId);
        signal.throwIfAborted();
        const retained = structuredClone(previous.result);
        retained.refinementPending = false;
        retained.refinementFailed = true;
        if (retained.answer?.status === "answered")
            retained.answer.status = "partial";
        retained.warnings.push(
            "Additional evidence reading was temporarily unavailable. Showing the revalidated initial explanation; refinement is incomplete. Retry the question to try again.",
        );
        recordSearchTiming("understanding.refinementFallback", 0, {
            retained: true,
        });
        return retained;
    }

    private async prepare(
        input: UnderstandingRequest,
        signal: AbortSignal,
    ): Promise<UnderstandingResult> {
        const epoch = this.store.version;
        const parent = await timeSearchStage("understanding.parent", () =>
            this.parent(input),
        );
        const question = retrievalQuestion(input.question.trim(), parent);
        if (input.phase === "preview")
            return this.preview(input, question, signal);
        const snapshot: Snapshot = {
            corpusId: input.corpusId,
            input: structuredClone(input),
            request: answerRequest(input, question),
            evidence: [],
            influence: parent?.influence ?? [],
            candidates: { dates: [], entities: [], warnings: [] },
            result: {
                schemaVersion: 1,
                snapshotId: randomUUID(),
                turnId: randomUUID(),
                corpusId: input.corpusId,
                question: input.question.trim(),
                expiresAt: new Date(this.now() + 15 * 60_000).toISOString(),
                citations: [],
                modules: [],
                warnings: [],
            },
        };
        let answer;
        try {
            answer = await this.host.answer(
                snapshot.request,
                this.reader(snapshot, parent),
            );
        } catch (error) {
            return this.retainInitial(input, error, signal);
        }
        signal.throwIfAborted();
        if (!answer.readerContext?.integratedAnswer)
            throw new Error(
                "Understanding requires indexed document evidence; this scope is unsupported",
            );
        const diagnostics = answer.readerContext.integratedAnswer;
        if (!snapshot.evidence.length)
            snapshot.evidence = diagnostics.suppliedEvidence;
        snapshot.indexVersion = answer.indexVersion;
        const lease = answer.evidenceSnapshotId
            ? this.host.evidenceLeaseExpiresAt?.(answer.evidenceSnapshotId)
            : undefined;
        snapshot.leaseExpiresAt =
            parent?.leaseExpiresAt === undefined
                ? lease
                : Math.min(
                      parent.leaseExpiresAt,
                      lease ?? parent.leaseExpiresAt,
                  );
        snapshot.influence = mergeInfluence([
            snapshot.influence,
            diagnostics.influencingEvidence ?? [],
            diagnostics.refinement?.initialEvidence ?? [],
            diagnostics.suppliedEvidence,
        ]);
        if (
            !(await timeSearchStage("understanding.influenceValidation", () =>
                this.current(snapshot),
            ))
        )
            throw new Error(
                "Understanding influence changed; retry the question",
            );
        const result = snapshot.result;
        if (answer.evidenceSnapshotId)
            result.evidenceSnapshotId = answer.evidenceSnapshotId;
        if (answer.refinementPending !== undefined)
            result.refinementPending = answer.refinementPending;
        if (snapshot.reader) result.answer = publicAnswer(snapshot.reader);
        else if (
            input.phase === "retrieve" &&
            wantsExplanation(input) &&
            answer.mode === "synthesized"
        )
            result.previousAnswer = {
                text: answer.answer,
                evidenceIds: diagnostics.selectedEvidenceIds,
            };
        result.citations = understandingCitations(snapshot.evidence);
        result.modules = understandingModules(
            input,
            snapshot.reader,
            snapshot.candidates,
        );
        result.warnings = [
            ...new Set([...answer.warnings, ...snapshot.candidates.warnings]),
        ];
        assertUnderstandingBytes({ success: true, data: result }, 128 * 1024);
        recordSearchTiming("understanding.result", 0, {
            groupId: result.snapshotId,
            responseBytes: Buffer.byteLength(
                JSON.stringify({ success: true, data: result }),
                "utf8",
            ),
            plannedModules: result.modules.filter(
                (item) => item.status === "planned",
            ).length,
            unavailableModules: result.modules.filter(
                (item) => item.status === "unavailable",
            ).length,
        });
        result.expiresAt = new Date(
            this.store.put(result.snapshotId, snapshot, epoch),
        ).toISOString();
        if (
            this.options.refinementFallback &&
            input.phase === "initial" &&
            result.refinementPending &&
            result.evidenceSnapshotId
        )
            this.initialSnapshots.put(
                result.evidenceSnapshotId,
                {
                    corpusId: input.corpusId,
                    snapshotId: result.snapshotId,
                },
                epoch,
            );
        return structuredClone(result);
    }

    private reader(
        snapshot: Snapshot,
        parent?: Snapshot,
    ): IntegratedAnswerReader {
        return async (request, evidence, _options, allowRefinement) => {
            snapshot.request = request;
            snapshot.evidence = evidence;
            snapshot.candidates = await timeSearchStage(
                "understanding.candidates",
                () =>
                    understandingCandidates(
                        this.host,
                        { ...snapshot.input, question: request.question },
                        evidence,
                    ),
            );
            if (!wantsExplanation(snapshot.input))
                return {
                    status: "noAnswer",
                    answer: "Requested evidence modules.",
                    evidenceIds: [],
                };
            recordSearchTiming("understanding.readerCall", 0, {
                readerCalls: evidence.length ? 1 : 0,
                refinement: !allowRefinement,
                evidenceCount: evidence.length,
                dateCandidates: snapshot.candidates.dates.length,
                entityCandidates: snapshot.candidates.entities.length,
            });
            const reader = await timeSearchStage("understanding.reader", () =>
                readUnderstanding({
                    ...this.options,
                    endpoint: allowRefinement
                        ? (this.options.initialEndpoint ??
                          this.options.endpoint)
                        : this.options.endpoint,
                    brief:
                        allowRefinement && this.options.briefInitial === true,
                    question: snapshot.input.question,
                    evidence,
                    candidates: snapshot.candidates,
                    allowRefinement,
                    parent: parent
                        ? {
                              question: parent.result.question,
                              answer: parent.result.answer?.summary.text,
                              unknowns: parent.result.answer?.unknowns ?? [],
                          }
                        : undefined,
                }),
            );
            snapshot.reader = reader;
            const claims = [
                reader.summary,
                ...reader.sections.flatMap((item) => item.claims),
            ];
            return {
                status:
                    reader.status === "answered" || reader.status === "partial"
                        ? "answered"
                        : "noAnswer",
                answer: claims.map((item) => item.text).join("\n\n"),
                evidenceIds: [
                    ...new Set(claims.flatMap((item) => item.evidenceIds)),
                ],
                retrievalQueries: reader.retrievalQueries,
            };
        };
    }

    async module(
        input: UnderstandingModuleRequest,
    ): Promise<UnderstandingModuleResult> {
        return runWithSearchTiming(
            undefined,
            "memory.understanding-module",
            () =>
                this.operation(input, (signal) =>
                    timeSearchStage("understanding.module", () =>
                        this.readModule(input, signal),
                    ),
                ),
            {
                groupId: input.snapshotId,
                operationId: input.requestId,
                phase: "module",
                origin: "module",
            },
        );
    }

    private async readModule(
        input: UnderstandingModuleRequest,
        signal: AbortSignal,
    ): Promise<UnderstandingModuleResult> {
        const epoch = this.store.version;
        const snapshot = await this.checked(input.snapshotId, input.corpusId);
        signal.throwIfAborted();
        const result: UnderstandingModuleResult = {
            schemaVersion: 1,
            corpusId: input.corpusId,
            snapshotId: input.snapshotId,
            kind: input.kind,
            status: "unavailable",
            citations: [],
        };
        const planned = snapshot.result.modules.find(
            (item) => item.kind === input.kind,
        );
        if (!planned || planned.status === "unavailable")
            result.reason =
                planned?.reason ??
                "Module was not selected for this understanding";
        else if (input.kind === "sources" || input.kind === "timeline") {
            const key = createHash("sha256")
                .update(
                    JSON.stringify([
                        input.corpusId,
                        input.kind,
                        snapshot.indexVersion,
                        snapshot.evidence,
                        snapshot.influence,
                        snapshot.candidates,
                        snapshot.reader?.moduleSignals,
                    ]),
                )
                .digest("hex");
            const cached = await this.moduleResults.get(
                key,
                input.corpusId,
                async () => {
                    if (input.kind === "sources") {
                        result.status = "ready";
                        result.citations = snapshot.result.citations;
                    } else this.timeline(snapshot, result);
                    return {
                        value: structuredClone(result),
                        bytes: Buffer.byteLength(
                            JSON.stringify(result),
                            "utf8",
                        ),
                    };
                },
            );
            Object.assign(result, cached, {
                snapshotId: input.snapshotId,
            });
        } else if (input.kind === "concepts")
            await this.concepts(snapshot, result);
        else await this.relationships(snapshot, result);
        signal.throwIfAborted();
        await this.checked(input.snapshotId, input.corpusId);
        if (epoch !== this.store.version)
            throw new Error(
                "Understanding invalidated during module preparation; retry",
            );
        assertUnderstandingBytes({ success: true, data: result }, 64 * 1024);
        return structuredClone(result);
    }

    private async concepts(
        snapshot: Snapshot,
        result: UnderstandingModuleResult,
    ): Promise<void> {
        if (!this.host.queryGraphSupport || !this.host.validateSupport) {
            result.reason = "Supported concept reads are unavailable";
            return;
        }
        const querySupport = this.host.queryGraphSupport.bind(this.host);
        const validateSupport = this.host.validateSupport.bind(this.host);
        const signal = snapshot.reader?.moduleSignals.find(
            (item) => item.kind === "concepts",
        );
        const candidates = snapshot.candidates.entities.filter(
            (item) => !signal || signal.candidateIds.includes(item.id),
        );
        const supported = await boundedSupportMap(
            candidates,
            this.options.parallelGraphSupport ? 2 : 1,
            async (entity) => {
                currentSearchAbortSignal()?.throwIfAborted();
                const page = await querySupport({
                    corpusId: snapshot.corpusId,
                    generation: entity.generation,
                    nodeId: entity.nodeId,
                    pageSize: 4,
                });
                const support = page.items.filter(
                    (item) =>
                        item.kind === "document" &&
                        item.corpusId === snapshot.corpusId &&
                        (!snapshot.request.sourceIds ||
                            snapshot.request.sourceIds.includes(item.sourceId)),
                );
                if (
                    page.generation === entity.generation &&
                    support.length &&
                    (await validateSupport(support))
                )
                    return entity;
                return undefined;
            },
        );
        const concepts = supported.filter(
            (item): item is (typeof candidates)[number] => item !== undefined,
        );
        if (!concepts.length) {
            result.reason =
                "No accessible original support within the bounded entity preview";
            return;
        }
        result.status = "ready";
        result.concepts = concepts;
    }

    private timeline(
        snapshot: Snapshot,
        result: UnderstandingModuleResult,
    ): void {
        const signal = snapshot.reader?.moduleSignals.find(
            (item) => item.kind === "timeline",
        );
        result.timeline = snapshot.candidates.dates
            .filter(
                (item) =>
                    !signal ||
                    (signal.candidateIds.includes(item.id) &&
                        signal.evidenceIds.includes(item.evidenceId)),
            )
            .sort((a, b) => a.date.localeCompare(b.date));
        result.status = "ready";
        result.citations = snapshot.result.citations.filter((item) =>
            result.timeline?.some((date) => date.evidenceId === item.id),
        );
    }

    private async relationships(
        snapshot: Snapshot,
        result: UnderstandingModuleResult,
    ): Promise<void> {
        if (
            !this.host.queryKnowledgeGraph ||
            !this.host.queryGraphSupport ||
            !this.host.validateSupport
        ) {
            result.reason = "Supported graph reads are unavailable";
            return;
        }
        const querySupport = this.host.queryGraphSupport.bind(this.host);
        const validateSupport = this.host.validateSupport.bind(this.host);
        const signal = snapshot.reader?.moduleSignals.find(
            (item) => item.kind === "relationships",
        );
        const entity = snapshot.candidates.entities.find(
            (item) => !signal || signal.candidateIds.includes(item.id),
        );
        if (!entity) {
            result.reason = "No matching graph identity";
            return;
        }
        const inventory = await this.host.queryGraphSupport({
            corpusId: snapshot.corpusId,
            generation: entity.generation,
            nodeId: entity.nodeId,
            pageSize: 1,
        });
        if (
            inventory.generation !== entity.generation ||
            !inventory.items.length
        ) {
            result.reason = "Graph inventory changed; ask again";
            return;
        }
        const graph = await this.host.queryKnowledgeGraph({
            corpusId: snapshot.corpusId,
            kind: "entities",
            nodeId: entity.nodeId,
            maxNodes: 12,
            maxEdges: 16,
            evidenceKinds: ["document"],
        });
        if (graph.state !== "ready") {
            result.reason = `Graph is ${graph.state}; ask again`;
            return;
        }
        const supported = await boundedSupportMap(
            graph.edges.filter((edge) => edge.supportCount > 0),
            this.options.parallelGraphSupport ? 2 : 1,
            async (edge) => {
                currentSearchAbortSignal()?.throwIfAborted();
                const page = await querySupport({
                    corpusId: snapshot.corpusId,
                    generation: graph.generation,
                    edgeId: edge.id,
                    pageSize: 4,
                });
                const items = page.items.filter(
                    (item) =>
                        item.kind === "document" &&
                        item.corpusId === snapshot.corpusId &&
                        (!snapshot.request.sourceIds ||
                            snapshot.request.sourceIds.includes(item.sourceId)),
                );
                if (
                    page.generation === graph.generation &&
                    items.length &&
                    (await validateSupport(items))
                )
                    return { edgeId: edge.id, items };
                return undefined;
            },
        );
        const support = supported.filter(
            (item): item is NonNullable<typeof item> => item !== undefined,
        );
        graph.edges = graph.edges.filter((edge) =>
            support.some((item) => item.edgeId === edge.id),
        );
        const connected = new Set(
            graph.edges.flatMap((edge) => [edge.source, edge.target]),
        );
        graph.nodes = graph.nodes.filter((node) => connected.has(node.id));
        if (!graph.edges.length) {
            result.reason =
                "No same-generation edges with accessible original support";
            return;
        }
        if (
            !(await this.host.validateSupport(
                support.flatMap((item) => item.items),
            ))
        )
            throw new Error(
                "Graph support changed during module preparation; retry",
            );
        result.graph = graph;
        result.support = support;
        result.status =
            graph.counts.omittedEdges || graph.counts.omittedNodes
                ? "partial"
                : "ready";
    }
}
