// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { SessionEvent } from "@github/copilot-sdk";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { isTypeAgentVariant } from "./types.js";
import type {
    BenchmarkVariant,
    NormalizedTrajectoryRecord,
    NormalizedTrajectoryUsage,
    RunResult,
    RunTrajectoryFiles,
    TokenUsage,
} from "./types.js";

export interface TrajectoryExpectation {
    rowName: string;
    model: string;
    variant: BenchmarkVariant;
    attempt: number;
    system: "main" | "codemode";
    invocationIndex?: number;
}

interface TrajectoryValidationSummary {
    requestIndices: number[];
    usageRecordCount: number;
    usage: TokenUsage;
    unavailable: boolean;
}

export function createTrajectoryFiles(
    output: string,
    rowName: string,
    model: string,
    variant: BenchmarkVariant,
    attempt: number,
): RunTrajectoryFiles {
    const safeRow = safeSegment(rowName);
    const safeModel = modelLabel(model);
    const prefix = variant;
    const directory = path.join(
        path.dirname(path.resolve(output)),
        "trajectories",
        [safeRow, safeModel, variant, `attempt-${attempt}`, randomUUID()].join(
            "--",
        ),
    );
    const codeMode = path.join(
        directory,
        `${prefix}-codemode-${safeRow}-${safeModel}.jsonl`,
    );
    return {
        main: path.join(
            directory,
            `${prefix}${variant === "baseline" ? "" : "-main"}-${safeRow}-${safeModel}.jsonl`,
        ),
        ...(variant === "baseline"
            ? {}
            : {
                  codeMode,
                  codeModeInvocations: [codeMode],
              }),
    };
}

export function codeModeTrajectoryFiles(
    firstFile: string,
    invocationCount: number,
): string[] {
    if (!Number.isSafeInteger(invocationCount) || invocationCount < 1) {
        throw new Error(
            "Code Mode trajectory invocation count must be a positive integer",
        );
    }
    const extension = path.extname(firstFile);
    return Array.from({ length: invocationCount }, (_, index) =>
        index === 0
            ? firstFile
            : path.join(
                  path.dirname(firstFile),
                  `${path.basename(firstFile, extension)}-invocation-${index + 1}${extension}`,
              ),
    );
}

export function codeModeTrajectoryInvocationCount(
    attemptedExploreCalls: number | undefined,
    telemetryInvocationCount: number | undefined,
): number {
    for (const [name, value] of [
        ["Attempted explore call count", attemptedExploreCalls],
        ["Telemetry invocation count", telemetryInvocationCount],
    ] as const) {
        if (
            value !== undefined &&
            (!Number.isSafeInteger(value) || value < 0)
        ) {
            throw new Error(`${name} must be a non-negative integer`);
        }
    }
    return Math.max(
        1,
        attemptedExploreCalls ?? 0,
        telemetryInvocationCount ?? 0,
    );
}

export function normalizeCopilotTrajectory(
    events: readonly SessionEvent[],
    expectedModel: string,
    redactedValues: readonly string[],
    fallback?: { system: string; user: string; failure?: string },
): NormalizedTrajectoryRecord[] {
    const normalizedEvents = withFallbackMessages(events, fallback);
    const completedToolCallIds = new Set<string>();
    for (const event of normalizedEvents) {
        if (event.type === "tool.execution_complete") {
            completedToolCallIds.add(event.data.toolCallId);
        }
    }
    const terminalToolCallIds = new Set<string>();
    const requestedToolCallIds = new Set<string>();
    const usageByActorAndCall = new Map<
        string,
        {
            usage: NormalizedTrajectoryUsage;
            model: string;
            consumed: boolean;
        }
    >();
    const finalAssistantMessageByCall = new Map<string, string>();
    for (const event of normalizedEvents) {
        if (event.type === "assistant.message" && event.data.apiCallId) {
            finalAssistantMessageByCall.set(
                usageKey(event.agentId, event.data.apiCallId),
                event.id,
            );
        }
        if (event.type !== "assistant.usage") {
            continue;
        }
        const usage = normalizeUsage(event.data);
        if (event.data.apiCallId) {
            usageByActorAndCall.set(
                usageKey(event.agentId, event.data.apiCallId),
                { usage, model: event.data.model, consumed: false },
            );
        }
    }

    const records: NormalizedTrajectoryRecord[] = [];
    const add = (
        event: SessionEvent,
        input: Omit<
            NormalizedTrajectoryRecord,
            | "schemaVersion"
            | "sequence"
            | "model"
            | "tool_call_id"
            | "tool_calls"
            | "usage"
        > &
            Partial<
                Pick<
                    NormalizedTrajectoryRecord,
                    "tool_call_id" | "tool_calls" | "usage"
                >
            >,
    ) => {
        records.push(
            redactDeep(
                {
                    schemaVersion: 1,
                    sequence: records.length + 1,
                    role: input.role,
                    content: input.content,
                    model: expectedModel,
                    tool_call_id: input.tool_call_id ?? null,
                    tool_calls: input.tool_calls ?? [],
                    usage: input.usage ?? {},
                    source: "copilot-sdk",
                    sourceEvent: event.type,
                    eventId: event.id,
                    timestamp: event.timestamp,
                    ...(event.agentId ? { agentId: event.agentId } : {}),
                    ...("messageKind" in input && input.messageKind
                        ? { messageKind: input.messageKind }
                        : {}),
                    ...("isError" in input && input.isError !== undefined
                        ? { isError: input.isError }
                        : {}),
                    ...("apiCallId" in input && input.apiCallId
                        ? { apiCallId: input.apiCallId }
                        : {}),
                    ...("observedModel" in input && input.observedModel
                        ? { observedModel: input.observedModel }
                        : {}),
                    ...("usageModel" in input && input.usageModel
                        ? { usageModel: input.usageModel }
                        : {}),
                    ...("success" in input && input.success !== undefined
                        ? { success: input.success }
                        : {}),
                },
                redactedValues,
            ),
        );
    };
    const closeOutstandingToolCalls = (
        event: SessionEvent,
        message: string,
    ): void => {
        for (const toolCallId of requestedToolCallIds) {
            if (
                completedToolCallIds.has(toolCallId) ||
                terminalToolCallIds.has(toolCallId)
            ) {
                continue;
            }
            terminalToolCallIds.add(toolCallId);
            add(event, {
                role: "tool",
                content: message,
                tool_call_id: toolCallId,
                success: false,
            });
        }
    };

    for (const event of normalizedEvents) {
        switch (event.type) {
            case "system.message":
                add(event, {
                    role:
                        event.data.role === "developer"
                            ? "developer"
                            : "system",
                    content: event.data.content,
                });
                break;
            case "user.message":
                add(event, { role: "user", content: event.data.content });
                break;
            case "assistant.reasoning":
                add(event, {
                    role: "assistant",
                    content: event.data.content,
                    messageKind: "reasoning",
                });
                break;
            case "assistant.message": {
                const callKey = event.data.apiCallId
                    ? usageKey(event.agentId, event.data.apiCallId)
                    : undefined;
                const usageEntry = callKey
                    ? usageByActorAndCall.get(callKey)
                    : undefined;
                const ownsUsage = Boolean(
                    usageEntry &&
                        callKey &&
                        finalAssistantMessageByCall.get(callKey) === event.id,
                );
                if (usageEntry && ownsUsage) {
                    usageEntry.consumed = true;
                }
                const toolCalls = (event.data.toolRequests ?? []).map(
                    (request) => ({
                        id: request.toolCallId,
                        type: "function" as const,
                        function: {
                            name:
                                request.mcpServerName && request.mcpToolName
                                    ? `${request.mcpServerName}/${request.mcpToolName}`
                                    : request.name,
                            arguments: request.arguments ?? {},
                        },
                    }),
                );
                for (const call of toolCalls) {
                    requestedToolCallIds.add(call.id);
                }
                add(event, {
                    role: "assistant",
                    content: event.data.content,
                    ...(event.data.apiCallId
                        ? { apiCallId: event.data.apiCallId }
                        : {}),
                    ...(event.data.model
                        ? { observedModel: event.data.model }
                        : {}),
                    ...(ownsUsage && usageEntry?.model
                        ? { usageModel: usageEntry.model }
                        : {}),
                    tool_calls: toolCalls,
                    usage: ownsUsage && usageEntry ? usageEntry.usage : {},
                });
                break;
            }
            case "assistant.usage": {
                const callKey = event.data.apiCallId
                    ? usageKey(event.agentId, event.data.apiCallId)
                    : undefined;
                if (callKey && finalAssistantMessageByCall.has(callKey)) {
                    break;
                }
                const usageEntry = callKey
                    ? usageByActorAndCall.get(callKey)
                    : undefined;
                if (usageEntry) {
                    usageEntry.consumed = true;
                }
                add(event, {
                    role: "assistant",
                    content: "",
                    ...(event.data.apiCallId
                        ? { apiCallId: event.data.apiCallId }
                        : {}),
                    usageModel: event.data.model,
                    usage: usageEntry?.usage ?? normalizeUsage(event.data),
                    messageKind: "usage",
                });
                break;
            }
            case "tool.execution_complete":
                terminalToolCallIds.add(event.data.toolCallId);
                add(event, {
                    role: "tool",
                    content: completeToolContent(event),
                    tool_call_id: event.data.toolCallId,
                    ...(event.data.model
                        ? { observedModel: event.data.model }
                        : {}),
                    success: event.data.success,
                });
                break;
            case "subagent.failed":
                if (
                    !requestedToolCallIds.has(event.data.toolCallId) ||
                    completedToolCallIds.has(event.data.toolCallId) ||
                    terminalToolCallIds.has(event.data.toolCallId)
                ) {
                    break;
                }
                terminalToolCallIds.add(event.data.toolCallId);
                add(event, {
                    role: "tool",
                    content: event.data.error,
                    tool_call_id: event.data.toolCallId,
                    ...(event.data.model
                        ? { observedModel: event.data.model }
                        : {}),
                    success: false,
                });
                break;
            case "model.call_failure":
                closeOutstandingToolCalls(
                    event,
                    event.data.errorMessage ??
                        event.data.errorCode ??
                        "Model call failed",
                );
                add(event, {
                    role: "assistant",
                    content:
                        event.data.errorMessage ??
                        event.data.errorCode ??
                        "Model call failed",
                    ...(event.data.apiCallId
                        ? { apiCallId: event.data.apiCallId }
                        : {}),
                    ...(event.data.model
                        ? { observedModel: event.data.model }
                        : {}),
                    success: false,
                    messageKind: "model_error",
                });
                break;
            case "session.error":
                closeOutstandingToolCalls(event, event.data.message);
                add(event, {
                    role: "assistant",
                    content: event.data.message,
                    success: false,
                    messageKind: "model_error",
                });
                break;
        }
    }

    for (const [key, entry] of usageByActorAndCall) {
        if (entry.consumed) {
            continue;
        }
        const [agentId, apiCallId] = key.split("\0");
        const event = normalizedEvents.find(
            (
                candidate,
            ): candidate is Extract<
                SessionEvent,
                { type: "assistant.usage" }
            > =>
                candidate.type === "assistant.usage" &&
                (candidate.agentId ?? "") === agentId &&
                candidate.data.apiCallId === apiCallId,
        );
        if (event) {
            add(event, {
                role: "assistant",
                content: "",
                apiCallId,
                usageModel: event.data.model,
                usage: entry.usage,
                messageKind: "usage",
            });
        }
    }
    return records;
}

function withFallbackMessages(
    events: readonly SessionEvent[],
    fallback: { system: string; user: string; failure?: string } | undefined,
): readonly SessionEvent[] {
    if (!fallback) {
        return events;
    }
    const prefix: SessionEvent[] = [];
    if (
        !events.some(
            (event) =>
                event.type === "system.message" && event.agentId === undefined,
        )
    ) {
        prefix.push({
            id: "synthetic-system-message",
            parentId: null,
            timestamp: "1970-01-01T00:00:00.000Z",
            type: "system.message",
            data: {
                role: "system",
                content: fallback.system,
            },
        });
    }
    if (
        !events.some(
            (event) =>
                event.type === "user.message" && event.agentId === undefined,
        )
    ) {
        prefix.push({
            id: "synthetic-user-message",
            parentId: prefix.at(-1)?.id ?? null,
            timestamp: "1970-01-01T00:00:00.001Z",
            type: "user.message",
            data: { content: fallback.user },
        });
    }
    const suffix: SessionEvent[] = [];
    if (
        fallback.failure &&
        !events.some(
            (event) =>
                event.type === "model.call_failure" ||
                event.type === "session.error",
        )
    ) {
        suffix.push({
            id: "synthetic-model-call-failure",
            parentId: events.at(-1)?.id ?? prefix.at(-1)?.id ?? null,
            timestamp: events.at(-1)?.timestamp ?? "1970-01-01T00:00:00.002Z",
            type: "model.call_failure",
            data: { errorMessage: fallback.failure },
        } as SessionEvent);
    }
    return [...prefix, ...events, ...suffix];
}

export function mergeCopilotEvents(
    persisted: readonly SessionEvent[],
    live: readonly SessionEvent[],
): SessionEvent[] {
    const byId = new Map<string, SessionEvent>();
    for (const event of [...persisted, ...live]) {
        byId.set(event.id, event);
    }
    return [...byId.values()].sort((left, right) =>
        left.timestamp.localeCompare(right.timestamp),
    );
}

export async function writeTrajectoryFile(
    file: string,
    records: readonly NormalizedTrajectoryRecord[],
): Promise<void> {
    if (records.length === 0) {
        throw new Error("Trajectory must contain at least one record");
    }
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(
        file,
        `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
        { encoding: "utf8", flag: "wx", mode: 0o600 },
    );
}

export async function writeUnavailableTrajectoryFile(
    file: string,
    expected: TrajectoryExpectation,
    userMessage: string,
    errorMessage: string,
    redactedValues: readonly string[],
): Promise<void> {
    if (expected.system !== "codemode") {
        throw new Error(
            "Only a missing Code Mode system may use an unavailable trajectory",
        );
    }
    const source = expectedSource(expected.system);
    const records = redactDeep<NormalizedTrajectoryRecord[]>(
        [
            stableRecord(1, "system", expected.model, source, {
                content: "TypeAgent Code Mode did not start.",
                sourceEvent: "trajectory.unavailable",
            }),
            stableRecord(2, "user", expected.model, source, {
                content: userMessage,
                sourceEvent: "trajectory.unavailable",
            }),
            stableRecord(3, "assistant", expected.model, source, {
                content: errorMessage,
                success: false,
                messageKind: "model_error",
                sourceEvent: "trajectory.unavailable",
            }),
        ],
        redactedValues,
    );
    await writeTrajectoryFile(file, records);
}

export async function validateRunTrajectoryFiles(
    rows: readonly RunResult[],
): Promise<void> {
    const usedPaths = new Set<string>();
    for (const row of rows) {
        const files = row.trajectoryFiles;
        if (!files?.main) {
            throw new Error(
                "Every benchmark attempt requires a main trajectory",
            );
        }
        const mainSummary = await validateUniqueTrajectory(
            files.main,
            {
                rowName: row.taskId,
                model: row.model,
                variant: row.variant,
                attempt: row.attempt,
                system: "main",
            },
            usedPaths,
        );
        validateMainTrajectorySummary(row, mainSummary);
        if (isTypeAgentVariant(row.variant)) {
            if (!files.codeMode) {
                throw new Error(
                    "Every TypeAgent benchmark attempt requires a Code Mode trajectory",
                );
            }
            const codeModeFiles = files.codeModeInvocations ?? [files.codeMode];
            const expectedFiles = codeModeTrajectoryFiles(
                files.codeMode,
                codeModeTrajectoryInvocationCount(
                    row.attemptedExploreCalls,
                    row.exploreTelemetry?.invocations?.length,
                ),
            );
            if (
                codeModeFiles.length !== expectedFiles.length ||
                codeModeFiles.some(
                    (file, index) => file !== expectedFiles[index],
                )
            ) {
                throw new Error(
                    `${row.variant} must reference every Code Mode invocation trajectory`,
                );
            }
            const summaries = await Promise.all(
                codeModeFiles.map((file, invocationIndex) =>
                    validateUniqueTrajectory(
                        file,
                        {
                            rowName: row.taskId,
                            model: row.model,
                            variant: row.variant,
                            attempt: row.attempt,
                            system: "codemode",
                            invocationIndex,
                        },
                        usedPaths,
                    ),
                ),
            );
            validateCodeModeTrajectorySummaries(row, summaries);
        } else if (
            files.codeMode !== undefined ||
            files.codeModeInvocations !== undefined
        ) {
            throw new Error(
                "Baseline benchmark attempts cannot claim a Code Mode trajectory",
            );
        }
    }
}

async function validateUniqueTrajectory(
    file: string,
    expected: TrajectoryExpectation,
    usedPaths: Set<string>,
): Promise<TrajectoryValidationSummary> {
    const resolved = path.resolve(file);
    if (usedPaths.has(resolved)) {
        throw new Error(
            `Benchmark attempts must use unique trajectory paths: ${resolved}`,
        );
    }
    usedPaths.add(resolved);
    return validateTrajectoryFileAndSummarize(file, expected);
}

export async function validateTrajectoryFile(
    file: string,
    expected: TrajectoryExpectation,
): Promise<void> {
    await validateTrajectoryFileAndSummarize(file, expected);
}

async function validateTrajectoryFileAndSummarize(
    file: string,
    expected: TrajectoryExpectation,
): Promise<TrajectoryValidationSummary> {
    validateTrajectoryPath(file, expected);
    const metadata = await stat(file);
    if (process.platform !== "win32" && (metadata.mode & 0o777) !== 0o600) {
        throw new Error(`Trajectory ${file} must have mode 0600`);
    }
    const text = await readFile(file, "utf8");
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length === 0) {
        throw new Error(`Trajectory ${file} is empty`);
    }
    const toolCallIds = new Set<string>();
    const toolResultIds = new Set<string>();
    const requiredRoles = new Map<"system" | "user" | "assistant", number>();
    const source = expectedSource(expected.system);
    const requestIndices: number[] = [];
    const requestIndexSet = new Set<number>();
    const usage = emptyTokenUsage();
    let usageRecordCount = 0;
    let unavailable = lines.length === 3;
    for (const [index, line] of lines.entries()) {
        let value: unknown;
        try {
            value = JSON.parse(line);
        } catch (error) {
            throw new Error(
                `Invalid trajectory JSONL at ${file}:${index + 1}: ${(error as Error).message}`,
            );
        }
        if (!isRecord(value)) {
            throw new Error(`Trajectory ${file}:${index + 1} is not an object`);
        }
        if (value.schemaVersion !== 1 || value.sequence !== index + 1) {
            throw new Error(
                `Trajectory ${file}:${index + 1} has an invalid schema or sequence`,
            );
        }
        if (value.model !== expected.model) {
            throw new Error(
                `Trajectory ${file}:${index + 1} model ${JSON.stringify(value.model)} does not match expected model ${JSON.stringify(expected.model)}`,
            );
        }
        if (
            !new Set(["system", "developer", "user", "assistant", "tool"]).has(
                String(value.role),
            ) ||
            typeof value.content !== "string" ||
            !Array.isArray(value.tool_calls) ||
            !isRecord(value.usage) ||
            !(
                value.tool_call_id === null ||
                typeof value.tool_call_id === "string"
            )
        ) {
            throw new Error(
                `Trajectory ${file}:${index + 1} is missing stable message fields`,
            );
        }
        if (value.source !== source) {
            throw new Error(
                `Trajectory ${file}:${index + 1} source ${JSON.stringify(value.source)} does not match expected source ${JSON.stringify(source)}`,
            );
        }
        if (
            value.observedModel !== undefined &&
            (typeof value.observedModel !== "string" ||
                value.observedModel.length === 0)
        ) {
            throw new Error(
                `Trajectory ${file}:${index + 1} has an invalid observed model`,
            );
        }
        if (
            value.usageModel !== undefined &&
            (typeof value.usageModel !== "string" ||
                value.usageModel.length === 0)
        ) {
            throw new Error(
                `Trajectory ${file}:${index + 1} has an invalid usage model`,
            );
        }
        const role = value.role as NormalizedTrajectoryRecord["role"];
        unavailable &&=
            value.sourceEvent === "trajectory.unavailable" &&
            value.tool_call_id === null &&
            value.tool_calls.length === 0 &&
            Object.keys(value.usage).length === 0 &&
            value.requestIndex === undefined &&
            ((index === 0 &&
                role === "system" &&
                value.content === "TypeAgent Code Mode did not start.") ||
                (index === 1 && role === "user") ||
                (index === 2 &&
                    role === "assistant" &&
                    value.success === false &&
                    value.messageKind === "model_error"));
        validateUsage(file, index + 1, value.usage);
        const hasUsage = Object.keys(value.usage).length > 0;
        if (source === "copilot-sdk" && hasUsage) {
            const usageModel = value.usageModel ?? value.observedModel;
            if (usageModel !== expected.model) {
                throw new Error(
                    `Trajectory ${file}:${index + 1} usage model ${JSON.stringify(usageModel)} does not match expected model ${JSON.stringify(expected.model)}`,
                );
            }
            usageRecordCount++;
            addTrajectoryUsage(usage, value.usage);
        }
        if (
            source === "typeagent-codemode" &&
            hasUsage &&
            value.requestIndex === undefined
        ) {
            throw new Error(
                `Trajectory ${file}:${index + 1} has Code Mode usage without a request index`,
            );
        }
        if (value.requestIndex !== undefined) {
            const requestIndex = value.requestIndex;
            if (
                source !== "typeagent-codemode" ||
                role !== "assistant" ||
                typeof requestIndex !== "number" ||
                !Number.isSafeInteger(requestIndex) ||
                requestIndex < 1 ||
                Object.keys(value.usage).length === 0
            ) {
                throw new Error(
                    `Trajectory ${file}:${index + 1} has an invalid Code Mode request index`,
                );
            }
            if (requestIndexSet.has(requestIndex)) {
                throw new Error(
                    `Trajectory ${file}:${index + 1} has duplicate Code Mode request index ${requestIndex}`,
                );
            }
            requestIndexSet.add(requestIndex);
            requestIndices.push(requestIndex);
            usageRecordCount++;
            addTrajectoryUsage(usage, value.usage);
        }
        if (value.isError !== undefined && typeof value.isError !== "boolean") {
            throw new Error(
                `Trajectory ${file}:${index + 1} has an invalid error marker`,
            );
        }
        if (role === "system" || role === "user" || role === "assistant") {
            requiredRoles.set(role, requiredRoles.get(role) ?? index);
        }
        for (const call of value.tool_calls) {
            if (
                role !== "assistant" ||
                !isRecord(call) ||
                typeof call.id !== "string" ||
                call.id.length === 0 ||
                call.type !== "function" ||
                !isRecord(call.function) ||
                typeof call.function.name !== "string" ||
                call.function.name.length === 0 ||
                !isRecord(call.function.arguments)
            ) {
                throw new Error(
                    `Trajectory ${file}:${index + 1} has an invalid tool call`,
                );
            }
            if (toolCallIds.has(call.id)) {
                throw new Error(
                    `Trajectory ${file}:${index + 1} has duplicate tool call ${JSON.stringify(call.id)}`,
                );
            }
            toolCallIds.add(call.id);
        }
        if (typeof value.tool_call_id === "string") {
            if (
                role !== "tool" ||
                value.tool_call_id.length === 0 ||
                value.tool_calls.length !== 0
            ) {
                throw new Error(
                    `Trajectory ${file}:${index + 1} has an invalid tool result`,
                );
            }
            if (!toolCallIds.has(value.tool_call_id)) {
                throw new Error(
                    `Trajectory ${file}:${index + 1} has a tool result before its assistant call`,
                );
            }
            if (toolResultIds.has(value.tool_call_id)) {
                throw new Error(
                    `Trajectory ${file}:${index + 1} has duplicate tool result ${JSON.stringify(value.tool_call_id)}`,
                );
            }
            toolResultIds.add(value.tool_call_id);
        } else if (role === "tool") {
            throw new Error(
                `Trajectory ${file}:${index + 1} has a tool result without assistant call`,
            );
        }
    }
    const missingResult = [...toolCallIds].find((id) => !toolResultIds.has(id));
    if (missingResult) {
        throw new Error(
            `Trajectory ${file} has tool call ${JSON.stringify(missingResult)} without exactly one tool result`,
        );
    }
    for (const role of ["system", "user", "assistant"] as const) {
        if (!requiredRoles.has(role)) {
            throw new Error(
                `Trajectory ${file} is missing required ${role} role`,
            );
        }
    }
    if (
        requiredRoles.get("system")! > requiredRoles.get("user")! ||
        requiredRoles.get("user")! > requiredRoles.get("assistant")!
    ) {
        throw new Error(
            `Trajectory ${file} must order system, user, and assistant roles`,
        );
    }
    return { requestIndices, usageRecordCount, usage, unavailable };
}

function validateMainTrajectorySummary(
    row: RunResult,
    summary: TrajectoryValidationSummary,
): void {
    const expected = row.usage;
    if (!expected) {
        if (summary.usageRecordCount === 0) {
            return;
        }
        throw new Error(
            `${row.variant} main trajectory has usage that is missing from the result row`,
        );
    }
    if (
        summary.usageRecordCount !== expected.requestCount ||
        summary.usage.inputTokens !== expected.inputTokens ||
        summary.usage.cachedInputTokens !== expected.cachedInputTokens ||
        summary.usage.cacheWriteTokens !== expected.cacheWriteTokens ||
        summary.usage.outputTokens !== expected.outputTokens ||
        summary.usage.reasoningOutputTokens !==
            expected.reasoningOutputTokens ||
        summary.usage.totalTokens !== expected.totalTokens
    ) {
        throw new Error(
            `${row.variant} main trajectory request count and usage must match result usage`,
        );
    }
}

function validateCodeModeTrajectorySummaries(
    row: RunResult,
    summaries: readonly TrajectoryValidationSummary[],
): void {
    const invocations = row.exploreTelemetry?.invocations;
    const expectedInvocationCount = codeModeTrajectoryInvocationCount(
        row.attemptedExploreCalls,
        invocations?.length,
    );
    if (!invocations || invocations.length === 0) {
        const legacyUsage = row.exploreTelemetry?.usage;
        if (legacyUsage) {
            const summary = summaries[0];
            const expectedIndices = Array.from(
                { length: legacyUsage.requestCount },
                (_, requestIndex) => requestIndex + 1,
            );
            if (
                summaries.length !== 1 ||
                (legacyUsage.requestCount === 0 &&
                    (row.exploreTelemetry?.status !== "failed" ||
                        !summary.unavailable)) ||
                summary.requestIndices.length !== legacyUsage.requestCount ||
                !summary.requestIndices.every(
                    (requestIndex, offset) =>
                        requestIndex === expectedIndices[offset],
                ) ||
                summary.usage.inputTokens !== legacyUsage.inputTokens ||
                summary.usage.cachedInputTokens !==
                    legacyUsage.cachedInputTokens ||
                summary.usage.cacheWriteTokens !==
                    legacyUsage.cacheWriteTokens ||
                summary.usage.outputTokens !== legacyUsage.outputTokens ||
                summary.usage.reasoningOutputTokens !==
                    legacyUsage.reasoningOutputTokens ||
                summary.usage.totalTokens !== legacyUsage.totalTokens
            ) {
                throw new Error(
                    `${row.variant} Code Mode trajectory request indices and usage must match Explorer telemetry`,
                );
            }
            return;
        }
        if (row.ok) {
            throw new Error(
                `Successful ${row.variant} row is missing Explorer telemetry for Code Mode trajectory validation`,
            );
        }
        if (
            summaries.length === expectedInvocationCount &&
            summaries.every((summary) => summary.unavailable)
        ) {
            return;
        }
        throw new Error(
            `Failed ${row.variant} row has a started Code Mode trajectory but is missing Explorer telemetry`,
        );
    }
    if (summaries.length !== expectedInvocationCount) {
        throw new Error(
            `${row.variant} Code Mode trajectory count must match every attempted execution and Explorer telemetry invocation`,
        );
    }
    const aggregateUsage = invocations.reduce(
        (total, invocation) => ({
            requestCount: total.requestCount + invocation.usage.requestCount,
            inputTokens: total.inputTokens + invocation.usage.inputTokens,
            cachedInputTokens:
                total.cachedInputTokens + invocation.usage.cachedInputTokens,
            cacheWriteTokens:
                total.cacheWriteTokens + invocation.usage.cacheWriteTokens,
            outputTokens: total.outputTokens + invocation.usage.outputTokens,
            reasoningOutputTokens:
                total.reasoningOutputTokens +
                invocation.usage.reasoningOutputTokens,
            totalTokens: total.totalTokens + invocation.usage.totalTokens,
        }),
        {
            requestCount: 0,
            inputTokens: 0,
            cachedInputTokens: 0,
            cacheWriteTokens: 0,
            outputTokens: 0,
            reasoningOutputTokens: 0,
            totalTokens: 0,
        },
    );
    const telemetryUsage = row.exploreTelemetry!.usage;
    if (
        aggregateUsage.requestCount !== telemetryUsage.requestCount ||
        aggregateUsage.inputTokens !== telemetryUsage.inputTokens ||
        aggregateUsage.cachedInputTokens !== telemetryUsage.cachedInputTokens ||
        aggregateUsage.cacheWriteTokens !== telemetryUsage.cacheWriteTokens ||
        aggregateUsage.outputTokens !== telemetryUsage.outputTokens ||
        aggregateUsage.reasoningOutputTokens !==
            telemetryUsage.reasoningOutputTokens ||
        aggregateUsage.totalTokens !== telemetryUsage.totalTokens
    ) {
        throw new Error(
            `${row.variant} Explorer telemetry aggregate usage must equal its invocations`,
        );
    }
    for (const [index, summary] of summaries.entries()) {
        const invocation = invocations[index];
        if (!invocation) {
            if (!row.ok && summary.unavailable) {
                continue;
            }
            throw new Error(
                `${row.variant} Code Mode trajectory invocation ${index + 1} is missing Explorer telemetry`,
            );
        }
        if (invocation.index !== index) {
            throw new Error(
                `${row.variant} Explorer telemetry invocation index must equal its position ${index}`,
            );
        }
        const usage = invocation.usage;
        if (
            usage.requestCount === 0 &&
            invocation.status === "failed" &&
            summary.unavailable
        ) {
            continue;
        }
        const expectedIndices = Array.from(
            { length: usage.requestCount },
            (_, requestIndex) => requestIndex + 1,
        );
        if (
            usage.requestCount === 0 ||
            summary.unavailable ||
            summary.requestIndices.length !== usage.requestCount ||
            !summary.requestIndices.every(
                (requestIndex, requestIndexOffset) =>
                    requestIndex === expectedIndices[requestIndexOffset],
            ) ||
            summary.usage.inputTokens !== usage.inputTokens ||
            summary.usage.cachedInputTokens !== usage.cachedInputTokens ||
            summary.usage.cacheWriteTokens !== usage.cacheWriteTokens ||
            summary.usage.outputTokens !== usage.outputTokens ||
            summary.usage.reasoningOutputTokens !==
                usage.reasoningOutputTokens ||
            summary.usage.totalTokens !== usage.totalTokens
        ) {
            throw new Error(
                `${row.variant} Code Mode trajectory invocation ${index + 1} request indices and usage must match Explorer telemetry`,
            );
        }
    }
}

function emptyTokenUsage(): TokenUsage {
    return {
        inputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 0,
    };
}

function addTrajectoryUsage(
    target: TokenUsage,
    usage: Record<string, unknown>,
): void {
    target.inputTokens += Number(usage.inputTokens);
    target.cachedInputTokens += Number(usage.cachedInputTokens);
    target.cacheWriteTokens += Number(usage.cacheWriteTokens ?? 0);
    target.outputTokens += Number(usage.outputTokens);
    target.reasoningOutputTokens += Number(usage.reasoningOutputTokens);
    target.totalTokens += Number(usage.totalTokens);
}

function validateTrajectoryPath(
    file: string,
    expected: TrajectoryExpectation,
): void {
    const safeRow = safeSegment(expected.rowName);
    const safeModel = modelLabel(expected.model);
    const expectedFile =
        expected.system === "main"
            ? `${expected.variant}${expected.variant === "baseline" ? "" : "-main"}-${safeRow}-${safeModel}.jsonl`
            : `${expected.variant}-codemode-${safeRow}-${safeModel}${(expected.invocationIndex ?? 0) === 0 ? "" : `-invocation-${(expected.invocationIndex ?? 0) + 1}`}.jsonl`;
    const directoryPattern = new RegExp(
        `^${escapeRegExp([safeRow, safeModel, expected.variant, `attempt-${expected.attempt}`].join("--"))}--[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`,
        "u",
    );
    if (
        path.basename(file) !== expectedFile ||
        path.basename(path.dirname(path.dirname(file))) !== "trajectories" ||
        !directoryPattern.test(path.basename(path.dirname(file)))
    ) {
        throw new Error(
            `Trajectory path does not match row, model, arm, attempt, and system identity: ${file}`,
        );
    }
}

function validateUsage(
    file: string,
    line: number,
    usage: Record<string, unknown>,
): void {
    const required = [
        "inputTokens",
        "cachedInputTokens",
        "outputTokens",
        "reasoningOutputTokens",
        "totalTokens",
    ] as const;
    const optional = new Set(["cacheWriteTokens", "durationMs"]);
    const keys = Object.keys(usage);
    if (keys.length === 0) {
        return;
    }
    if (
        required.some((key) => !(key in usage)) ||
        keys.some(
            (key) =>
                !required.includes(key as (typeof required)[number]) &&
                !optional.has(key),
        )
    ) {
        throw new Error(`Trajectory ${file}:${line} has invalid usage fields`);
    }
    for (const [key, value] of Object.entries(usage)) {
        if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
            throw new Error(
                `Trajectory ${file}:${line} has invalid usage value ${key}`,
            );
        }
    }
    if (
        usage.totalTokens !==
        Number(usage.inputTokens) + Number(usage.outputTokens)
    ) {
        throw new Error(
            `Trajectory ${file}:${line} has inconsistent total token usage`,
        );
    }
}

function normalizeUsage(
    usage: Extract<SessionEvent, { type: "assistant.usage" }>["data"],
): NormalizedTrajectoryUsage {
    return {
        inputTokens: usage.inputTokens ?? 0,
        cachedInputTokens: usage.cacheReadTokens ?? 0,
        cacheWriteTokens: usage.cacheWriteTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        reasoningOutputTokens: usage.reasoningTokens ?? 0,
        totalTokens: (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
        ...(usage.duration !== undefined ? { durationMs: usage.duration } : {}),
    };
}

function usageKey(agentId: string | undefined, apiCallId: string): string {
    return `${agentId ?? ""}\0${apiCallId}`;
}

function modelLabel(model: string): string {
    const route = model.split("/").at(-1) ?? model;
    return safeSegment(route.split("-").at(-1) ?? route);
}

function safeSegment(value: string): string {
    return value.replace(/[^A-Za-z0-9_.-]+/g, "-");
}

function expectedSource(
    system: TrajectoryExpectation["system"],
): "copilot-sdk" | "typeagent-codemode" {
    return system === "main" ? "copilot-sdk" : "typeagent-codemode";
}

function stableRecord(
    sequence: number,
    role: NormalizedTrajectoryRecord["role"],
    model: string,
    source: "copilot-sdk" | "typeagent-codemode",
    overrides: Partial<NormalizedTrajectoryRecord>,
): NormalizedTrajectoryRecord {
    return {
        schemaVersion: 1,
        sequence,
        role,
        content: "",
        model,
        tool_call_id: null,
        tool_calls: [],
        usage: {},
        source,
        ...overrides,
    };
}

function completeToolContent(
    event: Extract<SessionEvent, { type: "tool.execution_complete" }>,
): string {
    const contents = event.data.result?.contents;
    if (contents !== undefined) {
        if (
            contents.length === 1 &&
            contents[0].type === "text" &&
            typeof contents[0].text === "string"
        ) {
            return contents[0].text;
        }
        return JSON.stringify(contents);
    }
    return event.data.result?.content ?? event.data.error?.message ?? "";
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function redactDeep<T>(value: T, secrets: readonly string[]): T {
    if (typeof value === "string") {
        let redacted = String(value);
        for (const secret of secrets) {
            if (secret) {
                redacted = redacted.split(secret).join("[REDACTED]");
            }
        }
        return redacted as T;
    }
    if (Array.isArray(value)) {
        return value.map((item) => redactDeep(item, secrets)) as T;
    }
    if (isRecord(value)) {
        return Object.fromEntries(
            Object.entries(value).map(([key, item]) => [
                redactDeep(key, secrets),
                redactDeep(item, secrets),
            ]),
        ) as T;
    }
    return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
