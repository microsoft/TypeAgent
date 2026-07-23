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
import { validateAndFormatLocations } from "./citationFormatter.js";
import {
    createRepositoryTools,
    type RepositoryObservation,
    type RepositoryTools,
} from "./script/repositoryApi.js";
import type { LanguageServerOptions } from "./script/languageServer.js";
import { generateSandboxDeclarations } from "./script/sandboxDeclarations.js";
import { createExploreScriptExecutor } from "./script/scriptExecutor.js";
import {
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
export const MAX_REFINEMENT_CALLS_PER_PROGRAM = 4;
export const MAX_REFINEMENT_READ_LINES = 200;
const MAX_ACTION_RESULT_CHARS = 40_000;
const MAX_DISCOVERY_READ_LINES = 200;
const MAX_RESULT_MESSAGE_CHARS = 1_000;
const MAX_RESPONSE_GREP_OBSERVATIONS = 40;
const MAX_DISCOVERY_RESPONSE_LINES = 120;
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
            this.repository.trace.totalCalls >= this.options.maxToolCalls
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
        const callLimit =
            phase === "discover"
                ? this.options.maxToolCalls - REFINEMENT_RESERVED_CALLS
                : this.repository.trace.totalCalls +
                  MAX_REFINEMENT_CALLS_PER_PROGRAM;
        this.repository.allowCallsThrough(
            Math.max(1, Math.min(this.options.maxToolCalls, callLimit)),
            phase === "refine"
                ? MAX_REFINEMENT_READ_LINES
                : MAX_DISCOVERY_READ_LINES,
            phase === "refine"
                ? [
                      "ls",
                      "glob",
                      "grep",
                      "read",
                      ...(this.options.lsp ? (["lsp"] as const) : []),
                  ]
                : undefined,
            phase === "refine"
                ? { grep: 2, ...(this.options.lsp ? { lsp: 1 } : {}) }
                : undefined,
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
        const observations =
            this.repository.observations.slice(observationStart);
        const calls = this.repository.trace.calls.slice(callStart);
        const remainingRepositoryCalls = Math.max(
            0,
            this.options.maxToolCalls - this.repository.trace.totalCalls,
        );
        if (
            phase === "refine" &&
            !observations.some((observation) => observation.source === "read")
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
        this.programAttempts++;
        const responseObservations = compactObservations(
            observations,
            phase,
            this.repository.observations.slice(0, observationStart),
        );
        const remainingProgramExecutions =
            MAX_PROGRAM_EXECUTIONS - this.programAttempts;
        const payload = {
            phase,
            programResult: compactProgramResult(execution.result),
            repositoryCalls: this.repository.trace.totalCalls,
            remainingRepositoryCalls,
            remainingProgramExecutions,
            nextAction: nextPhaseInstruction(phase),
        };
        const response = serializeActionPayload(payload, responseObservations);
        this.groundingObservations.push(...response.observations);
        return createActionResult(response.text);
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
        if (
            this.options.lsp &&
            !this.repository.trace.calls.some(
                (call) => call.tool === "lsp" && call.error === undefined,
            )
        ) {
            return errorResult(
                "TypeAgent with LSP must complete at least one language-server navigation call before submission",
            );
        }
        let formatted;
        try {
            formatted = await validateAndFormatLocations(
                rawLocations,
                this.options.repoRoot,
                this.options.maxResults,
                this.options.maxOutputChars,
                this.groundingObservations,
            );
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            const remainingRepositoryCalls = Math.max(
                0,
                this.options.maxToolCalls - this.repository.trace.totalCalls,
            );
            if (
                message.startsWith("Invalid grounded location:") &&
                remainingRepositoryCalls > 0 &&
                this.programAttempts < MAX_PROGRAM_EXECUTIONS
            ) {
                throw new Error(
                    `${message}. ${remainingRepositoryCalls} repository calls remain; invoke refineRepository to read the rejected range, then submit again`,
                );
            }
            throw error;
        }
        this.submitted = formatted;
        return createActionResult(formatted.text);
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

function compactObservations(
    observations: RepositoryObservation[],
    phase: RepositoryProgramPhase,
    priorObservations: RepositoryObservation[],
): ReturnType<typeof compactObservation>[] {
    const retainedGreps = new Set(
        selectGrepObservations(
            observations.filter((observation) => observation.source === "grep"),
            MAX_RESPONSE_GREP_OBSERVATIONS,
        ),
    );
    const relevantGreps = [...priorObservations, ...observations].filter(
        (observation) => observation.source === "grep",
    );
    const readCount = observations.filter(
        (observation) => observation.source === "read",
    ).length;
    const lineBudget =
        phase === "refine"
            ? MAX_EXACT_RESPONSE_LINES
            : MAX_DISCOVERY_RESPONSE_LINES;
    const linesPerRead = Math.max(
        20,
        Math.floor(lineBudget / Math.max(1, readCount)),
    );
    return observations.flatMap((observation) => {
        if (observation.source === "grep") {
            return retainedGreps.has(observation)
                ? [compactObservation(observation)]
                : [];
        }
        if (observation.lines.length <= linesPerRead) {
            return [compactObservation(observation)];
        }
        return compactReadAroundGreps(
            observation,
            relevantGreps,
            linesPerRead,
            phase === "refine" ? 32 : 8,
        );
    });
}

function selectGrepObservations(
    observations: RepositoryObservation[],
    limit: number,
): RepositoryObservation[] {
    if (observations.length <= limit) {
        return observations;
    }
    const groups = new Map<number, RepositoryObservation[]>();
    for (const observation of observations) {
        const group = groups.get(observation.callIndex) ?? [];
        group.push(observation);
        groups.set(observation.callIndex, group);
    }
    const orderedGroups = [...groups.values()];
    const selected: RepositoryObservation[] = [];
    for (let index = 0; index < orderedGroups.length; index++) {
        const remaining = limit - selected.length;
        if (remaining <= 0) {
            break;
        }
        const groupsLeft = orderedGroups.length - index;
        const quota = Math.max(1, Math.floor(remaining / groupsLeft));
        selected.push(...sampleEvenly(orderedGroups[index], quota));
    }
    return selected.slice(0, limit);
}

function sampleEvenly<T>(values: T[], limit: number): T[] {
    if (values.length <= limit) {
        return values;
    }
    if (limit === 1) {
        return [values[0]];
    }
    return Array.from(
        { length: limit },
        (_, index) =>
            values[Math.round((index * (values.length - 1)) / (limit - 1))],
    );
}

function compactReadAroundGreps(
    observation: RepositoryObservation,
    priorGreps: RepositoryObservation[],
    maxLines: number,
    maxEdgeLines = 8,
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

function compactProgramResult(value: unknown): Record<string, unknown> {
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
    return {
        success: value.success === true,
        ...(message ? { message } : {}),
        ...(error ? { error } : {}),
        ...(truncated ? { truncated: true } : {}),
    };
}

function nextPhaseInstruction(phase: RepositoryProgramPhase): string {
    switch (phase) {
        case "discover":
            return `Invoke refineRepository with reads of at most ${MAX_REFINEMENT_READ_LINES} lines around the strongest candidate lines`;
        case "refine":
            return "Invoke submitExploration with the exact locations most likely needing changes, supported by grep matches or repository reads.";
    }
}

function serializeActionPayload(
    payload: Record<string, unknown>,
    observations: ReturnType<typeof compactObservation>[],
): {
    text: string;
    observations: ReturnType<typeof compactObservation>[];
} {
    const visible: ReturnType<typeof compactObservation>[] = [];
    let observationsTruncated = false;
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

    for (const observation of observations) {
        if (
            serialize([...visible, observation], observationsTruncated)
                .length <= MAX_ACTION_RESULT_CHARS
        ) {
            visible.push(observation);
            continue;
        }
        observationsTruncated = true;
        let low = 0;
        let high = observation.lines.length;
        while (low < high) {
            const count = Math.ceil((low + high) / 2);
            const partial = {
                ...observation,
                endLine: observation.startLine + count - 1,
                lines: observation.lines.slice(0, count),
            };
            if (
                serialize([...visible, partial], true).length <=
                MAX_ACTION_RESULT_CHARS
            ) {
                low = count;
            } else {
                high = count - 1;
            }
        }
        if (low > 0) {
            visible.push({
                ...observation,
                endLine: observation.startLine + low - 1,
                lines: observation.lines.slice(0, low),
            });
        }
        break;
    }
    if (visible.length < observations.length) {
        observationsTruncated = true;
    }
    return {
        text: serialize(visible, observationsTruncated),
        observations: visible,
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
