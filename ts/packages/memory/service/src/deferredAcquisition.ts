// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import lockfile from "proper-lockfile";
import {
    normalizeTemporalContext,
    temporalContextFromHeaders,
} from "@typeagent/knowpro";
import { writeRunbookJson } from "./durableRunbookJson.js";
import { redactRunbookText, redactRunbookValue } from "./runbookRedaction.js";
import { revisionDigest } from "./revisionAssetStore.js";
import type {
    IngestionJobStatus,
    IngestionSource,
    MemorySource,
} from "./types.js";
import type {
    AcquisitionConsumer,
    AcquisitionPeriodicOptions,
    AcquisitionReadiness,
    AcquisitionRemoval,
    AcquisitionRequest,
    AcquisitionRequestInput,
    AcquisitionTool,
    DeferredAcquisitionConfig,
    DeferredAcquisitionHost,
} from "./acquisitionTypes.js";

interface StoredAcquisitions {
    version: 1;
    suppressed: string[];
    denyAutomatic: boolean;
    requests: AcquisitionRequest[];
}

const leasePublicationGraceMs = 5_000;

function hash(value: unknown): string {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function bounded(
    value: number | undefined,
    fallback: number,
    max: number,
): number {
    const result = value ?? fallback;
    if (!Number.isSafeInteger(result) || result < 1 || result > max)
        throw new Error(
            `Acquisition limit must be an integer from 1 to ${max}`,
        );
    return result;
}

function consumerKey(consumer: AcquisitionConsumer): string {
    return JSON.stringify([
        consumer.viewId,
        consumer.slotId,
        consumer.definitionRevision,
    ]);
}

function terminal(request: AcquisitionRequest): boolean {
    return ["resolved", "cancelled"].includes(request.state);
}

function lineageIdentity(
    request: AcquisitionRequestInput & { lineageIdentity?: string },
): string {
    return (
        request.lineageIdentity ??
        hash([
            request.corpusId,
            request.principalId,
            request.policyId,
            request.lineage.rootId,
        ])
    );
}

function stagedRevisionId(source: IngestionSource): string {
    const text = source.text ?? "";
    const context =
        source.temporalContext ??
        (source.authoredAt === undefined
            ? temporalContextFromHeaders(text)
            : {
                  version: 1 as const,
                  scopes: [
                      {
                          ownerId: "document",
                          start: 0,
                          end: text.length,
                          messageTime: source.authoredAt,
                      },
                  ],
              });
    return revisionDigest(
        createHash("sha256").update(text).digest("hex"),
        source.assets ?? [],
        context === undefined
            ? undefined
            : normalizeTemporalContext(context, text.length),
    );
}

function matchesStagedRevision(
    source: MemorySource | undefined,
    staged: IngestionSource,
): boolean {
    return (
        source !== undefined &&
        source.activeRevisionId === stagedRevisionId(staged) &&
        hash(source.tags ?? []) === hash(staged.tags ?? []) &&
        source.metadata?.project === staged.metadata?.project &&
        source.canonicalUri === staged.canonicalUri
    );
}

function completedAcquisitionJob(
    job: IngestionJobStatus | undefined,
    request: AcquisitionRequest,
): boolean {
    return (
        job?.state === "complete" &&
        job.corpusId === request.corpusId &&
        job.sourceId === request.sourceId &&
        job.revisionId === request.receipt?.revisionId
    );
}

function jobActive(job: IngestionJobStatus | undefined): boolean {
    return (
        job !== undefined &&
        !["complete", "partial", "failed", "cancelled"].includes(job.state)
    );
}

export class DeferredAcquisitionCoordinator {
    private readonly tools = new Map<string, AcquisitionTool>();
    private readonly owner = randomUUID();
    private readonly controllers = new Map<
        string,
        { fence: number; controller: AbortController }
    >();
    private readonly runs = new Set<Promise<AcquisitionRequest[]>>();
    private timer: ReturnType<typeof setTimeout> | undefined;
    private closed = false;
    private active = 0;
    private readonly limits;

    constructor(
        private readonly rootDirectory: string,
        private readonly host: DeferredAcquisitionHost,
        private readonly config: DeferredAcquisitionConfig = {},
    ) {
        this.limits = {
            requests: bounded(config.maxRequests, 64, 128),
            calls: bounded(config.maxCallsPerRequest, 1, 4),
            lineageCalls: bounded(config.maxLineageCalls, 4, 16),
            retries: bounded(config.maxRetries, 2, 3),
            bytes: bounded(config.maxBytes, 256 * 1024, 1024 * 1024),
            duration: bounded(config.maxDurationMs, 30_000, 120_000),
            concurrency: bounded(config.maxConcurrency, 1, 4),
        };
        for (const tool of config.tools ?? []) {
            if (this.tools.has(tool.id))
                throw new Error("Duplicate acquisition tool");
            this.tools.set(tool.id, tool);
        }
    }

    private directory(corpusId: string): string {
        if (!/^[a-zA-Z0-9_-]{1,200}$/.test(corpusId))
            throw new Error("Invalid acquisition corpus ID");
        return path.join(this.rootDirectory, corpusId, "acquisitions");
    }

    private async transaction<T>(
        corpusId: string,
        operation: (store: StoredAcquisitions) => Promise<T> | T,
    ): Promise<T> {
        const directory = this.directory(corpusId);
        await mkdir(directory, { recursive: true });
        const release = await lockfile.lock(directory, {
            realpath: false,
            retries: { retries: 50, minTimeout: 10, maxTimeout: 50 },
        });
        try {
            const file = path.join(directory, "requests.json");
            let store: StoredAcquisitions;
            try {
                store = JSON.parse(
                    await readFile(file, "utf8"),
                ) as StoredAcquisitions;
                if (store.version !== 1)
                    throw new Error("Unsupported acquisition store");
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT")
                    throw error;
                store = {
                    version: 1,
                    requests: [],
                    suppressed: [],
                    denyAutomatic: false,
                };
            }
            const result = await operation(store);
            await writeRunbookJson(file, JSON.stringify(store));
            return structuredClone(result);
        } finally {
            await release();
        }
    }

    private validateInput(input: AcquisitionRequestInput): void {
        for (const value of [
            input.principalId,
            input.policyId,
            input.toolId,
            input.resourceIdentity,
            input.scopeFingerprint,
            input.lineage.rootId,
        ]) {
            if (
                typeof value !== "string" ||
                !value.trim() ||
                value.length > 2048
            )
                throw new Error(
                    "Acquisition requires explicit bounded authority and identity",
                );
        }
        if (!input.consumers.length || input.consumers.length > 32)
            throw new Error("Acquisition requires 1 to 32 consumers");
        if (
            input.sourceTags !== undefined &&
            (!Array.isArray(input.sourceTags) ||
                input.sourceTags.length > 32 ||
                input.sourceTags.some(
                    (tag) =>
                        typeof tag !== "string" ||
                        !tag.trim() ||
                        tag.length > 100,
                ))
        )
            throw new Error("Acquisition requires bounded source tags");
        if (
            input.sourceProject !== undefined &&
            (typeof input.sourceProject !== "string" ||
                !input.sourceProject.trim() ||
                input.sourceProject.length > 200)
        )
            throw new Error("Acquisition requires a bounded source project");
        for (const consumer of input.consumers) {
            if (
                ![
                    consumer.viewId,
                    consumer.slotId,
                    consumer.definitionRevision,
                ].every(
                    (value) =>
                        typeof value === "string" &&
                        value.length > 0 &&
                        value.length <= 200,
                )
            )
                throw new Error("Invalid acquisition consumer");
        }
        if (Buffer.byteLength(JSON.stringify(input)) > 32 * 1024)
            throw new Error("Acquisition request exceeds byte limit");
        if (
            JSON.stringify(redactRunbookValue(input.authorizedArguments)) !==
            JSON.stringify(input.authorizedArguments)
        )
            throw new Error(
                "Acquisition arguments must not contain credentials",
            );
        bounded(input.maxCalls, 1, this.limits.calls);
        bounded(input.lineage.maxCalls, 1, this.limits.lineageCalls);
    }

    async add(input: AcquisitionRequestInput): Promise<AcquisitionRequest> {
        if (this.closed) throw new Error("Acquisition coordinator closed");
        this.validateInput(input);
        const inventory = await this.host.listQuestions(input.corpusId);
        if (
            !input.consumers.every((consumer) =>
                inventory.items.some(
                    (question) =>
                        question.viewId === consumer.viewId &&
                        question.slot.id === consumer.slotId &&
                        question.definitionRevision ===
                            consumer.definitionRevision &&
                        question.slot.approval === "approved",
                ),
            )
        )
            throw new Error(
                "Acquisition consumer is not an approved current question",
            );
        const identity = hash([
            input.corpusId,
            input.principalId,
            input.policyId,
            input.toolId,
            input.resourceIdentity,
            [...new Set(input.sourceTags ?? [])].sort(),
            input.sourceProject ?? null,
        ]);
        return this.transaction(input.corpusId, (store) => {
            if (store.denyAutomatic || store.suppressed.includes(identity))
                throw new Error("Acquisition suppressed by removal");
            const equivalent = store.requests.find(
                (request) =>
                    !terminal(request) &&
                    request.identity === identity &&
                    request.scopeFingerprint === input.scopeFingerprint &&
                    hash(request.authorizedArguments) ===
                        hash(input.authorizedArguments) &&
                    request.lineage.rootId === input.lineage.rootId,
            );
            if (equivalent) {
                const consumers = new Map(
                    equivalent.consumers.map((c) => [consumerKey(c), c]),
                );
                input.consumers.forEach(
                    ({ viewId, slotId, definitionRevision }) => {
                        const consumer = { viewId, slotId, definitionRevision };
                        consumers.set(consumerKey(consumer), consumer);
                    },
                );
                if (consumers.size > 32)
                    throw new Error("Too many acquisition consumers");
                equivalent.consumers = [...consumers.values()];
                return equivalent;
            }
            if (store.requests.length >= this.limits.requests)
                throw new Error("Acquisition request capacity exhausted");
            const now = new Date().toISOString();
            const request: AcquisitionRequest = {
                corpusId: input.corpusId,
                principalId: input.principalId,
                policyId: input.policyId,
                toolId: input.toolId,
                resourceIdentity: input.resourceIdentity,
                scopeFingerprint: input.scopeFingerprint,
                ...(input.sourceTags === undefined
                    ? {}
                    : { sourceTags: [...input.sourceTags] }),
                ...(input.sourceProject === undefined
                    ? {}
                    : { sourceProject: input.sourceProject }),
                authorizedArguments: structuredClone(input.authorizedArguments),
                consumers: input.consumers.map(
                    ({ viewId, slotId, definitionRevision }) => ({
                        viewId,
                        slotId,
                        definitionRevision,
                    }),
                ),
                lineage: {
                    rootId: input.lineage.rootId,
                    maxCalls: input.lineage.maxCalls,
                },
                ...(input.maxCalls === undefined
                    ? {}
                    : { maxCalls: input.maxCalls }),
                requestId: randomUUID(),
                identity,
                lineageIdentity: hash([
                    input.corpusId,
                    input.principalId,
                    input.policyId,
                    input.lineage.rootId,
                ]),
                sourceId: `acquired-${identity}`,
                state: "pending",
                calls: 0,
                retries: 0,
                fence: 0,
                createdAt: now,
                updatedAt: now,
            };
            store.requests.push(request);
            return request;
        });
    }

    list(corpusId: string): Promise<AcquisitionRequest[]> {
        return this.transaction(corpusId, (store) => store.requests);
    }

    async cancel(corpusId: string, requestId: string): Promise<void> {
        await this.transaction(corpusId, (store) => {
            const request = store.requests.find(
                (r) => r.requestId === requestId,
            );
            if (request) this.scrub(request);
        });
        this.controllers.get(requestId)?.controller.abort();
    }

    private scrub(request: AcquisitionRequest): void {
        request.lineageIdentity = lineageIdentity(request);
        request.lineage.rootId = "";
        request.fence++;
        request.state = "cancelled";
        request.authorizedArguments = {};
        request.resourceIdentity = "";
        request.scopeFingerprint = "";
        delete request.sourceTags;
        delete request.sourceProject;
        request.consumers = [];
        delete request.staged;
        delete request.lease;
        delete request.receipt;
        delete request.error;
        request.updatedAt = new Date().toISOString();
    }

    /** Call within the host removal barrier, before its source purge commits. */
    async suppress(
        corpusId: string,
        removal: AcquisitionRemoval,
    ): Promise<void> {
        if (
            (removal.identities?.length ?? 0) > 128 ||
            removal.identities?.some(
                (identity) => !/^[a-f0-9]{64}$/.test(identity),
            )
        )
            throw new Error("Invalid acquisition suppression identities");
        const ids = await this.transaction(corpusId, (store) => {
            if (removal.uncertain) store.denyAutomatic = true;
            const suppressed = new Set([
                ...store.suppressed,
                ...(removal.identities ?? []),
            ]);
            const cancelled: string[] = [];
            for (const request of store.requests) {
                if (
                    removal.uncertain ||
                    suppressed.has(request.identity) ||
                    removal.sourceIds?.includes(request.sourceId) ||
                    request.consumers.some((c) =>
                        removal.viewIds?.includes(c.viewId),
                    )
                ) {
                    suppressed.add(request.identity);
                    cancelled.push(request.requestId);
                    this.scrub(request);
                }
            }
            if (suppressed.size > 128) store.denyAutomatic = true;
            store.suppressed = [...suppressed].slice(0, 128);
            return cancelled;
        });
        ids.forEach((id) => this.controllers.get(id)?.controller.abort());
    }

    runOnce(corpusId: string): Promise<AcquisitionRequest[]> {
        if (this.closed)
            return Promise.reject(new Error("Acquisition coordinator closed"));
        const run = this.run(corpusId);
        this.runs.add(run);
        void run.finally(() => this.runs.delete(run)).catch(() => {});
        return run;
    }

    private async run(corpusId: string): Promise<AcquisitionRequest[]> {
        const requests = await this.list(corpusId);
        let index = 0;
        const available = Math.max(0, this.limits.concurrency - this.active);
        this.active += available;
        await Promise.all(
            Array.from({ length: available }, async () => {
                try {
                    while (index < requests.length && !this.closed) {
                        const request = requests[index++];
                        if (!terminal(request)) await this.process(request);
                    }
                } finally {
                    this.active--;
                }
            }),
        );
        return this.list(corpusId);
    }

    private validLease(
        current: AcquisitionRequest,
        claimed: AcquisitionRequest,
    ): boolean {
        return (
            current.fence === claimed.fence &&
            current.lease?.owner === this.owner &&
            current.lease.expiresAt > Date.now() &&
            !terminal(current)
        );
    }

    private async update(
        claimed: AcquisitionRequest,
        operation: (current: AcquisitionRequest) => void,
    ): Promise<boolean> {
        return this.transaction(claimed.corpusId, (store) => {
            const current = store.requests.find(
                (r) => r.requestId === claimed.requestId,
            );
            if (!current || !this.validLease(current, claimed)) return false;
            operation(current);
            current.updatedAt = new Date().toISOString();
            return true;
        });
    }

    private status(
        readiness: AcquisitionReadiness,
        request: AcquisitionRequest,
    ): "cancelled" | "resolved" | "deferred" | "ready" {
        if (!readiness.authorityValid) return "cancelled";
        const consumers = request.consumers.map((consumer) =>
            readiness.consumers.find(
                (c) => consumerKey(c) === consumerKey(consumer),
            ),
        );
        if (consumers.some((c) => !c)) return "deferred";
        if (consumers.every((c) => c?.status === "obsolete")) return "resolved";
        if (
            !readiness.scopeEvaluated ||
            readiness.pendingJobIds.length ||
            readiness.pendingBatchIds.length
        )
            return "deferred";
        if (!consumers.some((c) => c?.status === "missing")) return "resolved";
        return "ready";
    }

    private async process(snapshot: AcquisitionRequest): Promise<void> {
        const claimed = await this.transaction(snapshot.corpusId, (store) => {
            const request = store.requests.find(
                (r) => r.requestId === snapshot.requestId,
            );
            if (
                !request ||
                terminal(request) ||
                (request.lease && request.lease.expiresAt > Date.now())
            )
                return undefined;
            request.fence++;
            request.lease = {
                owner: this.owner,
                expiresAt:
                    Date.now() + this.limits.duration + leasePublicationGraceMs,
            };
            return request;
        });
        if (!claimed) return;
        try {
            const readiness = await this.host.inspect(claimed);
            if (this.closed) return;
            const status = this.status(readiness, claimed);
            if (claimed.staged) {
                await this.admit(claimed);
                return;
            }
            if (status !== "ready") {
                await this.update(claimed, (current) => {
                    if (status === "cancelled") this.scrub(current);
                    else current.state = status;
                    delete current.lease;
                });
                return;
            }
            if (!claimed.staged) {
                if (claimed.retries >= this.limits.retries) {
                    await this.update(claimed, (current) => {
                        delete current.lease;
                    });
                    return;
                }
                if (!this.config.toolsEnabled) {
                    await this.update(claimed, (current) => {
                        current.state = "deferred";
                        current.error = "Acquisition tools disabled";
                        delete current.lease;
                    });
                    return;
                }
                await this.acquire(claimed);
            }
            if (!this.closed) await this.admit(claimed);
        } catch (error) {
            await this.update(claimed, (current) => {
                current.retries++;
                current.state =
                    current.state === "ingested"
                        ? "ingested"
                        : current.staged
                          ? "acquired"
                          : "failed";
                current.error =
                    error instanceof Error
                        ? redactRunbookText(error.message.slice(0, 500))
                        : "Acquisition failed";
                delete current.lease;
            });
        } finally {
            if (
                this.controllers.get(claimed.requestId)?.fence === claimed.fence
            )
                this.controllers.delete(claimed.requestId);
            if (this.closed)
                await this.update(claimed, (current) => {
                    delete current.lease;
                });
        }
    }

    private async acquire(claimed: AcquisitionRequest): Promise<void> {
        const tool = this.tools.get(claimed.toolId);
        if (!tool) throw new Error("Acquisition tool not authorized");
        const previousSource = await this.host.getSource(
            claimed.corpusId,
            claimed.sourceId,
        );
        if (this.closed) return;
        const permitted = await this.transaction(claimed.corpusId, (store) => {
            const current = store.requests.find(
                (r) => r.requestId === claimed.requestId,
            );
            if (!current || !this.validLease(current, claimed)) return false;
            const lineage = store.requests.filter(
                (r) => lineageIdentity(r) === lineageIdentity(current),
            );
            const allowance = Math.min(
                ...lineage.map((r) => r.lineage.maxCalls),
            );
            if (
                current.calls >= (current.maxCalls ?? 1) ||
                lineage.reduce((sum, r) => sum + r.calls, 0) >= allowance
            )
                throw new Error("Acquisition call allowance exhausted");
            current.calls++;
            current.state = "fetching";
            return true;
        });
        if (!permitted) return;
        if (this.closed) return;
        const controller = new AbortController();
        this.controllers.set(claimed.requestId, {
            fence: claimed.fence,
            controller,
        });
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            const timeout = new Promise<never>((_resolve, reject) => {
                timer = setTimeout(
                    () => {
                        controller.abort();
                        reject(new Error("Acquisition duration exceeded"));
                    },
                    Math.max(
                        1,
                        claimed.lease!.expiresAt -
                            Date.now() -
                            leasePublicationGraceMs,
                    ),
                );
                controller.signal.addEventListener(
                    "abort",
                    () => reject(new Error("Acquisition aborted")),
                    { once: true },
                );
            });
            const result = await Promise.race([
                tool.read(
                    structuredClone(claimed.authorizedArguments),
                    controller.signal,
                ),
                timeout,
            ]);
            if (
                typeof result.text !== "string" ||
                typeof result.title !== "string"
            )
                throw new Error("Acquisition tool returned invalid text");
            if (Buffer.byteLength(JSON.stringify(result)) > this.limits.bytes)
                throw new Error("Acquisition response exceeds byte limit");
            const staged = {
                corpusId: claimed.corpusId,
                source: {
                    sourceId: claimed.sourceId,
                    sourceType: "text" as const,
                    title: result.title,
                    text: result.text,
                    ...(claimed.sourceTags === undefined
                        ? {}
                        : { tags: [...claimed.sourceTags] }),
                    ...(result.canonicalUri === undefined
                        ? {}
                        : { canonicalUri: result.canonicalUri }),
                    ...(result.authoredAt === undefined
                        ? {}
                        : { authoredAt: result.authoredAt }),
                    ...(result.sourceModifiedAt === undefined
                        ? {}
                        : { sourceModifiedAt: result.sourceModifiedAt }),
                    capturedAt: new Date().toISOString(),
                    metadata: {
                        ...(claimed.sourceProject === undefined
                            ? {}
                            : { project: claimed.sourceProject }),
                        acquisitionIdentity: claimed.identity,
                        principalId: claimed.principalId,
                        policyId: claimed.policyId,
                        toolId: claimed.toolId,
                    },
                },
                pipeline: {
                    updatePolicy: "skipIfUnchanged" as const,
                    ...(previousSource === undefined
                        ? {}
                        : {
                              expectedActiveRevisionId:
                                  previousSource.activeRevisionId,
                          }),
                },
            };
            if (
                await this.update(claimed, (current) => {
                    current.staged = staged;
                    current.state = "acquired";
                    delete current.error;
                })
            )
                claimed.staged = staged;
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    private async admit(claimed: AcquisitionRequest): Promise<void> {
        if (!claimed.staged) return;
        await this.host.withAdmissionBarrier(claimed.corpusId, () =>
            this.transaction(claimed.corpusId, async (store) => {
                const current = store.requests.find(
                    (r) => r.requestId === claimed.requestId,
                );
                if (
                    !current ||
                    !this.validLease(current, claimed) ||
                    !current.staged
                )
                    return;
                const readiness = await this.host.inspect(current);
                const status = this.status(readiness, current);
                if (status === "cancelled" || status === "resolved") {
                    if (status === "cancelled") this.scrub(current);
                    else current.state = "resolved";
                    delete current.lease;
                    return;
                }
                if (current.state === "ingested") {
                    delete current.error;
                    delete current.lease;
                    return;
                }
                const source = await this.host.getSource(
                    current.corpusId,
                    current.sourceId,
                );
                const job =
                    current.receipt &&
                    (await this.host.getJob(current.receipt.jobId));
                if (!this.validLease(current, claimed)) return;
                if (this.prepareAdmission(current, source, job, status)) {
                    current.receipt = await this.host.admit(
                        structuredClone(current.staged),
                    );
                    current.state =
                        current.receipt.state === "complete"
                            ? "ingested"
                            : "ingesting";
                    delete current.error;
                }
                delete current.lease;
            }),
        );
    }

    private prepareAdmission(
        current: AcquisitionRequest,
        source: MemorySource | undefined,
        job: IngestionJobStatus | undefined,
        status: "deferred" | "ready",
    ): boolean {
        const staged = current.staged;
        if (!staged) return false;
        const revision = source?.revisions.find(
            (r) => r.revisionId === source.activeRevisionId,
        );
        const sameRevision = matchesStagedRevision(source, staged.source);
        if (
            completedAcquisitionJob(job, current) ||
            (sameRevision && revision?.state === "ready")
        ) {
            current.state = "ingested";
            delete current.error;
            return false;
        }
        if (jobActive(job)) {
            current.state = "ingesting";
            return false;
        }
        if (status === "deferred" || current.retries >= this.limits.retries) {
            current.state = "acquired";
            return false;
        }
        if (
            source &&
            !sameRevision &&
            source.activeRevisionId !==
                staged.pipeline?.expectedActiveRevisionId
        )
            throw new Error(
                "Acquisition source revision changed; explicit authorization required",
            );
        if (
            sameRevision &&
            ["accepted", "processing"].includes(revision?.state ?? "")
        ) {
            current.state = "ingesting";
            delete current.error;
            return false;
        }
        if (job && ["failed", "partial", "cancelled"].includes(job.state)) {
            current.retries++;
            current.error = "Acquisition ingestion did not complete";
            if (current.retries >= this.limits.retries) {
                current.state = "acquired";
                return false;
            }
        }
        return true;
    }

    startPeriodic(options: AcquisitionPeriodicOptions): void {
        if (!this.config.periodicEnabled || this.closed)
            throw new Error("Periodic acquisition disabled");
        if (this.timer) throw new Error("Periodic acquisition already started");
        bounded(options.maxTicks, 1, 1000);
        bounded(options.intervalMs, 1000, 86_400_000);
        if (
            options.intervalMs < 10 ||
            !options.corpusIds.length ||
            options.corpusIds.length > 32
        )
            throw new Error("Invalid periodic acquisition scope");
        options.corpusIds.forEach((id) => this.directory(id));
        let ticks = 0;
        const tick = async () => {
            try {
                for (const corpusId of options.corpusIds) {
                    if (this.closed) break;
                    await this.runOnce(corpusId);
                }
            } catch (error) {
                options.onError?.(error);
            } finally {
                ticks++;
                this.timer =
                    !this.closed && ticks < options.maxTicks
                        ? setTimeout(() => void tick(), options.intervalMs)
                        : undefined;
            }
        };
        this.timer = setTimeout(() => void tick(), options.intervalMs);
    }

    async close(): Promise<void> {
        this.closed = true;
        if (this.timer) clearTimeout(this.timer);
        this.timer = undefined;
        for (const { controller } of this.controllers.values())
            controller.abort();
        await Promise.allSettled(this.runs);
    }
}
