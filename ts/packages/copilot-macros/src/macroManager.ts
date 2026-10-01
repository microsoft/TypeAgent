// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import {
    appendFile,
    mkdir,
    readFile,
    stat,
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
    CreateMacroFromTraceRequest,
    DeleteMacroRequest,
    DisableMacroRequest,
    FinalizeRecordingRequest,
    InspectMacroRequest,
    ListMacrosRequest,
    MacroMatch,
    MacroRequirements,
    MacroRunRecord,
    MacroSummary,
    MacroValidationReport,
    MacroVersionRef,
    RecordedInteractionTrace,
    ReplayToolHost,
    RecordingState,
    RecordingToken,
    SearchMacrosRequest,
    TraceSummary,
    RunMacroRequest,
    RunMacroResponse,
    ValidateMacroRequest,
    SubmitMacroCandidateRequest,
    MacroLearningRuntime,
    MacroLearningPreference,
    MacroLearningMode,
    MacroLearningJob,
    MacroExecutionPreference,
    EvidencedMacroCandidateRequest,
} from "./contracts.js";
import {
    inspectReplayTools,
    replayMacro,
    ReplayValidationError,
    validateMacroInputs,
} from "./deterministicReplay.js";
import { induceMacroFromTrace, validateMacro } from "./macroDefinition.js";

import { redactTraceValue } from "./redaction.js";
import {
    MacroLearningEngine,
    type MacroLearningTarget,
} from "./macroLearning.js";
import { getMacroFeatures } from "./macroFeatures.js";
import {
    assertLearningTrace,
    assertLearningProcedure,
} from "./macroLearningValidation.js";

const defaultRecordingTtlMs = 10 * 60 * 1000;
const maxPersistedRunValueBytes = 256 * 1024;
const maxPersistedRunPreviewCharacters = 16 * 1024;
const maxCandidateBytes = 256 * 1024;
const maxCandidateItems = 100;

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

interface AgentHandoffRecord {
    runId: string;
    macroId: string;
    version: number;
    createdAt: string;
    cwd?: string;
    budgets: {
        maxToolCalls: number;
        maxRetries: number;
        timeoutMs: number;
        maxTokens: number;
    };
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
    private catalogMutation: Promise<void> = Promise.resolve();
    private readonly catalogListeners = new Set<() => Promise<void>>();
    private readonly learning: MacroLearningEngine;

    constructor(
        instanceDir: string,
        private readonly replayHost?: ReplayToolHost,
    ) {
        this.rootDir = path.join(instanceDir, "copilot-macros");
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
        );
    }

    configureLearning(runtime: MacroLearningRuntime): Promise<void> {
        return this.learning.configure(runtime);
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
        const trace = await this.readLearningTrace(request.traceId);
        const target = await this.learningTarget(request.traceId, trace);
        return this.learning.prepare(request.traceId, false, target);
    }

    getMacroLearningJob(jobId: string): Promise<MacroLearningJob> {
        return this.learning.getJob(jobId);
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

    getRecordingState(sessionId: string): RecordingState {
        this.removeExpired(sessionId);
        const token = this.recordings.get(sessionId);
        if (token) return { status: token.status, token };
        const trace = this.completed.get(sessionId);
        if (trace) return { status: "completed", trace };
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
        if (request.trace.handoffRunId)
            await this.verifyRunnerTrace(request.trace);
        this.recordings.delete(token.sessionId);

        const traceId = randomUUID();
        const createdAt = new Date().toISOString();
        const storedTrace = redactTraceValue({
            ...request.trace,
            traceId,
            createdAt,
        }) as RecordedInteractionTrace & { traceId: string; createdAt: string };
        const tracesDir = path.join(this.rootDir, "traces");
        try {
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
            if (request.trace.handoffRunId) {
                await this.bindRunnerTrace(traceId, request.trace.handoffRunId);
            }
        } catch (error) {
            this.failures.set(
                token.sessionId,
                "The selected interaction could not be stored.",
            );
            throw error;
        }
        const summary: TraceSummary = {
            traceId,
            sessionId: token.sessionId,
            createdAt,
            toolCallCount: request.trace.toolCalls.length,
        };
        this.failures.delete(token.sessionId);
        this.completed.set(token.sessionId, summary);
        if (token.learning) {
            const target = await this.learningTarget(traceId, storedTrace);
            const job = await this.learning.prepare(traceId, true, target);
            summary.learningJobId = job.jobId;
        }
        return summary;
    }

    async createMacroFromTrace(
        request: CreateMacroFromTraceRequest,
    ): Promise<MacroVersionRef> {
        if (!request.name.trim()) throw new Error("Macro name is required.");
        return this.mutateCatalog(async () => {
            const trace = await this.readTrace(request.traceId);
            const macro = await induceMacroFromTrace(
                request.traceId,
                trace,
                randomUUID(),
                request.name.trim(),
                request.description?.trim() ?? trace.prompt,
                new Date().toISOString(),
                this.replayHost,
            );
            await this.writeVersion(macro);
            await this.upsertSummary(macro);
            return this.versionRef(macro);
        });
    }

    async saveDraft(macro: CopilotToolMacro): Promise<MacroVersionRef> {
        this.validateMacroId(macro.macroId);
        if (macro.state !== "draft") {
            throw new Error("Only draft macros can be persisted.");
        }
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
                const summary = (await this.readCatalog()).find(
                    (item) => item.macroId === macro.macroId,
                );
                if (
                    (summary === undefined ||
                        summary.version <= existing.version) &&
                    !this.isPendingLearningAdaptation(existing, summary)
                ) {
                    await this.upsertSummary(existing);
                }
                return this.versionRef(existing);
            }
            const latest = (await this.readCatalog()).find(
                (item) => item.macroId === macro.macroId,
            );
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
            if (!this.isPendingLearningAdaptation(macro, latest)) {
                await this.upsertSummary(macro);
            }
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
        return this.readJson<CopilotToolMacro>(
            this.versionPath(request.macroId, version),
            `Macro version not found: ${request.macroId}@${version}`,
        );
    }

    async getMacroRequirements(
        request: InspectMacroRequest,
    ): Promise<MacroRequirements> {
        const macro = await this.inspectMacro(request);
        return {
            macroId: macro.macroId,
            version: macro.version,
            executionClass: macro.executionClass,
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
            let steps = current.steps;
            if (
                this.replayHost !== undefined &&
                current.executionClass === "replayable" &&
                !current.learning
            ) {
                const trace = current.sourceTraceId.startsWith("procedure:")
                    ? undefined
                    : await this.readTrace(current.sourceTraceId);
                steps = await Promise.all(
                    current.steps.map(async (step) => {
                        const descriptor = await this.replayHost!.inspectTool(
                            step.mcpServerName,
                            step.toolName,
                            trace === undefined
                                ? undefined
                                : { cwd: trace.cwd },
                        );
                        if (!descriptor) {
                            throw new Error(
                                `Replay tool is unavailable: ${step.mcpServerName ?? "native"}/${step.toolName}`,
                            );
                        }
                        return {
                            ...step,
                            schemaFingerprint: descriptor.schemaFingerprint,
                        };
                    }),
                );
            }
            const approved: CopilotToolMacro = {
                ...current,
                steps,
                version: current.version + 1,
                state: "approved",
                createdAt: new Date().toISOString(),
            };
            const latest = await this.getLatestSummary(current.macroId);
            if (
                (latest.version !== current.version ||
                    latest.state !== "draft") &&
                !this.isPendingLearningAdaptation(current, latest)
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

            const latest = (await this.readCatalog()).find(
                (item) => item.macroId === macro.macroId,
            );
            if (
                latest &&
                (latest.version > macro.version || latest.state === "disabled")
            ) {
                throw new Error(
                    "Learning recovery cannot resurrect a superseded or disabled version.",
                );
            }
            await this.upsertSummary(macro);
        });
    }

    private isPendingLearningAdaptation(
        macro: CopilotToolMacro,
        latest: MacroSummary | undefined,
    ): boolean {
        return (
            macro.learning !== undefined &&
            macro.state === "draft" &&
            latest?.state === "approved" &&
            latest.version + 1 === macro.version &&
            macro.candidateProvenance?.sourceMacroId === macro.macroId &&
            macro.candidateProvenance.sourceVersion === latest.version
        );
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
                version: current.version + 1,
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
            const summary = (await this.readCatalog()).find(
                (item) => item.macroId === request.macroId,
            );
            const current = summary
                ? await this.inspectMacro(summary)
                : await this.readVersionIfPresent(request.macroId, 1);
            if (current) await this.learning.suppress(current);
            if (!current?.learning) {
                await rm(path.join(this.rootDir, "macros", request.macroId), {
                    recursive: true,
                    force: true,
                });
            }
            const summaries = (await this.readCatalog()).filter(
                (macro) => macro.macroId !== request.macroId,
            );
            await this.writeJsonAtomic(this.catalogPath(), summaries);
        });
    }

    submitMacroCandidate(
        request: EvidencedMacroCandidateRequest,
    ): Promise<MacroLearningJob>;
    submitMacroCandidate(
        request: SubmitMacroCandidateRequest,
    ): Promise<MacroVersionRef>;
    submitMacroCandidate(
        request: SubmitMacroCandidateRequest | EvidencedMacroCandidateRequest,
    ): Promise<MacroVersionRef | MacroLearningJob> {
        if ("traceId" in request)
            return this.submitEvidencedMacroCandidate(request);
        return this.submitLegacyMacroCandidate(request);
    }

    private async submitEvidencedMacroCandidate(
        request: EvidencedMacroCandidateRequest,
    ): Promise<MacroLearningJob> {
        this.validateCandidateSubmission(request);
        const trace = await this.readLearningTrace(request.traceId);
        assertLearningTrace(trace);
        if (trace.handoffRunId !== request.handoffRunId) {
            throw new Error(
                "Candidate trace is not correlated with the runner handoff.",
            );
        }
        const handoff = await this.verifyRunnerTrace(trace);
        if (
            handoff.macroId !== request.sourceMacroId ||
            handoff.version !== request.sourceVersion
        ) {
            throw new Error(
                "Macro candidate provenance does not match its agent handoff.",
            );
        }
        this.validateCandidateEvidence(request, handoff);
        if (
            request.executionEvidence.toolCalls !== trace.toolCalls.length ||
            request.steps.length !== trace.toolCalls.length ||
            request.steps.some((step, index) => {
                const call = trace.toolCalls[index];
                return (
                    step.sourceToolCallId !== call.toolCallId ||
                    step.toolName !== call.name ||
                    step.mcpServerName !== call.mcpServerName
                );
            })
        ) {
            throw new Error(
                "Candidate steps do not match the exact completed runner trace.",
            );
        }
        const source = await this.inspectMacro({
            macroId: request.sourceMacroId,
            version: request.sourceVersion,
        });
        const proposed: CopilotToolMacro = {
            ...source,
            state: "draft",
            inputs: request.inputs,
            steps: request.steps,
            sourceTraceId: request.traceId,
            warnings: [],
        };
        assertLearningProcedure(
            {
                inputs: request.inputs,
                steps: request.steps,
                exampleInputs: request.exampleInputs,
            },
            proposed,
            trace,
        );
        const target = await this.learningTarget(
            request.traceId,
            trace,
            request.reason,
        );
        return this.learning.prepare(request.traceId, false, target);
    }

    private async submitLegacyMacroCandidate(
        request: SubmitMacroCandidateRequest,
    ): Promise<MacroVersionRef> {
        this.validateCandidateSubmission(request);
        return this.mutateCatalog(async () => {
            const source = await this.inspectMacro({
                macroId: request.sourceMacroId,
                version: request.sourceVersion,
            });
            if (source.state !== "approved") {
                throw new Error(
                    "Macro candidates must derive from an approved version.",
                );
            }
            if (source.learning) {
                throw new Error(
                    "Learned macro adaptations require a new grounded build and version-targeted grammar.",
                );
            }
            const handoff = await this.readJson<AgentHandoffRecord>(
                this.handoffPath(request.handoffRunId),
                `Agent handoff not found: ${request.handoffRunId}`,
            );
            if (
                handoff.macroId !== source.macroId ||
                handoff.version !== source.version
            ) {
                throw new Error(
                    "Macro candidate provenance does not match its agent handoff.",
                );
            }
            this.validateCandidateEvidence(request, handoff);
            const latest = await this.getLatestSummary(source.macroId);
            const createdAt = new Date().toISOString();
            const candidate: CopilotToolMacro = {
                ...source,
                version: latest.version + 1,
                name: request.name?.trim() || source.name,
                description: request.description?.trim() || source.description,
                state: "draft",
                executionClass: request.steps.every(
                    (step) => step.executionClass === "replayable",
                )
                    ? "replayable"
                    : "agentRequired",
                inputs: request.inputs,
                steps: request.steps,
                createdAt,
                warnings: [
                    ...source.warnings,
                    "Agent-guided adaptation requires explicit review and approval.",
                ],
                candidateProvenance: {
                    sourceMacroId: source.macroId,
                    sourceVersion: source.version,
                    handoffRunId: request.handoffRunId,
                    reason: request.reason.trim(),
                    submittedAt: createdAt,
                },
            };
            const report = validateMacro(
                candidate,
                await this.readTrace(source.sourceTraceId),
            );
            if (!report.valid) {
                throw new Error(
                    `Macro candidate validation failed: ${report.issues
                        .filter((issue) => issue.severity === "error")
                        .map((issue) => issue.message)
                        .join("; ")}`,
                );
            }
            await this.writeVersion(candidate);
            await this.upsertSummary(candidate);
            await this.recordMetric("candidate", "submitted");
            await rm(this.handoffPath(request.handoffRunId), { force: true });
            return this.versionRef(candidate);
        });
    }

    private validateCandidateSubmission(
        request: SubmitMacroCandidateRequest,
    ): void {
        if (!request.reason.trim() || request.reason.length > 2_000) {
            throw new Error("A bounded candidate reason is required.");
        }
        this.validateMacroId(request.handoffRunId);
        if (
            request.inputs.length > maxCandidateItems ||
            request.steps.length === 0 ||
            request.steps.length > maxCandidateItems ||
            Buffer.byteLength(JSON.stringify(request)) > maxCandidateBytes
        ) {
            throw new Error("Macro candidate exceeds submission limits.");
        }
        if (
            request.steps.some(
                (step) =>
                    !["replayable", "agentRequired"].includes(
                        step.executionClass,
                    ) ||
                    !step.id.trim() ||
                    !step.toolName.trim() ||
                    !step.sourceToolCallId.trim(),
            )
        ) {
            throw new Error("Macro candidate contains an invalid step.");
        }
    }

    private validateCandidateEvidence(
        request: SubmitMacroCandidateRequest,
        handoff: AgentHandoffRecord,
    ): void {
        const evidence = request.executionEvidence;
        const bounded = [
            [evidence.toolCalls, handoff.budgets.maxToolCalls],
            [evidence.retries, handoff.budgets.maxRetries],
            [evidence.durationMs, handoff.budgets.timeoutMs],
            [evidence.tokensUsed, handoff.budgets.maxTokens],
        ];
        if (
            evidence.outcome !== "completed" ||
            bounded.some(
                ([value, maximum]) =>
                    !Number.isFinite(value) || value < 0 || value > maximum,
            ) ||
            evidence.steps.length !== request.steps.length ||
            new Set(evidence.steps.map((step) => step.stepId)).size !==
                request.steps.length ||
            evidence.steps.some((step) => step.status !== "completed") ||
            request.steps.some(
                (step) =>
                    !evidence.steps.some((item) => item.stepId === step.id),
            )
        ) {
            throw new Error(
                "Macro candidate execution evidence exceeds its handoff budget.",
            );
        }
    }

    private async verifyRunnerTrace(
        trace: RecordedInteractionTrace,
    ): Promise<AgentHandoffRecord> {
        if (!trace.handoffRunId)
            throw new Error("A verified runner handoff ID is required.");
        this.validateMacroId(trace.handoffRunId);
        const handoff = await this.readJson<AgentHandoffRecord>(
            this.handoffPath(trace.handoffRunId),
            `Agent handoff not found: ${trace.handoffRunId}`,
        );
        const source = await this.inspectMacro({
            macroId: handoff.macroId,
            version: handoff.version,
        });
        const startedAt = Date.parse(trace.startedAt);
        const completedAt = Date.parse(trace.completedAt);
        if (
            source.state !== "approved" ||
            !handoff.cwd ||
            path.resolve(trace.cwd).toLowerCase() !==
                path.resolve(handoff.cwd).toLowerCase() ||
            !Number.isFinite(startedAt) ||
            !Number.isFinite(completedAt) ||
            startedAt < Date.parse(handoff.createdAt) ||
            completedAt < startedAt ||
            completedAt - Date.parse(handoff.createdAt) >
                handoff.budgets.timeoutMs ||
            trace.toolCalls.length > handoff.budgets.maxToolCalls
        ) {
            throw new Error(
                "Runner trace does not match the recorded handoff scope or budget.",
            );
        }
        return handoff;
    }

    private async learningTarget(
        traceId: string,
        trace: RecordedInteractionTrace,
        reason?: string,
    ): Promise<MacroLearningTarget | undefined> {
        if (!trace.handoffRunId) return undefined;
        const handoff = await this.verifyRunnerTrace(trace);
        const binding = await this.readJson<{ traceId: string }>(
            this.runnerTracePath(trace.handoffRunId),
            "Runner trace correlation was not recorded.",
        );
        if (binding.traceId !== traceId)
            throw new Error(
                "Runner handoff belongs to a different recorded trace.",
            );
        return {
            macroId: handoff.macroId,
            version: handoff.version + 1,
            provenance: {
                sourceMacroId: handoff.macroId,
                sourceVersion: handoff.version,
                handoffRunId: handoff.runId,
                reason: reason?.trim() ?? "Verified macro runner execution.",
                submittedAt: trace.completedAt,
            },
        };
    }

    private runnerTracePath(runId: string): string {
        return path.join(this.rootDir, "handoff-traces", `${runId}.json`);
    }

    private async bindRunnerTrace(
        traceId: string,
        runId: string,
    ): Promise<void> {
        const destination = this.runnerTracePath(runId);
        await mkdir(path.dirname(destination), { recursive: true });
        try {
            await writeFile(destination, JSON.stringify({ traceId }), {
                encoding: "utf8",
                flag: "wx",
            });
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
            const existing = await this.readJson<{ traceId: string }>(
                destination,
                "Runner trace binding is missing.",
            );
            if (existing.traceId !== traceId)
                throw new Error(
                    "Runner handoff is already bound to another trace.",
                );
        }
    }

    async runMacro(
        request: RunMacroRequest,
        options: MacroRunOptions = {},
    ): Promise<RunMacroResponse> {
        options.signal?.throwIfAborted();
        this.validateMacroId(request.runId);
        if (this.activeRuns.has(request.runId)) {
            throw new Error(`Macro run is already active: ${request.runId}`);
        }
        const macro = await this.inspectMacro(request);
        await this.validateRunRoute(macro, options);
        if (macro.learning && request.preference === "replay") {
            throw new Error("This macro requires agent-guided execution.");
        }
        const preference = macro.learning
            ? "agent"
            : (request.preference ?? "auto");
        if (
            preference === "agent" ||
            macro.executionClass === "agentRequired"
        ) {
            return this.createAgentHandoff(macro, request, preference);
        }
        if (!this.replayHost) {
            throw new Error("Deterministic macro replay is not configured.");
        }
        const sourceTrace = await this.readTrace(macro.sourceTraceId);
        if (request.dryRun === true) {
            await inspectReplayTools(
                macro,
                this.replayHost,
                {
                    cwd: sourceTrace.cwd,
                },
                request.inputs ?? {},
            );
            return {
                status: "validated",
                runId: request.runId,
                macroId: macro.macroId,
                version: macro.version,
            };
        }
        const timeoutMs = Math.min(
            Math.max(request.timeoutMs ?? 60_000, 1),
            10 * 60_000,
        );
        const controller = new AbortController();
        const unlinkAbort = forwardAbortSignal(options.signal, controller);
        let timedOut = false;
        const timeout = setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, timeoutMs);
        this.activeRuns.set(request.runId, controller);
        let run: MacroRunRecord;
        try {
            run = await replayMacro(
                macro,
                request.runId,
                request.inputs ?? {},
                this.replayHost,
                controller.signal,
                { cwd: sourceTrace.cwd },
            );
        } catch (error) {
            const now = new Date().toISOString();
            run = {
                runId: request.runId,
                macroId: macro.macroId,
                version: macro.version,
                status: controller.signal.aborted ? "cancelled" : "failed",
                executionClass: macro.executionClass,
                inputs: request.inputs ?? {},
                steps: [],
                startedAt: now,
                completedAt: now,
                error: {
                    code:
                        error instanceof ReplayValidationError
                            ? error.code
                            : controller.signal.aborted
                              ? "cancelled"
                              : "replayFailed",
                    message:
                        error instanceof Error ? error.message : String(error),
                },
            };
        } finally {
            clearTimeout(timeout);
            this.activeRuns.delete(request.runId);
            unlinkAbort();
        }
        if (timedOut) {
            run = {
                ...run,
                status: "failed",
                error: {
                    code: "timeout",
                    message: `Macro replay exceeded its ${timeoutMs}ms deadline.`,
                },
            };
        }
        run = await this.writeRun(run, macro);
        await this.recordMetric("replay", run.status);
        return { status: run.status, run } as RunMacroResponse;
    }

    private async createAgentHandoff(
        macro: CopilotToolMacro,
        request: RunMacroRequest,
        preference: MacroExecutionPreference,
    ): Promise<RunMacroResponse> {
        if (macro.learning && !getMacroFeatures().agentHandoff) {
            throw new Error("Live macro runner handoff is disabled.");
        }
        validateMacroInputs(macro, request.inputs ?? {});
        if (preference === "replay") {
            throw new Error("This macro requires agent-guided execution.");
        }
        const agentStepIds = macro.learning
            ? macro.steps.map((step) => step.id)
            : macro.steps
                  .filter((step) => step.executionClass === "agentRequired")
                  .map((step) => step.id);
        const reason = macro.learning
            ? "Learned macros require the live runner and current tool permissions."
            : preference === "agent"
              ? "Agent-guided execution was requested."
              : "The macro contains steps that are not replayable.";
        const budgets = {
            maxToolCalls: Math.max(macro.steps.length * 2, 10),
            maxRetries: 1,
            timeoutMs: Math.min(
                Math.max(request.timeoutMs ?? 10 * 60_000, 1),
                10 * 60_000,
            ),
            maxTokens: 16_000,
        };
        const cwd =
            macro.learning?.cwd ??
            (macro.sourceTraceId.startsWith("procedure:")
                ? undefined
                : (await this.readTrace(macro.sourceTraceId)).cwd);
        await this.writeAgentHandoff({
            runId: request.runId,
            macroId: macro.macroId,
            version: macro.version,
            createdAt: new Date().toISOString(),
            ...(cwd === undefined ? {} : { cwd }),
            budgets,
        });
        await this.recordMetric("agentHandoff", "required");
        return {
            status: "agentRequired",
            runId: request.runId,
            macroId: macro.macroId,
            version: macro.version,
            reason,
            launch: {
                agent: "typeagent-macro-runner",
                macro,
                inputs: request.inputs ?? {},
                reason: {
                    code:
                        preference === "agent" && !macro.learning
                            ? "agentRequested"
                            : "agentRequired",
                    message: reason,
                    stepIds: agentStepIds,
                },
                budgets,
                candidate: {
                    sourceMacroId: macro.macroId,
                    sourceVersion: macro.version,
                    handoffRunId: request.runId,
                },
            },
        };
    }

    private async validateRunRoute(
        macro: CopilotToolMacro,
        options: MacroRunOptions,
    ): Promise<void> {
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
        this.activeRuns.get(runId)?.abort();
    }

    async getMacroRun(runId: string): Promise<MacroRunRecord> {
        this.validateMacroId(runId);
        return this.readJson<MacroRunRecord>(
            this.runPath(runId),
            `Macro run not found: ${runId}`,
        );
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
        return this.readJson<RecordedInteractionTrace>(
            path.join(this.rootDir, "traces", `${traceId}.json`),
            `Trace not found: ${traceId}`,
        );
    }

    private async readLearningTrace(
        traceId: string,
    ): Promise<RecordedInteractionTrace> {
        this.validateMacroId(traceId);
        const destination = path.join(
            this.rootDir,
            "traces",
            `${traceId}.json`,
        );
        if ((await stat(destination)).size > 1024 * 1024) {
            throw new Error(
                "Recorded learning trace exceeds its 1 MiB storage limit.",
            );
        }
        return this.readTrace(traceId);
    }

    private async readCatalog(): Promise<MacroSummary[]> {
        try {
            return JSON.parse(
                await readFile(this.catalogPath(), "utf8"),
            ) as MacroSummary[];
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
            throw error;
        }
    }

    private async upsertSummary(macro: CopilotToolMacro): Promise<void> {
        const summaries = (await this.readCatalog()).filter(
            (summary) => summary.macroId !== macro.macroId,
        );
        summaries.push({
            macroId: macro.macroId,
            version: macro.version,
            name: macro.name,
            description: macro.description,
            state: macro.state,
            executionClass: macro.executionClass,
            stepCount: macro.steps.length,
            updatedAt: macro.createdAt,
        });
        await this.writeJsonAtomic(this.catalogPath(), summaries);
    }

    private async writeVersion(macro: CopilotToolMacro): Promise<void> {
        const destination = this.versionPath(macro.macroId, macro.version);
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, JSON.stringify(macro, undefined, 2), {
            encoding: "utf8",
            flag: "wx",
        });
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

    private async writeJsonAtomic(
        destination: string,
        value: unknown,
    ): Promise<void> {
        await mkdir(path.dirname(destination), { recursive: true });
        const temporary = `${destination}.${randomUUID()}.tmp`;
        await writeFile(temporary, JSON.stringify(value, undefined, 2), {
            encoding: "utf8",
            flag: "wx",
        });
        await rename(temporary, destination);
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
        const summary = (await this.readCatalog()).find(
            (macro) => macro.macroId === macroId,
        );
        if (!summary) throw new Error(`Macro not found: ${macroId}`);
        return summary;
    }

    private catalogPath(): string {
        return path.join(this.rootDir, "index.json");
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

    private handoffPath(runId: string): string {
        return path.join(this.rootDir, "handoffs", `${runId}.json`);
    }

    private async writeAgentHandoff(
        handoff: AgentHandoffRecord,
    ): Promise<void> {
        const destination = this.handoffPath(handoff.runId);
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, JSON.stringify(handoff, undefined, 2), {
            encoding: "utf8",
            flag: "wx",
        });
    }

    private async recordMetric(
        operation: "replay" | "agentHandoff" | "candidate",
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
        const secretInputs = new Set(
            macro.inputs
                .filter((input) => input.secret)
                .map((input) => input.name),
        );
        const sanitized = redactTraceValue({
            ...run,
            inputs: Object.fromEntries(
                Object.entries(run.inputs).map(([name, value]) => [
                    name,
                    secretInputs.has(name)
                        ? "[REDACTED]"
                        : sanitizeRunValue(value),
                ]),
            ),
            steps: run.steps.map((step) => ({
                ...step,
                ...(step.result === undefined
                    ? {}
                    : { result: sanitizeRunValue(step.result) }),
            })),
            ...(run.result === undefined
                ? {}
                : { result: sanitizeRunValue(run.result) }),
        }) as MacroRunRecord;
        const destination = this.runPath(run.runId);
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, JSON.stringify(sanitized, undefined, 2), {
            encoding: "utf8",
            flag: "wx",
        });
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
        const result = this.catalogMutation.then(operation, operation);
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
