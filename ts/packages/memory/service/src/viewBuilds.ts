// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    ViewBuildJob,
    ViewBuildSnapshot,
    ViewBuildTargetResult,
    ViewSynthesisAdapter,
    ViewSynthesisOutput,
    ViewVersion,
    ViewPublicationProof,
    WikiPagePurposeContext,
    WikiSubjectAssessment,
} from "./viewTypes.js";
import { parseWikiAssessment, wikiPageContext } from "./wikiAdmission.js";
import { publicationProof } from "./viewPublication.js";
import { validateInventoryAudit } from "./viewInventory.js";
import { mergeView } from "./viewMerge.js";
import { validateConstructedGuide, validateSupport } from "./viewSynthesis.js";
import { redactRunbookText } from "./runbookRedaction.js";
import { informationalPipeline } from "./informationalView.js";
import {
    RequestBudget,
    runWithRequestBudget,
    type RequestBudgetLimits,
} from "@typeagent/aiclient";

export class ViewBuildStaleError extends Error {}

interface ViewBuildRuntimeScope {
    corpusId: string;
    sources: Set<string>;
    events: Set<string>;
}

export interface ViewBuildOwner {
    update(
        corpusId: string,
        jobId: string,
        update: (job: ViewBuildJob) => void,
    ): Promise<ViewBuildJob>;
    current(input: ViewBuildSnapshot): Promise<ViewVersion | undefined>;
    unchanged?(input: ViewBuildSnapshot): Promise<boolean>;
    wikiPages?(input: ViewBuildSnapshot): Promise<WikiPagePurposeContext[]>;
    recordWikiAssessment?(
        job: ViewBuildJob,
        result: ViewBuildTargetResult,
        assessment: WikiSubjectAssessment,
        pages: WikiPagePurposeContext[],
        signal: AbortSignal,
    ): Promise<void>;
    contributeWikiSubject?(
        job: ViewBuildJob,
        result: ViewBuildTargetResult,
        assessment: WikiSubjectAssessment,
        pages: WikiPagePurposeContext[],
        signal: AbortSignal,
    ): Promise<void>;
    resumeWikiContribution?(
        job: ViewBuildJob,
        result: ViewBuildTargetResult,
        signal: AbortSignal,
    ): Promise<boolean>;
    materialize(
        job: ViewBuildJob,
        result: ViewBuildTargetResult,
        candidate: ViewSynthesisOutput,
        merged: ViewSynthesisOutput,
        conflicts: string[],
        signal: AbortSignal,
        proof?: ViewPublicationProof,
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
    private reservations = 0;
    private tail: Promise<void> = Promise.resolve();
    public constructor(
        private readonly adapter: ViewSynthesisAdapter,
        private readonly owner: ViewBuildOwner,
        private readonly informationalLimits?: RequestBudgetLimits,
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
                job.results.flatMap((result) => [
                    ...result.snapshot.definition.selector.sources.map(
                        (input) => input.sourceId,
                    ),
                    ...(result.snapshot.maintenance?.privacySources ?? []),
                ]),
            ),
            events: new Set(
                job.results.flatMap(
                    (result) =>
                        result.snapshot.definition.selector.events?.map(
                            (event) => event.eventId,
                        ) ?? [],
                ),
            ),
        };
        this.controllers.set(job.jobId, { ...scope, controller });
        const task = this.tail.then(() => {
            if (
                !job.results.some((result) =>
                    informationalPipeline(result.snapshot.pipeline),
                )
            )
                return this.run(job, controller.signal);
            if (!this.informationalLimits)
                return this.run(job, controller.signal);
            return runWithRequestBudget(
                new RequestBudget(this.informationalLimits),
                () => this.run(job, controller.signal),
            );
        });
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
        if (this.controllers.size + this.reservations >= 32)
            throw new Error("View build queue limit exceeded");
    }

    public reserve(): { start(job: ViewBuildJob): void; release(): void } {
        this.assertCapacity();
        this.reservations++;
        let active = true;
        const release = () => {
            if (!active) return;
            active = false;
            this.reservations--;
        };
        return {
            start: (job) => {
                if (!active) throw new Error("View build reservation released");
                release();
                this.start(job);
            },
            release,
        };
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

    public trackContribution(jobId: string, input: ViewBuildSnapshot): void {
        const scope = this.controllers.get(jobId);
        if (!scope)
            throw new ViewBuildStaleError(
                "Wiki contribution no longer has an active owner",
            );
        for (const source of input.inputs) scope.sources.add(source.sourceId);
    }

    public forgetEvent(corpusId: string, eventId: string): void {
        for (const [jobId, failure] of this.failures)
            if (failure.corpusId === corpusId && failure.events.has(eventId))
                this.failures.delete(jobId);
        for (const [jobId, item] of this.controllers)
            if (item.corpusId === corpusId && item.events.has(eventId)) {
                this.purged.add(jobId);
                this.failures.delete(jobId);
                item.controller.abort(
                    new ViewBuildStaleError("Canonical event evidence removed"),
                );
            }
    }

    private async result(
        job: ViewBuildJob,
        viewId: string,
        state: ViewBuildTargetResult["state"],
        reason: string,
        evidence?: Partial<
            Pick<
                ViewBuildTargetResult,
                "inventory" | "inventoryAudit" | "coverage"
            >
        >,
    ): Promise<void> {
        await this.owner.update(job.corpusId, job.jobId, (current) => {
            const result = current.results.find(
                (entry) => entry.viewId === viewId,
            );
            if (!result) throw new Error("Build result target missing");
            if (current.state === "cancelled") return;
            result.state = state;
            result.reason = reason;
            Object.assign(result, evidence);
        });
    }

    private async prepareInventory(
        job: ViewBuildJob,
        result: ViewBuildTargetResult,
        signal: AbortSignal,
    ): Promise<
        Pick<ViewBuildTargetResult, "inventory" | "inventoryAudit"> | undefined
    > {
        if (!this.adapter.inventory && !this.adapter.checkInventory)
            return undefined;
        if (!this.adapter.inventory || !this.adapter.checkInventory)
            throw new Error(
                "Evidence-first adapters require both inventory and independent source checking",
            );
        await this.result(
            job,
            result.viewId,
            "inventorying",
            "Extracting facts and context before any guide exists",
        );
        const inventory = await abortable(
            this.adapter.inventory(result.snapshot, signal),
            signal,
        );
        await this.result(
            job,
            result.viewId,
            "checkingInventory",
            "Independently checking complete sources against inventory",
            { inventory },
        );
        const inventoryAudit = await abortable(
            this.adapter.checkInventory(result.snapshot, inventory, signal),
            signal,
        );
        await this.result(
            job,
            result.viewId,
            "checkingInventory",
            "Source-to-inventory assessment recorded",
            { inventoryAudit },
        );
        validateInventoryAudit(result.snapshot, inventory, inventoryAudit);
        return { inventory, inventoryAudit };
    }

    private async target(
        job: ViewBuildJob,
        result: ViewBuildTargetResult,
        signal: AbortSignal,
    ): Promise<void> {
        const timeoutMs = informationalPipeline(result.snapshot.pipeline)
            ? (this.informationalLimits?.elapsedMs ?? 120_000)
            : 300_000;
        const timer = setTimeout(
            () =>
                this.cancel(
                    job.jobId,
                    `Evidence-first synthesis exceeded ${timeoutMs / 1000} second limit`,
                ),
            timeoutMs,
        );
        let validation = false;
        try {
            signal.throwIfAborted();
            if (
                result.snapshot.definition.kind === "timeline" &&
                !result.snapshot.inputs.some((input) => input.records?.length)
            ) {
                await this.result(
                    job,
                    result.viewId,
                    "skipped",
                    "Empty eligible timeline checkpoint; no new artifact or publication was created",
                );
                return;
            }
            validation = true;
            const informational = informationalPipeline(
                result.snapshot.pipeline,
            );
            if (
                (await this.skipInformationalTarget(
                    job,
                    result,
                    signal,
                    informational,
                )) ||
                (await this.assessWikiAdmission(job, result, signal))
            )
                return;
            const evidence = informational
                ? undefined
                : await this.prepareInventory(job, result, signal);
            const inventory = evidence?.inventory;
            validation = false;
            await this.result(
                job,
                result.viewId,
                "generating",
                "Synthesizing complete labeled retained inputs",
            );
            const candidate = await abortable(
                this.adapter.generate(result.snapshot, signal, inventory),
                signal,
            );
            signal.throwIfAborted();
            if (inventory) {
                candidate.inventory = inventory;
                if (evidence?.inventoryAudit)
                    candidate.inventoryAudit = evidence.inventoryAudit;
            }

            validation = true;
            validateConstructedGuide(result.snapshot, candidate);
            await this.result(
                job,
                result.viewId,
                "validating",
                "Checking actual artifact coverage, exclusions and semantic support",
                candidate.coverage ? { coverage: candidate.coverage } : {},
            );
            if (!informational)
                validateSupport(
                    candidate,
                    await abortable(
                        this.adapter.validate(
                            result.snapshot,
                            candidate,
                            signal,
                        ),
                        signal,
                    ),
                );
            validation = false;
            const current = await this.owner.current(result.snapshot);
            const { output, conflicts } = mergeView(
                current,
                candidate,
                result.snapshot.inputs,
            );
            let proof: ViewPublicationProof | undefined;
            if (!conflicts.length) {
                validation = true;
                validateConstructedGuide(result.snapshot, output);
                await this.verifyContributionRefresh(
                    result.snapshot,
                    output,
                    signal,
                );
                const support = informational
                    ? undefined
                    : await abortable(
                          this.adapter.validate(
                              result.snapshot,
                              output,
                              signal,
                          ),
                          signal,
                      );
                if (support) {
                    validateSupport(output, support);
                    proof = publicationProof(
                        result.snapshot.fingerprint,
                        output,
                        support,
                    );
                }
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
                proof,
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

    private async verifyContributionRefresh(
        input: ViewBuildSnapshot,
        output: ViewSynthesisOutput,
        signal: AbortSignal,
    ): Promise<void> {
        if (!input.wikiContribution) return;
        if (!this.adapter.assessWikiSubject)
            throw new Error(
                "Wiki contribution refresh lacks actual-prose coverage checker",
            );
        const context = wikiPageContext(
            input,
            {
                viewId: input.definition.viewId,
                revisionId: input.targetRevisionId!,
                definition: {
                    ...input.definition,
                    revisionId: input.definitionRevisionId!,
                },
                content: output.content,
            },
            undefined,
            false,
        );
        const coverage = parseWikiAssessment(
            await abortable(
                this.adapter.assessWikiSubject(input, [context], signal),
                signal,
            ),
            [context],
            input.wikiContribution.essentialDistinctions,
        );
        if (coverage.disposition !== "covered")
            throw new Error(
                "Wiki contribution refresh did not preserve essential old/new distinctions in actual prose",
            );
    }

    private async skipInformationalTarget(
        job: ViewBuildJob,
        result: ViewBuildTargetResult,
        signal: AbortSignal,
        informational: boolean,
    ): Promise<boolean> {
        if (!informational) return false;
        if (await this.owner.unchanged?.(result.snapshot)) {
            await this.result(
                job,
                result.viewId,
                "skipped",
                "Unchanged indexed evidence and definition; no synthesis required",
            );
            return true;
        }
        return (
            (await this.owner.resumeWikiContribution?.(job, result, signal)) ??
            false
        );
    }

    private async assessWikiAdmission(
        job: ViewBuildJob,
        result: ViewBuildTargetResult,
        signal: AbortSignal,
    ): Promise<boolean> {
        if (
            !job.maintenancePlan ||
            result.snapshot.pipeline !== "informational-wiki-v1" ||
            result.snapshot.expectedVersion !== 0 ||
            !this.adapter.assessWikiSubject
        )
            return false;
        if (!this.owner.wikiPages || !this.owner.recordWikiAssessment)
            throw new Error(
                "Wiki purpose assessment requires current-page context and guarded receipts",
            );
        const pages = await this.owner.wikiPages(result.snapshot);
        if (!pages.length) return false;
        await this.result(
            job,
            result.viewId,
            "generating",
            "Comparing standalone purpose with nominated current pages",
        );
        const assessment = parseWikiAssessment(
            await abortable(
                this.adapter.assessWikiSubject(result.snapshot, pages, signal),
                signal,
            ),
            pages,
        );
        signal.throwIfAborted();
        await this.owner.recordWikiAssessment(
            job,
            result,
            assessment,
            pages,
            signal,
        );
        if (assessment.disposition === "contribute") {
            if (!this.owner.contributeWikiSubject)
                throw new Error(
                    "Wiki contribution requires guarded canonical materialization",
                );
            await this.owner.contributeWikiSubject(
                job,
                result,
                assessment,
                pages,
                signal,
            );
            return true;
        }
        return (
            assessment.disposition === "covered" ||
            assessment.disposition === "ambiguous"
        );
    }

    private async run(job: ViewBuildJob, signal: AbortSignal): Promise<void> {
        for (const result of job.results)
            await this.target(job, result, signal);
        if (this.purged.has(job.jobId)) return;
        await this.owner.update(job.corpusId, job.jobId, (current) => {
            if (current.state === "cancelled") return;
            const saved = current.results.filter((result) =>
                [
                    "draft",
                    "merged",
                    "published",
                    "searchable",
                    "skipped",
                ].includes(result.state),
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

    public cancelAll(): void {
        for (const item of this.controllers.values())
            item.controller.abort(new Error("Service closing"));
    }

    public async close(): Promise<void> {
        this.cancelAll();
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
    let abort: (() => void) | undefined;
    const cancelled = new Promise<never>((_resolve, reject) => {
        abort = () => reject(signal.reason);
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
    });
    try {
        return await Promise.race([work, cancelled]);
    } finally {
        if (abort) signal.removeEventListener("abort", abort);
    }
}
