import type {
    CopilotToolMacro,
    MacroExecutionClass,
    MacroInput,
    MacroStep,
    MacroValidationIssue,
    MacroValidationReport,
    RecordedInteractionTrace,
    ValueExpression,
} from "./contracts.js";

function classifyTool(
    _toolName: string,
    mcpServerName: string | undefined,
): MacroExecutionClass {
    return mcpServerName ? "replayable" : "agentRequired";
}

function convertArguments(
    value: unknown,
    stepId: string,
    inputs: MacroInput[],
    warnings: string[],
): ValueExpression {
    if (value === undefined) {
        return { kind: "literal", value: {} };
    }
    const serialized = JSON.stringify(value);
    if (serialized?.includes("[REDACTED]")) {
        const inputName = `${stepId}_secret`;
        inputs.push({
            name: inputName,
            description: `Secret value required by ${stepId}`,
            required: true,
            secret: true,
        });
        warnings.push(
            `${stepId} contains a redacted value and requires review of the generated secret input.`,
        );
        return { kind: "input", name: inputName };
    }
    return { kind: "literal", value };
}

export function induceMacroFromTrace(
    traceId: string,
    trace: RecordedInteractionTrace,
    macroId: string,
    name: string,
    description: string,
    createdAt: string,
): CopilotToolMacro {
    const warnings: string[] = [];
    const inputs: MacroInput[] = [];
    const steps: MacroStep[] = trace.toolCalls.map((call, index) => {
        const id = `step-${index + 1}`;
        const executionClass = classifyTool(call.name, call.mcpServerName);
        if (executionClass === "agentRequired") {
            warnings.push(
                `${id} uses ${call.mcpServerName ? `${call.mcpServerName}/` : ""}${call.name} and requires agent-guided execution.`,
            );
        }
        if (call.status !== "completed") {
            warnings.push(
                `${id} was captured with status ${call.status} and requires review.`,
            );
        }
        return {
            id,
            toolName: call.name,
            ...(call.mcpServerName
                ? { mcpServerName: call.mcpServerName }
                : {}),
            arguments: convertArguments(call.arguments, id, inputs, warnings),
            executionClass,
            sourceToolCallId: call.toolCallId,
        };
    });

    return {
        schemaVersion: 1,
        macroId,
        version: 1,
        name,
        description,
        state: "draft",
        executionClass: steps.every(
            (step) => step.executionClass === "replayable",
        )
            ? "replayable"
            : "agentRequired",
        inputs,
        steps,
        sourceTraceId: traceId,
        createdAt,
        warnings,
    };
}

function validateExpression(
    expression: ValueExpression,
    macro: CopilotToolMacro,
    stepIndex: number,
): string | undefined {
    if (expression.kind === "input") {
        return macro.inputs.some((input) => input.name === expression.name)
            ? undefined
            : `Unknown input: ${expression.name}`;
    }
    if (expression.kind === "stepResult") {
        const referencedIndex = macro.steps.findIndex(
            (step) => step.id === expression.stepId,
        );
        if (referencedIndex < 0) return `Unknown step: ${expression.stepId}`;
        if (referencedIndex >= stepIndex) {
            return `Step result must reference an earlier step: ${expression.stepId}`;
        }
    }
    return undefined;
}

export function validateMacro(
    macro: CopilotToolMacro,
    trace?: RecordedInteractionTrace,
): MacroValidationReport {
    const issues: MacroValidationIssue[] = [];
    if (!macro.name.trim()) {
        issues.push({
            severity: "error",
            code: "missingName",
            message: "Macro name is required.",
        });
    }
    if (macro.steps.length === 0) {
        issues.push({
            severity: "error",
            code: "emptyMacro",
            message: "A macro must contain at least one step.",
        });
    }
    const stepIds = new Set<string>();
    macro.steps.forEach((step, index) => {
        if (stepIds.has(step.id)) {
            issues.push({
                severity: "error",
                code: "duplicateStepId",
                message: `Duplicate step ID: ${step.id}`,
                stepId: step.id,
            });
        }
        stepIds.add(step.id);
        const expressionError = validateExpression(
            step.arguments,
            macro,
            index,
        );
        if (expressionError) {
            issues.push({
                severity: "error",
                code: "invalidExpression",
                message: expressionError,
                stepId: step.id,
            });
        }
        const sourceCall = trace?.toolCalls.find(
            (call) => call.toolCallId === step.sourceToolCallId,
        );
        if (sourceCall && sourceCall.status !== "completed") {
            issues.push({
                severity: "error",
                code: "unsuccessfulSourceStep",
                message: `Source tool call ended with status ${sourceCall.status}.`,
                stepId: step.id,
            });
        }
    });
    for (const warning of macro.warnings) {
        issues.push({
            severity: "warning",
            code: "reviewRequired",
            message: warning,
        });
    }
    return {
        macroId: macro.macroId,
        version: macro.version,
        valid: !issues.some((issue) => issue.severity === "error"),
        executionClass: macro.executionClass,
        issues,
    };
}
