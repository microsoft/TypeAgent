// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import {
    appendFile,
    mkdir,
    readFile,
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
} from "./contracts.js";
import {
    inspectReplayTools,
    replayMacro,
    ReplayValidationError,
} from "./deterministicReplay.js";
import { induceMacroFromTrace, validateMacro } from "./macroDefinition.js";

import { redactTraceValue } from "./redaction.js";

const defaultRecordingTtlMs = 10 * 60 * 1000;
const maxPersistedRunValueBytes = 256 * 1024;
const maxPersistedRunPreviewCharacters = 16 * 1024;
const maxCandidateBytes = 256 * 1024;
const maxCandidateItems = 100;

interface AgentHandoffRecord {
    runId: string;
    macroId: string;
    version: number;
    createdAt: string;
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

    constructor(
        instanceDir: string,
        private readonly replayHost?: ReplayToolHost,
    ) {
        this.rootDir = path.join(instanceDir, "copilot-macros");
    }

    armRecording(request: ArmRecordingRequest): RecordingToken {
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
        return summary;
    }

    async createMacroFromTrace(
        request: CreateMacroFromTraceRequest,
    ): Promise<MacroVersionRef> {
        if (!request.name.trim()) throw new Error("Macro name is required.");
        return this.mutateCatalog(async () => {
            const trace = await this.readTrace(request.traceId);
            const macro = induceMacroFromTrace(
                request.traceId,
                trace,
                randomUUID(),
                request.name.trim(),
                request.description?.trim() ?? trace.prompt,
                new Date().toISOString(),
            );
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
        const trace = await this.readTrace(macro.sourceTraceId);
        return validateMacro(macro, trace);
    }

    async approveMacro(request: ApproveMacroRequest): Promise<MacroVersionRef> {
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
                current.executionClass === "replayable"
            ) {
                const trace = await this.readTrace(current.sourceTraceId);
                steps = await Promise.all(
                    current.steps.map(async (step) => {
                        const descriptor = await this.replayHost!.inspectTool(
                            step.mcpServerName,
                            step.toolName,
                            { cwd: trace.cwd },
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
            await this.writeVersion(approved);
            await this.upsertSummary(approved);
            return this.versionRef(approved);
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
                version: current.version + 1,
                state: "disabled",
                createdAt: new Date().toISOString(),
            };
            await this.writeVersion(disabled);
            await this.upsertSummary(disabled);
            return this.versionRef(disabled);
        });
    }

    async deleteMacro(request: DeleteMacroRequest): Promise<void> {
        await this.mutateCatalog(async () => {
            this.validateMacroId(request.macroId);
            await rm(path.join(this.rootDir, "macros", request.macroId), {
                recursive: true,
                force: true,
            });
            const summaries = (await this.readCatalog()).filter(
                (macro) => macro.macroId !== request.macroId,
            );
            await this.writeJsonAtomic(this.catalogPath(), summaries);
        });
    }

    async submitMacroCandidate(
        request: SubmitMacroCandidateRequest,
    ): Promise<MacroVersionRef> {
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
                    (step.executionClass !== "replayable" &&
                        step.executionClass !== "agentRequired") ||
                    !step.id.trim() ||
                    !step.toolName.trim() ||
                    !step.sourceToolCallId.trim(),
            )
        ) {
            throw new Error("Macro candidate contains an invalid step.");
        }
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
            if (
                request.executionEvidence.outcome !== "completed" ||
                request.executionEvidence.toolCalls < 0 ||
                request.executionEvidence.toolCalls >
                    handoff.budgets.maxToolCalls ||
                request.executionEvidence.retries < 0 ||
                request.executionEvidence.retries >
                    handoff.budgets.maxRetries ||
                request.executionEvidence.durationMs < 0 ||
                request.executionEvidence.durationMs >
                    handoff.budgets.timeoutMs ||
                request.executionEvidence.tokensUsed < 0 ||
                request.executionEvidence.tokensUsed >
                    handoff.budgets.maxTokens ||
                request.executionEvidence.steps.length !==
                    request.steps.length ||
                request.executionEvidence.steps.some(
                    (step) => step.status !== "completed",
                ) ||
                request.steps.some(
                    (step) =>
                        !request.executionEvidence.steps.some(
                            (evidence) => evidence.stepId === step.id,
                        ),
                )
            ) {
                throw new Error(
                    "Macro candidate execution evidence exceeds its handoff budget.",
                );
            }
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

    async runMacro(request: RunMacroRequest): Promise<RunMacroResponse> {
        this.validateMacroId(request.runId);
        if (this.activeRuns.has(request.runId)) {
            throw new Error(`Macro run is already active: ${request.runId}`);
        }
        const macro = await this.inspectMacro(request);
        if (macro.state !== "approved") {
            throw new Error("Only approved macros can run.");
        }
        const preference = request.preference ?? "auto";
        if (
            preference === "agent" ||
            macro.executionClass === "agentRequired"
        ) {
            if (preference === "replay") {
                throw new Error("This macro requires agent-guided execution.");
            }
            const agentStepIds = macro.steps
                .filter((step) => step.executionClass === "agentRequired")
                .map((step) => step.id);
            const reason =
                preference === "agent"
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
            await this.writeAgentHandoff({
                runId: request.runId,
                macroId: macro.macroId,
                version: macro.version,
                createdAt: new Date().toISOString(),
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
                            preference === "agent"
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
        const result = this.catalogMutation.then(operation, operation);
        this.catalogMutation = result.then(
            () => undefined,
            () => undefined,
        );
        return result;
    }
}
