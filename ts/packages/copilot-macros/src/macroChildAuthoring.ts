// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomUUID } from "node:crypto";
import path from "node:path";
import { RevisionRecords, withRecordLock } from "./revisionRecords.js";
import type {
    MacroAuthoringClaim,
    MacroAuthoringRequest,
    MacroAuthoringSubmission,
    MacroLearningJob,
} from "./contracts.js";
import { recipeDigest } from "./recipeCore.js";
import { DurableRecipeAuthoringContextStore } from "./recipeAuthoringStore.js";
import { redactTraceValue } from "./redaction.js";

export class MacroAuthoringPending extends Error {
    constructor() {
        super("Waiting for a compatible Copilot authoring host.");
    }
}

interface StoredRequest {
    requestId: string;
    jobId: string;
    cwd: string;
    captureId: string;
    contextDigest: string;
    prompt: string;
    promptDigest: string;
    lease?: {
        id: string;
        workerId: string;
        sessionId: string;
        expiresAt: string;
    };
    outcome?: MacroAuthoringSubmission["outcome"];
}

const maxTextBytes = 1_048_576;
const maxStateBytes = 16 * maxTextBytes;

function boundedText(
    value: unknown,
    limit = maxTextBytes,
): asserts value is string {
    if (
        typeof value !== "string" ||
        !value.trim() ||
        Buffer.byteLength(value) > limit
    )
        throw new Error("Invalid or oversized child authoring text.");
}

function normalizeCwd(cwd: string): string {
    boundedText(cwd, 4096);
    return path.resolve(cwd).toLowerCase();
}

function parseRequests(value: unknown): StoredRequest[] {
    if (!Array.isArray(value) || value.length > 512)
        throw new Error("Malformed child authoring storage.");
    for (const item of value) {
        if (!item || typeof item !== "object")
            throw new Error("Malformed child authoring request.");
        for (const key of [
            "requestId",
            "jobId",
            "cwd",
            "captureId",
            "contextDigest",
            "prompt",
            "promptDigest",
        ])
            boundedText(item[key]);
        if (
            item.promptDigest !== recipeDigest(item.prompt) ||
            item.requestId !==
                recipeDigest(JSON.stringify([item.jobId, item.promptDigest]))
        )
            throw new Error("Child authoring request digest mismatch.");
        if (item.lease) {
            for (const key of ["id", "workerId", "sessionId", "expiresAt"])
                boundedText(item.lease[key], 4096);
            if (!Number.isFinite(Date.parse(item.lease.expiresAt)))
                throw new Error("Invalid child authoring lease.");
        }
        if (item.outcome) validateOutcome(item.outcome);
    }
    if (new Set(value.map((item) => item.requestId)).size !== value.length)
        throw new Error("Duplicate child authoring requests.");
    return value;
}

function validateOutcome(value: MacroAuthoringSubmission["outcome"]): void {
    if (value?.status === "completed") {
        boundedText(value.text);
        boundedText(value.childId, 4096);
        if (redactTraceValue(value.text) !== value.text)
            throw new Error(
                "Child authoring response contains sensitive material.",
            );
    } else if (value?.status === "failed") {
        boundedText(value.error, 2000);
        if (redactTraceValue(value.error) !== value.error)
            throw new Error(
                "Child authoring failure contains sensitive material.",
            );
    } else throw new Error("Invalid child authoring outcome.");
}

export class MacroChildAuthoring {
    readonly contexts: DurableRecipeAuthoringContextStore;
    private requests?: StoredRequest[];
    private loading?: Promise<void>;
    private mutation: Promise<void> = Promise.resolve();
    private readonly file: string;
    private readonly records: RevisionRecords;
    private changedRequest: string | undefined;

    constructor(
        directory: string,
        private readonly profileId = "typeagent",
        private readonly notify: () => void = () => {},
    ) {
        this.contexts = new DurableRecipeAuthoringContextStore(directory);
        this.file = path.join(directory, "child-authoring.json");
        this.records = new RevisionRecords(this.file);
    }

    private async load(): Promise<void> {
        this.loading ??= (async () => {
            this.requests = parseRequests([
                ...(await this.records.load()).values(),
            ]);
            await this.records.purgeUnreferenced();
        })();
        await this.loading;
    }

    private async update<T>(
        operation: () => T,
        changedId?: string,
    ): Promise<T> {
        await this.load();
        const work = this.mutation.then(() =>
            withRecordLock(`${this.file}.owner`, async () => {
                this.requests = parseRequests([
                    ...(await this.records.load()).values(),
                ]);
                const previous = this.requests!.map((request) => ({
                    ...request,
                }));
                try {
                    this.changedRequest = changedId;
                    const result = operation();
                    if (this.requests!.length > 512)
                        throw new Error(
                            "Child authoring storage capacity exceeded.",
                        );
                    const changes = new Map<string, unknown | undefined>();
                    for (const request of this.requests!)
                        if (
                            request.requestId === this.changedRequest ||
                            !previous.some(
                                (item) => item.requestId === request.requestId,
                            )
                        ) {
                            if (
                                Buffer.byteLength(JSON.stringify(request)) >
                                maxStateBytes
                            )
                                throw new Error(
                                    "Child authoring storage capacity exceeded.",
                                );
                            changes.set(request.requestId, request);
                        }
                    for (const request of previous)
                        if (
                            !this.requests!.some(
                                (item) => item.requestId === request.requestId,
                            )
                        )
                            changes.set(request.requestId, undefined);
                    await this.records.commit(changes);
                    if (changes.size) this.notify();
                    return result;
                } catch (error) {
                    this.requests = previous;
                    throw error;
                }
            }),
        );
        this.mutation = work.then(
            () => {},
            () => {},
        );
        return work;
    }

    async query(
        job: MacroLearningJob,
        prompt: string,
        signal: AbortSignal,
    ): Promise<string> {
        signal.throwIfAborted();
        const envelope = await this.assertContext(job);
        boundedText(prompt);
        if (redactTraceValue(prompt) !== prompt)
            throw new Error(
                "Child authoring prompt contains sensitive material.",
            );
        const promptDigest = recipeDigest(prompt);
        const requestId = recipeDigest(
            JSON.stringify([job.jobId, promptDigest]),
        );
        const request = await this.update(() => {
            let request = this.requests!.find(
                (item) => item.requestId === requestId,
            );
            if (!request) {
                request = {
                    requestId,
                    jobId: job.jobId,
                    cwd: job.cwd,
                    captureId: job.authoring.captureId,
                    contextDigest: envelope.digest,
                    prompt,
                    promptDigest,
                };
                this.requests!.push(request);
            }
            return structuredClone(request);
        }, requestId);
        signal.throwIfAborted();
        if (!request.outcome) throw new MacroAuthoringPending();
        if (request.outcome.status === "failed")
            throw new Error(
                `Copilot authoring failed: ${request.outcome.error}`,
            );
        return request.outcome.text;
    }

    async assertContext(job: MacroLearningJob) {
        if (!job.authoring)
            throw new Error(
                "A sealed child authoring capture is required; re-record the successful task.",
            );
        const envelope = await this.contexts.get(
            { workspaceId: job.cwd, profileId: this.profileId },
            job.authoring.captureId,
        );
        if (
            !envelope ||
            envelope.digest !== job.authoring.contextDigest ||
            envelope.context.capture.taskId !== job.authoring.taskId ||
            envelope.context.capture.tokenId !== job.authoring.tokenId ||
            envelope.context.capture.sessionId !== job.sessionId ||
            job.authoring.captureId !== job.traceId
        )
            throw new Error(
                "The sealed Copilot authoring context is missing or changed; re-record the successful task.",
            );
        return envelope;
    }

    async claim(
        claim: MacroAuthoringClaim,
        activeJobs: Set<string>,
    ): Promise<MacroAuthoringRequest | undefined> {
        const cwd = normalizeCwd(claim.cwd);
        boundedText(claim.workerId, 4096);
        boundedText(claim.sessionId, 4096);
        const eligible = (item: StoredRequest) =>
            item.cwd === cwd &&
            activeJobs.has(item.jobId) &&
            !item.outcome &&
            (!item.lease || Date.parse(item.lease.expiresAt) <= Date.now());
        await this.load();
        await this.mutation;
        const request = await this.update(() => {
            const request = this.requests!.find(eligible);
            if (!request) return undefined;
            this.changedRequest = request.requestId;
            request.lease = {
                id: randomUUID(),
                workerId: claim.workerId,
                sessionId: claim.sessionId,
                expiresAt: new Date(Date.now() + 120_000).toISOString(),
            };
            return structuredClone({
                requestId: request.requestId,
                jobId: request.jobId,
                captureId: request.captureId,
                contextDigest: request.contextDigest,
                prompt: request.prompt,
                promptDigest: request.promptDigest,
                leaseId: request.lease.id,
                leaseExpiresAt: request.lease.expiresAt,
                cwd: request.cwd,
            });
        });
        if (!request) return undefined;
        const context = await this.contexts.get(
            { workspaceId: request.cwd, profileId: this.profileId },
            request.captureId,
        );
        if (!context || context.digest !== request.contextDigest)
            throw new Error(
                "The sealed Copilot authoring context is missing or changed.",
            );
        const { cwd: _cwd, ...claimed } = request;
        return { ...claimed, context };
    }

    async submit(
        submission: MacroAuthoringSubmission,
        activeJobs: Set<string>,
    ): Promise<string> {
        validateOutcome(submission.outcome);
        return this.update(() => {
            const request = this.requests!.find(
                (item) => item.requestId === submission.requestId,
            );
            if (
                !request ||
                !activeJobs.has(request.jobId) ||
                request.cwd !== normalizeCwd(submission.cwd) ||
                request.promptDigest !== submission.promptDigest ||
                request.lease?.id !== submission.leaseId ||
                request.lease?.workerId !== submission.workerId ||
                request.lease?.sessionId !== submission.sessionId
            )
                throw new Error(
                    "Child authoring submission does not match its scoped lease.",
                );
            if (request.outcome) {
                if (
                    JSON.stringify(request.outcome) !==
                    JSON.stringify(submission.outcome)
                )
                    throw new Error("A completed child response is immutable.");
            } else {
                if (Date.parse(request.lease.expiresAt) <= Date.now())
                    throw new Error("The child authoring lease expired.");
                request.outcome = structuredClone(submission.outcome);
            }
            return request.jobId;
        }, submission.requestId);
    }

    async forget(jobId: string): Promise<void> {
        await this.update(() => {
            this.requests = this.requests!.filter(
                (item) => item.jobId !== jobId,
            );
        });
        await withRecordLock(`${this.file}.owner`, async () => {
            await this.records.load();
            await this.records.purgeUnreferenced();
        });
    }
}
