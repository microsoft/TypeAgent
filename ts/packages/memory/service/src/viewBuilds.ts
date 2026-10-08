// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    ViewBuildJob,
    ViewBuildSnapshot,
    ViewBuildTargetResult,
    ViewSynthesisAdapter,
    ViewSynthesisOutput,
    ViewVersion,
} from "./viewTypes.js";
import { mergeView } from "./viewMerge.js";
import { validateConstructedGuide, validateSupport } from "./viewSynthesis.js";
import { redactRunbookText } from "./runbookRedaction.js";

export class ViewBuildStaleError extends Error {}

interface ViewBuildRuntimeScope {
    corpusId: string;
    sources: Set<string>;
}

export interface ViewBuildOwner {
    update(
        corpusId: string,
        jobId: string,
        update: (job: ViewBuildJob) => void,
    ): Promise<ViewBuildJob>;
    current(input: ViewBuildSnapshot): Promise<ViewVersion | undefined>;
    materialize(
        job: ViewBuildJob,
        result: ViewBuildTargetResult,
        candidate: ViewSynthesisOutput,
        merged: ViewSynthesisOutput,
        conflicts: string[],
        signal: AbortSignal,
    ): Promise<void>;
}

export class ViewBuildRunner {
    private readonly controllers = new Map<
        string,
        ViewBuildRuntimeScope & { controller: AbortController }
    >();
    private readonly failures = new Map<
        string,
        ViewBuildRuntimeScope & { error: Error }
    >();
    private readonly purged = new Set<string>();
    private tail: Promise<void> = Promise.resolve();
    public constructor(
        private readonly adapter: ViewSynthesisAdapter,
        private readonly owner: ViewBuildOwner,
    ) {}

    public assertPersistence(jobId: string): void {
        const failure = this.failures.get(jobId);
        if (failure) throw failure.error;
    }

    public start(job: ViewBuildJob): void {
        this.assertCapacity();
        const controller = new AbortController();
        const scope: ViewBuildRuntimeScope = {
            corpusId: job.corpusId,
            sources: new Set(
                job.results.flatMap((result) =>
                    result.snapshot.inputs.map((input) => input.sourceId),
                ),
            ),
        };
        this.controllers.set(job.jobId, { ...scope, controller });
        const task = this.tail.then(() => this.run(job, controller.signal));
        this.tail = task
            .catch((error: unknown) => {
                if (this.purged.has(job.jobId)) return;
                this.failures.set(job.jobId, {
                    ...scope,
                    error: new Error(
                        `View build persistence failed: ${safeError(error)}`,
                    ),
                });
            })
            .finally(() => this.controllers.delete(job.jobId));
    }

    public assertCapacity(): void {
        if (this.controllers.size >= 32)
            throw new Error("View build queue limit exceeded");
    }

    public cancel(
        jobId: string,
        reason = "Explicit cancellation requested",
    ): void {
        this.controllers.get(jobId)?.controller.abort(new Error(reason));
    }

    public forget(corpusId: string, sourceId?: string): void {
        for (const [jobId, failure] of this.failures)
            if (
                failure.corpusId === corpusId &&
                (sourceId === undefined || failure.sources.has(sourceId))
            )
                this.failures.delete(jobId);
        for (const [jobId, item] of this.controllers) {
            if (
                item.corpusId === corpusId &&
                (sourceId === undefined || item.sources.has(sourceId))
            ) {
                this.purged.add(jobId);
                this.failures.delete(jobId);
                item.controller.abort(
                    new ViewBuildStaleError("Retained source evidence removed"),
                );
            }
        }
    }

    private async result(
        job: ViewBuildJob,
        viewId: string,
        state: ViewBuildTargetResult["state"],
        reason: string,
    ): Promise<void> {
        await this.owner.update(job.corpusId, job.jobId, (current) => {
            const result = current.results.find(
                (entry) => entry.viewId === viewId,
            );
            if (!result) throw new Error("Build result target missing");
            if (current.state === "cancelled") return;
            result.state = state;
            result.reason = reason;
        });
    }

    private async target(
        job: ViewBuildJob,
        result: ViewBuildTargetResult,
        signal: AbortSignal,
    ): Promise<void> {
        const timer = setTimeout(
            () =>
                this.cancel(
                    job.jobId,
                    "View synthesis exceeded 120 second limit",
                ),
            120_000,
        );
        let validation = false;
        try {
            signal.throwIfAborted();
            await this.result(
                job,
                result.viewId,
                "generating",
                "Synthesizing complete labeled retained inputs",
            );
            const candidate = await abortable(
                this.adapter.generate(result.snapshot, signal),
                signal,
            );
            signal.throwIfAborted();
            validation = true;
            validateConstructedGuide(result.snapshot, candidate);
            await this.result(
                job,
                result.viewId,
                "validating",
                "Checking claim support and required context",
            );
            validateSupport(
                candidate,
                await abortable(
                    this.adapter.validate(result.snapshot, candidate, signal),
                    signal,
                ),
            );
            validation = false;
            const current = await this.owner.current(result.snapshot);
            const { output, conflicts } = mergeView(current, candidate);
            if (!conflicts.length) {
                validation = true;
                validateConstructedGuide(result.snapshot, output);
                validateSupport(
                    output,
                    await abortable(
                        this.adapter.validate(result.snapshot, output, signal),
                        signal,
                    ),
                );
            }
            validation = false;
            signal.throwIfAborted();
            await this.owner.materialize(
                job,
                result,
                candidate,
                output,
                conflicts,
                signal,
            );
        } catch (error) {
            const state =
                error instanceof ViewBuildStaleError
                    ? "stale"
                    : signal.aborted
                      ? "cancelled"
                      : validation
                        ? "blocked"
                        : "failed";
            if (!this.purged.has(job.jobId))
                await this.result(job, result.viewId, state, safeError(error));
        } finally {
            clearTimeout(timer);
        }
    }

    private async run(job: ViewBuildJob, signal: AbortSignal): Promise<void> {
        for (const result of job.results)
            await this.target(job, result, signal);
        if (this.purged.has(job.jobId)) return;
        await this.owner.update(job.corpusId, job.jobId, (current) => {
            if (current.state === "cancelled") return;
            const saved = current.results.filter((result) =>
                ["draft", "merged", "skipped"].includes(result.state),
            ).length;
            current.state =
                saved === current.results.length
                    ? "complete"
                    : saved
                      ? "partial"
                      : signal.aborted
                        ? "cancelled"
                        : "failed";
        });
    }

    public async close(): Promise<void> {
        for (const item of this.controllers.values())
            item.controller.abort(new Error("Service closing"));
        await this.tail;
        for (const failure of this.failures.values()) throw failure.error;
    }
}

export function safeError(error: unknown): string {
    return redactRunbookText(
        error instanceof Error ? error.message : String(error),
    ).slice(0, 1800);
}

export async function abortable<T>(
    work: Promise<T>,
    signal: AbortSignal,
): Promise<T> {
    signal.throwIfAborted();
    let abort: (() => void) | undefined;
    const cancelled = new Promise<never>((_resolve, reject) => {
        abort = () => reject(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
    });
    try {
        return await Promise.race([work, cancelled]);
    } finally {
        if (abort) signal.removeEventListener("abort", abort);
    }
}
