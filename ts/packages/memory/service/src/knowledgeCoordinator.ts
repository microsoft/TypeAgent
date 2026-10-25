// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomUUID } from "node:crypto";
import type {
    CorpusQuestionInput,
    CorpusQuestionProposal,
    DiscoveryReceipt,
    KnowledgeCheckpoint,
    KnowledgeCheckpointRead,
    KnowledgeCheckpointRequest,
    KnowledgeCheckpointWait,
    KnowledgeDiscoveryState,
    KnowledgeDiscoveryUpdate,
    KnowledgeFamily,
    KnowledgeStatus,
    KnowledgeSource,
} from "./knowledgeTypes.js";
import { knowledgeLimits } from "./knowledgeTypes.js";
import { abortable } from "./viewBuilds.js";

export interface KnowledgeDocument extends KnowledgeSource {
    title: string;
    content: string;
}
export interface KnowledgeHost {
    begin?(corpusId: string): Promise<void>;
    end?(corpusId: string): void;
    reportFailure?(corpusId: string, error: unknown): Promise<void>;
    modelIdentity: string;
    read(corpusId: string): Promise<KnowledgeStatus>;
    write(
        corpusId: string,
        update: (state: KnowledgeStatus) => void,
    ): Promise<KnowledgeStatus>;
    capture(
        corpusId: string,
    ): Promise<{ sources: KnowledgeDocument[]; indexVersion: string }>;
    activeImport(corpusId: string): boolean;
    maintainedCurrent?(checkpoint: KnowledgeCheckpoint): Promise<boolean>;
    questions(corpusId: string): Promise<string[]>;
    plan(
        corpusId: string,
        documents: KnowledgeDocument[],
        questions: string[],
        state: KnowledgeDiscoveryState,
        identity: string,
    ): CorpusQuestionInput[];
    discover(
        input: CorpusQuestionInput,
        signal: AbortSignal,
    ): Promise<CorpusQuestionProposal[]>;
    admit(
        corpusId: string,
        input: CorpusQuestionInput,
        proposal: CorpusQuestionProposal,
        signal: AbortSignal,
    ): Promise<string | undefined>;
    route(corpusId: string, sources: KnowledgeDocument[]): Promise<void>;
    maintain(
        checkpoint: KnowledgeCheckpoint,
        signal: AbortSignal,
    ): Promise<
        Pick<
            KnowledgeCheckpoint,
            "viewIds" | "jobIds" | "state" | "reasons" | "viewRevisions"
        >
    >;
    enabledFamilies(): KnowledgeFamily[];
}

function message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
function terminal(checkpoint: KnowledgeCheckpoint): boolean {
    return !["pending", "running"].includes(checkpoint.state);
}
function validateCorpus(corpusId: string): void {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(corpusId))
        throw new Error("Invalid knowledge corpus ID");
}
function validateTimeout(value: number): number {
    if (!Number.isSafeInteger(value) || value < 1 || value > 3_600_000)
        throw new Error("Knowledge timeout must be 1 to 3600000 milliseconds");
    return value;
}

export class KnowledgeCoordinator {
    private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
    private readonly dirtySince = new Map<string, number>();
    private readonly work = new Map<string, Promise<void>>();
    private readonly controllers = new Set<AbortController>();
    private readonly checkpoints = new Map<string, Promise<void>>();
    private readonly checkpointCorpora = new Set<string>();
    private closed = false;

    public constructor(private readonly host: KnowledgeHost) {}

    public schedule(corpusId: string): void {
        if (
            this.closed ||
            this.host.activeImport(corpusId) ||
            this.checkpointCorpora.has(corpusId)
        )
            return;
        const first = this.dirtySince.get(corpusId) ?? Date.now();
        this.dirtySince.set(corpusId, first);
        const previous = this.timers.get(corpusId);
        if (previous) clearTimeout(previous);
        const delay = Math.max(
            0,
            Math.min(
                knowledgeLimits.coalesceMs,
                first + knowledgeLimits.maxDelayMs - Date.now(),
            ),
        );
        const timer = setTimeout(() => {
            this.timers.delete(corpusId);
            this.dirtySince.delete(corpusId);
            if (
                this.closed ||
                this.host.activeImport(corpusId) ||
                this.checkpointCorpora.has(corpusId)
            )
                return;
            void this.runDiscovery(corpusId).catch((error: unknown) =>
                this.reportFailure(corpusId, error),
            );
        }, delay);
        timer.unref();
        this.timers.set(corpusId, timer);
    }

    private async reportFailure(
        corpusId: string,
        error: unknown,
    ): Promise<void> {
        try {
            if (this.host.reportFailure) {
                await this.host.reportFailure(corpusId, error);
            } else {
                await this.host.write(corpusId, (state) => {
                    state.discovery.error = message(error);
                });
            }
        } catch (failure) {
            console.error(
                "Knowledge failure could not be persisted:",
                message(failure),
            );
        }
    }

    public async update(
        request: KnowledgeDiscoveryUpdate,
    ): Promise<KnowledgeStatus> {
        validateCorpus(request.corpusId);
        if (
            !["off", "suggest", "sourceObserved"].includes(request.policy) ||
            (request.retryFailed !== undefined &&
                typeof request.retryFailed !== "boolean") ||
            Object.keys(request).some(
                (key) => !["corpusId", "policy", "retryFailed"].includes(key),
            )
        )
            throw new Error("Invalid knowledge discovery policy update");
        const state = await this.host.write(request.corpusId, (state) => {
            state.discovery.policy = request.policy;
            delete state.discovery.error;
            if (request.retryFailed)
                for (const receipt of state.discovery.receipts)
                    if (
                        (receipt.state === "failed" ||
                            receipt.state === "running") &&
                        receipt.attempts < 2
                    )
                        receipt.state = "deferred";
        });
        if (request.policy !== "off") this.schedule(request.corpusId);
        return state;
    }

    private async runDiscovery(
        corpusId: string,
        sources?: KnowledgeDocument[],
        signal?: AbortSignal,
    ): Promise<void> {
        const prior = this.work.get(corpusId);
        const work = (async () => {
            if (prior) {
                if (signal) await abortable(prior, signal);
                else await prior;
            }
            await this.discover(corpusId, sources, signal);
        })();
        this.work.set(corpusId, work);
        try {
            await work;
        } finally {
            if (this.work.get(corpusId) === work) this.work.delete(corpusId);
        }
    }

    private async discover(
        corpusId: string,
        selected?: KnowledgeDocument[],
        signal?: AbortSignal,
    ): Promise<void> {
        const status = await this.host.read(corpusId);
        if (status.discovery.policy === "off" || this.closed) return;
        const sources = selected ?? (await this.host.capture(corpusId)).sources;
        await this.host.route(corpusId, sources);
        const questions = await this.host.questions(corpusId);
        const windows = this.host
            .plan(
                corpusId,
                sources,
                questions,
                status.discovery,
                this.host.modelIdentity,
            )
            .slice(0, knowledgeLimits.windows);
        let admitted = 0;
        for (const input of windows) {
            const added = await this.discoverWindow(
                corpusId,
                input,
                admitted,
                signal,
            );
            if (added === undefined) return;
            admitted += added;
        }
        if (admitted) await this.host.route(corpusId, sources);
    }

    private async discoverWindow(
        corpusId: string,
        input: CorpusQuestionInput,
        admitted: number,
        signal?: AbortSignal,
    ): Promise<number | undefined> {
        const previousAdmissions = admitted;
        if (this.closed) throw new Error("Knowledge service is closing");
        const state = (await this.host.read(corpusId)).discovery;
        const prior = state.receipts.find(
            (entry) => entry.fingerprint === input.fingerprint,
        );
        if (prior?.state === "complete") return 0;
        if (prior?.state === "failed" || prior?.state === "running")
            throw new Error(
                prior.reason ??
                    "Discovery requires explicit retry after an interrupted or failed attempt",
            );
        const calls = state.callTimes.filter(
            (time) => time > Date.now() - 3_600_000,
        );
        if (!prior?.proposals && calls.length >= knowledgeLimits.callsPerHour) {
            await this.host.write(corpusId, (status) => {
                status.discovery.error =
                    "Discovery hourly budget exhausted; pending content remains deferred";
            });
            return;
        }
        await this.reserveDiscoveryWindow(corpusId, input, calls, prior);
        const controller = new AbortController();
        const timeout = setTimeout(
            () => controller.abort(new Error("Discovery call timed out")),
            knowledgeLimits.callTimeoutMs,
        );
        this.controllers.add(controller);
        try {
            const callSignal = signal
                ? AbortSignal.any([signal, controller.signal])
                : controller.signal;
            const proposals =
                prior?.proposals ??
                (await abortable(
                    this.host.discover(input, callSignal),
                    callSignal,
                ));
            if (proposals.length > input.maxProposals)
                throw new Error("Discovery exceeded proposal allowance");
            if (!prior?.proposals)
                proposals.sort(
                    (a, b) =>
                        Object.values(b.utility ?? {}).reduce(
                            (sum, score) => sum + score,
                            0,
                        ) -
                        Object.values(a.utility ?? {}).reduce(
                            (sum, score) => sum + score,
                            0,
                        ),
                );
            await this.host.write(corpusId, (status) => {
                const current = status.discovery.receipts.find(
                    (entry) => entry.fingerprint === input.fingerprint,
                );
                if (!current) throw new Error("Discovery receipt was removed");
                current.proposals = proposals;
            });
            let processed = prior?.processedProposals ?? 0;
            for (const proposal of proposals.slice(processed)) {
                callSignal.throwIfAborted();
                if (admitted >= knowledgeLimits.admissions) break;
                const viewId = await this.host.admit(
                    corpusId,
                    input,
                    proposal,
                    callSignal,
                );
                if (viewId) admitted++;
                processed++;
            }
            await this.host.write(corpusId, (status) => {
                const current = status.discovery.receipts.find(
                    (entry) => entry.fingerprint === input.fingerprint,
                );
                if (!current) throw new Error("Discovery receipt was removed");
                current.processedProposals = processed;
                current.state =
                    processed < proposals.length ? "deferred" : "complete";
                if (current.state === "complete")
                    current.completedAt = new Date().toISOString();
                else current.reason = "Checkpoint admission limit reached";
            });
        } catch (error) {
            await this.host.write(corpusId, (status) => {
                const current = status.discovery.receipts.find(
                    (entry) => entry.fingerprint === input.fingerprint,
                );
                if (current) {
                    current.state = "failed";
                    current.reason = message(error);
                }
                status.discovery.error = message(error);
            });
            throw error;
        } finally {
            clearTimeout(timeout);
            this.controllers.delete(controller);
        }
        return admitted - previousAdmissions;
    }

    private async reserveDiscoveryWindow(
        corpusId: string,
        input: CorpusQuestionInput,
        calls: number[],
        prior?: DiscoveryReceipt,
    ): Promise<void> {
        const receipt: DiscoveryReceipt = {
            fingerprint: input.fingerprint,
            adapterIdentity: this.host.modelIdentity,
            sources: [
                ...new Map(
                    input.passages.map((passage) => [
                        passage.sourceId,
                        {
                            sourceId: passage.sourceId,
                            revisionId: passage.revisionId,
                        },
                    ]),
                ).values(),
            ],
            state: "running",
            attempts: (prior?.attempts ?? 0) + (prior?.proposals ? 0 : 1),
            startedAt: new Date().toISOString(),
            viewIds: prior?.viewIds ?? [],
            ...(prior?.proposals ? { proposals: prior.proposals } : {}),
            processedProposals: prior?.processedProposals ?? 0,
        };
        await this.host.write(corpusId, (status) => {
            status.discovery.callTimes = prior?.proposals
                ? calls
                : [...calls, Date.now()];
            status.discovery.receipts = [
                ...status.discovery.receipts.filter(
                    (entry) => entry.fingerprint !== input.fingerprint,
                ),
                receipt,
            ];
            delete status.discovery.error;
        });
    }

    public async create(
        request: KnowledgeCheckpointRequest,
    ): Promise<KnowledgeCheckpoint> {
        validateCorpus(request.corpusId);
        if (this.closed) throw new Error("Knowledge service is closed");
        if (this.checkpointCorpora.has(request.corpusId))
            throw new Error(
                "A knowledge checkpoint is already running for this corpus",
            );
        this.checkpointCorpora.add(request.corpusId);
        try {
            return await this.createCheckpoint(request);
        } catch (error) {
            this.checkpointCorpora.delete(request.corpusId);
            throw error;
        }
    }

    private async createCheckpoint(
        request: KnowledgeCheckpointRequest,
    ): Promise<KnowledgeCheckpoint> {
        if (
            Object.keys(request).some(
                (key) =>
                    ![
                        "corpusId",
                        "sourceIds",
                        "families",
                        "producerComplete",
                        "timeoutMs",
                    ].includes(key),
            )
        )
            throw new Error("Unsupported knowledge checkpoint fields");
        if (
            request.sourceIds &&
            (!Array.isArray(request.sourceIds) ||
                request.sourceIds.some((id) => typeof id !== "string") ||
                new Set(request.sourceIds).size !== request.sourceIds.length)
        )
            throw new Error("Invalid knowledge source scope");
        if (
            request.producerComplete !== undefined &&
            typeof request.producerComplete !== "boolean"
        )
            throw new Error("Invalid knowledge producer boundary");
        const families = request.families ?? this.host.enabledFamilies();
        if (
            !Array.isArray(families) ||
            !families.length ||
            new Set(families).size !== families.length ||
            families.some(
                (family) =>
                    !["questions", "wiki", "projects", "topics"].includes(
                        family,
                    ),
            )
        )
            throw new Error("Invalid knowledge checkpoint families");
        const timeoutMs = validateTimeout(request.timeoutMs ?? 600000);
        const capture = await this.host.capture(request.corpusId);
        const sources = capture.sources.filter(
            (source) =>
                !request.sourceIds ||
                request.sourceIds.includes(source.sourceId),
        );
        if (
            request.sourceIds?.some(
                (id) => !sources.some((source) => source.sourceId === id),
            )
        )
            throw new Error(
                "Checkpoint requires exact accessible ready source revisions",
            );
        const checkpoint: KnowledgeCheckpoint = {
            version: 1,
            checkpointId: randomUUID(),
            corpusId: request.corpusId,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            state: "pending",
            sources: sources.map(({ sourceId, revisionId }) => ({
                sourceId,
                revisionId,
            })),
            families,
            excludedFamilies: (
                ["questions", "wiki", "projects", "topics"] as const
            ).filter((family) => !families.includes(family)),
            producerComplete: request.producerComplete ?? false,
            indexVersion: capture.indexVersion,
            viewIds: [],
            jobIds: [],
            discoveryFingerprints: [],
            coverage: { inspectedSources: 0, deferredSources: sources.length },
            reasons: [],
        };
        await this.host.write(request.corpusId, (status) => {
            status.checkpoints.push(checkpoint);
        });
        const pendingTimer = this.timers.get(request.corpusId);
        if (pendingTimer) clearTimeout(pendingTimer);
        this.timers.delete(request.corpusId);
        const work = this.runCheckpoint(checkpoint, sources, timeoutMs);
        this.checkpoints.set(checkpoint.checkpointId, work);
        const finished = () => {
            this.checkpoints.delete(checkpoint.checkpointId);
            this.checkpointCorpora.delete(request.corpusId);
        };
        void work.then(finished, async (error: unknown) => {
            finished();
            await this.reportFailure(request.corpusId, error);
        });
        return checkpoint;
    }

    private async runCheckpoint(
        checkpoint: KnowledgeCheckpoint,
        sources: KnowledgeDocument[],
        timeoutMs: number,
    ): Promise<void> {
        const controller = new AbortController();
        this.controllers.add(controller);
        const timer = setTimeout(
            () =>
                controller.abort(
                    new Error("Knowledge checkpoint deadline exceeded"),
                ),
            timeoutMs,
        );
        try {
            await this.host.begin?.(checkpoint.corpusId);
            await this.change(checkpoint, { state: "running" });
            const unavailable = checkpoint.families.filter(
                (family) => !this.host.enabledFamilies().includes(family),
            );
            if (unavailable.length) {
                await this.change(checkpoint, {
                    state: "blocked",
                    reasons: [
                        `Required knowledge families are disabled: ${unavailable.join(", ")}`,
                    ],
                });
                return;
            }
            const discoveryErrors = await this.discoverForCheckpoint(
                checkpoint,
                sources,
                controller.signal,
            );
            controller.signal.throwIfAborted();
            if (!(await this.current(checkpoint))) {
                await this.change(checkpoint, {
                    state: "superseded",
                    reasons: ["Captured evidence changed before maintenance"],
                });
                return;
            }
            const discovery = await this.discoveryCoverage(checkpoint);
            await this.change(checkpoint, {
                coverage: discovery.coverage,
                discoveryFingerprints: discovery.fingerprints,
            });
            const result = await this.host.maintain(
                checkpoint,
                controller.signal,
            );
            const stillCurrent = await this.current(checkpoint);
            await this.change(checkpoint, {
                ...result,
                state: !stillCurrent
                    ? "superseded"
                    : discoveryErrors.length
                      ? "failed"
                      : result.state === "ready" && discovery.limited
                        ? "partial"
                        : result.state,
                reasons: [
                    ...result.reasons,
                    ...discoveryErrors,
                    ...discovery.reasons,
                    ...(!stillCurrent ? ["Captured evidence changed"] : []),
                ],
            });
        } catch (error) {
            await this.change(checkpoint, {
                state: this.closed ? "cancelled" : "failed",
                reasons: [message(error)],
            });
        } finally {
            this.host.end?.(checkpoint.corpusId);
            clearTimeout(timer);
            this.controllers.delete(controller);
        }
    }

    private async discoverForCheckpoint(
        checkpoint: KnowledgeCheckpoint,
        sources: KnowledgeDocument[],
        signal: AbortSignal,
    ): Promise<string[]> {
        if (!checkpoint.families.includes("questions")) return [];
        try {
            await this.runDiscovery(checkpoint.corpusId, sources, signal);
            return [];
        } catch (error) {
            signal.throwIfAborted();
            return [message(error)];
        }
    }

    private async discoveryCoverage(checkpoint: KnowledgeCheckpoint) {
        const status = await this.host.read(checkpoint.corpusId);
        const receipts = status.discovery.receipts.filter((receipt) =>
            receipt.sources.every((source) =>
                checkpoint.sources.some(
                    (selected) =>
                        selected.sourceId === source.sourceId &&
                        selected.revisionId === source.revisionId,
                ),
            ),
        );
        const inspected = new Set(
            receipts
                .filter((r) => r.state === "complete")
                .flatMap((r) => r.sources.map((source) => source.sourceId)),
        );
        const deferred = checkpoint.sources.filter(
            (source) => !inspected.has(source.sourceId),
        ).length;
        const limited =
            checkpoint.families.includes("questions") &&
            (deferred > 0 ||
                !!status.discovery.error ||
                receipts.some((r) => r.reason));
        return {
            coverage: {
                inspectedSources: inspected.size,
                deferredSources: deferred,
            },
            fingerprints: receipts.map((r) => r.fingerprint),
            limited,
            reasons: limited
                ? [
                      status.discovery.error ??
                          "Discovery coverage or admission is bounded; see receipts",
                  ]
                : [],
        };
    }

    private async current(checkpoint: KnowledgeCheckpoint): Promise<boolean> {
        const { sources } = await this.host.capture(checkpoint.corpusId);
        return checkpoint.sources.every((selected) =>
            sources.some(
                (source) =>
                    source.sourceId === selected.sourceId &&
                    source.revisionId === selected.revisionId,
            ),
        );
    }

    private async change(
        checkpoint: KnowledgeCheckpoint,
        update: Partial<KnowledgeCheckpoint>,
    ): Promise<void> {
        await this.host.write(checkpoint.corpusId, (status) => {
            const stored = status.checkpoints.find(
                (entry) => entry.checkpointId === checkpoint.checkpointId,
            );
            if (!stored) throw new Error("Knowledge checkpoint was removed");
            if (stored.state === "superseded") return;
            Object.assign(stored, update, {
                updatedAt: new Date().toISOString(),
            });
        });
    }

    public async get(
        request: KnowledgeCheckpointRead,
    ): Promise<KnowledgeCheckpoint> {
        validateCorpus(request.corpusId);
        if (
            typeof request.checkpointId !== "string" ||
            Object.keys(request).some(
                (key) => !["corpusId", "checkpointId"].includes(key),
            )
        )
            throw new Error("Invalid knowledge checkpoint reference");
        const checkpoint = (
            await this.host.read(request.corpusId)
        ).checkpoints.find(
            (entry) => entry.checkpointId === request.checkpointId,
        );
        if (!checkpoint) throw new Error("Knowledge checkpoint is unavailable");
        if (
            checkpoint.state === "ready" &&
            (!(await this.current(checkpoint)) ||
                (this.host.maintainedCurrent &&
                    !(await this.host.maintainedCurrent(checkpoint))))
        ) {
            const update = {
                state: "superseded" as const,
                reasons: [
                    ...checkpoint.reasons,
                    "Captured source or maintained view revision changed",
                ],
            };
            await this.change(checkpoint, update);
            return { ...checkpoint, ...update };
        }
        return checkpoint;
    }

    public async wait(
        request: KnowledgeCheckpointWait,
    ): Promise<KnowledgeCheckpoint> {
        if (
            Object.keys(request).some(
                (key) =>
                    !["corpusId", "checkpointId", "timeoutMs"].includes(key),
            )
        )
            throw new Error("Invalid knowledge wait request");
        const deadline =
            Date.now() + validateTimeout(request.timeoutMs ?? 600000);
        const reference = {
            corpusId: request.corpusId,
            checkpointId: request.checkpointId,
        };
        const initial = await this.get(reference);
        if (terminal(initial)) return initial;
        const work = this.checkpoints.get(request.checkpointId);
        if (work) {
            const controller = new AbortController();
            const timer = setTimeout(
                () =>
                    controller.abort(
                        new Error(
                            "Timed out waiting for knowledge checkpoint; work continues",
                        ),
                    ),
                Math.max(0, deadline - Date.now()),
            );
            try {
                await abortable(work, controller.signal);
                return this.get(reference);
            } finally {
                clearTimeout(timer);
            }
        }
        while (Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 500));
            const checkpoint = await this.get(reference);
            if (terminal(checkpoint)) return checkpoint;
        }
        throw new Error(
            "Timed out waiting for knowledge checkpoint; work continues",
        );
    }

    public async close(): Promise<void> {
        this.closed = true;
        for (const timer of this.timers.values()) clearTimeout(timer);
        this.timers.clear();
        for (const controller of this.controllers)
            controller.abort(new Error("Knowledge service is closing"));
        await Promise.allSettled([
            ...this.work.values(),
            ...this.checkpoints.values(),
        ]);
    }
}
