// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { MacroLearningMode } from "./contracts.js";
import {
    assertCatalogPayload,
    assertRecipeScope,
    assertStoredArtifact,
    assertStoredCapture,
    assertStoredJob,
} from "./recipeCatalogValidation.js";
import type {
    RecipeCapture,
    RecipeCatalog,
    RecipeCatalogEntry,
    RecipeCatalogTransaction,
    RecipeEffectCheckpoint,
    RecipeInvalidation,
    RecipeJob,
    RecipeRevisionRef,
    RecipeRunResult,
    RecipeScope,
} from "./recipeContracts.js";
import { recipePublicationState } from "./recipeValidation.js";

interface Statement {
    get(...values: (string | number)[]): { payload: string } | undefined;
    run(...values: (string | number)[]): unknown;
}
interface Database {
    exec(sql: string): void;
    prepare(sql: string): Statement;
    close(): void;
}

export interface RecipeStoredRun {
    runId: string;
    recipe: RecipeRevisionRef;
    acceptedAt: string;
    cancelRequested: boolean;
    checkpoints: RecipeEffectCheckpoint[];
    result?: RecipeRunResult;
}

interface CatalogState {
    revision: number;
    mode?: MacroLearningMode;
    entries: RecipeCatalogEntry[];
    captures: RecipeCapture[];
    jobs: RecipeJob[];
    runs: RecipeStoredRun[];
}

const sameScope = (a: RecipeScope, b: RecipeScope) =>
    a.workspaceId === b.workspaceId && a.profileId === b.profileId;
const sameRef = (a: RecipeRevisionRef, b: RecipeRevisionRef) =>
    a.recipeId === b.recipeId && a.revision === b.revision;
const clone = <T>(value: T): T => structuredClone(value);

function findEntry(state: CatalogState, ref: RecipeRevisionRef) {
    const entry = state.entries.find((entry) => sameRef(entry.artifact, ref));
    if (!entry) throw new Error("Unknown recipe revision.");
    return entry;
}

function invalidateEntry(
    state: CatalogState,
    scope: RecipeScope,
    ref: RecipeRevisionRef,
    reason: RecipeInvalidation["reason"],
    events: RecipeInvalidation[],
) {
    const entry = findEntry(state, ref);
    if (entry.state === "deleted") throw new Error("Recipe was deleted.");
    if (reason !== "binding_changed") entry.state = reason;
    for (const run of state.runs) {
        if (!run.result && sameRef(run.recipe, ref)) run.cancelRequested = true;
    }
    events.push({
        scope: clone(scope),
        catalogRevision: state.revision + 1,
        recipe: clone(ref),
        reason,
        inFlight: "pin_revision_stop_future_calls",
    });
}

function publish(
    state: CatalogState,
    scope: RecipeScope,
    ref: RecipeRevisionRef,
    captureId: string,
    target: "prepared" | "ready",
    events: RecipeInvalidation[],
    explicitApproval = false,
) {
    const entry = findEntry(state, ref);
    const capture = state.captures.find((c) => c.captureId === captureId);
    if (
        !capture ||
        entry.captureId !== captureId ||
        entry.artifact.provenance.taskId !== capture.taskId ||
        entry.artifact.provenance.tokenId !== capture.tokenId
    )
        throw new Error(
            "Publication requires the artifact's captured evidence.",
        );
    if (["deleted", "superseded"].includes(entry.state))
        throw new Error("A retired revision cannot be republished.");
    if (entry.state === "disabled" && !explicitApproval)
        throw new Error(
            "A disabled revision requires explicit local approval.",
        );
    const permitted = recipePublicationState(
        entry.artifact,
        explicitApproval ? "all" : capture.mode,
    );
    const current = recipePublicationState(
        entry.artifact,
        explicitApproval ? "all" : (state.mode ?? capture.mode),
    );
    if (
        permitted === "candidate" ||
        current === "candidate" ||
        (target === "ready" && (permitted !== "ready" || current !== "ready"))
    )
        throw new Error("Learning mode does not permit this publication.");
    if (target === "ready") {
        for (const other of state.entries) {
            if (
                other !== entry &&
                other.artifact.recipeId === ref.recipeId &&
                other.state === "ready"
            )
                invalidateEntry(
                    state,
                    scope,
                    other.artifact,
                    "superseded",
                    events,
                );
        }
    }
    entry.state = target;
}

function captureIdentity(capture: RecipeCapture) {
    return JSON.stringify([capture.tokenId, capture.sessionId, capture.taskId]);
}

function enqueue(
    state: CatalogState,
    scope: RecipeScope,
    capture: RecipeCapture,
    job: RecipeJob,
): "inserted" | "existing" {
    assertStoredCapture(capture);
    assertStoredJob(job);
    if (!sameScope(scope, capture.scope) || !sameScope(scope, job.scope))
        throw new Error("Capture/job scope mismatch.");
    const existing = state.captures.find(
        (c) => c.captureId === capture.captureId,
    );
    if (existing) {
        if (!isDeepStrictEqual(existing, capture))
            throw new Error("Capture identity collision.");
        return "existing";
    }
    if (
        state.captures.some(
            (c) => captureIdentity(c) === captureIdentity(capture),
        )
    )
        return "existing";
    if (
        capture.mode === "off" ||
        state.mode === "off" ||
        capture.outcome !== "succeeded" ||
        job.captureId !== capture.captureId ||
        job.state !== "queued" ||
        job.attempt !== 0 ||
        job.claim ||
        state.jobs.some((j) => j.jobId === job.jobId)
    )
        throw new Error("Invalid capture/job admission.");
    state.captures.push(clone(capture));
    state.jobs.push(clone(job));
    return "inserted";
}

function validDate(value: string) {
    const date = Date.parse(value);
    if (!Number.isFinite(date)) throw new Error("Invalid lease timestamp.");
    return date;
}

function claim(
    state: CatalogState,
    jobId: string,
    ownerId: string,
    now: string,
    expiresAt: string,
) {
    const timestamp = validDate(now);
    if (!ownerId || validDate(expiresAt) <= timestamp)
        throw new Error("Invalid job lease.");
    const job = state.jobs.find((j) => j.jobId === jobId);
    if (
        !job ||
        !["queued", "authoring", "validating"].includes(job.state) ||
        (job.claim && validDate(job.claim.expiresAt) > timestamp)
    )
        return undefined;
    job.attempt++;
    job.state = "authoring";
    job.claim = { ownerId, token: randomUUID(), expiresAt };
    return clone(job);
}

function updateJob(state: CatalogState, job: RecipeJob, token: string) {
    assertStoredJob(job);
    const index = state.jobs.findIndex((j) => j.jobId === job.jobId);
    const previous = state.jobs[index];
    if (
        !previous?.claim ||
        previous.claim.token !== token ||
        validDate(previous.claim.expiresAt) <= Date.now() ||
        previous.captureId !== job.captureId ||
        !sameScope(previous.scope, job.scope) ||
        previous.attempt !== job.attempt ||
        JSON.stringify(previous.claim) !== JSON.stringify(job.claim)
    )
        throw new Error("Stale or invalid job claim.");
    const next = clone(job);
    if (!["authoring", "validating"].includes(next.state)) delete next.claim;
    state.jobs[index] = next;
}

function transaction(
    state: CatalogState,
    scope: RecipeScope,
    events: RecipeInvalidation[],
): RecipeCatalogTransaction {
    return {
        putImmutable(artifact) {
            assertStoredArtifact(artifact);
            const existing = state.entries.find((e) =>
                sameRef(e.artifact, artifact),
            );
            if (existing) {
                if (!isDeepStrictEqual(existing.artifact, artifact))
                    throw new Error("Immutable revision collision.");
                return;
            }
            state.entries.push({
                artifact: clone(artifact),
                state: "candidate",
                captureId: artifact.provenance.captureId,
            });
        },
        publish: (ref, captureId, target) =>
            publish(state, scope, ref, captureId, target, events),
        invalidate: (ref, reason) =>
            invalidateEntry(state, scope, ref, reason, events),
        enqueueCapture: (capture, job) => enqueue(state, scope, capture, job),
        claimJob: (id, owner, now, expiry) =>
            claim(state, id, owner, now, expiry),
        updateJob: (job, token) => updateJob(state, job, token),
    };
}

/**
 * Local SQLite is the mutation authority, not a JavaScript promise queue.
 * BEGIN IMMEDIATE serializes independent processes; the entire scope, including
 * immutable artifacts and publication pointers, commits or rolls back together.
 * Use a local data directory outside the installed plugin (not a network share).
 * Requires Node's built-in SQLite, available without a flag in Node >=22.13.
 */
export class DurableRecipeCatalog implements RecipeCatalog {
    private readonly db: Database;
    private readonly listeners = new Set<(event: RecipeInvalidation) => void>();

    constructor(dataDirectory: string) {
        let sqlite: { DatabaseSync: new (file: string) => Database };
        try {
            sqlite = createRequire(import.meta.url)(
                "node:sqlite",
            ) as typeof sqlite;
        } catch {
            throw new Error(
                "Local recipe storage requires Node >=22.13 with node:sqlite. Legacy macro routing remains available.",
            );
        }
        mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
        this.db = new sqlite.DatabaseSync(
            path.join(dataDirectory, "recipe-catalog.sqlite"),
        );
        this.db.exec(`
            PRAGMA busy_timeout = 10000;
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = FULL;
            CREATE TABLE IF NOT EXISTS recipe_scopes (
                scope TEXT PRIMARY KEY, payload TEXT NOT NULL
            );
        `);
    }

    close() {
        this.db.close();
        this.listeners.clear();
    }

    private key(scope: RecipeScope) {
        assertRecipeScope(scope);
        return JSON.stringify([scope.workspaceId, scope.profileId]);
    }

    private read(scope: RecipeScope): CatalogState {
        const row = this.db
            .prepare("SELECT payload FROM recipe_scopes WHERE scope = ?")
            .get(this.key(scope));
        if (!row)
            return {
                revision: 0,
                entries: [],
                captures: [],
                jobs: [],
                runs: [],
            };
        const value: unknown = JSON.parse(row.payload);
        assertCatalogPayload(value);
        return value as CatalogState;
    }

    private mutate<T>(
        scope: RecipeScope,
        callback: (state: CatalogState, events: RecipeInvalidation[]) => T,
        expectedRevision?: number,
    ):
        | { status: "committed"; catalogRevision: number; value: T }
        | { status: "conflict"; catalogRevision: number } {
        const events: RecipeInvalidation[] = [];
        this.db.exec("BEGIN IMMEDIATE");
        let result;
        try {
            const state = this.read(scope);
            if (
                expectedRevision !== undefined &&
                state.revision !== expectedRevision
            ) {
                this.db.exec("ROLLBACK");
                return { status: "conflict", catalogRevision: state.revision };
            }
            const value = callback(state, events);
            if (value instanceof Promise)
                throw new Error("Catalog mutations must be synchronous.");
            state.revision++;
            this.db
                .prepare(
                    "INSERT INTO recipe_scopes(scope, payload) VALUES (?, ?) " +
                        "ON CONFLICT(scope) DO UPDATE SET payload = excluded.payload",
                )
                .run(this.key(scope), JSON.stringify(state));
            this.db.exec("COMMIT");
            result = {
                status: "committed" as const,
                catalogRevision: state.revision,
                value,
            };
        } catch (error) {
            this.db.exec("ROLLBACK");
            throw error;
        }
        // Observers cannot roll back an already committed mutation.
        for (const event of events)
            for (const listener of this.listeners) {
                try {
                    listener(clone(event));
                } catch {
                    // Routing always rereads durable state before acceptance/calls.
                }
            }
        return result;
    }

    async snapshot(scope: RecipeScope) {
        const state = this.read(scope);
        return {
            scope: clone(scope),
            catalogRevision: state.revision,
            entries: state.entries,
        };
    }

    async transact(
        scope: RecipeScope,
        expectedRevision: number,
        mutate: (tx: RecipeCatalogTransaction) => void,
    ) {
        return this.mutate(
            scope,
            (state, events) => mutate(transaction(state, scope, events)),
            expectedRevision,
        );
    }

    subscribe(listener: (event: RecipeInvalidation) => void) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    async getCapture(scope: RecipeScope, captureId: string) {
        return this.read(scope).captures.find((c) => c.captureId === captureId);
    }

    async getJob(scope: RecipeScope, jobId: string) {
        return this.read(scope).jobs.find((j) => j.jobId === jobId);
    }

    async listJobs(scope: RecipeScope) {
        return this.read(scope).jobs;
    }

    async getArtifact(scope: RecipeScope, ref: RecipeRevisionRef) {
        return findEntry(this.read(scope), ref).artifact;
    }

    async list(scope: RecipeScope) {
        return (await this.snapshot(scope)).entries.map((entry) => ({
            recipeId: entry.artifact.recipeId,
            revision: entry.artifact.revision,
            name: entry.artifact.name,
            state: entry.state,
        }));
    }

    async setLearningMode(scope: RecipeScope, mode: MacroLearningMode) {
        if (!["off", "prepare", "read-only", "all"].includes(mode))
            throw new Error("Invalid learning mode.");
        return this.mutate(scope, (state) => {
            state.mode = mode;
        });
    }

    async approve(scope: RecipeScope, ref: RecipeRevisionRef) {
        return this.mutate(scope, (state, events) =>
            publish(
                state,
                scope,
                ref,
                findEntry(state, ref).captureId,
                "ready",
                events,
                true,
            ),
        );
    }

    async disable(scope: RecipeScope, ref: RecipeRevisionRef) {
        return this.mutate(scope, (state, events) =>
            invalidateEntry(state, scope, ref, "disabled", events),
        );
    }

    async delete(scope: RecipeScope, ref: RecipeRevisionRef) {
        return this.mutate(scope, (state, events) =>
            invalidateEntry(state, scope, ref, "deleted", events),
        );
    }

    async cancelJob(scope: RecipeScope, jobId: string) {
        return this.mutate(scope, (state) => {
            const job = state.jobs.find((j) => j.jobId === jobId);
            if (!job) throw new Error("Unknown job.");
            if (!["queued", "authoring", "validating"].includes(job.state))
                throw new Error("Job has no active work to cancel.");
            job.state = "blocked";
            job.message = "Cancelled locally.";
            delete job.claim;
        });
    }

    async acceptRun(
        scope: RecipeScope,
        ref: RecipeRevisionRef,
        expectedRevision: number,
        runId: string,
    ) {
        return this.mutate(
            scope,
            (state) => {
                if (findEntry(state, ref).state !== "ready")
                    throw new Error("Recipe is not ready.");
                if (state.runs.some((r) => r.runId === runId))
                    throw new Error("Duplicate run ID.");
                const run: RecipeStoredRun = {
                    runId,
                    recipe: clone(ref),
                    acceptedAt: new Date().toISOString(),
                    cancelRequested: false,
                    checkpoints: [],
                };
                state.runs.push(run);
                return clone(run);
            },
            expectedRevision,
        );
    }

    async mayCall(scope: RecipeScope, runId: string) {
        const state = this.read(scope);
        const run = state.runs.find((r) => r.runId === runId);
        return Boolean(
            run &&
                !run.result &&
                !run.cancelRequested &&
                findEntry(state, run.recipe).state === "ready",
        );
    }

    async cancelRun(scope: RecipeScope, runId: string) {
        return this.mutate(scope, (state) => {
            const run = state.runs.find((r) => r.runId === runId);
            if (!run) throw new Error("Unknown run.");
            if (run.result) throw new Error("Run has already finished.");
            run.cancelRequested = true;
        });
    }

    async beginCall(
        scope: RecipeScope,
        runId: string,
        checkpoint: RecipeEffectCheckpoint,
    ) {
        const result = this.mutate(scope, (state) => {
            const run = state.runs.find((r) => r.runId === runId);
            if (
                !run ||
                run.result ||
                run.cancelRequested ||
                findEntry(state, run.recipe).state !== "ready"
            )
                return false;
            if (run.checkpoints.some((c) => c.callId === checkpoint.callId))
                throw new Error("Duplicate call ID.");
            run.checkpoints.push(clone(checkpoint));
            return true;
        });
        return result.status === "committed" && result.value;
    }

    async completeCall(
        scope: RecipeScope,
        runId: string,
        checkpoint: RecipeEffectCheckpoint,
    ) {
        this.mutate(scope, (state) => {
            const run = state.runs.find((r) => r.runId === runId);
            const index = run?.checkpoints.findIndex(
                (c) => c.callId === checkpoint.callId,
            );
            if (!run || index === undefined || index < 0)
                throw new Error("Unknown dispatched call.");
            run.checkpoints[index] = clone(checkpoint);
        });
    }

    async finishRun(scope: RecipeScope, result: RecipeRunResult) {
        return this.mutate(scope, (state) => {
            const run = state.runs.find((r) => r.runId === result.runId);
            if (!run || !sameRef(run.recipe, result) || !result.accepted)
                throw new Error("Run result does not match acceptance.");
            if (run.result) throw new Error("Run result is immutable.");
            run.result = clone(result);
            const completed = new Set(result.completedCallIds);
            for (const checkpoint of run.checkpoints) {
                const index = run.result.checkpoints.findIndex(
                    (c) => c.callId === checkpoint.callId,
                );
                if (index < 0) run.result.checkpoints.push(clone(checkpoint));
                else run.result.checkpoints[index] = clone(checkpoint);
                if (checkpoint.phase === "completed")
                    completed.add(checkpoint.callId);
            }
            run.result.completedCallIds = [...completed];
            // The caller receives the same durable evidence, including partial
            // effects recorded before a trusted executor threw.
            result.checkpoints = clone(run.result.checkpoints);
            result.completedCallIds = [...completed];
        });
    }

    async listRuns(scope: RecipeScope) {
        // An unfinished accepted run is never automatically replayed on restart.
        return this.read(scope).runs;
    }
}
