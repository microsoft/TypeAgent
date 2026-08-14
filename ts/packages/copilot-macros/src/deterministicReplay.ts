import type {
    CopilotToolMacro,
    MacroRunRecord,
    MacroRunStep,
    ReplayToolDescriptor,
    ReplayToolContext,
    ReplayToolHost,
    ValueExpression,
} from "./contracts.js";

export class ReplayValidationError extends Error {
    constructor(
        readonly code: string,
        message: string,
    ) {
        super(message);
    }
}

function resolveExpression(
    expression: ValueExpression,
    inputs: Record<string, unknown>,
    results: ReadonlyMap<string, unknown>,
): unknown {
    if (expression.kind === "literal") return expression.value;
    if (expression.kind === "input") {
        if (!Object.prototype.hasOwnProperty.call(inputs, expression.name)) {
            throw new ReplayValidationError(
                "missingInput",
                `Required macro input is missing: ${expression.name}`,
            );
        }
        return inputs[expression.name];
    }
    if (!results.has(expression.stepId)) {
        throw new ReplayValidationError(
            "missingStepResult",
            `Step result is unavailable: ${expression.stepId}`,
        );
    }
    let value = results.get(expression.stepId);
    for (const segment of expression.path ?? []) {
        if (value === null || typeof value !== "object") {
            throw new ReplayValidationError(
                "invalidStepResultPath",
                `Step result path is unavailable: ${expression.stepId}.${segment}`,
            );
        }
        const record = value as Record<string, unknown>;
        if (!Object.prototype.hasOwnProperty.call(record, segment)) {
            throw new ReplayValidationError(
                "invalidStepResultPath",
                `Step result path is unavailable: ${expression.stepId}.${segment}`,
            );
        }
        value = record[segment];
    }
    return value;
}

function isAbort(error: unknown, signal: AbortSignal): boolean {
    return (
        signal.aborted ||
        (error instanceof Error && error.name === "AbortError")
    );
}

export async function inspectReplayTools(
    macro: CopilotToolMacro,
    host: ReplayToolHost,
    context: ReplayToolContext = {},
    inputs: Record<string, unknown> = {},
): Promise<Map<string, ReplayToolDescriptor>> {
    if (macro.state !== "approved") {
        throw new ReplayValidationError(
            "macroNotApproved",
            "Only approved macros can be replayed.",
        );
    }
    if (macro.executionClass !== "replayable") {
        throw new ReplayValidationError(
            "agentRequired",
            "This macro requires agent-guided execution.",
        );
    }
    for (const input of macro.inputs) {
        if (
            input.required &&
            !Object.prototype.hasOwnProperty.call(inputs, input.name)
        ) {
            throw new ReplayValidationError(
                "missingInput",
                `Required macro input is missing: ${input.name}`,
            );
        }
    }
    const descriptors = new Map<string, ReplayToolDescriptor>();
    for (const step of macro.steps) {
        if (step.executionClass !== "replayable") {
            throw new ReplayValidationError(
                "agentRequired",
                `Step requires agent-guided execution: ${step.id}`,
            );
        }
        if (
            step.arguments.kind === "input" &&
            !Object.prototype.hasOwnProperty.call(inputs, step.arguments.name)
        ) {
            throw new ReplayValidationError(
                "missingInput",
                `Required macro input is missing: ${step.arguments.name}`,
            );
        }
        const descriptor = await host.inspectTool(
            step.mcpServerName,
            step.toolName,
            context,
        );
        if (!descriptor) {
            throw new ReplayValidationError(
                "toolUnavailable",
                `Replay tool is unavailable: ${step.mcpServerName ?? "native"}/${step.toolName}`,
            );
        }
        if (
            step.schemaFingerprint !== undefined &&
            step.schemaFingerprint !== descriptor.schemaFingerprint
        ) {
            throw new ReplayValidationError(
                "schemaDrift",
                `Replay tool schema changed after approval: ${step.mcpServerName ?? "native"}/${step.toolName}`,
            );
        }
        descriptors.set(step.id, descriptor);
    }
    return descriptors;
}

export async function replayMacro(
    macro: CopilotToolMacro,
    runId: string,
    inputs: Record<string, unknown>,
    host: ReplayToolHost,
    signal: AbortSignal,
    context: ReplayToolContext = {},
    now: () => string = () => new Date().toISOString(),
): Promise<MacroRunRecord> {
    const startedAt = now();
    await inspectReplayTools(macro, host, context, inputs);
    const results = new Map<string, unknown>();
    const steps: MacroRunStep[] = [];
    for (const step of macro.steps) {
        const stepStartedAt = now();
        try {
            signal.throwIfAborted();
            const argumentsValue = resolveExpression(
                step.arguments,
                inputs,
                results,
            );
            const result = await host.callTool(
                step.mcpServerName,
                step.toolName,
                argumentsValue,
                signal,
                context,
            );
            results.set(step.id, result);
            steps.push({
                stepId: step.id,
                toolName: step.toolName,
                ...(step.mcpServerName
                    ? { mcpServerName: step.mcpServerName }
                    : {}),
                status: "completed",
                result,
                startedAt: stepStartedAt,
                completedAt: now(),
            });
        } catch (error) {
            const cancelled = isAbort(error, signal);
            steps.push({
                stepId: step.id,
                toolName: step.toolName,
                ...(step.mcpServerName
                    ? { mcpServerName: step.mcpServerName }
                    : {}),
                status: cancelled ? "cancelled" : "failed",
                error: error instanceof Error ? error.message : String(error),
                startedAt: stepStartedAt,
                completedAt: now(),
            });
            return {
                runId,
                macroId: macro.macroId,
                version: macro.version,
                status: cancelled ? "cancelled" : "failed",
                executionClass: macro.executionClass,
                inputs,
                steps,
                startedAt,
                completedAt: now(),
                error: {
                    code:
                        error instanceof ReplayValidationError
                            ? error.code
                            : cancelled
                              ? "cancelled"
                              : "toolCallFailed",
                    message:
                        error instanceof Error ? error.message : String(error),
                },
            };
        }
    }
    return {
        runId,
        macroId: macro.macroId,
        version: macro.version,
        status: "completed",
        executionClass: macro.executionClass,
        inputs,
        steps,
        startedAt,
        completedAt: now(),
        ...(steps.length > 0 ? { result: steps.at(-1)?.result } : {}),
    };
}
