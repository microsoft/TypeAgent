// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    validateMacro,
    type CopilotToolMacro,
    type MacroValidationReport,
} from "@typeagent/copilot-macros";
import type { ProcedureVersion } from "@typeagent/memory-service";
import {
    getProcedureLineage,
    validateProcedure,
} from "./procedureValidation.js";
import type { ArtifactValidationIssue, MacroDraftResult } from "./types.js";

const automationHeading = "automation";

function issue(
    code: string,
    message: string,
    path?: string,
): ArtifactValidationIssue {
    return { code, message, ...(path === undefined ? {} : { path }) };
}

function parseAutomationContent(content: string): unknown {
    const trimmed = content.trim();
    const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/i.exec(trimmed);
    return JSON.parse(fenced?.[1] ?? trimmed) as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isExecutionClass(value: unknown): boolean {
    return value === "replayable" || value === "agentRequired";
}

function validateExpressionShape(
    value: unknown,
    path: string,
): ArtifactValidationIssue[] {
    if (!isRecord(value) || typeof value.kind !== "string") {
        return [
            issue(
                "invalidExpressionShape",
                "A value expression must be an object with a supported kind.",
                path,
            ),
        ];
    }
    if (value.kind === "literal") return [];
    if (value.kind === "input") {
        return typeof value.name === "string"
            ? []
            : [
                  issue(
                      "invalidExpressionShape",
                      "An input expression requires a string name.",
                      `${path}.name`,
                  ),
              ];
    }
    if (value.kind === "stepResult") {
        const validPath =
            value.path === undefined ||
            (Array.isArray(value.path) &&
                value.path.every((part) => typeof part === "string"));
        return typeof value.stepId === "string" && validPath
            ? []
            : [
                  issue(
                      "invalidExpressionShape",
                      "A stepResult expression requires a string stepId and optional string path.",
                      path,
                  ),
              ];
    }
    if (value.kind === "template") {
        if (!Array.isArray(value.bindings)) {
            return [
                issue(
                    "invalidExpressionShape",
                    "A template expression requires a bindings array.",
                    `${path}.bindings`,
                ),
            ];
        }
        return value.bindings.flatMap((binding, index) => {
            const bindingPath = `${path}.bindings[${index}]`;
            if (
                !isRecord(binding) ||
                !Array.isArray(binding.path) ||
                !binding.path.every((part) => typeof part === "string")
            ) {
                return [
                    issue(
                        "invalidExpressionShape",
                        "A template binding requires a string path and expression.",
                        bindingPath,
                    ),
                ];
            }
            return validateExpressionShape(
                binding.expression,
                `${bindingPath}.expression`,
            );
        });
    }
    return [
        issue(
            "invalidExpressionShape",
            `Unsupported value expression kind '${value.kind}'.`,
            `${path}.kind`,
        ),
    ];
}

function validateInputs(value: unknown[]): ArtifactValidationIssue[] {
    return value.flatMap((input, index) => {
        if (
            isRecord(input) &&
            typeof input.name === "string" &&
            typeof input.description === "string" &&
            typeof input.required === "boolean" &&
            typeof input.secret === "boolean"
        ) {
            return [];
        }
        return [
            issue(
                "invalidInput",
                "Each input requires string name/description and boolean required/secret fields.",
                `inputs[${index}]`,
            ),
        ];
    });
}

function validateSteps(value: unknown[]): ArtifactValidationIssue[] {
    return value.flatMap((step, index) => {
        const path = `steps[${index}]`;
        if (
            !isRecord(step) ||
            typeof step.id !== "string" ||
            typeof step.toolName !== "string" ||
            typeof step.sourceToolCallId !== "string" ||
            !isExecutionClass(step.executionClass)
        ) {
            return [
                issue(
                    "invalidStep",
                    "Each step requires string id/toolName/sourceToolCallId fields and a valid executionClass.",
                    path,
                ),
            ];
        }
        return validateExpressionShape(step.arguments, `${path}.arguments`);
    });
}

function validateMacroShape(value: unknown): ArtifactValidationIssue[] {
    if (!isRecord(value)) {
        return [
            issue(
                "invalidAutomationShape",
                "Automation must be a JSON object containing a CopilotToolMacro.",
            ),
        ];
    }
    const errors: ArtifactValidationIssue[] = [];
    const requiredStrings = [
        "macroId",
        "name",
        "description",
        "sourceTraceId",
        "createdAt",
    ];
    for (const field of requiredStrings) {
        if (typeof value[field] !== "string") {
            errors.push(
                issue(
                    "invalidField",
                    `Automation field '${field}' must be a string.`,
                    field,
                ),
            );
        }
    }
    if (value.schemaVersion !== 1) {
        errors.push(
            issue(
                "invalidSchemaVersion",
                "Automation schemaVersion must be 1.",
                "schemaVersion",
            ),
        );
    }
    if (!Number.isSafeInteger(value.version) || (value.version as number) < 1) {
        errors.push(
            issue(
                "invalidVersion",
                "Automation version must be a positive integer.",
                "version",
            ),
        );
    }
    if (!Array.isArray(value.inputs)) {
        errors.push(
            issue(
                "invalidInputs",
                "Automation inputs must be an array.",
                "inputs",
            ),
        );
    } else {
        errors.push(...validateInputs(value.inputs));
    }
    if (!Array.isArray(value.steps)) {
        errors.push(
            issue(
                "invalidSteps",
                "Automation steps must be an array.",
                "steps",
            ),
        );
    } else {
        errors.push(...validateSteps(value.steps));
    }
    if (!Array.isArray(value.warnings)) {
        errors.push(
            issue(
                "invalidWarnings",
                "Automation warnings must be an array.",
                "warnings",
            ),
        );
    } else if (
        !value.warnings.every((warning) => typeof warning === "string")
    ) {
        errors.push(
            issue(
                "invalidWarnings",
                "Every automation warning must be a string.",
                "warnings",
            ),
        );
    }
    if (!isExecutionClass(value.executionClass)) {
        errors.push(
            issue(
                "invalidExecutionClass",
                "Automation executionClass must be 'replayable' or 'agentRequired'.",
                "executionClass",
            ),
        );
    }
    return errors;
}

function safeValidateMacro(
    macro: CopilotToolMacro,
): MacroValidationReport | ArtifactValidationIssue[] {
    try {
        return validateMacro(macro);
    } catch (error) {
        return [
            issue(
                "validatorFailure",
                `Copilot macro validation could not inspect the automation: ${error instanceof Error ? error.message : String(error)}`,
            ),
        ];
    }
}

function lineageTraceId(procedure: ProcedureVersion): string {
    return [
        "procedure",
        encodeURIComponent(procedure.corpusId),
        encodeURIComponent(procedure.procedureId),
        `v${procedure.version}`,
        procedure.jsonHash,
    ].join(":");
}

export function createMacroDraft(
    procedure: ProcedureVersion,
): MacroDraftResult {
    validateProcedure(procedure);
    const lineage = getProcedureLineage(procedure);
    const automation = (procedure.document.additionalSections ?? []).filter(
        (section) =>
            section.heading.trim().toLocaleLowerCase() === automationHeading,
    );
    if (automation.length === 0) {
        return {
            status: "notAvailable",
            reason: "The procedure has no explicit machine-readable Automation section.",
            lineage,
        };
    }
    if (automation.length > 1) {
        return {
            status: "invalid",
            errors: [
                issue(
                    "duplicateAutomation",
                    "The procedure contains multiple Automation sections; keep exactly one.",
                ),
            ],
            lineage,
        };
    }

    let parsed: unknown;
    try {
        parsed = parseAutomationContent(automation[0].content);
    } catch (error) {
        return {
            status: "invalid",
            errors: [
                issue(
                    "invalidAutomationJson",
                    `Automation must contain valid JSON: ${error instanceof Error ? error.message : String(error)}`,
                ),
            ],
            lineage,
        };
    }
    const shapeErrors = validateMacroShape(parsed);
    if (shapeErrors.length > 0) {
        return { status: "invalid", errors: shapeErrors, lineage };
    }
    const macro = {
        ...(parsed as CopilotToolMacro),
        state: "draft" as const,
        sourceTraceId: lineageTraceId(procedure),
    };
    const validation = safeValidateMacro(macro);
    if (Array.isArray(validation)) {
        return { status: "invalid", errors: validation, lineage };
    }
    if (!validation.valid) {
        return {
            status: "invalid",
            errors: validation.issues
                .filter((item) => item.severity === "error")
                .map((item) => issue(item.code, item.message, item.stepId)),
            validation,
            lineage,
        };
    }
    return { status: "ready", macro, validation, lineage };
}
