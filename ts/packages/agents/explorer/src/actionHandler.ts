// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    ActionContext,
    ActionResult,
    AppAgent,
    AppAgentInitSettings,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import { createActionResult } from "@typeagent/agent-sdk/helpers/action";
import { readFileSync } from "node:fs";
import path from "node:path";
import { validateAndFormatLocations } from "./citationFormatter.js";
import {
    createRepositoryTools,
    type RepositoryObservation,
    type RepositoryToolTrace,
    type RepositoryTools,
} from "./script/repositoryApi.js";
import type { LanguageServerOptions } from "./script/languageServer.js";
import { generateSandboxDeclarations } from "./script/sandboxDeclarations.js";
import { createExploreScriptExecutor } from "./script/scriptExecutor.js";
import {
    callsRepositoryTool,
    transpileExploreScript,
    validateExploreScript,
} from "./script/scriptValidator.js";
import type {
    ExplorerActionAttempt,
    ExplorerSessionSnapshot,
} from "./types.js";

export const EXPLORER_AGENT_NAME = "explorer";
export const DISCOVER_REPOSITORY_ACTION = "discoverRepository";
export const REFINE_REPOSITORY_ACTION = "refineRepository";
export const SUBMIT_EXPLORATION_ACTION = "submitExploration";
export const REPOSITORY_BUDGET_EXHAUSTED =
    "Explorer repository call budget exhausted";

const MIN_PROGRAM_EXECUTIONS = 2;
const MAX_PROGRAM_EXECUTIONS = 2;
export const REFINEMENT_RESERVED_CALLS = 4;
export const MAX_REFINEMENT_READ_LINES = 200;
const MAX_PROGRAM_READ_LINES = 1_000;
const MAX_ACTION_RESULT_CHARS = 40_000;
const MAX_DISCOVERY_ACTION_RESULT_CHARS = 20_000;
const MAX_SUBMISSION_CONTEXT_CHARS = 16_000;
const MAX_SUBMISSION_CANDIDATE_CHARS = 4_000;
const MAX_SUBMISSION_GREP_CHARS = 4_000;
const MAX_RESULT_MESSAGE_CHARS = 1_000;
const MAX_RESULT_PATH_CHARS = 1_000;
const MAX_DISCOVERY_RESPONSE_LINES = 240;
const MAX_EXACT_RESPONSE_LINES = 400;
const CONTEXT_LINES_AROUND_GREP = 4;

type RepositoryProgramPhase = "discover" | "refine";

export interface ExplorerActionSessionOptions {
    repoRoot: string;
    query: string;
    maxResults: number;
    maxToolCalls: number;
    maxOutputChars: number;
    executionTimeoutMs: number;
    lsp?: LanguageServerOptions;
}

interface ExplorerAgentContext {
    session?: ExplorerActionSession;
}

export class ExplorerActionSession {
    private readonly executor;
    private readonly actionAttempts: ExplorerActionAttempt[] = [];
    private programAttempts = 0;
    private groundingObservations: RepositoryObservation[] = [];
    private visibleGroundingObservations: RepositoryObservation[] = [];
    private candidateLocations: CompactProgramLocation[] = [];
    private evidenceCompacted = false;
    private submitted:
        | {
              text: string;
              citationCount: number;
              truncated: boolean;
          }
        | undefined;

    private constructor(
        private readonly options: ExplorerActionSessionOptions,
        private readonly repository: RepositoryTools,
    ) {
        this.executor = createExploreScriptExecutor(options.executionTimeoutMs);
    }

    public static async create(
        options: ExplorerActionSessionOptions,
    ): Promise<ExplorerActionSession> {
        return new ExplorerActionSession(
            options,
            await createRepositoryTools({
                repoRoot: options.repoRoot,
                maxCalls: options.maxToolCalls,
                ...(options.lsp ? { lsp: options.lsp } : {}),
            }),
        );
    }

    public async close(): Promise<void> {
        await this.repository.close();
    }

    public async execute(action: TypeAgentAction): Promise<ActionResult> {
        const actionName = action.actionName;
        const attempt: ExplorerActionAttempt = {
            index: this.actionAttempts.length,
            actionName,
            status: "failed",
        };
        this.actionAttempts.push(attempt);
        try {
            if (action.schemaName !== EXPLORER_AGENT_NAME) {
                throw new Error(
                    `Unsupported explorer schema: ${action.schemaName}`,
                );
            }
            const result =
                actionName === DISCOVER_REPOSITORY_ACTION
                    ? await this.runRepositoryProgram(
                          "discover",
                          action.parameters?.program,
                      )
                    : actionName === REFINE_REPOSITORY_ACTION
                      ? await this.runRepositoryProgram(
                            "refine",
                            action.parameters?.program,
                        )
                      : actionName === SUBMIT_EXPLORATION_ACTION
                        ? await this.submitExploration(
                              action.parameters?.locations,
                          )
                        : errorResult(
                              `Unsupported explorer action: ${actionName}`,
                          );
            if ("error" in result) {
                const message = result.error ?? "Explorer action failed";
                attempt.error = message;
                return errorResult(message);
            }
            attempt.status = "completed";
            return result;
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            attempt.error = message;
            return errorResult(message);
        }
    }

    public snapshot(): ExplorerSessionSnapshot {
        return {
            submitted: this.submitted !== undefined,
            programAttempts: this.programAttempts,
            observationCount: this.repository.observations.length,
            actionAttempts: this.actionAttempts.map((attempt) => ({
                ...attempt,
            })),
            toolTrace: {
                calls: this.repository.trace.calls.map((call) => ({ ...call })),
                totalCalls: this.repository.trace.totalCalls,
                totalOutputBytes: this.repository.trace.totalOutputBytes,
            },
            ...(this.submitted
                ? {
                      text: this.submitted.text,
                      result: {
                          citationCount: this.submitted.citationCount,
                          truncated: this.submitted.truncated,
                      },
                  }
                : {}),
        };
    }

    public submissionContext(): string {
        if (this.programAttempts < MIN_PROGRAM_EXECUTIONS) {
            throw new Error(
                "Complete discovery and refinement before building submission evidence",
            );
        }
        return formatSubmissionContext(
            this.candidateLocations,
            this.groundingObservations,
        ).text;
    }

    public remainingRepositoryCalls(): number {
        return Math.max(
            0,
            this.options.maxToolCalls -
                repositoryEvidenceCallCount(this.repository.trace),
        );
    }

    private async runRepositoryProgram(
        phase: RepositoryProgramPhase,
        rawProgram: unknown,
    ): Promise<ActionResult> {
        if (this.submitted) {
            return errorResult(
                "The exploration was already submitted; no more programs may run",
            );
        }
        if (this.programAttempts >= MAX_PROGRAM_EXECUTIONS) {
            return errorResult(
                `Explorer permits at most ${MAX_PROGRAM_EXECUTIONS} repository programs per request`,
            );
        }
        const expected = this.programAttempts === 0 ? "discover" : "refine";
        if (phase !== expected) {
            return errorResult(
                `Explorer expected the ${expected} repository phase, not ${phase}`,
            );
        }
        if (
            phase === "refine" &&
            repositoryEvidenceCallCount(this.repository.trace) >=
                this.options.maxToolCalls
        ) {
            return errorResult(
                `${REPOSITORY_BUDGET_EXHAUSTED}: no calls remain for an exact candidate read`,
            );
        }
        if (typeof rawProgram !== "string" || !rawProgram.trim()) {
            return errorResult(
                "runRepositoryProgram requires a program string",
            );
        }
        const validation = validateExploreScript(
            rawProgram,
            this.options.lsp !== undefined,
        );
        if (!validation.valid) {
            return errorResult(
                `Repository program validation failed: ${validation.errors.join("; ")}`,
            );
        }
        if (
            phase === "refine" &&
            this.options.lsp &&
            !this.hasAdoptedLspNavigation() &&
            !callsRepositoryTool(rawProgram, "lsp")
        ) {
            return errorResult(
                "The refine program must call repo.lsp before execution; no repository calls were consumed",
            );
        }
        const callLimit =
            phase === "discover"
                ? this.options.maxToolCalls - REFINEMENT_RESERVED_CALLS
                : this.options.maxToolCalls;
        this.repository.allowCallsThrough(
            Math.max(1, Math.min(this.options.maxToolCalls, callLimit)),
            MAX_PROGRAM_READ_LINES,
            phase === "refine"
                ? [
                      "ls",
                      "glob",
                      "grep",
                      "read",
                      ...(this.options.lsp ? (["lsp"] as const) : []),
                  ]
                : undefined,
            phase === "refine" && this.options.lsp ? { lsp: 1 } : undefined,
            phase === "refine" ? 6 : undefined,
        );
        const observationStart = this.repository.observations.length;
        const callStart = this.repository.trace.calls.length;
        const execution = await this.executor.execute(
            transpileExploreScript(rawProgram),
            this.repository,
            this.options.query,
            this.options.maxResults,
            this.options.executionTimeoutMs,
        );
        if (!execution.ok) {
            return errorResult(
                execution.error ?? "Repository program execution failed",
            );
        }
        let accepted = false;
        try {
            const observations =
                this.repository.observations.slice(observationStart);
            const calls = this.repository.trace.calls
                .slice(callStart)
                .filter((call) => call.discarded !== true);
            const remainingRepositoryCalls = Math.max(
                0,
                this.options.maxToolCalls -
                    repositoryEvidenceCallCount(this.repository.trace),
            );
            if (
                phase === "refine" &&
                !observations.some(
                    (observation) => observation.source === "read",
                )
            ) {
                const diagnostic = zeroLineReadDiagnostic(calls);
                const message = `The ${phase} program must read exact candidate context before submission${diagnostic ? `; ${diagnostic}` : ""}`;
                return errorResult(
                    remainingRepositoryCalls === 0
                        ? `${REPOSITORY_BUDGET_EXHAUSTED}: ${message}`
                        : `${message}; ${remainingRepositoryCalls} repository calls remain`,
                );
            }
            if (phase === "refine" && calls.length === 0) {
                return errorResult(
                    `The ${phase} program must inspect new repository evidence before submission`,
                );
            }
            if (
                phase === "refine" &&
                this.options.lsp &&
                !this.hasAdoptedLspNavigation()
            ) {
                const message =
                    "The refine program must attempt language-server navigation before submission; retry refineRepository with a corrected program that calls repo.lsp";
                return errorResult(
                    remainingRepositoryCalls === 0
                        ? `${REPOSITORY_BUDGET_EXHAUSTED}: ${message}`
                        : `${message}; ${remainingRepositoryCalls} repository calls remain`,
                );
            }
            const programResult = compactProgramResult(
                execution.result,
                this.options.maxResults,
            );
            const candidateLocations =
                phase === "refine"
                    ? mergeProgramLocations(
                          programResult.locations ?? [],
                          this.candidateLocations,
                          this.options.maxResults * 2,
                      )
                    : (programResult.locations ?? []);
            const compactedObservations = compactObservations(
                observations,
                phase,
                this.repository.observations.slice(0, observationStart),
                candidateLocations,
            );
            const remainingProgramExecutions =
                MAX_PROGRAM_EXECUTIONS - this.programAttempts - 1;
            const payload = {
                phase,
                programResult,
                repositoryCalls: this.repository.trace.totalCalls,
                remainingRepositoryCalls,
                remainingProgramExecutions,
                nextAction: nextPhaseInstruction(
                    phase,
                    phase === "discover" &&
                        this.options.lsp !== undefined &&
                        !this.hasAdoptedLspNavigation(),
                ),
            };
            let response = serializeActionPayload(
                payload,
                compactedObservations.observations,
                compactedObservations.truncated,
                phase === "discover"
                    ? MAX_DISCOVERY_ACTION_RESULT_CHARS
                    : MAX_ACTION_RESULT_CHARS,
            );
            let submissionContext: FormattedSubmissionContext | undefined;
            if (
                phase === "refine" &&
                (this.evidenceCompacted || response.truncated)
            ) {
                submissionContext = formatSubmissionContext(
                    candidateLocations,
                    [...this.groundingObservations, ...observations],
                );
                response = serializeActionPayload(
                    {
                        ...payload,
                        submissionEvidence: submissionContext.text,
                    },
                    compactedObservations.observations,
                    compactedObservations.truncated,
                    MAX_ACTION_RESULT_CHARS,
                );
            }
            execution.accept();
            accepted = true;
            this.programAttempts++;
            this.evidenceCompacted ||= response.truncated;
            this.groundingObservations.push(...observations);
            this.visibleGroundingObservations.push(
                ...response.observations,
                ...(submissionContext?.observations ?? []),
            );
            this.candidateLocations = candidateLocations;
            return createActionResult(response.text);
        } finally {
            if (!accepted) {
                execution.discard();
            }
        }
    }

    private async submitExploration(
        rawLocations: unknown,
    ): Promise<ActionResult> {
        if (this.submitted) {
            return errorResult("The exploration was already submitted");
        }
        if (this.programAttempts < MIN_PROGRAM_EXECUTIONS) {
            return errorResult(
                "Complete discovery and refinement before submission",
            );
        }
        if (this.options.lsp && !this.hasAdoptedLspNavigation()) {
            return errorResult(
                "TypeAgent with LSP must attempt non-discarded language-server navigation before submission",
            );
        }
        const formatted = await validateAndFormatLocations(
            rawLocations,
            this.options.repoRoot,
            this.options.maxResults,
            this.options.maxOutputChars,
            this.visibleGroundingObservations,
        );
        this.submitted = formatted;
        return createActionResult(formatted.text);
    }

    public hasAdoptedLspNavigation(): boolean {
        return this.repository.trace.calls.some(
            (call) => call.discarded !== true && call.tool === "lsp",
        );
    }
}

function zeroLineReadDiagnostic(
    calls: ExplorerSessionSnapshot["toolTrace"]["calls"],
): string | undefined {
    const reads = calls
        .filter((call) => call.tool === "read" && call.resultCount === 0)
        .map((call) => {
            const path =
                typeof call.input.path === "string"
                    ? call.input.path
                    : "unknown path";
            const offset =
                typeof call.input.offset === "number" ? call.input.offset : 0;
            return `${path} at zero-based offset ${offset} returned zero lines`;
        });
    return reads.length > 0 ? reads.join("; ") : undefined;
}

export function createExplorerAgent(session: ExplorerActionSession): AppAgent {
    return createAgent(session);
}

export function instantiate(): AppAgent {
    return createAgent();
}

export function getExplorerActionSchema(): string {
    return readFileSync(
        new URL("./schema/explorerActions.d.ts", import.meta.url),
        "utf8",
    );
}

export function getRepositorySandboxSchema(enableLsp = false): string {
    return generateSandboxDeclarations(undefined, enableLsp);
}

function createAgent(initialSession?: ExplorerActionSession): AppAgent {
    return {
        initializeAgentContext: async (settings) => {
            const session = initialSession ?? sessionFromInitSettings(settings);
            return { ...(session ? { session } : {}) };
        },
        executeAction: async (
            action,
            context: ActionContext<ExplorerAgentContext>,
        ) => {
            const session = context.sessionContext.agentContext.session;
            return session
                ? session.execute(action)
                : errorResult(
                      "Explorer AppAgent requires a configured exploration session",
                  );
        },
    };
}

function compactObservation(observation: RepositoryObservation): {
    source: "grep" | "read";
    callIndex: number;
    path: string;
    startLine: number;
    endLine: number;
    lines: string[];
} {
    return {
        source: observation.source,
        callIndex: observation.callIndex,
        path: observation.path,
        startLine: observation.startLine,
        endLine: observation.endLine,
        lines: observation.lines,
    };
}

interface FormattedSubmissionContext {
    text: string;
    observations: RepositoryObservation[];
}

function formatSubmissionContext(
    candidates: readonly CompactProgramLocation[],
    observations: readonly RepositoryObservation[],
): FormattedSubmissionContext {
    const groups = groupSubmissionReadEvidence(observations, candidates);
    if (groups.length === 0) {
        throw new Error("Submission requires successful read evidence");
    }
    const candidateText = boundedJson(
        candidates,
        MAX_SUBMISSION_CANDIDATE_CHARS,
    );
    const basePrefix = `Advisory candidates (navigation only; they do not ground submission):\n${candidateText}\n\nSuccessful grep evidence (exact grep lines ground submission):`;
    const readLabel =
        "\n\nRead evidence (successful reads also ground submission):";
    const readHeaderBudget = Math.max(
        ...groups.map((group) => formatSubmissionReadHeader(group).length),
    );
    const grepBudget = Math.max(
        0,
        Math.min(
            MAX_SUBMISSION_GREP_CHARS,
            MAX_SUBMISSION_CONTEXT_CHARS -
                basePrefix.length -
                readLabel.length -
                groups.length * (readHeaderBudget + 2),
        ),
    );
    const grepEvidence = formatSubmissionGrepEvidence(
        observations,
        candidates,
        grepBudget,
    );
    const prefix = `${basePrefix}\n${grepEvidence.text || "No successful grep evidence was available."}${readLabel}`;
    const separatorChars = groups.length * 2;
    const available =
        MAX_SUBMISSION_CONTEXT_CHARS - prefix.length - separatorChars;
    if (available < groups.length) {
        throw new Error("Submission evidence metadata exceeds its size limit");
    }
    const groupBudget = Math.floor(available / groups.length);
    const blocks = groups.map((group) =>
        formatSubmissionReadGroup(group, groupBudget),
    );
    const result = `${prefix}\n\n${blocks.map((block) => block.text).join("\n\n")}`;
    if (result.length > MAX_SUBMISSION_CONTEXT_CHARS) {
        throw new Error("Submission evidence exceeds its size limit");
    }
    return {
        text: result,
        observations: [
            ...grepEvidence.observations,
            ...blocks.flatMap((block) => block.observations),
        ],
    };
}

interface SubmissionEvidenceLine {
    path: string;
    line: number;
    text: string;
    candidate: boolean;
    order: number;
}

interface SubmissionReadGroup {
    callIndex: number;
    path: string;
    lines: SubmissionEvidenceLine[];
}

function formatSubmissionGrepEvidence(
    observations: readonly RepositoryObservation[],
    candidates: readonly CompactProgramLocation[],
    maxChars: number,
): FormattedSubmissionContext {
    const greps = observations
        .map((observation, order) => ({ observation, order }))
        .filter(({ observation }) => observation.source === "grep")
        .sort(
            (left, right) =>
                Number(hasCandidateOverlap(right.observation, candidates)) -
                    Number(hasCandidateOverlap(left.observation, candidates)) ||
                submissionPathPriority(left.observation.path) -
                    submissionPathPriority(right.observation.path) ||
                left.order - right.order,
        );
    let result = "";
    const visible: RepositoryObservation[] = [];
    for (const { observation } of greps) {
        const numberedLines = observation.lines
            .map((line, index) => `${observation.startLine + index}\t${line}`)
            .join("\n");
        const block = `[grep callIndex=${observation.callIndex} path=${JSON.stringify(
            observation.path,
        )}]\n${numberedLines}`;
        const separator = result ? "\n\n" : "";
        if (result.length + separator.length + block.length > maxChars) {
            continue;
        }
        result += separator + block;
        visible.push(observation);
    }
    return { text: result, observations: visible };
}

function hasCandidateOverlap(
    observation: RepositoryObservation,
    candidates: readonly CompactProgramLocation[],
): boolean {
    return candidates.some(
        (candidate) =>
            candidate.path === observation.path &&
            candidate.startLine <= observation.endLine &&
            candidate.endLine >= observation.startLine,
    );
}

function submissionPathPriority(fileName: string): number {
    const parts = fileName.toLowerCase().split("/");
    if (
        parts.some((part) =>
            ["doc", "docs", "example", "examples", "asset", "assets"].includes(
                part,
            ),
        )
    ) {
        return 2;
    }
    return parts.some((part) =>
        ["test", "tests", "testing", "spec", "specs"].includes(part),
    ) ||
        /(?:^|[._-])(test|spec)(?:[._-]|$)/iu.test(
            path.posix.basename(fileName),
        )
        ? 1
        : 0;
}

function groupSubmissionReadEvidence(
    observations: readonly RepositoryObservation[],
    candidates: readonly CompactProgramLocation[],
): SubmissionReadGroup[] {
    const groups = new Map<number, SubmissionReadGroup>();
    let order = 0;
    for (const observation of observations) {
        if (observation.source !== "read") {
            continue;
        }
        const group = groups.get(observation.callIndex) ?? {
            callIndex: observation.callIndex,
            path: observation.path,
            lines: [],
        };
        const seen = new Set(group.lines.map((line) => line.line));
        for (let index = 0; index < observation.lines.length; index++) {
            const line = observation.startLine + index;
            if (seen.has(line)) {
                continue;
            }
            seen.add(line);
            group.lines.push({
                path: observation.path,
                line,
                text: observation.lines[index],
                candidate: candidates.some(
                    (candidate) =>
                        candidate.path === observation.path &&
                        candidate.startLine <= line &&
                        candidate.endLine >= line,
                ),
                order: order++,
            });
        }
        groups.set(observation.callIndex, group);
    }
    return [...groups.values()].sort(
        (left, right) => left.callIndex - right.callIndex,
    );
}

function formatSubmissionReadGroup(
    group: SubmissionReadGroup,
    maxChars: number,
): FormattedSubmissionContext {
    const header = formatSubmissionReadHeader(group);
    if (header.length > maxChars) {
        throw new Error(
            `Read evidence header exceeds its per-call size limit for call ${group.callIndex}`,
        );
    }
    let result = header;
    const visible: RepositoryObservation[] = [];
    const lines = [...group.lines].sort(
        (left, right) =>
            Number(right.candidate) - Number(left.candidate) ||
            left.order - right.order,
    );
    for (const line of lines) {
        const value = `\n${line.line}\t${line.text}`;
        if (result.length + value.length > maxChars) {
            break;
        }
        result += value;
        visible.push({
            source: "read",
            callIndex: group.callIndex,
            path: line.path,
            startLine: line.line,
            endLine: line.line,
            lines: [line.text],
        });
    }
    return { text: result, observations: visible };
}

function formatSubmissionReadHeader(group: SubmissionReadGroup): string {
    return `[read callIndex=${group.callIndex} path=${JSON.stringify(
        group.path,
    )}]`;
}

function compactObservations(
    observations: RepositoryObservation[],
    phase: RepositoryProgramPhase,
    priorObservations: RepositoryObservation[],
    candidateLocations: readonly CompactProgramLocation[] = [],
): {
    observations: ReturnType<typeof compactObservation>[];
    truncated: boolean;
} {
    const relevantGreps = [...priorObservations, ...observations].filter(
        (observation) => observation.source === "grep",
    );
    const lineBudget =
        phase === "refine"
            ? MAX_EXACT_RESPONSE_LINES
            : MAX_DISCOVERY_RESPONSE_LINES;
    const readObservations = observations.filter(
        (observation) => observation.source === "read",
    );
    const linesPerRead = Math.max(
        20,
        Math.floor(lineBudget / Math.max(1, readObservations.length)),
    );
    let truncated = false;
    const compacted = observations.flatMap((observation) => {
        if (observation.source === "grep") {
            return [compactObservation(observation)];
        }
        if (observation.lines.length <= linesPerRead) {
            return [compactObservation(observation)];
        }
        const selected = compactReadAroundGreps(
            observation,
            relevantGreps,
            linesPerRead,
            phase === "refine" ? 32 : 8,
            candidateLocations,
        );
        if (
            selected.reduce((total, entry) => total + entry.lines.length, 0) <
            observation.lines.length
        ) {
            truncated = true;
        }
        return selected;
    });
    return {
        observations: [
            ...compacted.filter((observation) => observation.source === "read"),
            ...compacted.filter((observation) => observation.source === "grep"),
        ],
        truncated,
    };
}

function compactReadAroundGreps(
    observation: RepositoryObservation,
    priorGreps: RepositoryObservation[],
    maxLines: number,
    maxEdgeLines = 8,
    candidateLocations: readonly CompactProgramLocation[] = [],
): ReturnType<typeof compactObservation>[] {
    if (observation.lines.length <= maxLines) {
        return [compactObservation(observation)];
    }
    const selected = new Set<number>();
    const definitions = observation.lines
        .map((line, index) => (isDefinitionLine(line) ? index : -1))
        .filter((index) => index >= 0);
    const edgeLines = Math.min(
        maxEdgeLines,
        Math.max(2, Math.floor(maxLines / 4)),
    );
    for (const candidate of candidateLocations) {
        if (
            candidate.path !== observation.path ||
            candidate.endLine < observation.startLine ||
            candidate.startLine > observation.endLine
        ) {
            continue;
        }
        addIndices(
            selected,
            Math.max(0, candidate.startLine - observation.startLine),
            Math.min(
                observation.lines.length - 1,
                candidate.endLine - observation.startLine,
            ),
            maxLines,
        );
    }
    addIndices(
        selected,
        0,
        Math.min(observation.lines.length - 1, edgeLines - 1),
        maxLines,
    );
    addIndices(
        selected,
        Math.max(0, observation.lines.length - edgeLines),
        observation.lines.length - 1,
        maxLines,
    );
    for (const grep of [...priorGreps].reverse()) {
        if (
            grep.path !== observation.path ||
            grep.startLine < observation.startLine ||
            grep.startLine > observation.endLine
        ) {
            continue;
        }
        const center = grep.startLine - observation.startLine;
        addIndices(
            selected,
            Math.max(0, center - CONTEXT_LINES_AROUND_GREP),
            Math.min(
                observation.lines.length - 1,
                center + CONTEXT_LINES_AROUND_GREP,
            ),
            maxLines,
        );
        if (selected.size >= maxLines) {
            break;
        }
    }
    const segments: Array<[number, number]> = [];
    if (definitions.length === 0) {
        segments.push([0, observation.lines.length - 1]);
    } else if (definitions[0] > 0) {
        segments.push([0, definitions[0] - 1]);
    }
    for (let position = 0; position < definitions.length; position++) {
        segments.push([
            definitions[position],
            (definitions[position + 1] ?? observation.lines.length) - 1,
        ]);
    }
    const linesPerSegment = Math.max(
        2,
        Math.floor(maxLines / Math.max(1, segments.length)),
    );
    for (const [start, end] of segments) {
        const headLines = Math.min(3, linesPerSegment);
        addIndices(
            selected,
            start,
            Math.min(end, start + headLines - 1),
            maxLines,
        );
        addIndices(
            selected,
            Math.max(
                start + headLines,
                end - (linesPerSegment - headLines) + 1,
            ),
            end,
            maxLines,
        );
    }
    if (selected.size === 0) {
        const edgeLines = Math.floor(maxLines / 2);
        for (let index = 0; index < edgeLines; index++) {
            selected.add(index);
            selected.add(observation.lines.length - 1 - index);
        }
    }
    return contiguousRanges(
        [...selected].sort((left, right) => left - right),
    ).map(([start, end]) => ({
        source: "read" as const,
        callIndex: observation.callIndex,
        path: observation.path,
        startLine: observation.startLine + start,
        endLine: observation.startLine + end,
        lines: observation.lines.slice(start, end + 1),
    }));
}

function addIndices(
    selected: Set<number>,
    start: number,
    end: number,
    maxLines: number,
): void {
    for (let index = start; index <= end && selected.size < maxLines; index++) {
        selected.add(index);
    }
}

function isDefinitionLine(line: string): boolean {
    return /^\s*(?:(?:export|public|private|protected|static)\s+)*(?:async\s+)?(?:class|def|enum|fn|func|function|impl|interface|struct|type)\s+[A-Za-z_$]/u.test(
        line,
    );
}

function contiguousRanges(indices: number[]): Array<[number, number]> {
    const ranges: Array<[number, number]> = [];
    for (const index of indices) {
        const last = ranges.at(-1);
        if (last && index === last[1] + 1) {
            last[1] = index;
        } else {
            ranges.push([index, index]);
        }
    }
    return ranges;
}

interface CompactProgramLocation {
    path: string;
    startLine: number;
    endLine: number;
}

interface CompactProgramResult {
    success: boolean;
    message?: string;
    error?: string;
    locations?: CompactProgramLocation[];
    truncated?: true;
}

function compactProgramResult(
    value: unknown,
    maxResults: number,
): CompactProgramResult {
    if (!isRecord(value)) {
        return { success: true };
    }
    const message =
        typeof value.message === "string"
            ? value.message.slice(0, MAX_RESULT_MESSAGE_CHARS)
            : undefined;
    const error =
        typeof value.error === "string"
            ? value.error.slice(0, MAX_RESULT_MESSAGE_CHARS)
            : undefined;
    const truncated =
        (typeof value.message === "string" && value.message !== message) ||
        (typeof value.error === "string" && value.error !== error);
    const sourceLocations = Array.isArray(value.locations)
        ? value.locations
        : undefined;
    const locations = sourceLocations
        ? sourceLocations
              .map(compactProgramLocation)
              .filter(
                  (location): location is CompactProgramLocation =>
                      location !== undefined,
              )
              .slice(0, maxResults)
        : undefined;
    return {
        success: value.success === true,
        ...(message ? { message } : {}),
        ...(error ? { error } : {}),
        ...(locations ? { locations } : {}),
        ...(truncated ||
        (sourceLocations &&
            (sourceLocations.length > maxResults ||
                locations?.length !== sourceLocations.length))
            ? { truncated: true }
            : {}),
    };
}

function compactProgramLocation(
    value: unknown,
): CompactProgramLocation | undefined {
    if (!isRecord(value)) {
        return undefined;
    }
    const { path: rawPath, startLine, endLine } = value;
    const locationPath =
        typeof rawPath === "string"
            ? normalizeProgramLocationPath(rawPath)
            : undefined;
    if (
        locationPath === undefined ||
        locationPath.length > MAX_RESULT_PATH_CHARS ||
        !Number.isSafeInteger(startLine) ||
        !Number.isSafeInteger(endLine) ||
        Number(startLine) < 1 ||
        Number(endLine) < Number(startLine) ||
        Number(endLine) - Number(startLine) > 1_000
    ) {
        return undefined;
    }
    return {
        path: locationPath,
        startLine: Number(startLine),
        endLine: Number(endLine),
    };
}

function mergeProgramLocations(
    preferred: readonly CompactProgramLocation[],
    fallback: readonly CompactProgramLocation[],
    maxResults: number,
): CompactProgramLocation[] {
    const merged: CompactProgramLocation[] = [];
    const seen = new Set<string>();
    for (const location of [...preferred, ...fallback]) {
        const identity = `${location.path}\0${location.startLine}\0${location.endLine}`;
        if (seen.has(identity)) {
            continue;
        }
        seen.add(identity);
        merged.push(location);
        if (merged.length >= maxResults) {
            break;
        }
    }
    return merged;
}

function boundedJson(value: unknown, maxChars: number): string {
    try {
        const serialized = JSON.stringify(value);
        if (serialized.length <= maxChars) {
            return serialized;
        }
        if (!Array.isArray(value)) {
            return JSON.stringify({ truncated: true });
        }
        const items: unknown[] = [];
        for (const item of value) {
            const candidate = JSON.stringify({
                items: [...items, item],
                truncated: true,
                totalItems: value.length,
            });
            if (candidate.length > maxChars) {
                break;
            }
            items.push(item);
        }
        return JSON.stringify({
            items,
            truncated: true,
            totalItems: value.length,
        });
    } catch {
        return "unavailable";
    }
}

function normalizeProgramLocationPath(value: string): string | undefined {
    const rawPath = value.trim().replaceAll("\\", "/");
    if (
        !rawPath ||
        path.posix.isAbsolute(rawPath) ||
        rawPath.split("/").includes("..")
    ) {
        return undefined;
    }
    const normalized = path.posix.normalize(rawPath);
    return normalized === "." ? undefined : normalized;
}

function nextPhaseInstruction(
    phase: RepositoryProgramPhase,
    requireLsp = false,
): string {
    switch (phase) {
        case "discover":
            return requireLsp
                ? `Invoke refineRepository with exactly one repo.lsp call followed by reads of at most ${MAX_REFINEMENT_READ_LINES} lines around the strongest candidate lines`
                : `Invoke refineRepository with reads of at most ${MAX_REFINEMENT_READ_LINES} lines around the strongest candidate lines`;
        case "refine":
            return "Invoke submitExploration with the exact locations most likely needing changes, wholly supported by successful repository grep or read observations.";
    }
}

function repositoryEvidenceCallCount(trace: RepositoryToolTrace): number {
    return trace.calls.filter((call) => call.tool !== "lsp").length;
}

function serializeActionPayload(
    payload: Record<string, unknown>,
    observations: ReturnType<typeof compactObservation>[],
    initiallyTruncated = false,
    maxChars = MAX_ACTION_RESULT_CHARS,
): {
    text: string;
    observations: ReturnType<typeof compactObservation>[];
    truncated: boolean;
} {
    const serialize = (
        values: ReturnType<typeof compactObservation>[],
        truncated: boolean,
    ) =>
        JSON.stringify({
            ...payload,
            observations: values.map((observation) => ({
                ...observation,
                lines: observation.lines.map(
                    (line, index) =>
                        `${observation.startLine + index}\t${line}`,
                ),
            })),
            observationsTruncated: truncated,
        });

    if (serialize([], false).length > maxChars) {
        throw new Error(
            `Explorer action metadata exceeds the ${maxChars}-character result limit`,
        );
    }

    const observationsByPath = new Map<string, number[]>();
    observations.forEach((observation, index) => {
        const indices = observationsByPath.get(observation.path) ?? [];
        indices.push(index);
        observationsByPath.set(observation.path, indices);
    });
    const allocationOrder: number[] = [];
    while (
        [...observationsByPath.values()].some((indices) => indices.length > 0)
    ) {
        for (const indices of observationsByPath.values()) {
            const index = indices.shift();
            if (index !== undefined) {
                allocationOrder.push(index);
            }
        }
    }
    const visibleLineCounts = observations.map(() => 0);
    const blocked = new Set<number>();
    const buildVisible = () =>
        observations.flatMap((observation, index) => {
            const count = visibleLineCounts[index];
            return count === 0
                ? []
                : [
                      {
                          ...observation,
                          endLine: observation.startLine + count - 1,
                          lines: observation.lines.slice(0, count),
                      },
                  ];
        });
    while (true) {
        let progressed = false;
        for (const index of allocationOrder) {
            if (
                blocked.has(index) ||
                visibleLineCounts[index] >= observations[index].lines.length
            ) {
                continue;
            }
            visibleLineCounts[index]++;
            if (serialize(buildVisible(), false).length <= maxChars) {
                progressed = true;
            } else {
                visibleLineCounts[index]--;
                blocked.add(index);
            }
        }
        if (!progressed) {
            break;
        }
    }

    const visible = buildVisible();
    const observationsTruncated =
        initiallyTruncated ||
        observations.some(
            (observation, index) =>
                visibleLineCounts[index] < observation.lines.length,
        );
    return {
        text: serialize(visible, observationsTruncated),
        observations: visible,
        truncated: observationsTruncated,
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorResult(error: string): ActionResult {
    return { error };
}

function sessionFromInitSettings(
    settings: AppAgentInitSettings | undefined,
): ExplorerActionSession | undefined {
    const options = settings?.options;
    if (typeof options !== "object" || options === null) {
        return undefined;
    }
    const session = (options as { session?: unknown }).session;
    return session instanceof ExplorerActionSession ? session : undefined;
}
