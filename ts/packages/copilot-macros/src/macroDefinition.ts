// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    CopilotToolMacro,
    MacroExecutionClass,
    MacroInput,
    MacroPostcondition,
    MacroStep,
    MacroValueType,
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

function getValueType(value: unknown): MacroValueType {
    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    return typeof value as Exclude<MacroValueType, "null" | "array">;
}

function getInputName(stepId: string, path: string[]): string {
    const suffix = path
        .map((segment) => segment.replace(/[^a-zA-Z0-9]+/g, "_"))
        .filter(Boolean)
        .join("_");
    return `${stepId.replace(/-/g, "_")}_${suffix || "value"}`;
}

function findValuePath(root: unknown, target: unknown): string[] | undefined {
    if (Object.is(root, target)) return [];
    if (root === null || typeof root !== "object") return undefined;
    for (const [key, child] of Object.entries(root)) {
        const nested = findValuePath(child, target);
        if (nested !== undefined) return [key, ...nested];
    }
    return undefined;
}

function collectLeafPaths(value: unknown, path: string[] = []): string[][] {
    if (value === null || typeof value !== "object") return [path];
    return Object.entries(value).flatMap(([key, child]) =>
        collectLeafPaths(child, [...path, key]),
    );
}

function inferPostconditions(result: unknown): MacroPostcondition[] {
    const postconditions: MacroPostcondition[] = [
        { kind: "resultType", valueType: getValueType(result) },
    ];
    if (result !== null && typeof result === "object") {
        for (const path of collectLeafPaths(result).slice(0, 50)) {
            if (path.length > 0) {
                postconditions.push({ kind: "resultPathExists", path });
            }
        }
    }
    return postconditions;
}

type BoundValueExpression = Exclude<ValueExpression, { kind: "template" }>;

function findPriorResultExpression(
    leaf: unknown,
    priorSteps: MacroStep[],
    priorCalls: RecordedInteractionTrace["toolCalls"],
): BoundValueExpression | undefined {
    if (typeof leaf !== "string" || leaf === "[REDACTED]" || leaf.length < 3) {
        return undefined;
    }
    for (let index = priorCalls.length - 1; index >= 0; index--) {
        const resultPath = findValuePath(priorCalls[index].result, leaf);
        if (resultPath !== undefined) {
            return {
                kind: "stepResult",
                stepId: priorSteps[index].id,
                ...(resultPath.length > 0 ? { path: resultPath } : {}),
            };
        }
    }
    return undefined;
}

function createInputExpression(
    leaf: unknown,
    stepId: string,
    path: string[],
    prompt: string,
    inputs: MacroInput[],
    warnings: string[],
): BoundValueExpression | undefined {
    const redacted = leaf === "[REDACTED]";
    const mentionedInPrompt =
        typeof leaf === "string" &&
        leaf.length >= 3 &&
        prompt.toLowerCase().includes(leaf.toLowerCase());
    if (!redacted && !mentionedInPrompt) return undefined;

    const name = getInputName(stepId, path);
    inputs.push({
        name,
        description: redacted
            ? `Secret value required by ${stepId} at ${path.join(".") || "arguments"}`
            : `Value captured from the request for ${stepId} at ${path.join(".") || "arguments"}`,
        required: true,
        secret: redacted,
        ...(redacted ? {} : { valueType: getValueType(leaf) }),
    });
    if (redacted) {
        warnings.push(
            `${stepId} contains a redacted value and requires review of the generated secret input.`,
        );
    }
    return { kind: "input", name };
}

function convertArguments(
    value: unknown,
    stepId: string,
    prompt: string,
    priorSteps: MacroStep[],
    priorCalls: RecordedInteractionTrace["toolCalls"],
    inputs: MacroInput[],
    warnings: string[],
): ValueExpression {
    if (value === undefined) {
        return { kind: "literal", value: {} };
    }
    const bindings: Extract<ValueExpression, { kind: "template" }>["bindings"] =
        [];
    for (const path of collectLeafPaths(value)) {
        let leaf: unknown = value;
        for (const segment of path) {
            leaf = (leaf as Record<string, unknown>)[segment];
        }
        const expression =
            findPriorResultExpression(leaf, priorSteps, priorCalls) ??
            createInputExpression(leaf, stepId, path, prompt, inputs, warnings);
        if (expression) bindings.push({ path, expression });
    }
    return bindings.length === 0
        ? { kind: "literal", value }
        : { kind: "template", value, bindings };
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
    const steps: MacroStep[] = [];
    trace.toolCalls.forEach((call, index) => {
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
        steps.push({
            id,
            toolName: call.name,
            ...(call.mcpServerName
                ? { mcpServerName: call.mcpServerName }
                : {}),
            arguments: convertArguments(
                call.arguments,
                id,
                trace.prompt,
                steps,
                trace.toolCalls.slice(0, index),
                inputs,
                warnings,
            ),
            executionClass,
            sourceToolCallId: call.toolCallId,
            ...(call.result === undefined
                ? {}
                : { postconditions: inferPostconditions(call.result) }),
        });
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
    if (expression.kind === "template") {
        if (expression.bindings.length === 0) {
            return "A template expression requires at least one binding.";
        }
        for (const binding of expression.bindings) {
            if (binding.path.length === 0) {
                return "A template binding requires a non-empty path.";
            }
            let target = expression.value;
            for (const segment of binding.path) {
                if (
                    target === null ||
                    typeof target !== "object" ||
                    !Object.prototype.hasOwnProperty.call(target, segment)
                ) {
                    return `Template binding path is unavailable: ${binding.path.join(".")}`;
                }
                target = (target as Record<string, unknown>)[segment];
            }
            const error = validateExpression(
                binding.expression,
                macro,
                stepIndex,
            );
            if (error) return error;
        }
        return undefined;
    }
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
        if (
            step.postconditions?.some(
                (condition) =>
                    condition.kind === "resultPathExists" &&
                    condition.path.length === 0,
            )
        ) {
            issues.push({
                severity: "error",
                code: "invalidPostcondition",
                message:
                    "A result path postcondition requires a non-empty path.",
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
