// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
    CopilotToolMacro,
    MacroExecutionRecipe,
    MacroLearningJob,
    MacroLearningMode,
    MacroLearningPreference,
    MacroLearningRuntime,
    MacroCandidateProvenance,
    MacroVersionRef,
    RecordedInteractionTrace,
    ReplayToolHost,
} from "./contracts.js";
import { getMacroFeatures } from "./macroFeatures.js";
import {
    parseMacroExecutionRecipe,
    parseMacroLearningBuild,
} from "./macroLearningParsers.js";
import { induceMacroFromTrace } from "./macroDefinition.js";
import { redactTraceValue } from "./redaction.js";
import {
    assertLearningBuild,
    assertLearningGrammar,
    assertLearningRecipe,
    assertLearningTrace,
    learningValuesEqual,
} from "./macroLearningValidation.js";

interface StoredJob extends MacroLearningJob {
    fingerprint: string;
    preferenceRevision: number;
    recipe?: MacroExecutionRecipe;
    draft?: CopilotToolMacro;
    attempts: Partial<Record<"extract" | "build" | "grammar", number>>;
    target?: MacroLearningTarget;
}

export interface MacroLearningTarget {
    macroId: string;
    version: number;
    provenance: MacroCandidateProvenance;
}

interface LearningState {
    schemaVersion: 1;
    preferences: MacroLearningPreference[];
    jobs: StoredJob[];
    suppressed: string[];
    suppressedMacroIds: string[];
}

interface LearningCatalog {
    readTrace(traceId: string): Promise<RecordedInteractionTrace>;
    saveDraft(macro: CopilotToolMacro): Promise<MacroVersionRef>;
    approveMacro(ref: MacroVersionRef): Promise<MacroVersionRef>;
    readVersion(
        macroId: string,
        version: number,
    ): Promise<CopilotToolMacro | undefined>;
    recoverApproved(macro: CopilotToolMacro): Promise<void>;
}

class LearningReviewRequired extends Error {}
class LearningDeadlineExceeded extends Error {}

const modes: MacroLearningMode[] = ["off", "prepare", "read-only", "all"];
const activeStatuses = new Set(["queued", "extracting", "building"]);

function normalizeCwd(cwd: string): string {
    if (typeof cwd !== "string" || !cwd.trim() || cwd.length > 4_096) {
        throw new Error(
            "A bounded working directory is required for learning.",
        );
    }
    return path.resolve(cwd).toLowerCase();
}

function digest(value: unknown): string {
    const canonical = (entry: unknown): unknown => {
        if (Array.isArray(entry)) return entry.map(canonical);
        if (entry !== null && typeof entry === "object") {
            return Object.fromEntries(
                Object.entries(entry)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([key, child]) => [key, canonical(child)]),
            );
        }
        return entry;
    };
    return createHash("sha256")
        .update(JSON.stringify(canonical(value)))
        .digest("hex");
}

export class MacroLearningEngine {
    private state?: LearningState;
    private loading?: Promise<void>;
    private mutation: Promise<void> = Promise.resolve();
    private runtime?: MacroLearningRuntime;
    private worker: Promise<void> | undefined;
    private workerError?: unknown;
    private controller: AbortController | undefined;
    private activeJobId: string | undefined;

    constructor(
        private readonly rootDir: string,
        private readonly catalog: LearningCatalog,
        private readonly replayHost?: ReplayToolHost,
    ) {}

    async configure(runtime: MacroLearningRuntime): Promise<void> {
        if (this.worker)
            throw new Error(
                "Learning runtime cannot change while jobs are active.",
            );
        if (
            !runtime ||
            typeof runtime.extract !== "function" ||
            typeof runtime.build !== "function" ||
            typeof runtime.generateGrammar !== "function"
        ) {
            throw new Error("A complete learning runtime is required.");
        }
        await this.load();
        this.runtime = runtime;
        await this.update(() => {
            for (const job of this.state!.jobs) {
                if (
                    activeStatuses.has(job.status) ||
                    (job.status === "failed" &&
                        job.draft &&
                        job.error?.includes("catalog was saved"))
                ) {
                    job.status = "queued";
                }
            }
        });
        this.startWorker();
    }

    async getPreference(cwd: string): Promise<MacroLearningPreference> {
        await this.load();
        return this.mutation.then(() => structuredClone(this.preference(cwd)));
    }

    private preference(cwd: string): MacroLearningPreference {
        const normalized = normalizeCwd(cwd);
        return (
            this.state?.preferences.find((item) => item.cwd === normalized) ?? {
                cwd: normalized,
                mode: "off",
                revision: 0,
            }
        );
    }

    assertSelected(cwd: string): void {
        const features = getMacroFeatures();
        if (!this.state || this.preference(cwd).mode === "off") {
            throw new Error(
                "Learning is off; load and select a learning preference before recording.",
            );
        }
        if (
            !features.recording ||
            !features.induction ||
            !features.agentHandoff
        ) {
            throw new Error(
                "Learning recording, induction, and live runner handoff must be enabled.",
            );
        }
    }

    async setPreference(request: {
        cwd: string;
        mode: MacroLearningMode;
    }): Promise<MacroLearningPreference> {
        const cwd = normalizeCwd(request.cwd);
        if (!modes.includes(request.mode))
            throw new Error("Invalid macro learning mode.");
        await this.load();
        let preference!: MacroLearningPreference;
        await this.update(() => {
            if (
                !this.state!.preferences.some((item) => item.cwd === cwd) &&
                this.state!.preferences.length >= 1_000
            ) {
                throw new Error(
                    "Learning workspace preference capacity exceeded.",
                );
            }
            preference = {
                cwd,
                mode: request.mode,
                revision: this.preference(cwd).revision + 1,
            };
            this.state!.preferences = this.state!.preferences.filter(
                (item) => item.cwd !== cwd,
            );
            this.state!.preferences.push(preference);
            for (const job of this.state!.jobs) {
                if (
                    job.cwd === cwd &&
                    activeStatuses.has(job.status) &&
                    job.macro?.state !== "approved"
                ) {
                    job.mode = preference.mode;
                    job.preferenceRevision = preference.revision;
                    if (preference.mode === "off") {
                        job.status = "cancelled";
                        job.error = "Learning was turned off.";
                        job.updatedAt = new Date().toISOString();
                        if (this.activeJobId === job.jobId)
                            this.controller?.abort();
                    }
                }
            }
        });
        return structuredClone(preference);
    }

    async prepare(
        traceId: string,
        selectedRecording = false,
        target?: MacroLearningTarget,
    ): Promise<MacroLearningJob> {
        await this.load();
        const trace = await this.catalog.readTrace(traceId);
        const cwd = normalizeCwd(trace.cwd);
        let sourceError: string | undefined;
        try {
            assertLearningTrace(trace);
        } catch (error) {
            sourceError = redactTraceValue(
                error instanceof Error ? error.message : String(error),
            ) as string;
        }
        const fingerprint = sourceError
            ? digest({ traceId, cwd })
            : digest({
                  cwd,
                  request: trace.prompt,
                  calls: trace.toolCalls.map((call) => ({
                      name: call.name,
                      ...(call.mcpServerName
                          ? { mcpServerName: call.mcpServerName }
                          : {}),
                      arguments: call.arguments,
                  })),
              });
        let job!: StoredJob;
        await this.update(() => {
            const existing = this.state!.jobs.find(
                (item) =>
                    item.fingerprint === fingerprint ||
                    (item.traceId === traceId && item.cwd === cwd),
            );
            if (existing) {
                if (
                    target &&
                    (existing.target?.macroId ?? existing.jobId) !==
                        target.macroId
                ) {
                    throw new Error(
                        "This trace already belongs to a different learning producer.",
                    );
                }
                job = existing;
                return;
            }
            if (!selectedRecording) this.assertSelected(cwd);
            const preference = this.preference(cwd);
            if (
                this.state!.jobs.length >= 1_000 ||
                this.state!.jobs.filter((item) =>
                    activeStatuses.has(item.status),
                ).length >= 32
            ) {
                throw new Error(
                    "Learning job capacity exceeded (1000 retained, 32 pending).",
                );
            }
            const now = new Date().toISOString();
            job = {
                jobId: digest({ traceId, cwd }),
                traceId,
                cwd,
                sessionId: trace.sessionId,
                mode: preference.mode,
                preferenceRevision: preference.revision,
                status: sourceError ? "failed" : "queued",
                fingerprint,
                attempts: {},
                createdAt: now,
                updatedAt: now,
                ...(sourceError ? { error: sourceError.slice(0, 2_000) } : {}),
                ...(target ? { target: structuredClone(target) } : {}),
            };
            this.state!.jobs.push(job);
            if (selectedRecording) {
                try {
                    this.assertSelected(cwd);
                } catch (error) {
                    job.status = "cancelled";
                    job.error =
                        error instanceof Error ? error.message : String(error);
                }
            }
        });
        this.startWorker();
        return this.publicJob(job);
    }

    async getJob(jobId: string): Promise<MacroLearningJob> {
        await this.load();
        const job = await this.mutation.then(() =>
            this.publicJob(this.findJob(jobId)),
        );
        if (this.workerError !== undefined) throw this.workerError;
        return job;
    }

    async isSuppressed(macro: CopilotToolMacro): Promise<boolean> {
        if (!macro.learning) return false;
        await this.load();
        const job = this.findJob(macro.learning.jobId);
        return (
            job.status === "cancelled" ||
            this.state!.suppressed.includes(job.fingerprint) ||
            this.state!.suppressedMacroIds.includes(macro.macroId)
        );
    }

    async cancel(jobId: string): Promise<MacroLearningJob> {
        await this.load();
        await this.update(() => {
            const job = this.findJob(jobId);
            if (job.status === "ready" || job.macro?.state === "approved") {
                throw new Error("Disable or forget an already approved macro.");
            }
            job.status = "cancelled";
            job.error = "Learning job was cancelled.";
            job.updatedAt = new Date().toISOString();
            if (this.activeJobId === jobId) this.controller?.abort();
        });
        return this.getJob(jobId);
    }

    async suppress(macro: CopilotToolMacro): Promise<void> {
        if (!macro.learning) return;
        await this.load();
        await this.update(() => {
            const job = this.findJob(macro.learning!.jobId);
            if (!this.state!.suppressedMacroIds.includes(macro.macroId)) {
                this.state!.suppressedMacroIds.push(macro.macroId);
            }
            for (const related of this.state!.jobs) {
                if (
                    (related.target?.macroId ?? related.jobId) === macro.macroId
                ) {
                    if (!this.state!.suppressed.includes(related.fingerprint)) {
                        this.state!.suppressed.push(related.fingerprint);
                    }
                    related.status = "cancelled";
                    related.error =
                        "The source macro was disabled or forgotten.";
                    related.updatedAt = new Date().toISOString();
                    if (this.activeJobId === related.jobId)
                        this.controller?.abort();
                }
            }
            if (!this.state!.suppressed.includes(job.fingerprint)) {
                this.state!.suppressed.push(job.fingerprint);
            }
            job.status = "cancelled";
            job.error =
                "Equivalent learning is suppressed because the macro was disabled or forgotten.";
            job.updatedAt = new Date().toISOString();
            if (this.activeJobId === job.jobId) this.controller?.abort();
        });
    }

    async assertApproval(
        macro: CopilotToolMacro,
        automatic = false,
    ): Promise<MacroLearningPreference | undefined> {
        if (!macro.learning) return undefined;
        await this.load();
        const job = this.findJob(macro.learning.jobId);
        this.check(job);
        if (!job.draft || !learningValuesEqual(macro, job.draft)) {
            throw new Error(
                "Learning approval requires the immutable staged draft and grammar target.",
            );
        }
        if (automatic) {
            const preference = this.preference(job.cwd);
            const allowed =
                preference.mode === "all" ||
                (preference.mode === "read-only" &&
                    (await this.stageInspection(job, () =>
                        this.allReadOnly(macro, job.cwd),
                    )));
            this.check(job);
            if (
                !allowed ||
                this.preference(job.cwd).revision !== preference.revision
            ) {
                throw new LearningReviewRequired(
                    "Current learning preference requires explicit review.",
                );
            }
        }
        return structuredClone(this.preference(job.cwd));
    }

    async approved(macro: CopilotToolMacro): Promise<void> {
        if (!macro.learning) return;
        await this.update(() => {
            const job = this.findJob(macro.learning!.jobId);
            if (
                job.status === "cancelled" ||
                this.state!.suppressed.includes(job.fingerprint) ||
                this.state!.suppressedMacroIds.includes(
                    job.target?.macroId ?? job.jobId,
                )
            ) {
                return;
            }
            job.macro = {
                macroId: macro.macroId,
                version: macro.version,
                state: macro.state,
            };
            job.status = "ready";
            job.updatedAt = new Date().toISOString();
            delete job.error;
        });
    }

    async approvalSaved(macro: CopilotToolMacro): Promise<void> {
        if (!macro.learning) return;
        await this.update(() => {
            const job = this.findJob(macro.learning!.jobId);
            job.mode = macro.learning!.mode;
            job.macro = {
                macroId: macro.macroId,
                version: macro.version,
                state: macro.state,
            };
            job.updatedAt = new Date().toISOString();
        });
    }

    private check(job: StoredJob): void {
        this.assertSelected(job.cwd);
        if (
            job.status === "cancelled" ||
            this.state!.suppressed.includes(job.fingerprint) ||
            this.state!.suppressedMacroIds.includes(
                job.target?.macroId ?? job.jobId,
            )
        ) {
            throw new Error("Learning job is cancelled or suppressed.");
        }
        if (this.activeJobId === job.jobId)
            this.controller?.signal.throwIfAborted();
    }

    private startWorker(): void {
        if (!this.runtime || this.worker || this.workerError !== undefined)
            return;
        this.worker = this.drain()
            .catch((error: unknown) => {
                // Storage failures cannot themselves be persisted; expose them on status reads.
                this.workerError = error;
            })
            .finally(() => {
                this.worker = undefined;
            });
    }

    private async drain(): Promise<void> {
        let job: StoredJob | undefined;
        while (
            (job = this.state!.jobs.find((item) => item.status === "queued"))
        ) {
            this.controller = new AbortController();
            this.activeJobId = job.jobId;
            try {
                await this.process(job);
            } catch (error) {
                const message = redactTraceValue(
                    error instanceof Error ? error.message : String(error),
                ) as string;
                if (job.status !== "cancelled") {
                    await this.update(() => {
                        job!.status =
                            error instanceof LearningReviewRequired
                                ? "needsReview"
                                : error instanceof LearningDeadlineExceeded
                                  ? "failed"
                                  : this.controller!.signal.aborted
                                    ? "cancelled"
                                    : "failed";
                        job!.error = message.slice(0, 2_000);
                        job!.updatedAt = new Date().toISOString();
                    });
                }
            } finally {
                this.controller = undefined;
                this.activeJobId = undefined;
            }
        }
    }

    private async stage<T>(
        job: StoredJob,
        stage: "extract" | "build" | "grammar",
        operation: (signal: AbortSignal) => Promise<T>,
    ): Promise<T> {
        this.check(job);
        await this.update(() => {
            const attempts = (job.attempts[stage] ?? 0) + 1;
            if (attempts > 2)
                throw new Error(`Learning ${stage} restart budget exceeded.`);
            job.attempts[stage] = attempts;
            job.updatedAt = new Date().toISOString();
        });
        let timer: ReturnType<typeof setTimeout> | undefined;
        const controller = this.controller!;
        let timedOut = false;
        let abort!: () => void;
        const interrupted = new Promise<never>((_resolve, reject) => {
            abort = () =>
                reject(
                    timedOut
                        ? new LearningDeadlineExceeded(
                              `Learning ${stage} exceeded its 30s deadline.`,
                          )
                        : new Error(`Learning ${stage} was cancelled.`),
                );
            controller.signal.addEventListener("abort", abort, { once: true });
            timer = setTimeout(() => {
                timedOut = true;
                controller.abort();
            }, 30_000);
        });
        try {
            controller.signal.throwIfAborted();
            const result = await Promise.race([
                operation(controller.signal),
                interrupted,
            ]);
            this.check(job);
            return result;
        } finally {
            clearTimeout(timer);
            controller.signal.removeEventListener("abort", abort);
        }
    }

    private async process(job: StoredJob): Promise<void> {
        const macroId = job.target?.macroId ?? job.jobId;
        const draftVersion = job.target?.version ?? 1;
        const existing = await this.catalog.readVersion(
            macroId,
            draftVersion + 1,
        );
        if (existing) {
            if (
                !existing.learning ||
                existing.learning.jobId !== job.jobId ||
                existing.state !== "approved"
            ) {
                throw new Error(
                    "Learning publication conflicts with an existing immutable version.",
                );
            }
            if (
                job.status === "cancelled" ||
                this.state!.suppressed.includes(job.fingerprint)
            ) {
                throw new Error("Learning publication is suppressed.");
            }
            await this.catalog.recoverApproved(existing);
            await this.approved(existing);
            return;
        }
        this.check(job);
        const trace = await this.catalog.readTrace(job.traceId);
        assertLearningTrace(trace);
        if (!job.recipe) {
            await this.update(() => {
                job.status = "extracting";
            });
            const recipe = parseMacroExecutionRecipe(
                await this.stage(job, "extract", (signal) =>
                    this.runtime!.extract(
                        structuredClone(trace),
                        job.traceId,
                        signal,
                    ),
                ),
            );
            assertLearningRecipe(recipe, trace, job.traceId);
            await this.update(() => {
                job.recipe = structuredClone(recipe);
                job.status = "building";
            });
        }
        assertLearningRecipe(job.recipe!, trace, job.traceId);
        if (!job.draft) {
            const baseline = await this.stage(job, "build", async (signal) => {
                const macro = await induceMacroFromTrace(
                    job.traceId,
                    trace,
                    macroId,
                    "Learning draft",
                    trace.prompt,
                    job.createdAt,
                    this.replayHost,
                );
                macro.version = draftVersion;
                if (job.target) {
                    macro.candidateProvenance = structuredClone(
                        job.target.provenance,
                    );
                }
                signal.throwIfAborted();
                const build = parseMacroLearningBuild(
                    await this.runtime!.build(
                        structuredClone(job.recipe!),
                        structuredClone(trace),
                        structuredClone(macro),
                        signal,
                    ),
                );
                const draft: CopilotToolMacro = {
                    ...macro,
                    name: build.name,
                    description: build.description,
                    inputs: build.inputs,
                    steps: build.steps,
                    executionClass: build.steps.every(
                        (step) => step.executionClass === "replayable",
                    )
                        ? "replayable"
                        : "agentRequired",
                    warnings: [],
                };
                assertLearningBuild(build, draft, trace);
                if (
                    draft.steps.some(
                        (step, index) =>
                            step.executionClass !==
                            macro.steps[index].executionClass,
                    )
                ) {
                    throw new Error(
                        "Builder changed the inspected source execution class.",
                    );
                }
                return { draft, build };
            });
            const rules = await this.stage(job, "grammar", (signal) =>
                this.runtime!.generateGrammar(
                    {
                        ...structuredClone(baseline.draft),
                        version: baseline.draft.version + 1,
                        state: "approved",
                    },
                    structuredClone(baseline.build.exampleInputs),
                    [...baseline.build.requests],
                    signal,
                ),
            );
            assertLearningGrammar(rules);
            this.check(job);
            const preference = this.preference(job.cwd);
            baseline.draft.learning = {
                jobId: job.jobId,
                cwd: job.cwd,
                mode: preference.mode,
                requiresLivePermissions: true,
                grammarRules: rules,
                exampleInputs: baseline.build.exampleInputs,
                requests: baseline.build.requests,
            };
            await this.update(() => {
                job.draft = structuredClone(baseline.draft);
            });
        }
        this.check(job);
        const ref = await this.catalog.saveDraft(structuredClone(job.draft!));
        await this.update(() => {
            job.macro = ref;
        });
        this.check(job);
        const preference = this.preference(job.cwd);
        let approve = preference.mode === "all";
        if (preference.mode === "read-only") {
            approve = await this.stageInspection(job, () =>
                this.allReadOnly(job.draft!, trace.cwd),
            );
        }
        this.check(job);
        // A downgrade during metadata inspection must never inherit the earlier approval decision.
        if (this.preference(job.cwd).revision !== preference.revision) {
            approve = this.preference(job.cwd).mode === "all";
        }
        if (approve) {
            await this.catalog.approveMacro(ref);
        } else {
            await this.update(() => {
                job.status = "needsReview";
                job.updatedAt = new Date().toISOString();
            });
        }
    }

    private async allReadOnly(
        macro: CopilotToolMacro,
        cwd: string,
    ): Promise<boolean> {
        if (!this.replayHost) return false;
        for (const step of macro.steps) {
            if (!step.mcpServerName) return false;
            const descriptor = await this.replayHost.inspectTool(
                step.mcpServerName,
                step.toolName,
                { cwd },
            );
            if (
                descriptor?.readOnly !== true ||
                descriptor.toolName !== step.toolName ||
                (descriptor.mcpServerName !== undefined &&
                    descriptor.mcpServerName !== step.mcpServerName)
            )
                return false;
        }
        return true;
    }

    private async stageInspection<T>(
        job: StoredJob,
        operation: () => Promise<T>,
    ): Promise<T> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            const result = await Promise.race([
                operation(),
                new Promise<never>((_resolve, reject) => {
                    timer = setTimeout(
                        () =>
                            reject(
                                new Error(
                                    "Learning tool inspection exceeded its 10s deadline.",
                                ),
                            ),
                        10_000,
                    );
                }),
            ]);
            this.check(job);
            return result;
        } finally {
            clearTimeout(timer);
        }
    }

    private findJob(jobId: string): StoredJob {
        const job = this.state!.jobs.find((item) => item.jobId === jobId);
        if (!job) throw new Error(`Macro learning job not found: ${jobId}`);
        return job;
    }

    private publicJob(job: StoredJob): MacroLearningJob {
        const {
            recipe: _recipe,
            draft: _draft,
            fingerprint: _fingerprint,
            preferenceRevision: _revision,
            attempts: _attempts,
            target: _target,
            ...publicJob
        } = job;
        return structuredClone(publicJob);
    }

    private async load(): Promise<void> {
        this.loading ??= (async () => {
            try {
                if ((await stat(this.statePath())).size > 16 * 1024 * 1024) {
                    throw new Error(
                        "Durable learning storage exceeds its 16 MiB limit.",
                    );
                }
                this.state = JSON.parse(
                    await readFile(this.statePath(), "utf8"),
                ) as LearningState;
                this.state.suppressedMacroIds ??= [];
                if (
                    this.state.schemaVersion !== 1 ||
                    !Array.isArray(this.state.jobs) ||
                    !Array.isArray(this.state.preferences) ||
                    !Array.isArray(this.state.suppressed) ||
                    !Array.isArray(this.state.suppressedMacroIds) ||
                    this.state.jobs.length > 1_000 ||
                    this.state.preferences.length > 1_000 ||
                    this.state.preferences.some(
                        (item) =>
                            !modes.includes(item.mode) ||
                            !Number.isSafeInteger(item.revision) ||
                            item.revision < 0 ||
                            typeof item.cwd !== "string",
                    ) ||
                    this.state.jobs.some(
                        (job) =>
                            typeof job.jobId !== "string" ||
                            !/^[a-f0-9]{64}$/.test(job.jobId) ||
                            !modes.includes(job.mode) ||
                            ![
                                "queued",
                                "extracting",
                                "building",
                                "needsReview",
                                "ready",
                                "failed",
                                "cancelled",
                            ].includes(job.status) ||
                            typeof job.traceId !== "string" ||
                            typeof job.cwd !== "string" ||
                            typeof job.fingerprint !== "string" ||
                            !job.attempts,
                    )
                ) {
                    throw new Error("Invalid durable learning state.");
                }
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT")
                    throw error;
                this.state = {
                    schemaVersion: 1,
                    preferences: [],
                    jobs: [],
                    suppressed: [],
                    suppressedMacroIds: [],
                };
            }
        })();
        await this.loading;
    }

    private update(operation: () => void): Promise<void> {
        const result = this.mutation.then(async () => {
            const before = structuredClone(this.state!);
            const references = new Map(
                this.state!.jobs.map((job) => [job.jobId, job]),
            );
            try {
                operation();
                const destination = this.statePath();
                await mkdir(path.dirname(destination), { recursive: true });
                const temporary = `${destination}.${randomUUID()}.tmp`;
                const serialized = JSON.stringify(this.state);
                if (Buffer.byteLength(serialized) > 16 * 1024 * 1024) {
                    throw new Error(
                        "Durable learning storage exceeds its 16 MiB limit.",
                    );
                }
                await writeFile(temporary, serialized, {
                    encoding: "utf8",
                    flag: "wx",
                });
                await rename(temporary, destination);
            } catch (error) {
                before.jobs = before.jobs.map((snapshot) => {
                    const original = references.get(snapshot.jobId);
                    if (!original) return snapshot;
                    for (const key of Object.keys(original)) {
                        Reflect.deleteProperty(original, key);
                    }
                    return Object.assign(original, snapshot);
                });
                this.state = before;
                throw error;
            }
        });
        this.mutation = result.then(
            () => undefined,
            () => undefined,
        );
        return result;
    }

    private statePath(): string {
        return path.join(this.rootDir, "learning.json");
    }
}
