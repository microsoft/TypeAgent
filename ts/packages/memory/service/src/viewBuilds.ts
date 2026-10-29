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
import { parseWikiAssessment } from "./wikiAdmission.js";
import { publicationProof } from "./viewPublication.js";
import { validateInventoryAudit } from "./viewInventory.js";
import {
    mergeEditorialView,
    requiresEditorialCheck,
    assertEditorialAssessment,
    EditorialRejection,
} from "./viewEditorial.js";
import {
    ConsolidationRejection,
    ConsolidationTargetChanged,
} from "./wikiConsolidation.js";
import {
    validateConstructedGuide,
    prepareWikiContribution,
    validateSupport,
    ViewSupportRejection,
} from "./viewSynthesis.js";
import { redactRunbookText } from "./runbookRedaction.js";
import { informationalPipeline } from "./informationalView.js";
import { generateTopicTarget, type TopicBuildOwner } from "./topicBuilds.js";
import { createTopicSnapshot, type TopicGenerator } from "./topicGeneration.js";
import { resolveTopicBuildTimeout } from "./viewBuildValidation.js";
import {
    isSearchTimingEnabled,
    recordSearchTiming,
    runWithSearchTiming,
    timeSearchStage,
} from "@typeagent/knowpro";
import {
    RequestBudget,
    runWithRequestBudget,
    type RequestBudgetLimits,
} from "@typeagent/aiclient";
import {
    createMaintenanceBuildScheduler,
    yieldMaintenanceBuild,
} from "./maintenanceConcurrency.js";
import { createLimiter } from "@typeagent/common-utils";

export class ViewBuildStaleError extends Error {}

interface PreparedWikiAssessment {
    assessment: WikiSubjectAssessment;
    pages: WikiPagePurposeContext[];
    input: ViewBuildSnapshot;
}

type WikiPreparation =
    | { value: PreparedWikiAssessment | undefined; error?: never }
    | { value?: never; error: unknown };

interface ViewBuildRuntimeScope {
    corpusId: string;
    sources: Set<string>;
    events: Set<string>;
}

export interface ViewBuildOwner extends TopicBuildOwner {
    update(
        corpusId: string,
        jobId: string,
        update: (job: ViewBuildJob) => void,
    ): Promise<ViewBuildJob>;
    current(input: ViewBuildSnapshot): Promise<ViewVersion | undefined>;
    unchanged?(input: ViewBuildSnapshot): Promise<boolean>;
    canPrepareWikiAssessment?(input: ViewBuildSnapshot): Promise<boolean>;
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
    consolidateWiki?(
        job: ViewBuildJob,
        result: ViewBuildTargetResult,
        signal: AbortSignal,
    ): Promise<void>;
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
    private readonly tasks = new Map<string, Promise<void>>();
    private readonly corpusTails = new Map<string, Promise<void>>();
    private readonly limit: ReturnType<typeof createMaintenanceBuildScheduler>;
    private readonly topicTimeoutMs: number;
    public constructor(
        private readonly adapter: ViewSynthesisAdapter,
        private readonly owner: ViewBuildOwner,
        private readonly informationalLimits?: RequestBudgetLimits,
        private readonly topicGenerator?: TopicGenerator,
        topicTimeoutMs?: number,
        concurrency = 1,
        reserveShortSlot = false,
        private readonly wikiAssessmentConcurrency = 1,
        prioritizeShortBuilds = !reserveShortSlot,
    ) {
        if (
            !Number.isSafeInteger(wikiAssessmentConcurrency) ||
            wikiAssessmentConcurrency < 1 ||
            wikiAssessmentConcurrency > 4
        )
            throw new Error(
                "Wiki assessment concurrency must be an integer from 1 to 4",
            );
        this.topicTimeoutMs = resolveTopicBuildTimeout(topicTimeoutMs);
        this.limit = createMaintenanceBuildScheduler(
            concurrency,
            reserveShortSlot,
            prioritizeShortBuilds,
        );
    }

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
                    ...(result.snapshot.influenceSources?.map(
                        (source) => source.sourceId,
                    ) ?? []),
                ]),
            ),
            events: new Set(
                job.results.flatMap((result) => [
                    ...(result.snapshot.definition.selector.events?.map(
                        (event) => event.eventId,
                    ) ?? []),
                    ...(result.snapshot.influenceEvents?.map(
                        (event) => event.eventId,
                    ) ?? []),
                ]),
            ),
        };
        this.controllers.set(job.jobId, { ...scope, controller });
        const queuedAt = isSearchTimingEnabled()
            ? performance.now()
            : undefined;
        const previous =
            this.corpusTails.get(job.corpusId) ?? Promise.resolve();
        const task = previous.then(() =>
            this.limit(
                () =>
                    runWithSearchTiming(
                        job.jobId,
                        "memory.build",
                        () => {
                            if (queuedAt !== undefined)
                                recordSearchTiming(
                                    "build.queue.wait",
                                    performance.now() - queuedAt,
                                );
                            return timeSearchStage("build.job.total", () =>
                                this.run(job, controller.signal),
                            );
                        },
                        { corpusId: job.corpusId, buildId: job.jobId },
                    ),
                job.results.some(
                    (result) => result.snapshot.pipeline === "topics-v1",
                ),
            ),
        );
        const settled = task
            .catch((error: unknown) => {
                if (this.purged.has(job.jobId)) return;
                this.failures.set(job.jobId, {
                    ...scope,
                    error: new Error(
                        `View build persistence failed: ${safeError(error)}`,
                    ),
                });
            })
            .finally(() => {
                this.controllers.delete(job.jobId);
                this.tasks.delete(job.jobId);
                if (this.corpusTails.get(job.corpusId) === settled)
                    this.corpusTails.delete(job.corpusId);
            });
        this.corpusTails.set(job.corpusId, settled);
        this.tasks.set(job.jobId, settled);
    }

    public async wait(jobId: string, signal: AbortSignal): Promise<void> {
        const cancel = () => this.cancel(jobId, "Maintenance drain cancelled");
        signal.addEventListener("abort", cancel, { once: true });
        if (signal.aborted) cancel();
        try {
            await this.tasks.get(jobId);
            this.assertPersistence(jobId);
            signal.throwIfAborted();
        } finally {
            signal.removeEventListener("abort", cancel);
        }
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
        reason: string | Error = "Explicit cancellation requested",
    ): void {
        this.controllers
            .get(jobId)
            ?.controller.abort(
                reason instanceof Error ? reason : new Error(reason),
            );
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
        for (const source of input.influenceSources ?? [])
            scope.sources.add(source.sourceId);
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
            timeSearchStage("view.inventory.model", () =>
                this.adapter.inventory!(result.snapshot, signal),
            ),
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
            timeSearchStage("view.inventory.check", () =>
                this.adapter.checkInventory!(
                    result.snapshot,
                    inventory,
                    signal,
                ),
            ),
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
        assessmentPreparation?: Promise<WikiPreparation>,
    ): Promise<boolean> {
        const timeoutMs =
            (result.snapshot.pipeline === "topics-v1"
                ? this.topicTimeoutMs
                : informationalPipeline(result.snapshot.pipeline)
                  ? this.informationalLimits?.elapsedMs
                  : undefined) ?? 3_000_000;
        const controller = new AbortController();
        const jobSignal = signal;
        const cancel = () => controller.abort(jobSignal.reason);
        signal.addEventListener("abort", cancel, { once: true });
        if (signal.aborted) cancel();
        signal = controller.signal;
        const timer = setTimeout(
            () =>
                controller.abort(
                    new Error(
                        `Evidence-first synthesis exceeded ${timeoutMs / 1000} second limit`,
                    ),
                ),
            timeoutMs,
        );
        let validation = false;
        try {
            signal.throwIfAborted();
            if (result.snapshot.pipeline === "topics-v1") {
                if (!this.owner.materializeTopics)
                    throw new Error(
                        "Topic snapshot materialization is not supported",
                    );
                await this.result(
                    job,
                    result.viewId,
                    "generating",
                    "Generating complete topic incidence snapshot",
                );
                if (this.owner.materializeTopicIncidence) {
                    await timeSearchStage("topic.incidence.materialize", () =>
                        this.owner.materializeTopicIncidence!(
                            job,
                            result,
                            createTopicSnapshot(
                                result.snapshot,
                                result.snapshot.model,
                            ),
                            signal,
                        ),
                    );
                    await yieldMaintenanceBuild(signal);
                }
                const snapshot = await timeSearchStage(
                    "topic.generate.total",
                    () =>
                        generateTopicTarget(
                            this.adapter,
                            result.snapshot,
                            signal,
                            this.topicGenerator,
                            this.owner.materializeTopicIncidence
                                ? (snapshot) =>
                                      timeSearchStage(
                                          "topic.summary.checkpoint",
                                          () =>
                                              this.owner
                                                  .materializeTopicIncidence!(
                                                  job,
                                                  result,
                                                  snapshot,
                                                  signal,
                                              ),
                                      )
                                : undefined,
                        ),
                );
                validation = true;
                await this.result(
                    job,
                    result.viewId,
                    "validating",
                    "Validated complete membership, original evidence and organizational DAG",
                );
                validation = false;
                signal.throwIfAborted();
                await timeSearchStage("topic.snapshot.materialize", () =>
                    this.owner.materializeTopics!(
                        job,
                        result,
                        snapshot,
                        signal,
                    ),
                );
                return true;
            }
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
                return true;
            }
            validation = true;
            const informational = informationalPipeline(
                result.snapshot.pipeline,
            );
            if (
                (await timeSearchStage("view.admission.skip", () =>
                    this.skipInformationalTarget(
                        job,
                        result,
                        signal,
                        informational,
                    ),
                )) ||
                (await timeSearchStage("wiki.subject.assess", () =>
                    this.assessWikiAdmission(
                        job,
                        result,
                        signal,
                        assessmentPreparation,
                    ),
                ))
            )
                return true;
            const evidence =
                informational ||
                result.snapshot.pipeline === "schema-defined-v1"
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
            let candidate = await abortable(
                timeSearchStage("view.synthesis.generate", () =>
                    this.adapter.generate(result.snapshot, signal, inventory),
                ),
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
                candidate = await this.validateOrRepairAnswers(
                    result.snapshot,
                    candidate,
                    signal,
                );
            validation = false;
            const current = await timeSearchStage("view.current.read", () =>
                this.owner.current(result.snapshot),
            );
            validation = true;
            const prepared = await abortable(
                timeSearchStage("wiki.contribution.refresh", () =>
                    prepareWikiContribution(
                        this.adapter,
                        result.snapshot,
                        candidate,
                        (candidate) =>
                            mergeEditorialView(
                                current,
                                candidate,
                                result.snapshot.inputs,
                            ),
                        signal,
                    ),
                ),
                signal,
            );
            candidate = prepared.candidate;
            const { output, conflicts } = prepared;
            let proof: ViewPublicationProof | undefined;
            if (!conflicts.length) {
                validation = true;
                validateConstructedGuide(result.snapshot, output);
                await timeSearchStage("view.editorial.verify", () =>
                    this.verifyEditorialUpdate(result.snapshot, output, signal),
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
            await timeSearchStage("view.materialize-and-index", () =>
                this.owner.materialize(
                    job,
                    result,
                    candidate,
                    output,
                    conflicts,
                    signal,
                    proof,
                ),
            );
            await timeSearchStage("wiki.consolidation", () =>
                this.consolidateWikiTarget(job, result, conflicts, signal),
            );
        } catch (error) {
            const state = failedTargetState(
                error,
                signal,
                jobSignal,
                validation,
            );
            if (!this.purged.has(job.jobId))
                await this.result(job, result.viewId, state, safeError(error));
            return false;
        } finally {
            clearTimeout(timer);
            jobSignal.removeEventListener("abort", cancel);
        }
        return true;
    }

    private async validateOrRepairAnswers(
        input: ViewBuildSnapshot,
        candidate: ViewSynthesisOutput,
        signal: AbortSignal,
    ): Promise<ViewSynthesisOutput> {
        const report = await abortable(
            this.adapter.validate(input, candidate, signal),
            signal,
        );
        try {
            validateSupport(candidate, report);
            return candidate;
        } catch (error) {
            if (
                !(error instanceof ViewSupportRejection) ||
                input.pipeline !== "schema-defined-v1" ||
                !this.adapter.repairSchemaAnswers
            )
                throw error;
        }
        const repaired = await abortable(
            this.adapter.repairSchemaAnswers(input, candidate, report, signal),
            signal,
        );
        validateConstructedGuide(input, repaired);
        validateSupport(
            repaired,
            await abortable(
                this.adapter.validate(input, repaired, signal),
                signal,
            ),
        );
        return repaired;
    }

    private async consolidateWikiTarget(
        job: ViewBuildJob,
        result: ViewBuildTargetResult,
        conflicts: string[],
        signal: AbortSignal,
    ): Promise<void> {
        if (
            conflicts.length ||
            result.snapshot.pipeline !== "informational-wiki-v1"
        )
            return;
        await this.owner.consolidateWiki?.(job, result, signal);
    }

    private async verifyEditorialUpdate(
        input: ViewBuildSnapshot,
        output: ViewSynthesisOutput,
        signal: AbortSignal,
    ): Promise<void> {
        if (!requiresEditorialCheck(input, output)) return;
        if (!this.adapter.checkEditorial)
            throw new Error(
                "Consequential editorial update requires an actual-output checker",
            );
        assertEditorialAssessment(
            await abortable(
                this.adapter.checkEditorial(input, output, signal),
                signal,
            ),
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
        prepared?: Promise<WikiPreparation>,
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
        await this.result(
            job,
            result.viewId,
            "generating",
            "Comparing standalone purpose with nominated current pages",
        );
        const preparation = prepared
            ? await abortable(prepared, signal)
            : undefined;
        if (preparation && "error" in preparation) throw preparation.error;
        let value =
            preparation?.value ??
            (await this.prepareWikiAssessment(job, result, signal));
        if (value.input.influenceSources)
            result.snapshot.influenceSources = value.input.influenceSources;
        try {
            await this.owner.recordWikiAssessment(
                job,
                result,
                value.assessment,
                value.pages,
                signal,
            );
        } catch (error) {
            if (!prepared || !(error instanceof ViewBuildStaleError))
                throw error;
            signal.throwIfAborted();
            recordSearchTiming("wiki.assessment.speculation.discarded", 0, {
                discarded: 1,
            });
            value = await this.prepareWikiAssessment(job, result, signal);
            if (value.input.influenceSources)
                result.snapshot.influenceSources = value.input.influenceSources;
            await this.owner.recordWikiAssessment(
                job,
                result,
                value.assessment,
                value.pages,
                signal,
            );
        }
        const { assessment, pages } = value;
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
            assessment.disposition === "defer" ||
            assessment.disposition === "ambiguous"
        );
    }

    private async prepareWikiAssessment(
        job: ViewBuildJob,
        result: ViewBuildTargetResult,
        signal: AbortSignal,
    ): Promise<PreparedWikiAssessment> {
        if (!this.owner.wikiPages || !this.adapter.assessWikiSubject)
            throw new Error(
                "Wiki assessment preparation requires page and model adapters",
            );
        const input = structuredClone(result.snapshot);
        signal.throwIfAborted();
        const pages = await abortable(this.owner.wikiPages(input), signal);
        const sources = [
            ...new Map(
                [
                    ...(input.influenceSources ?? []),
                    ...pages.flatMap((page) => page.contributingSources),
                ].map((source) => [
                    JSON.stringify([source.sourceId, source.revisionId]),
                    source,
                ]),
            ).values(),
        ];
        input.influenceSources = sources;
        const scope = this.controllers.get(job.jobId);
        for (const source of sources) scope?.sources.add(source.sourceId);
        const assessment = parseWikiAssessment(
            await abortable(
                this.adapter.assessWikiSubject(input, pages, signal),
                signal,
            ),
            pages,
        );
        signal.throwIfAborted();
        return { assessment, pages, input };
    }

    private async run(job: ViewBuildJob, signal: AbortSignal): Promise<void> {
        const controller = new AbortController();
        const preparationSignal = AbortSignal.any([signal, controller.signal]);
        const prepared = new Map<string, Promise<WikiPreparation>>();
        const preparationLimit = createLimiter(this.wikiAssessmentConcurrency);
        const prepare = (offset: number) => {
            if (
                this.informationalLimits ||
                this.wikiAssessmentConcurrency === 1 ||
                !job.maintenancePlan ||
                !this.adapter.assessWikiSubject
            )
                return;
            for (const result of job.results.slice(
                offset,
                offset + this.wikiAssessmentConcurrency,
            )) {
                if (
                    result.snapshot.pipeline !== "informational-wiki-v1" ||
                    result.snapshot.expectedVersion !== 0 ||
                    result.snapshot.wikiContribution ||
                    prepared.has(result.viewId)
                )
                    continue;
                prepared.set(
                    result.viewId,
                    preparationLimit(async () => {
                        preparationSignal.throwIfAborted();
                        if (
                            this.owner.canPrepareWikiAssessment &&
                            !(await abortable(
                                this.owner.canPrepareWikiAssessment(
                                    result.snapshot,
                                ),
                                preparationSignal,
                            ))
                        )
                            return undefined;
                        return this.prepareWikiAssessment(
                            job,
                            result,
                            preparationSignal,
                        );
                    }).then(
                        (value): WikiPreparation => ({ value }),
                        (error: unknown): WikiPreparation => ({ error }),
                    ),
                );
            }
        };
        try {
            for (const [index, result] of job.results.entries()) {
                if (index % this.wikiAssessmentConcurrency === 0)
                    prepare(index);
                const target = () =>
                    runWithSearchTiming(
                        undefined,
                        `memory.build.${result.snapshot.pipeline}`,
                        () =>
                            timeSearchStage("build.target.total", async () => {
                                const success = await this.target(
                                    job,
                                    result,
                                    signal,
                                    prepared.get(result.viewId),
                                );
                                return { success };
                            }),
                        { corpusId: job.corpusId },
                    );
                if (
                    this.informationalLimits &&
                    informationalPipeline(result.snapshot.pipeline)
                )
                    await runWithRequestBudget(
                        new RequestBudget(this.informationalLimits),
                        target,
                    );
                else await target();
            }
        } finally {
            controller.abort(new Error("Wiki preparation window closed"));
            await Promise.all(prepared.values());
        }
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
        await Promise.all(this.tasks.values());
        for (const failure of this.failures.values()) throw failure.error;
    }
}

function failedTargetState(
    error: unknown,
    targetSignal: AbortSignal,
    jobSignal: AbortSignal,
    validation: boolean,
): ViewBuildTargetResult["state"] {
    if (
        error instanceof ViewBuildStaleError ||
        error instanceof ConsolidationTargetChanged
    )
        return "stale";
    if (
        error instanceof EditorialRejection ||
        error instanceof ConsolidationRejection
    )
        return "blocked";
    if (targetSignal.aborted) return jobSignal.aborted ? "cancelled" : "failed";
    return validation ? "blocked" : "failed";
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
