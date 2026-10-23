// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash, randomUUID } from "node:crypto";
import {
    appendFile,
    mkdir,
    readFile,
    readdir,
    rename,
    rm,
    writeFile,
} from "node:fs/promises";
import path from "node:path";
import type {
    ApproveMacroRequest,
    ArmRecordingRequest,
    ClaimRecordingRequest,
    CopilotToolMacro,
    DeleteMacroRequest,
    DisableMacroRequest,
    FinalizeRecordingRequest,
    InspectMacroRequest,
    ListMacrosRequest,
    MacroLearningJob,
    MacroLearningMode,
    MacroLearningPreference,
    MacroLearningRuntime,
    MacroMatch,
    MacroProgramRuntime,
    MacroRequirements,
    MacroRunRecord,
    MacroSummary,
    MacroValidationReport,
    MacroVersionRef,
    RecordedInteractionTrace,
    RecordingState,
    RecordingToken,
    ReplayToolHost,
    RunMacroRequest,
    RunMacroResponse,
    SearchMacrosRequest,
    TraceSummary,
    ValidateMacroRequest,
} from "./contracts.js";
import { validateMacro } from "./macroDefinition.js";

import { MacroLearningEngine } from "./macroLearning.js";
import { sealMacroChildCapture } from "./macroChildCapture.js";
import type {
    MacroAuthoringClaim,
    MacroAuthoringRequest,
    MacroAuthoringSubmission,
} from "./contracts.js";
import { readProgramJournal, runMacroProgram } from "./macroProgramRun.js";
import type { JsonValue } from "./recipeContracts.js";
import type { SealedRecipeAuthoringContext } from "./recipeAuthoring.js";
import { redactTraceValue } from "./redaction.js";
import { PrivateResultStore } from "./resultEvidence.js";
import { assertMacroCapabilities } from "./resultPath.js";
import {
    publishImmutable,
    publishJson,
    withRecordLock,
} from "./revisionRecords.js";

const defaultRecordingTtlMs = 10 * 60 * 1000;
const maxPersistedRunValueBytes = 256 * 1024;
const maxPersistedRunPreviewCharacters = 16 * 1024;

interface MacroRunOptions {
    signal?: AbortSignal | undefined;
    requireLatestApproved?: boolean;
}

function forwardAbortSignal(
    signal: AbortSignal | undefined,
    controller: AbortController,
): () => void {
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) controller.abort();
    return () => signal?.removeEventListener("abort", abort);
}

function sanitizeRunValue(value: unknown): unknown {
    const redacted = redactTraceValue(value);
    const serialized = JSON.stringify(redacted);
    if (
        serialized === undefined ||
        Buffer.byteLength(serialized) <= maxPersistedRunValueBytes
    ) {
        return redacted;
    }
    return {
        truncated: true,
        originalBytes: Buffer.byteLength(serialized),
        preview: serialized.slice(0, maxPersistedRunPreviewCharacters),
    };
}

export class MacroManager {
    private readonly recordings = new Map<string, RecordingToken>();
    private readonly completed = new Map<string, TraceSummary>();
    private readonly failures = new Map<string, string>();
    private readonly rootDir: string;
    private readonly activeRuns = new Map<string, AbortController>();
    private readonly runCompletions = new Map<string, Promise<void>>();
    private readonly pendingCancellations = new Map<string, number>();
    private closed = false;
    private catalogMutation: Promise<void> = Promise.resolve();
    private readonly catalogListeners = new Set<() => Promise<void>>();
    private readonly learning: MacroLearningEngine;
    private programRuntime?: MacroProgramRuntime;

    constructor(
        instanceDir: string,
        replayHost?: ReplayToolHost,
        private readonly authoringProfileId = "typeagent",
    ) {
        if (!authoringProfileId.trim() || authoringProfileId.length > 256)
            throw new Error(
                "A bounded authoring profile identity is required.",
            );
        this.rootDir = path.resolve(instanceDir, "copilot-macros");
        this.learning = new MacroLearningEngine(
            this.rootDir,
            {
                readTrace: (traceId) => this.readLearningTrace(traceId),
                saveDraft: (macro) => this.saveDraft(macro),
                approveMacro: (ref) => this.approveMacroVersion(ref, true),
                readVersion: (macroId, version) =>
                    this.readVersionIfPresent(macroId, version),
                recoverApproved: (macro) => this.recoverLearningApproval(macro),
            },
            replayHost,
            authoringProfileId,
        );
    }

    configureLearning(runtime: MacroLearningRuntime): Promise<void> {
        return this.learning.configure(runtime);
    }

    configureProgramRuntime(runtime: MacroProgramRuntime): void {
        if (this.closed) throw new Error("The macro owner is closed.");
        if (this.activeRuns.size)
            throw new Error("Program runtime cannot change during execution.");
        this.programRuntime = runtime;
    }

    canRunPrograms(): boolean {
        return this.programRuntime !== undefined;
    }

    getMacroLearningPreference(cwd: string): Promise<MacroLearningPreference> {
        return this.learning.getPreference(cwd);
    }

    setMacroLearningPreference(request: {
        cwd: string;
        mode: MacroLearningMode;
    }): Promise<MacroLearningPreference> {
        return this.serializeCatalog(() =>
            this.learning.setPreference(request),
        );
    }

    async prepareMacroLearning(request: {
        traceId: string;
    }): Promise<MacroLearningJob> {
        return this.learning.prepare(request.traceId, false);
    }

    getMacroLearningJob(jobId: string): Promise<MacroLearningJob> {
        return this.learning.getJob(jobId);
    }

    claimMacroAuthoringRequest(
        claim: MacroAuthoringClaim,
    ): Promise<MacroAuthoringRequest | undefined> {
        return this.learning.claimAuthoring(claim);
    }

    submitMacroAuthoringResponse(
        submission: MacroAuthoringSubmission,
    ): Promise<void> {
        return this.learning.submitAuthoring(submission);
    }

    cancelMacroLearningJob(jobId: string): Promise<MacroLearningJob> {
        return this.serializeCatalog(() => this.learning.cancel(jobId));
    }

    onCatalogChanged(listener: () => Promise<void>): () => void {
        this.catalogListeners.add(listener);
        return () => this.catalogListeners.delete(listener);
    }

    async getApprovedMacros(): Promise<CopilotToolMacro[]> {
        const summaries = await this.readCatalog();
        const macros = await Promise.all(
            summaries
                .filter((macro) => macro.state === "approved")
                .map((macro) => this.inspectMacro(macro)),
        );
        const suppressed = await Promise.all(
            macros.map((macro) => this.learning.isSuppressed(macro)),
        );
        return macros.filter((_macro, index) => !suppressed[index]);
    }

    armRecording(request: ArmRecordingRequest): RecordingToken {
        if (request.learning === true) {
            this.learning.assertSelected(request.cwd ?? "");
        }
        this.removeExpired(request.sessionId);
        if (this.recordings.has(request.sessionId)) {
            throw new Error(
                "A macro recording is already active for this session.",
            );
        }
        const ttlMs = request.ttlMs ?? defaultRecordingTtlMs;
        if (!request.sessionId || ttlMs <= 0) {
            throw new Error(
                "A session ID and positive recording TTL are required.",
            );
        }
        const token: RecordingToken = {
            id: randomUUID(),
            sessionId: request.sessionId,
            status: "armed",
            expiresAt: new Date(Date.now() + ttlMs).toISOString(),
            ...(request.learning === true
                ? { learning: true, cwd: request.cwd }
                : {}),
        };
        this.completed.delete(request.sessionId);
        this.failures.delete(request.sessionId);
        this.recordings.set(request.sessionId, token);
        return token;
    }

    async getRecordingState(sessionId: string): Promise<RecordingState> {
        this.removeExpired(sessionId);
        const token = this.recordings.get(sessionId);
        if (token) return { status: token.status, token };
        const trace = this.completed.get(sessionId);
        if (trace) {
            return {
                status: "completed",
                trace,
                ...(trace.learningJobId
                    ? {
                          learningJob: await this.learning.getJob(
                              trace.learningJobId,
                          ),
                      }
                    : {}),
            };
        }
        const error = this.failures.get(sessionId);
        return error ? { status: "failed", error } : { status: "idle" };
    }

    claimRecording(request: ClaimRecordingRequest): RecordingToken | undefined {
        this.removeExpired(request.sessionId);
        const current = this.recordings.get(request.sessionId);
        if (!current || current.status !== "armed") return undefined;
        if (!request.cwd || !request.promptHash) {
            throw new Error("Recording claims require cwd and promptHash.");
        }
        if (
            current.learning &&
            path.resolve(current.cwd!).toLowerCase() !==
                path.resolve(request.cwd).toLowerCase()
        ) {
            throw new Error(
                "Selected learning must remain in its armed working directory.",
            );
        }
        const claimed: RecordingToken = {
            ...current,
            status: "claimed",
            cwd: request.cwd,
            promptHash: request.promptHash,
        };
        this.recordings.set(request.sessionId, claimed);
        return claimed;
    }

    cancelRecording(sessionId: string): void {
        this.recordings.delete(sessionId);
        this.completed.delete(sessionId);
        this.failures.delete(sessionId);
    }

    failRecording(sessionId: string, tokenId: string, error: string): void {
        const token = this.recordings.get(sessionId);
        if (!token || token.id !== tokenId || token.status !== "claimed") {
            return;
        }
        this.recordings.delete(sessionId);
        this.failures.set(sessionId, error);
    }

    async finalizeRecording(
        request: FinalizeRecordingRequest,
    ): Promise<TraceSummary> {
        const token = [...this.recordings.values()].find(
            (candidate) => candidate.id === request.tokenId,
        );
        if (!token || token.status !== "claimed") {
            throw new Error("The macro recording token is not active.");
        }
        this.removeExpired(token.sessionId);
        if (!this.recordings.has(token.sessionId)) {
            throw new Error("The macro recording token has expired.");
        }
        this.validateTrace(token, request.trace);
        this.recordings.delete(token.sessionId);

        const traceId = randomUUID();
        const createdAt = new Date().toISOString();
        let storedTrace: RecordedInteractionTrace & {
            traceId: string;
            createdAt: string;
        };
        let envelope: SealedRecipeAuthoringContext | undefined;
        try {
            storedTrace = redactTraceValue({
                ...(await this.retainTraceEvidence(traceId, request.trace)),
                traceId,
                createdAt,
            }) as typeof storedTrace;
            if (token.learning) {
                if (!request.childAuthoring)
                    throw new Error(
                        "A sealed child authoring capture is required; re-record the successful task.",
                    );
                envelope = sealMacroChildCapture(
                    traceId,
                    request.trace,
                    token,
                    request.childAuthoring,
                    (await this.learning.getPreference(request.trace.cwd)).mode,
                    storedTrace,
                    this.authoringProfileId,
                );
            }
            if (
                Buffer.byteLength(JSON.stringify(storedTrace, undefined, 2)) >
                1024 * 1024
            )
                throw new Error(
                    "Recorded learning trace exceeds its 1 MiB storage limit.",
                );
            const tracesDir = path.join(this.rootDir, "traces");
            await mkdir(tracesDir, { recursive: true });
            const destination = path.join(tracesDir, `${traceId}.json`);
            const temporary = `${destination}.${randomUUID()}.tmp`;
            await writeFile(
                temporary,
                JSON.stringify(storedTrace, undefined, 2),
                {
                    encoding: "utf8",
                    flag: "wx",
                },
            );
            await rename(temporary, destination);
        } catch (error) {
            this.failures.set(
                token.sessionId,
                `The selected interaction could not be stored or queued for learning: ${redactTraceValue(error instanceof Error ? error.message : String(error))}`,
            );
            throw error;
        }
        const summary: TraceSummary = {
            traceId,
            sessionId: token.sessionId,
            createdAt,
            toolCallCount: request.trace.toolCalls.length,
        };
        try {
            if (token.learning) {
                const job = await this.learning.prepare(
                    traceId,
                    true,
                    envelope,
                );
                summary.learningJobId = job.jobId;
            }
        } catch (error) {
            this.failures.set(
                token.sessionId,
                `The stored trace ${traceId} could not be queued for learning: ${redactTraceValue(error instanceof Error ? error.message : String(error))}`,
            );
            throw error;
        }
        this.failures.delete(token.sessionId);
        this.completed.set(token.sessionId, summary);
        return summary;
    }

    private async retainTraceEvidence(
        traceId: string,
        trace: RecordedInteractionTrace,
    ): Promise<RecordedInteractionTrace> {
        const evidence = new PrivateResultStore(this.rootDir);
        const boundedTrace = structuredClone(trace);
        for (const call of boundedTrace.toolCalls) {
            for (const source of ["result", "modelResult"] as const) {
                const ref = await evidence.retain(
                    "trace",
                    traceId,
                    call.toolCallId,
                    source,
                    call[source],
                );
                if (!ref) continue;
                if (source === "result") call.resultArtifact = ref;
                else call.modelResultArtifact = ref;
                call[source] = ref.view;
                boundedTrace.schemaVersion = 2;
                boundedTrace.capabilities = ["private-result-evidence-v1"];
            }
        }
        return boundedTrace;
    }

    async saveDraft(macro: CopilotToolMacro): Promise<MacroVersionRef> {
        this.validateMacroId(macro.macroId);
        if (macro.state !== "draft") {
            throw new Error("Only draft macros can be persisted.");
        }
        if (macro.executionKind !== "program" || !macro.program)
            throw new Error("Only validated program macros can be persisted.");
        const report = validateMacro(macro);
        if (!report.valid) {
            const errors = report.issues
                .filter((item) => item.severity === "error")
                .map((item) => item.message)
                .join("; ");
            throw new Error(`Macro validation failed: ${errors}`);
        }
        return this.mutateCatalog(async () => {
            if (macro.learning) await this.learning.assertApproval(macro);
            const latest = await this.readSummary(macro.macroId);
            const existing = await this.readVersionIfPresent(
                macro.macroId,
                macro.version,
            );
            if (existing !== undefined) {
                if (JSON.stringify(existing) !== JSON.stringify(macro)) {
                    throw new Error(
                        `Macro version already exists with different content: ${macro.macroId}@${macro.version}`,
                    );
                }
                if (
                    latest === undefined ||
                    latest.version <= existing.version
                ) {
                    await this.upsertSummary(existing);
                }
                return this.versionRef(existing);
            }
            if (
                latest &&
                (await this.inspectMacro(latest)).learning &&
                !macro.learning
            ) {
                throw new Error(
                    "Learned macro versions require a fresh grounded build and version-targeted grammar.",
                );
            }
            if (latest !== undefined && latest.version >= macro.version) {
                throw new Error(
                    `Macro version must be newer than ${macro.macroId}@${latest.version}.`,
                );
            }
            await this.writeVersion(macro);
            await this.upsertSummary(macro);
            return this.versionRef(macro);
        });
    }

    async listMacros(request: ListMacrosRequest = {}): Promise<MacroSummary[]> {
        const limit = Math.min(Math.max(request.limit ?? 100, 1), 500);
        const summaries = await this.readCatalog();
        return summaries
            .filter((macro) => !request.state || macro.state === request.state)
            .sort((left, right) =>
                right.updatedAt.localeCompare(left.updatedAt),
            )
            .slice(0, limit);
    }

    async searchMacros(request: SearchMacrosRequest): Promise<MacroMatch[]> {
        const terms = request.query.toLowerCase().split(/\s+/).filter(Boolean);
        if (terms.length === 0) return [];
        const macros = await this.listMacros({ limit: 500 });
        return macros
            .map((macro) => {
                const name = macro.name.toLowerCase();
                const text = `${name} ${macro.description.toLowerCase()}`;
                const matches = terms.filter((term) => text.includes(term));
                const nameMatches = terms.filter((term) => name.includes(term));
                return {
                    macro,
                    score:
                        (matches.length + nameMatches.length) /
                        (terms.length * 2),
                };
            })
            .filter((match) => match.score > 0)
            .sort((left, right) => right.score - left.score)
            .slice(0, Math.min(Math.max(request.limit ?? 20, 1), 100));
    }

    async inspectMacro(
        request: InspectMacroRequest,
    ): Promise<CopilotToolMacro> {
        this.validateMacroId(request.macroId);
        const version =
            request.version ??
            (await this.getLatestSummary(request.macroId)).version;
        const macro = await this.readJson<CopilotToolMacro>(
            this.versionPath(request.macroId, version),
            `Macro version not found: ${request.macroId}@${version}`,
        );
        assertMacroCapabilities(macro);
        if (request.requireRunnable) {
            await this.validateRunRoute(macro, {
                requireLatestApproved: true,
            });
        }
        return macro;
    }

    async getMacroRequirements(
        request: InspectMacroRequest,
    ): Promise<MacroRequirements> {
        const macro = await this.inspectMacro(request);
        return {
            macroId: macro.macroId,
            version: macro.version,
            executionClass: macro.executionClass,
            ...(macro.executionKind
                ? { executionKind: macro.executionKind }
                : {}),
            inputs: macro.inputs,
            tools: macro.steps.map((step) => ({
                toolName: step.toolName,
                ...(step.mcpServerName
                    ? { mcpServerName: step.mcpServerName }
                    : {}),
                executionClass: step.executionClass,
            })),
        };
    }

    async validateMacro(
        request: ValidateMacroRequest,
    ): Promise<MacroValidationReport> {
        const macro = await this.inspectMacro(request);
        const trace = macro.sourceTraceId.startsWith("procedure:")
            ? undefined
            : await this.readTrace(macro.sourceTraceId);
        return validateMacro(macro, trace);
    }

    async approveMacro(request: ApproveMacroRequest): Promise<MacroVersionRef> {
        return this.approveMacroVersion(request, false);
    }

    private async approveMacroVersion(
        request: ApproveMacroRequest,
        automatic: boolean,
    ): Promise<MacroVersionRef> {
        return this.mutateCatalog(async () => {
            const current = await this.inspectMacro(request);
            if (current.state !== "draft") {
                throw new Error("Only a draft macro version can be approved.");
            }
            const report = await this.validateMacro({
                macroId: current.macroId,
                version: current.version,
            });
            if (!report.valid) {
                throw new Error(
                    "Macro validation failed; approval was not recorded.",
                );
            }
            if (current.executionKind !== "program" || !current.program)
                throw new Error(
                    "Only validated program macros can be approved.",
                );
            const approved: CopilotToolMacro = {
                ...current,
                version: current.learning
                    ? current.version + 1
                    : await this.nextVersion(current.macroId),
                state: "approved",
                createdAt: new Date().toISOString(),
            };
            const latest = await this.getLatestSummary(current.macroId);
            if (
                latest.version !== current.version ||
                latest.state !== "draft"
            ) {
                throw new Error("Only the current draft can be approved.");
            }
            const learningPreference = await this.learning.assertApproval(
                current,
                automatic,
            );
            if (approved.learning && learningPreference) {
                approved.learning = {
                    ...approved.learning,
                    mode: learningPreference.mode,
                };
            }
            if (approved.learning) {
                this.learning.validateApprovalGrammar(
                    approved,
                    await this.getApprovedMacros(),
                );
            }
            await this.writeVersion(approved);
            await this.upsertSummary(approved);
            await this.learning.approvalSaved(approved);
            return this.versionRef(approved);
        }).then(async (ref) => {
            await this.learning.approved(await this.inspectMacro(ref));
            return ref;
        });
    }

    private async recoverLearningApproval(
        macro: CopilotToolMacro,
    ): Promise<void> {
        await this.mutateCatalog(async () => {
            if (await this.learning.isSuppressed(macro)) {
                throw new Error(
                    "Learning recovery cannot resurrect a suppressed macro.",
                );
            }

            const latest = await this.readSummary(macro.macroId);
            if (
                latest &&
                (latest.version > macro.version || latest.state === "disabled")
            ) {
                throw new Error(
                    "Learning recovery cannot resurrect a superseded or disabled version.",
                );
            }
            this.learning.validateApprovalGrammar(
                macro,
                await this.getApprovedMacros(),
            );
            await this.upsertSummary(macro);
        });
    }

    async disableMacro(request: DisableMacroRequest): Promise<MacroVersionRef> {
        return this.mutateCatalog(async () => {
            const current = await this.inspectMacro({
                macroId: request.macroId,
            });
            if (current.state !== "approved") {
                throw new Error("Only an approved macro can be disabled.");
            }
            const disabled: CopilotToolMacro = {
                ...current,
                version: await this.nextVersion(current.macroId),
                state: "disabled",
                createdAt: new Date().toISOString(),
            };
            await this.learning.suppress(current);
            await this.writeVersion(disabled);
            await this.upsertSummary(disabled);
            return this.versionRef(disabled);
        });
    }

    async deleteMacro(request: DeleteMacroRequest): Promise<void> {
        await this.mutateCatalog(async () => {
            this.validateMacroId(request.macroId);
            const summary = await this.readSummary(request.macroId);
            const current = summary
                ? await this.inspectMacro(summary)
                : await this.readVersionIfPresent(request.macroId, 1);
            if (current) await this.learning.suppress(current);
            await publishJson(this.summaryPath(request.macroId), {
                schemaVersion: 2,
                summary: null,
            });
            if (!current?.learning) {
                await rm(path.join(this.rootDir, "macros", request.macroId), {
                    recursive: true,
                    force: true,
                });
            }
            const directory = path.dirname(this.summaryPath(request.macroId));
            const staged = (await readdir(directory)).filter(
                (file) =>
                    file.startsWith(`${request.macroId}.json.`) &&
                    file.endsWith(".tmp"),
            );
            await Promise.all(
                staged.map((file) =>
                    rm(path.join(directory, file), { force: true }),
                ),
            );
        });
    }
    async runMacro(
        request: RunMacroRequest,
        options: MacroRunOptions = {},
    ): Promise<RunMacroResponse> {
        if (this.closed) throw new Error("The macro owner is closed.");
        options.signal?.throwIfAborted();
        this.validateMacroId(request.runId);
        if ((this.pendingCancellations.get(request.runId) ?? 0) > Date.now())
            throw new Error(
                `Macro run was cancelled before acceptance: ${request.runId}`,
            );
        if (this.activeRuns.has(request.runId))
            throw new Error(`Macro run is already active: ${request.runId}`);
        const controller = new AbortController();
        const unlink = forwardAbortSignal(options.signal, controller);
        let finish!: () => void;
        this.runCompletions.set(
            request.runId,
            new Promise<void>((resolve) => {
                finish = resolve;
            }),
        );
        this.activeRuns.set(request.runId, controller);
        try {
            const macro = await this.inspectMacro(request);
            if (macro.executionKind !== "program" || !macro.program)
                throw new Error(
                    "Step macros are no longer supported. Record the task as a program.",
                );
            await this.validateRunRoute(macro, {
                ...options,
                signal: controller.signal,
                requireLatestApproved: true,
            });
            return await this.runProgram(macro, request, controller.signal);
        } finally {
            this.activeRuns.delete(request.runId);
            unlink();
            finish();
            this.runCompletions.delete(request.runId);
        }
    }

    private async runProgram(
        macro: CopilotToolMacro,
        request: RunMacroRequest,
        signal: AbortSignal,
    ): Promise<RunMacroResponse> {
        if (this.closed) throw new Error("The macro owner is closed.");
        signal?.throwIfAborted();
        if (!this.canRunPrograms() || !this.programRuntime)
            throw new Error("The TypeAgent program runtime is unavailable.");
        if (request.dryRun)
            throw new Error(
                "Program dry-run is unsupported. No program calls were dispatched.",
            );
        const run = await runMacroProgram(
            this.rootDir,
            macro,
            request,
            this.programRuntime,
            signal,
            async () => {
                const latest = await this.getLatestSummary(macro.macroId);
                if (
                    latest.state !== "approved" ||
                    latest.version !== macro.version ||
                    (await this.learning.isSuppressed(macro))
                )
                    throw new Error(
                        "Program route was disabled or superseded; future calls stopped.",
                    );
            },
        );
        const saved = await this.writeRun(run, macro);
        await this.recordMetric("program", saved.status);
        if (saved.status === "completed")
            return { status: "completed", run: saved };
        return {
            status: saved.status === "cancelled" ? "cancelled" : "failed",
            run: saved,
        };
    }

    private async validateRunRoute(
        macro: CopilotToolMacro,
        options: MacroRunOptions,
    ): Promise<void> {
        assertMacroCapabilities(macro);
        if (!validateMacro(macro).valid)
            throw new Error("Invalid approved macro procedure.");
        if (macro.state !== "approved") {
            throw new Error("Only approved macros can run.");
        }
        if (await this.learning.isSuppressed(macro)) {
            throw new Error(
                "This learned macro is suppressed because it was disabled or forgotten.",
            );
        }
        if (options.requireLatestApproved) {
            const latest = await this.getLatestSummary(macro.macroId);
            if (
                latest.state !== "approved" ||
                latest.version !== macro.version
            ) {
                throw new Error(
                    "The macro route is no longer the current approved version.",
                );
            }
        }
        options.signal?.throwIfAborted();
    }

    cancelMacroRun(runId: string): void {
        this.validateMacroId(runId);
        for (const [id, expiresAt] of this.pendingCancellations)
            if (expiresAt <= Date.now()) this.pendingCancellations.delete(id);
        if (
            !this.pendingCancellations.has(runId) &&
            this.pendingCancellations.size >= 1000
        )
            throw new Error("Pending run cancellation capacity exceeded.");
        this.pendingCancellations.set(runId, Date.now() + 120_000);
        this.activeRuns.get(runId)?.abort();
    }

    cancelAllMacroRuns(): void {
        for (const controller of this.activeRuns.values()) controller.abort();
    }

    async close(): Promise<void> {
        this.closed = true;
        this.cancelAllMacroRuns();
        const outcomes = await Promise.allSettled([
            this.learning.close(),
            ...this.runCompletions.values(),
            this.catalogMutation,
        ]);
        const failures = outcomes.filter(
            (outcome): outcome is PromiseRejectedResult =>
                outcome.status === "rejected",
        );
        if (failures.length)
            throw new AggregateError(
                failures.map((outcome) => outcome.reason),
                "The macro owner stopped with persistence failures.",
            );
    }

    async getMacroRun(runId: string): Promise<MacroRunRecord> {
        this.validateMacroId(runId);
        let run: MacroRunRecord;
        try {
            run = JSON.parse(
                await readFile(this.runPath(runId), "utf8"),
            ) as MacroRunRecord;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            const journal = await readProgramJournal(this.rootDir, runId).catch(
                (failure: unknown) => {
                    if ((failure as NodeJS.ErrnoException).code === "ENOENT")
                        throw new Error(`Macro run not found: ${runId}`);
                    throw failure;
                },
            );
            return {
                runId,
                macroId: journal.macroId,
                version: journal.version,
                status: this.activeRuns.has(runId) ? "running" : "failed",
                executionClass: "replayable",
                inputs: {},
                steps: [],
                startedAt: journal.startedAt,
                error: {
                    code: "execution_uncertain",
                    message:
                        "Program has no terminal record. Do not replay; inspect its durable dispatch checkpoints.",
                },
                result: { checkpoints: journal.checkpoints, fallback: "never" },
            };
        }
        const evidence = new PrivateResultStore(this.rootDir);
        for (const step of run.steps) {
            if (step.resultArtifact) {
                await evidence.verify(
                    step.resultArtifact,
                    "run",
                    runId,
                    step.stepId,
                    "result",
                );
                if (
                    JSON.stringify(step.result) !==
                    JSON.stringify(step.resultArtifact.view)
                )
                    throw new Error(
                        "Private run result view does not match its source.",
                    );
            }
        }
        if (run.resultArtifact) {
            await evidence.verify(
                run.resultArtifact,
                "run",
                runId,
                "$final",
                "result",
            );
            if (
                JSON.stringify(run.result) !==
                JSON.stringify(run.resultArtifact.view)
            )
                throw new Error(
                    "Private final run view does not match its source.",
                );
        }
        return run;
    }

    private removeExpired(sessionId: string): void {
        const token = this.recordings.get(sessionId);
        if (token && Date.parse(token.expiresAt) <= Date.now()) {
            this.recordings.delete(sessionId);
        }
    }

    private validateTrace(
        token: RecordingToken,
        trace: RecordedInteractionTrace,
    ): void {
        if (
            trace.schemaVersion !== 1 ||
            trace.capabilities !== undefined ||
            trace.toolCalls.some(
                (call) => call.resultArtifact || call.modelResultArtifact,
            ) ||
            trace.sessionId !== token.sessionId ||
            trace.cwd !== token.cwd ||
            createHash("sha256")
                .update(redactTraceValue(trace.prompt) as string)
                .digest("hex") !== token.promptHash ||
            !trace.prompt ||
            !trace.startedAt ||
            !trace.completedAt ||
            trace.toolCalls.some(
                (call) =>
                    !call.toolCallId || !call.name || call.result === undefined,
            )
        ) {
            throw new Error("The recorded interaction trace is incomplete.");
        }
    }

    private async readTrace(
        traceId: string,
    ): Promise<RecordedInteractionTrace> {
        this.validateMacroId(traceId);
        const trace = await this.readJson<RecordedInteractionTrace>(
            path.join(this.rootDir, "traces", `${traceId}.json`),
            `Trace not found: ${traceId}`,
        );
        const hasEvidence = trace.toolCalls.some(
            (call) => call.resultArtifact || call.modelResultArtifact,
        );
        if (
            (trace.schemaVersion === 1 &&
                (hasEvidence || trace.capabilities !== undefined)) ||
            (trace.schemaVersion === 2 &&
                (!hasEvidence ||
                    trace.capabilities?.length !== 1 ||
                    trace.capabilities[0] !== "private-result-evidence-v1")) ||
            (trace.schemaVersion !== 1 && trace.schemaVersion !== 2)
        )
            throw new Error(
                "Unsupported recorded trace schema or capabilities.",
            );
        const evidence = new PrivateResultStore(this.rootDir);
        for (const call of trace.toolCalls) {
            for (const source of ["result", "modelResult"] as const) {
                const ref =
                    source === "result"
                        ? call.resultArtifact
                        : call.modelResultArtifact;
                if (ref) {
                    await evidence.verify(
                        ref,
                        "trace",
                        traceId,
                        call.toolCallId,
                        source,
                    );
                    if (
                        JSON.stringify(call[source]) !==
                        JSON.stringify(ref.view)
                    )
                        throw new Error(
                            "Private result view does not match its recorded source.",
                        );
                }
            }
        }
        return trace;
    }

    private async readLearningTrace(
        traceId: string,
    ): Promise<RecordedInteractionTrace> {
        this.validateMacroId(traceId);
        return new PrivateResultStore(this.rootDir).verifyLearningTrace(
            traceId,
        );
    }

    private async readCatalog(): Promise<MacroSummary[]> {
        await this.assertCatalogFormat();
        const directory = path.join(this.rootDir, "catalog");
        const files = await readdir(directory).catch(
            (error: NodeJS.ErrnoException) => {
                if (error.code === "ENOENT") return [];
                throw error;
            },
        );
        const summaries = await Promise.all(
            files
                .filter((file) => /^[a-zA-Z0-9-]+\.json$/.test(file))
                .map((file) => this.readSummary(file.slice(0, -5), false)),
        );
        return summaries.filter(
            (summary): summary is MacroSummary => summary !== undefined,
        );
    }

    private async readSummary(
        macroId: string,
        checkFormat = true,
    ): Promise<MacroSummary | undefined> {
        if (checkFormat) await this.assertCatalogFormat();
        let pointer: { schemaVersion: number; summary: MacroSummary | null };
        try {
            pointer = JSON.parse(
                await readFile(this.summaryPath(macroId), "utf8"),
            );
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT")
                return undefined;
            throw error;
        }
        if (
            pointer?.schemaVersion !== 2 ||
            !("summary" in pointer) ||
            (pointer.summary !== null &&
                (pointer.summary.macroId !== macroId ||
                    !Number.isSafeInteger(pointer.summary.version) ||
                    pointer.summary.version < 1 ||
                    !["draft", "approved", "disabled"].includes(
                        pointer.summary.state,
                    )))
        )
            throw new Error(
                "Incompatible macro catalog publication; explicitly reset/reimport the development store.",
            );
        return pointer.summary ?? undefined;
    }

    private async assertCatalogFormat(): Promise<void> {
        // The former array is canonical, not a derived cache.
        try {
            await readFile(this.catalogPath(), "utf8");
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            return;
        }
        throw new Error(
            "Incompatible canonical macro catalog index.json; explicitly reset/reimport the development store. It was not deleted.",
        );
    }

    private async upsertSummary(macro: CopilotToolMacro): Promise<void> {
        const summary: MacroSummary = {
            macroId: macro.macroId,
            version: macro.version,
            name: macro.name,
            description: macro.description,
            state: macro.state,
            executionClass: macro.executionClass,
            stepCount: macro.steps.length,
            updatedAt: macro.createdAt,
        };
        await publishJson(this.summaryPath(macro.macroId), {
            schemaVersion: 2,
            summary,
        });
    }

    private async nextVersion(macroId: string): Promise<number> {
        this.validateMacroId(macroId);
        let files: string[];
        try {
            files = await readdir(path.dirname(this.versionPath(macroId, 1)));
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return 1;
            throw error;
        }
        return (
            files.reduce((latest, file) => {
                const match = /^([1-9]\d*)\.json$/.exec(file);
                return match ? Math.max(latest, Number(match[1])) : latest;
            }, 0) + 1
        );
    }

    private async writeVersion(macro: CopilotToolMacro): Promise<void> {
        const destination = this.versionPath(macro.macroId, macro.version);
        await publishImmutable(destination, JSON.stringify(macro));
    }

    private async readVersionIfPresent(
        macroId: string,
        version: number,
    ): Promise<CopilotToolMacro | undefined> {
        try {
            return JSON.parse(
                await readFile(this.versionPath(macroId, version), "utf8"),
            ) as CopilotToolMacro;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                return undefined;
            }
            throw error;
        }
    }

    private async readJson<T>(
        filePath: string,
        notFoundMessage: string,
    ): Promise<T> {
        try {
            return JSON.parse(await readFile(filePath, "utf8")) as T;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                throw new Error(notFoundMessage);
            }
            throw error;
        }
    }

    private async getLatestSummary(macroId: string): Promise<MacroSummary> {
        this.validateMacroId(macroId);
        const summary = await this.readSummary(macroId);
        if (!summary) throw new Error(`Macro not found: ${macroId}`);
        return summary;
    }

    private catalogPath(): string {
        return path.join(this.rootDir, "index.json");
    }

    private summaryPath(macroId: string): string {
        return path.join(this.rootDir, "catalog", `${macroId}.json`);
    }

    private versionPath(macroId: string, version: number): string {
        return path.join(
            this.rootDir,
            "macros",
            macroId,
            "versions",
            `${version}.json`,
        );
    }

    private runPath(runId: string): string {
        return path.join(this.rootDir, "runs", `${runId}.json`);
    }

    private async recordMetric(
        operation: "program",
        outcome: string,
    ): Promise<void> {
        const destination = path.join(this.rootDir, "metrics.jsonl");
        await mkdir(path.dirname(destination), { recursive: true });
        await appendFile(
            destination,
            `${JSON.stringify({ timestamp: new Date().toISOString(), operation, outcome })}\n`,
            "utf8",
        ).catch(() => undefined);
    }

    private async writeRun(
        run: MacroRunRecord,
        macro: CopilotToolMacro,
    ): Promise<MacroRunRecord> {
        const evidence = new PrivateResultStore(this.rootDir);
        const boundedRun = structuredClone(run);
        if (run.resultArtifact || run.steps.some((step) => step.resultArtifact))
            throw new Error(
                "Caller-submitted run evidence references are not supported.",
            );
        for (const step of boundedRun.steps) {
            const ref = await evidence.retain(
                "run",
                run.runId,
                step.stepId,
                "result",
                step.result,
            );
            if (ref) {
                step.resultArtifact = ref;
                step.result = ref.view;
            }
        }
        const resultRef = await evidence.retain(
            "run",
            run.runId,
            "$final",
            "result",
            run.result,
        );
        if (resultRef) {
            boundedRun.resultArtifact = resultRef;
            boundedRun.result = resultRef.view;
        }
        if (boundedRun.program?.output !== undefined)
            boundedRun.program.output = boundedRun.result as JsonValue;
        const secretInputs = new Set(
            macro.inputs
                .filter((input) => input.secret)
                .map((input) => input.name),
        );
        const sanitized = redactTraceValue({
            ...boundedRun,
            inputs: Object.fromEntries(
                Object.entries(run.inputs).map(([name, value]) => [
                    name,
                    secretInputs.has(name)
                        ? "[REDACTED]"
                        : sanitizeRunValue(value),
                ]),
            ),
            steps: boundedRun.steps.map((step) => ({
                ...step,
                ...(step.result === undefined
                    ? {}
                    : { result: redactTraceValue(step.result) }),
            })),
            ...(boundedRun.result === undefined
                ? {}
                : { result: redactTraceValue(boundedRun.result) }),
        }) as MacroRunRecord;
        const destination = this.runPath(run.runId);
        await publishImmutable(destination, JSON.stringify(sanitized));
        return sanitized;
    }

    private validateMacroId(id: string): void {
        if (!/^[a-zA-Z0-9-]+$/.test(id))
            throw new Error("Invalid macro identifier.");
    }

    private versionRef(macro: CopilotToolMacro): MacroVersionRef {
        return {
            macroId: macro.macroId,
            version: macro.version,
            state: macro.state,
        };
    }

    private mutateCatalog<T>(operation: () => Promise<T>): Promise<T> {
        return this.serializeCatalog(operation).then(async (value) => {
            await this.refreshCatalog();
            return value;
        });
    }

    private serializeCatalog<T>(operation: () => Promise<T>): Promise<T> {
        const locked = () =>
            withRecordLock(path.join(this.rootDir, "catalog-owner"), operation);
        const result = this.catalogMutation.then(locked, locked);
        this.catalogMutation = result.then(
            () => undefined,
            () => undefined,
        );
        return result;
    }

    private async refreshCatalog(): Promise<void> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            await Promise.race([
                Promise.all(
                    [...this.catalogListeners].map((listener) => listener()),
                ),
                new Promise<never>((_resolve, reject) => {
                    timer = setTimeout(
                        () =>
                            reject(
                                new Error(
                                    "Route refresh exceeded its 10s deadline.",
                                ),
                            ),
                        10_000,
                    );
                }),
            ]);
        } catch (error) {
            throw new Error(
                `Macro catalog was saved, but route refresh failed: ${error instanceof Error ? error.message : String(error)}`,
            );
        } finally {
            clearTimeout(timer);
        }
    }
}
