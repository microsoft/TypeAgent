// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { watch, type FSWatcher } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { SessionRegistrationSchema } from "./daemonApi.js";
import { byteOffset } from "./sessionCaptureState.js";
import type {
    CapturedSessionUpdates,
    SessionCaptureOptions,
} from "./sessionCapture.js";
import type { SessionMetadataState } from "./sessionMetadata.js";
import type { SessionNormalizationDiagnostic } from "./sessionNormalization.js";
import type {
    SessionCaptureCheckpoint,
    SessionWatcher,
    SessionWatchRequest,
} from "./sessionWatcher.js";

export type SessionProcessingStage =
    | "configuration"
    | "monitoring"
    | "capture"
    | "restore"
    | "normalize"
    | "metadata"
    | "privacy"
    | "delivery"
    | "reporting";

export type SessionProcessingFailure = {
    stage: SessionProcessingStage;
    // Read progress is not a downstream delivery acknowledgement.
    captureMayHaveAdvanced: boolean;
};

export type SessionWatcherStatus = {
    phase: "waiting" | "processing" | "idle" | "failed" | "stopped";
    monitoring: boolean;
    generation?: string;
    readCheckpoint?: SessionCaptureCheckpoint;
    // Last nonempty batch (or restoration); onStatus observes every diagnostic batch.
    diagnostics: SessionNormalizationDiagnostic[];
    diagnosticCount: number;
    failure?: SessionProcessingFailure;
    reportingFailed?: boolean;
};

export type SessionLifecycleOptions = {
    capture?: Pick<SessionCaptureOptions, "stateDirectory" | "maxRecords">;
    reconcileIntervalMs?: number;
    // Local operational evidence, not privacy-approved output. Never includes payloads.
    // Rejection fails this source closed; getStatus remains available.
    onStatus?: (
        request: SessionWatchRequestIdentity,
        status: SessionWatcherStatus,
    ) => void | Promise<void>;
};

export type SessionWatchRequestIdentity = Pick<
    SessionWatchRequest,
    "projectPath" | "sessionId" | "transcriptPath"
>;

type Monitor = {
    watcher: FSWatcher;
    timer: ReturnType<typeof setInterval>;
};

type SourceState = {
    request: SessionWatchRequest;
    status: SessionWatcherStatus;
    tail: Promise<void>;
    metadata?: SessionMetadataState;
    metadataOutputGeneration?: string;
    monitor?: Monitor;
    watchReady?: Promise<void>;
    signature?: string;
    scheduled: boolean;
    dirty: boolean;
};

function identity(request: SessionWatchRequest): SessionWatchRequestIdentity {
    const { projectPath, sessionId, transcriptPath } = request;
    return { projectPath, sessionId, transcriptPath };
}

function canonicalRequest(request: SessionWatchRequest): SessionWatchRequest {
    const parsed = SessionRegistrationSchema.safeParse(request);
    if (
        !parsed.success ||
        typeof request.transcriptPath !== "string" ||
        !path.isAbsolute(request.transcriptPath)
    ) {
        throw new Error("SessionWatcher registration is invalid");
    }
    return {
        ...parsed.data,
        projectPath: path.normalize(request.projectPath),
        transcriptPath: path.normalize(request.transcriptPath),
    };
}

function registrationKey(request: SessionWatchRequestIdentity): string {
    return JSON.stringify([request.projectPath, request.sessionId]);
}

function sourceKey(request: SessionWatchRequestIdentity): string {
    return JSON.stringify([request.sessionId, request.transcriptPath]);
}

function missing(error: unknown): boolean {
    return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

async function signature(file: string): Promise<string | undefined> {
    try {
        const stat = await fs.stat(file, { bigint: true });
        if (!stat.isFile()) throw new Error("Not a regular transcript");
        return [
            stat.dev,
            stat.ino,
            stat.birthtimeNs,
            stat.size,
            stat.mtimeNs,
            stat.ctimeNs,
        ].join(":");
    } catch (error) {
        if (missing(error)) return undefined;
        throw error;
    }
}

async function existingParent(file: string): Promise<string> {
    let directory = path.dirname(file);
    for (;;) {
        try {
            const stat = await fs.stat(directory);
            if (!stat.isDirectory()) throw new Error("Not a directory");
            return directory;
        } catch (error) {
            const parent = path.dirname(directory);
            if (!missing(error) || parent === directory) throw error;
            directory = parent;
        }
    }
}

function batchStart(
    captured: CapturedSessionUpdates,
): SessionCaptureCheckpoint {
    let start = byteOffset(captured.nextCheckpoint.sourceByteOffset);
    for (const item of [...captured.records, ...captured.diagnostics]) {
        start = Math.min(start, byteOffset(item.source.sourceByteOffset));
    }
    return { ...captured.nextCheckpoint, sourceByteOffset: String(start) };
}

function processingError(stage: SessionProcessingStage): Error {
    return new Error(`SessionWatcher ${stage} failed; inspect source status`);
}

// One daemon owns these local append-only transcripts and serializes each source.
export class SessionLifecycle {
    readonly #sources = new Map<string, SourceState>();
    readonly #registrations = new Map<string, SourceState>();
    readonly #capture: NonNullable<SessionLifecycleOptions["capture"]>;
    readonly #interval: number;
    readonly #onStatus: SessionLifecycleOptions["onStatus"];
    #stopping = false;
    #stopPromise?: Promise<void>;

    constructor(
        readonly pipeline: SessionWatcher,
        readonly configured: () => boolean,
        options: SessionLifecycleOptions,
    ) {
        this.#capture = { ...options.capture };
        this.#interval = options.reconcileIntervalMs ?? 1000;
        this.#onStatus = options.onStatus;
        if (
            !Number.isSafeInteger(this.#interval) ||
            this.#interval < 1 ||
            this.#interval > 2 ** 31 - 1 ||
            !Number.isSafeInteger(this.#capture.maxRecords ?? 1000) ||
            (this.#capture.maxRecords ?? 1000) < 1
        ) {
            throw new Error("SessionWatcher lifecycle options are invalid");
        }
    }

    getStatus(
        request: SessionWatchRequestIdentity,
    ): SessionWatcherStatus | undefined {
        const state = this.#registrations.get(
            registrationKey({
                ...request,
                projectPath: path.normalize(request.projectPath),
            }),
        );
        return state ? structuredClone(state.status) : undefined;
    }

    #register(request: SessionWatchRequest): SourceState {
        if (this.#stopping) throw new Error("SessionWatcher is stopped");
        const seed = canonicalRequest(request);
        const key = registrationKey(seed);
        const existing = this.#registrations.get(key);
        if (existing) {
            if (!isDeepStrictEqual(seed, existing.request)) {
                throw new Error("SessionWatcher registration conflicts");
            }
            return existing;
        }
        if (this.#sources.has(sourceKey(seed))) {
            throw new Error(
                "SessionWatcher capture source already belongs to another project",
            );
        }
        const state: SourceState = {
            request: seed,
            status: {
                phase: "idle",
                monitoring: false,
                diagnostics: [],
                diagnosticCount: 0,
            },
            tail: Promise.resolve(),
            scheduled: false,
            dirty: false,
        };
        this.#sources.set(sourceKey(seed), state);
        this.#registrations.set(key, state);
        return state;
    }

    #enqueue<T>(state: SourceState, operation: () => Promise<T>): Promise<T> {
        const result = state.tail.then(async () => {
            if (state.status.failure) {
                throw processingError(state.status.failure.stage);
            }
            return operation();
        });
        // The returned promise carries the error to the caller. The queue must
        // still settle so stop can drain failed sources.
        state.tail = result.then(
            () => {},
            () => {},
        );
        return result;
    }

    #closeMonitor(state: SourceState): void {
        if (state.monitor) {
            clearInterval(state.monitor.timer);
            state.monitor.watcher.close();
            delete state.monitor;
        }
        state.status.monitoring = false;
    }

    async #report(state: SourceState): Promise<void> {
        try {
            await this.#onStatus?.(
                identity(state.request),
                structuredClone(state.status),
            );
        } catch {
            state.status.reportingFailed = true;
            throw processingError("reporting");
        }
    }

    async #fail(
        state: SourceState,
        failure: SessionProcessingFailure,
    ): Promise<never> {
        // TODO: operator delivery recovery. The daemon must persist a blocked
        // registration; a saved read cursor alone cannot recover a failed delivery.
        state.status.failure ??= failure;
        state.status.phase = "failed";
        this.#closeMonitor(state);
        if (!state.status.reportingFailed) {
            try {
                await this.#report(state);
            } catch {
                // Keep the original failure as well as reportingFailed.
            }
        }
        throw processingError(state.status.failure.stage);
    }

    async #guard<T>(
        state: SourceState,
        stage: SessionProcessingStage,
        operation: () => Promise<T>,
    ): Promise<T> {
        try {
            return await operation();
        } catch {
            return this.#fail(state, {
                stage: state.status.reportingFailed ? "reporting" : stage,
                captureMayHaveAdvanced: false,
            });
        }
    }

    watch(request: SessionWatchRequest): Promise<void> {
        let state: SourceState;
        try {
            state = this.#register(request);
        } catch (error) {
            return Promise.reject(error);
        }
        if (state.status.failure)
            return Promise.reject(processingError(state.status.failure.stage));
        state.watchReady ??= this.#enqueue(state, async () => {
            await this.#guard(state, "configuration", async () => {
                if (!this.configured()) throw processingError("configuration");
            });
            await this.#guard(state, "monitoring", async () => {
                const directory = await existingParent(
                    state.request.transcriptPath,
                );
                // stop may have run while resolving a missing source's ancestor.
                if (this.#stopping) return;
                const watcher = watch(directory, () => this.#schedule(state));
                const timer = setInterval(
                    () => this.#schedule(state),
                    this.#interval,
                );
                state.monitor = { watcher, timer };
                state.status.monitoring = true;
                watcher.on("error", () => {
                    if (this.#stopping || state.status.failure) return;
                    this.#background(
                        this.#enqueue(state, () =>
                            this.#fail(state, {
                                stage: "monitoring",
                                captureMayHaveAdvanced: false,
                            }),
                        ),
                    );
                });
            });
            await this.#reconcile(state, true);
        });
        return state.watchReady;
    }

    #background(operation: Promise<unknown>): void {
        // Every managed failure has already been retained and reported by #fail.
        void operation.catch(() => {});
    }

    #schedule(state: SourceState): void {
        if (this.#stopping || state.status.failure) return;
        state.dirty = true;
        if (state.scheduled) return;
        state.scheduled = true;
        const operation = this.#enqueue(state, async () => {
            try {
                while (
                    state.dirty &&
                    !this.#stopping &&
                    !state.status.failure
                ) {
                    state.dirty = false;
                    await this.#reconcile(state);
                }
            } finally {
                state.scheduled = false;
            }
        });
        this.#background(operation);
    }

    async #reconcile(state: SourceState, force = false): Promise<void> {
        const observed = await this.#guard(state, "monitoring", () =>
            signature(state.request.transcriptPath),
        );
        if (observed === undefined) {
            delete state.signature;
            if (state.status.phase !== "waiting") {
                state.status.phase = "waiting";
                await this.#guard(state, "reporting", () =>
                    this.#report(state),
                );
            }
            return;
        }
        if (!force && observed === state.signature) return;
        await this.#drain(state);
        // Use the pre-drain signature. An append during processing must still
        // cause reconciliation even when the notification was coalesced.
        state.signature = observed;
    }

    async processUpdates(
        request: SessionWatchRequest,
    ): Promise<SessionCaptureCheckpoint> {
        const state = this.#register(request);
        return this.#enqueue(state, () => this.#drain(state));
    }

    async #processBatch(
        state: SourceState,
    ): Promise<{ next: SessionCaptureCheckpoint; progressed: boolean }> {
        let stage: SessionProcessingStage = "configuration";
        let captureMayHaveAdvanced = false;
        try {
            if (!this.configured()) throw processingError(stage);
            state.status.phase = "processing";
            stage = "reporting";
            await this.#report(state);
            stage = "capture";
            captureMayHaveAdvanced = true;
            const captured = await this.pipeline.captureUpdates(
                state.request,
                undefined,
                this.#capture,
            );
            const from = batchStart(captured);
            state.status.generation = captured.generation;
            state.status.readCheckpoint = captured.nextCheckpoint;
            if (
                !state.metadata ||
                state.metadata.generation !== captured.generation
            ) {
                stage = "restore";
                const restored = await this.pipeline.restoreMetadata(
                    state.request,
                    from,
                    captured.generation,
                    this.#capture,
                );
                state.metadata = restored.state;
                if (restored.diagnostics.length) {
                    await this.#diagnostics(state, restored.diagnostics);
                }
            }
            stage = "normalize";
            const batch = this.pipeline.normalizeEvents(
                state.request,
                captured,
            );
            await this.#diagnostics(state, batch.diagnostics);
            stage = "metadata";
            const previous = state.metadata;
            const next = this.pipeline.collectMetadata(
                state.request,
                batch,
                previous,
            );
            // Initial/restored metadata is useful once, even without new events.
            const changed =
                state.status.generation !== previous?.generation ||
                !isDeepStrictEqual(previous?.metadata, next.metadata);
            if (
                batch.events.length ||
                changed ||
                state.metadataOutputGeneration !== batch.generation
            ) {
                stage = "privacy";
                const approved = await this.pipeline.filterForPrivacy({
                    projectPath: state.request.projectPath,
                    sessionId: state.request.sessionId,
                    events: batch.events,
                    metadata: next.metadata,
                });
                if (approved !== null) {
                    stage = "delivery";
                    await this.pipeline.publishUpdate(approved);
                }
                state.metadataOutputGeneration = batch.generation;
            }
            state.metadata = next;
            return {
                next: captured.nextCheckpoint,
                progressed:
                    byteOffset(captured.nextCheckpoint.sourceByteOffset) >
                    byteOffset(from.sourceByteOffset),
            };
        } catch {
            return this.#fail(state, {
                stage: state.status.reportingFailed ? "reporting" : stage,
                captureMayHaveAdvanced,
            });
        }
    }

    async #diagnostics(
        state: SourceState,
        diagnostics: SessionNormalizationDiagnostic[],
    ): Promise<void> {
        if (diagnostics.length) {
            state.status.diagnostics = diagnostics;
            state.status.diagnosticCount += diagnostics.length;
            await this.#report(state);
        }
    }

    async #drain(state: SourceState): Promise<SessionCaptureCheckpoint> {
        let next: SessionCaptureCheckpoint;
        for (;;) {
            const batch = await this.#processBatch(state);
            next = batch.next;
            if (!batch.progressed || this.#stopping) break;
        }
        state.status.phase = "idle";
        await this.#guard(state, "reporting", () => this.#report(state));
        return { ...next };
    }

    stop(): Promise<void> {
        if (this.#stopPromise) return this.#stopPromise;
        this.#stopping = true;
        for (const state of this.#sources.values()) this.#closeMonitor(state);
        this.#stopPromise = (async () => {
            await Promise.all(
                [...this.#sources.values()].map((state) => state.tail),
            );
            const reports = await Promise.allSettled(
                [...this.#sources.values()].map(async (state) => {
                    if (!state.status.failure) {
                        state.status.phase = "stopped";
                        await this.#guard(state, "reporting", () =>
                            this.#report(state),
                        );
                    }
                }),
            );
            if (reports.some((report) => report.status === "rejected")) {
                throw processingError("reporting");
            }
        })();
        return this.#stopPromise;
    }
}
