// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { readFile } from "node:fs/promises";
import type {
    ExploreInvocationTelemetry,
    ExploreTelemetry,
    TypeAgentUsage,
} from "./types.js";

export async function readExploreTelemetry(
    telemetryFile: string,
    expectedModel: string,
): Promise<ExploreTelemetry> {
    let value: unknown;
    try {
        value = JSON.parse(await readFile(telemetryFile, "utf8"));
    } catch (error) {
        throw new Error(
            `Unable to read TypeAgent telemetry ${telemetryFile}: ${(error as Error).message}`,
        );
    }
    const telemetry = recordValue(value);
    if (!telemetry) {
        throw new Error("TypeAgent telemetry must be a JSON object");
    }
    if (
        telemetry.schemaVersion !== 1 &&
        telemetry.schemaVersion !== 2 &&
        telemetry.schemaVersion !== 3 &&
        telemetry.schemaVersion !== 4
    ) {
        throw new Error(
            "TypeAgent telemetry schemaVersion must be 1, 2, 3, or 4",
        );
    }
    const schemaVersion = telemetry.schemaVersion;
    const model = requiredString(telemetry, "model", "telemetry");
    if (model !== expectedModel) {
        throw new Error(
            `TypeAgent telemetry model ${JSON.stringify(model)} does not match expected model ${JSON.stringify(expectedModel)}`,
        );
    }
    if (telemetry.schemaVersion === 1) {
        const invocation = parseExploreInvocation(telemetry, "telemetry", 0, 1);
        return {
            schemaVersion: 1,
            model,
            status: invocation.status,
            usage: invocation.usage,
            toolTrace: invocation.toolTrace,
            ...(invocation.result ? { result: invocation.result } : {}),
            ...(invocation.error ? { error: invocation.error } : {}),
        };
    }
    if (!Array.isArray(telemetry.invocations)) {
        throw new Error("telemetry.invocations must be an array");
    }
    if (telemetry.invocations.length === 0) {
        throw new Error("telemetry.invocations must not be empty");
    }
    const invocations = telemetry.invocations.map((value, index) => {
        const record = recordValue(value);
        if (!record) {
            throw new Error(
                `telemetry.invocations[${index}] must be an object`,
            );
        }
        const invocation = parseExploreInvocation(
            record,
            `telemetry.invocations[${index}]`,
            index,
            schemaVersion,
        );
        if (invocation.index !== index) {
            throw new Error(
                `telemetry.invocations[${index}].index must equal ${index}`,
            );
        }
        return invocation;
    });
    const usage = invocations.reduce<TypeAgentUsage>(
        (total, invocation) => ({
            requestCount: total.requestCount + invocation.usage.requestCount,
            usageComplete:
                total.usageComplete !== false &&
                invocation.usage.usageComplete !== false,
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
            usageComplete: true,
            inputTokens: 0,
            cachedInputTokens: 0,
            cacheWriteTokens: 0,
            outputTokens: 0,
            reasoningOutputTokens: 0,
            totalTokens: 0,
        },
    );
    const calls = invocations.flatMap(
        (invocation) => invocation.toolTrace.calls,
    );
    const failures = invocations.filter(
        (invocation) => invocation.status === "failed",
    );
    return {
        schemaVersion,
        model,
        status: failures.length === 0 ? "completed" : "failed",
        usage,
        toolTrace: {
            calls,
            totalCalls: calls.length,
            totalOutputBytes: invocations.reduce(
                (total, invocation) =>
                    total + invocation.toolTrace.totalOutputBytes,
                0,
            ),
        },
        invocations,
        ...(invocations.length === 1 && invocations[0].result
            ? { result: invocations[0].result }
            : {}),
        ...(failures.length > 0
            ? {
                  error: failures
                      .map((invocation) => invocation.error)
                      .filter((error): error is string => Boolean(error))
                      .join("; ")
                      .slice(0, 2_000),
              }
            : {}),
    };
}

function parseExploreInvocation(
    telemetry: Record<string, unknown>,
    context: string,
    fallbackIndex: number,
    schemaVersion: 1 | 2 | 3 | 4,
): ExploreInvocationTelemetry {
    const status = telemetry.status;
    if (status !== "completed" && status !== "failed") {
        throw new Error(`${context}.status must be 'completed' or 'failed'`);
    }
    const usage = parseTypeAgentUsage(
        requiredRecord(telemetry, "usage", context),
        `${context}.usage`,
    );
    const translationUsage =
        schemaVersion === 3
            ? parseTypeAgentUsage(
                  requiredRecord(telemetry, "translationUsage", context),
                  `${context}.translationUsage`,
                  true,
              )
            : undefined;
    const codeModeUsage =
        schemaVersion === 3
            ? parseTypeAgentUsage(
                  requiredRecord(telemetry, "codeModeUsage", context),
                  `${context}.codeModeUsage`,
              )
            : undefined;
    const actionTranslationAndCodeGenerationUsage =
        schemaVersion === 4
            ? parseTypeAgentUsage(
                  requiredRecord(
                      telemetry,
                      "actionTranslationAndCodeGenerationUsage",
                      context,
                  ),
                  `${context}.actionTranslationAndCodeGenerationUsage`,
              )
            : undefined;
    if (
        translationUsage &&
        codeModeUsage &&
        !usageEquals(usage, addTypeAgentUsage(translationUsage, codeModeUsage))
    ) {
        throw new Error(
            `${context}.usage must equal translationUsage plus codeModeUsage`,
        );
    }
    if (
        actionTranslationAndCodeGenerationUsage &&
        !usageEquals(usage, actionTranslationAndCodeGenerationUsage)
    ) {
        throw new Error(
            `${context}.usage must equal actionTranslationAndCodeGenerationUsage`,
        );
    }
    const toolTraceValue = requiredRecord(telemetry, "toolTrace", context);
    const toolTraceContext = `${context}.toolTrace`;
    if (!Array.isArray(toolTraceValue.calls)) {
        throw new Error(`${toolTraceContext}.calls must be an array`);
    }
    const calls = toolTraceValue.calls.map((call, index) => {
        const callContext = `${toolTraceContext}.calls[${index}]`;
        const record = recordValue(call);
        if (!record) {
            throw new Error(`${callContext} must be an object`);
        }
        return parseTypeAgentToolCall(record, callContext);
    });
    const totalCalls = requiredNonNegativeNumber(
        toolTraceValue,
        "totalCalls",
        toolTraceContext,
    );
    if (totalCalls !== calls.length) {
        throw new Error(
            `${toolTraceContext}.totalCalls must equal calls.length`,
        );
    }
    const resultValue = recordValue(telemetry.result);
    const result = resultValue
        ? {
              citationCount: requiredNonNegativeNumber(
                  resultValue,
                  "citationCount",
                  `${context}.result`,
              ),
              truncated: requiredBoolean(
                  resultValue,
                  "truncated",
                  `${context}.result`,
              ),
          }
        : undefined;
    const error =
        typeof telemetry.error === "string" ? telemetry.error : undefined;
    const reasoningTrace =
        schemaVersion === 4 && telemetry.reasoningTrace !== undefined
            ? parseReasoningTrace(telemetry.reasoningTrace, context)
            : undefined;
    const actionAttempts =
        schemaVersion === 4 && telemetry.actionAttempts !== undefined
            ? parseActionAttempts(telemetry.actionAttempts, context)
            : undefined;
    const submissionAction = optionalSubmissionAction(
        telemetry.submissionAction,
        context,
    );
    return {
        index:
            telemetry.index === undefined
                ? fallbackIndex
                : requiredNonNegativeNumber(telemetry, "index", context),
        status,
        usage,
        ...(translationUsage ? { translationUsage } : {}),
        ...(codeModeUsage ? { codeModeUsage } : {}),
        ...(actionTranslationAndCodeGenerationUsage
            ? { actionTranslationAndCodeGenerationUsage }
            : {}),
        toolTrace: {
            calls,
            totalCalls,
            totalOutputBytes: requiredNonNegativeNumber(
                toolTraceValue,
                "totalOutputBytes",
                toolTraceContext,
            ),
        },
        ...(reasoningTrace ? { reasoningTrace } : {}),
        ...(actionAttempts ? { actionAttempts } : {}),
        ...(submissionAction ? { submissionAction } : {}),
        ...(result ? { result } : {}),
        ...(error ? { error } : {}),
    };
}

function optionalSubmissionAction(
    value: unknown,
    context: string,
): "refineRepository" | "submitExploration" | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (value !== "refineRepository" && value !== "submitExploration") {
        throw new Error(
            `${context}.submissionAction must be 'refineRepository' or 'submitExploration'`,
        );
    }
    return value;
}

function parseReasoningTrace(
    value: unknown,
    context: string,
): NonNullable<ExploreInvocationTelemetry["reasoningTrace"]> {
    if (!Array.isArray(value)) {
        throw new Error(`${context}.reasoningTrace must be an array`);
    }
    return value.map((item, index) => {
        const itemContext = `${context}.reasoningTrace[${index}]`;
        const record = recordValue(item);
        if (!record) {
            throw new Error(`${itemContext} must be an object`);
        }
        const status = requiredAttemptStatus(record, itemContext);
        const actionName = optionalString(record.actionName);
        const error = optionalString(record.error);
        return {
            index: requiredNonNegativeNumber(record, "index", itemContext),
            tool: requiredString(record, "tool", itemContext),
            status,
            ...(actionName ? { actionName } : {}),
            ...(error ? { error } : {}),
        };
    });
}

function parseActionAttempts(
    value: unknown,
    context: string,
): NonNullable<ExploreInvocationTelemetry["actionAttempts"]> {
    if (!Array.isArray(value)) {
        throw new Error(`${context}.actionAttempts must be an array`);
    }
    return value.map((item, index) => {
        const itemContext = `${context}.actionAttempts[${index}]`;
        const record = recordValue(item);
        if (!record) {
            throw new Error(`${itemContext} must be an object`);
        }
        const error = optionalString(record.error);
        return {
            index: requiredNonNegativeNumber(record, "index", itemContext),
            actionName: requiredString(record, "actionName", itemContext),
            status: requiredAttemptStatus(record, itemContext),
            ...(error ? { error } : {}),
        };
    });
}

function requiredAttemptStatus(
    value: Record<string, unknown>,
    context: string,
): "completed" | "failed" {
    if (value.status !== "completed" && value.status !== "failed") {
        throw new Error(`${context}.status must be 'completed' or 'failed'`);
    }
    return value.status;
}

function optionalString(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}

function parseTypeAgentUsage(
    usageValue: Record<string, unknown>,
    usageContext: string,
    allowZero = false,
): TypeAgentUsage {
    const usage: TypeAgentUsage = {
        requestCount: requiredNonNegativeNumber(
            usageValue,
            "requestCount",
            usageContext,
            !allowZero,
        ),
        usageComplete:
            usageValue.usageComplete === undefined
                ? true
                : requiredBoolean(usageValue, "usageComplete", usageContext),
        inputTokens: requiredNonNegativeNumber(
            usageValue,
            "inputTokens",
            usageContext,
        ),
        cachedInputTokens: optionalNonNegativeNumber(
            usageValue,
            "cachedInputTokens",
            usageContext,
        ),
        cacheWriteTokens: 0,
        outputTokens: requiredNonNegativeNumber(
            usageValue,
            "outputTokens",
            usageContext,
        ),
        reasoningOutputTokens: optionalNonNegativeNumber(
            usageValue,
            "reasoningOutputTokens",
            usageContext,
        ),
        totalTokens: requiredNonNegativeNumber(
            usageValue,
            "totalTokens",
            usageContext,
            !allowZero,
        ),
    };
    if (usage.totalTokens !== usage.inputTokens + usage.outputTokens) {
        throw new Error(
            `${usageContext}.totalTokens must equal inputTokens plus outputTokens`,
        );
    }
    if (
        usage.requestCount === 0 &&
        (usage.inputTokens !== 0 ||
            usage.outputTokens !== 0 ||
            usage.totalTokens !== 0)
    ) {
        throw new Error(
            `${usageContext} with zero requests must have zero tokens`,
        );
    }
    return usage;
}

function addTypeAgentUsage(
    first: TypeAgentUsage,
    second: TypeAgentUsage,
): TypeAgentUsage {
    return {
        requestCount: first.requestCount + second.requestCount,
        usageComplete:
            first.usageComplete !== false && second.usageComplete !== false,
        inputTokens: first.inputTokens + second.inputTokens,
        cachedInputTokens: first.cachedInputTokens + second.cachedInputTokens,
        cacheWriteTokens: first.cacheWriteTokens + second.cacheWriteTokens,
        outputTokens: first.outputTokens + second.outputTokens,
        reasoningOutputTokens:
            first.reasoningOutputTokens + second.reasoningOutputTokens,
        totalTokens: first.totalTokens + second.totalTokens,
    };
}

function usageEquals(first: TypeAgentUsage, second: TypeAgentUsage): boolean {
    return (
        first.requestCount === second.requestCount &&
        (first.usageComplete !== false) === (second.usageComplete !== false) &&
        first.inputTokens === second.inputTokens &&
        first.cachedInputTokens === second.cachedInputTokens &&
        first.cacheWriteTokens === second.cacheWriteTokens &&
        first.outputTokens === second.outputTokens &&
        first.reasoningOutputTokens === second.reasoningOutputTokens &&
        first.totalTokens === second.totalTokens
    );
}

function parseTypeAgentToolCall(
    record: Record<string, unknown>,
    context: string,
): ExploreInvocationTelemetry["toolTrace"]["calls"][number] {
    const tool = requiredString(record, "tool", context);
    if (!new Set(["ls", "glob", "grep", "read", "lsp"]).has(tool)) {
        throw new Error(`${context}.tool is not a repository exploration tool`);
    }
    const executionRecord = recordValue(record.execution);
    const execution = executionRecord
        ? {
              engine: requiredString(
                  executionRecord,
                  "engine",
                  `${context}.execution`,
              ),
              executable: requiredString(
                  executionRecord,
                  "executable",
                  `${context}.execution`,
              ),
          }
        : undefined;
    if (execution && execution.engine !== "ripgrep") {
        throw new Error(`${context}.execution.engine must be ripgrep`);
    }
    return {
        tool,
        ...(typeof record.startedAt === "string"
            ? { startedAt: record.startedAt }
            : {}),
        durationMs: requiredNonNegativeNumber(record, "durationMs", context),
        input: record.input,
        ...(execution
            ? {
                  execution: {
                      engine: execution.engine,
                      executable: execution.executable,
                  },
              }
            : {}),
        resultCount: requiredNonNegativeNumber(record, "resultCount", context),
        outputBytes: requiredNonNegativeNumber(record, "outputBytes", context),
        truncated: requiredBoolean(record, "truncated", context),
        ...(typeof record.error === "string" ? { error: record.error } : {}),
    };
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

function requiredRecord(
    value: Record<string, unknown>,
    key: string,
    parent: string,
): Record<string, unknown> {
    const result = recordValue(value[key]);
    if (!result) {
        throw new Error(`${parent}.${key} must be an object`);
    }
    return result;
}

function requiredString(
    value: Record<string, unknown>,
    key: string,
    parent: string,
): string {
    const result = value[key];
    if (typeof result !== "string" || !result) {
        throw new Error(`${parent}.${key} must be a non-empty string`);
    }
    return result;
}

function requiredBoolean(
    value: Record<string, unknown>,
    key: string,
    parent: string,
): boolean {
    const result = value[key];
    if (typeof result !== "boolean") {
        throw new Error(`${parent}.${key} must be a boolean`);
    }
    return result;
}

function requiredNonNegativeNumber(
    value: Record<string, unknown>,
    key: string,
    parent: string,
    positive = false,
): number {
    const result = value[key];
    if (
        typeof result !== "number" ||
        !Number.isFinite(result) ||
        !Number.isInteger(result) ||
        result < (positive ? 1 : 0)
    ) {
        throw new Error(
            `${parent}.${key} must be a ${positive ? "positive" : "non-negative"} integer`,
        );
    }
    return result;
}

function optionalNonNegativeNumber(
    value: Record<string, unknown>,
    key: string,
    parent: string,
): number {
    return value[key] === undefined
        ? 0
        : requiredNonNegativeNumber(value, key, parent);
}
