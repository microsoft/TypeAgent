// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomUUID } from "node:crypto";
import { readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import {
    synthesisCandidates,
    type RunbookJobResult,
    type RunbookSynthesisInput,
    type RunbookSynthesizer,
} from "./runbookPipeline.js";
import type { ProcedureCandidateCreateRequest } from "./types.js";
import { redactRunbookText } from "./runbookRedaction.js";
import { writeRunbookJson } from "./durableRunbookJson.js";

function synthesisErrorMessage(error: unknown): string {
    if (
        error !== null &&
        typeof error === "object" &&
        "message" in error &&
        typeof error.message === "string"
    )
        return error.message;
    return String(error);
}

export class RunbookJobStore {
    private admissions: Promise<void> = Promise.resolve();
    private tail: Promise<void> = Promise.resolve();
    private pending = 0;
    private readonly controllers = new Map<string, AbortController>();
    private readonly purged = new Set<string>();
    private readonly persistenceFailures = new Map<string, Error>();
    private readonly fileOperations = new Map<string, Promise<void>>();
    public constructor(
        private readonly root: string,
        private readonly synthesize: RunbookSynthesizer,
        private readonly publish: (
            input: RunbookSynthesisInput,
            candidates: ProcedureCandidateCreateRequest[],
            signal: AbortSignal,
        ) => Promise<void>,
    ) {}

    private file(jobId: string): string {
        if (!/^[a-f0-9-]{36}$/.test(jobId))
            throw new Error("Invalid runbook job ID");
        return path.join(this.root, "runbook-jobs", `${jobId}.json`);
    }

    private async save(job: RunbookJobResult): Promise<void> {
        await this.withFile(job.jobId, async () => {
            if (this.purged.has(job.jobId)) return;
            const file = this.file(job.jobId);
            job.updatedAt = new Date().toISOString();
            await writeRunbookJson(
                file,
                JSON.stringify(job),
                () => !this.purged.has(job.jobId),
            );
        });
    }

    private async withFile<T>(
        jobId: string,
        operation: () => Promise<T>,
    ): Promise<T> {
        const previous = this.fileOperations.get(jobId) ?? Promise.resolve();
        const task = previous.then(operation, operation);
        const settled = task.then(
            () => undefined,
            () => undefined,
        );
        this.fileOperations.set(jobId, settled);
        try {
            return await task;
        } finally {
            if (this.fileOperations.get(jobId) === settled)
                this.fileOperations.delete(jobId);
        }
    }

    public async get(jobId: string): Promise<RunbookJobResult | undefined> {
        const failure = this.persistenceFailures.get(jobId);
        if (failure) throw failure;
        try {
            return await this.withFile(
                jobId,
                async () =>
                    JSON.parse(
                        await readFile(this.file(jobId), "utf8"),
                    ) as RunbookJobResult,
            );
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT")
                return undefined;
            throw error;
        }
    }

    private async *all(): AsyncGenerator<RunbookJobResult> {
        let files: string[];
        try {
            files = await readdir(path.join(this.root, "runbook-jobs"));
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
            throw error;
        }
        for (const file of files.filter((file) =>
            /^[a-f0-9-]{36}\.json$/.test(file),
        )) {
            const job = await this.get(file.slice(0, -5));
            if (job) yield job;
        }
    }

    public async list(corpusId: string): Promise<RunbookJobResult[]> {
        const results: RunbookJobResult[] = [];
        for await (const job of this.all()) {
            if (job.corpusId !== corpusId) continue;
            results.push(job);
            results.sort((left, right) =>
                right.createdAt.localeCompare(left.createdAt),
            );
            if (results.length > 100) results.pop();
        }
        if (Buffer.byteLength(JSON.stringify(results)) > 8 * 1024 * 1024)
            throw new Error(
                "Runbook job listing exceeds the 8 MiB transport limit; read individual jobs",
            );
        return results;
    }

    public async recover(): Promise<void> {
        for await (const job of this.all()) {
            if (job.state !== "running") continue;
            job.state = "interrupted";
            job.reason =
                "Synthesis interrupted by service restart; source capture remains committed";
            await this.save(job);
        }
    }

    public async start(
        input: RunbookSynthesisInput,
    ): Promise<RunbookJobResult> {
        const task = this.admissions.then(() => this.startAdmitted(input));
        this.admissions = task.then(
            () => undefined,
            () => undefined,
        );
        return task;
    }

    private async startAdmitted(
        input: RunbookSynthesisInput,
    ): Promise<RunbookJobResult> {
        for await (const job of this.all()) {
            if (
                job.corpusId === input.corpusId &&
                job.sourceId === input.sourceId &&
                job.revisionId === input.revisionId &&
                ["running", "complete"].includes(job.state)
            )
                return job;
        }
        const timestamp = new Date().toISOString();
        const job: RunbookJobResult = {
            jobId: randomUUID(),
            corpusId: input.corpusId,
            sourceId: input.sourceId,
            revisionId: input.revisionId,
            state: "running",
            reason: "Queued for retained-document synthesis",
            createdAt: timestamp,
            updatedAt: timestamp,
            candidateIds: [],
            warnings: input.assets
                .filter(
                    (asset) =>
                        asset.instructionBearing &&
                        !input.images.some(
                            (image) => image.assetId === asset.assetId,
                        ),
                )
                .map(
                    (asset) =>
                        `Asset ${asset.assetId}: instruction-bearing image unavailable; manual inspection required`,
                ),
        };
        if (this.pending >= 32 || input.content.length > 120_000) {
            job.state = "failed";
            job.reason =
                this.pending >= 32
                    ? "Synthesis queue limit exceeded; retry required"
                    : "Complete document exceeds 120000 UTF-16 character synthesis limit; no truncation applied";
            await this.save(job);
            return job;
        }
        await this.save(job);
        const controller = new AbortController();
        this.controllers.set(job.jobId, controller);
        this.pending++;
        const task = this.tail.then(() =>
            this.run(job, input, controller.signal),
        );
        this.tail = task
            .catch((error: unknown) => {
                this.persistenceFailures.set(
                    job.jobId,
                    new Error(
                        `Runbook job result could not be persisted: ${redactRunbookText(synthesisErrorMessage(error)).slice(0, 1800)}`,
                    ),
                );
            })
            .finally(() => {
                this.controllers.delete(job.jobId);
                this.pending--;
            });
        return structuredClone(job);
    }

    private async run(
        job: RunbookJobResult,
        input: RunbookSynthesisInput,
        signal: AbortSignal,
    ): Promise<void> {
        const timer = setTimeout(
            () =>
                this.controllers
                    .get(job.jobId)
                    ?.abort(new Error("Synthesis exceeded 120 second limit")),
            120_000,
        );
        try {
            signal.throwIfAborted();
            job.reason = "Synthesizing retained document";
            await this.save(job);
            const output = await Promise.race([
                this.synthesize(input, signal),
                new Promise<never>((_resolve, reject) =>
                    signal.addEventListener(
                        "abort",
                        () => reject(signal.reason),
                        { once: true },
                    ),
                ),
            ]);
            signal.throwIfAborted();
            const candidates = synthesisCandidates(input, output);
            job.reason = "Publishing draft candidates";
            await this.save(job);
            await this.publish(input, candidates, signal);
            job.state = "complete";
            job.classification = output.classification;
            job.confidence = output.confidence;
            job.reason = redactRunbookText(output.reason);
            job.candidateIds = candidates.map(
                (candidate) => candidate.candidateId!,
            );
            job.warnings.push(...output.warnings.map(redactRunbookText));
        } catch (error) {
            job.state = signal.aborted ? "cancelled" : "failed";
            const reason = synthesisErrorMessage(error);
            job.reason =
                redactRunbookText(reason.slice(0, 1800)) +
                (reason.length > 1800 ? " [truncated]" : "");
            job.warnings.push(
                "Source capture remains committed; deterministic seeds retained; no synthesis fallback",
            );
        } finally {
            clearTimeout(timer);
            await this.save(job);
        }
    }

    public async purge(
        corpusId: string,
        sourceId?: string,
        retainedRevisions?: ReadonlySet<string>,
    ): Promise<void> {
        for await (const job of this.all()) {
            if (
                job.corpusId !== corpusId ||
                (sourceId !== undefined && job.sourceId !== sourceId) ||
                retainedRevisions?.has(job.revisionId)
            )
                continue;
            this.controllers
                .get(job.jobId)
                ?.abort(new Error("Retained source evidence removed"));
            this.purged.add(job.jobId);
            this.persistenceFailures.delete(job.jobId);
            // Publication checks retained revision while holding the corpus write queue.
            await this.withFile(job.jobId, () =>
                rm(this.file(job.jobId), { force: true }),
            );
        }
    }

    public async close(): Promise<void> {
        await this.admissions;
        for (const controller of this.controllers.values())
            controller.abort(new Error("Service closing"));
        await this.tail;
    }
}
