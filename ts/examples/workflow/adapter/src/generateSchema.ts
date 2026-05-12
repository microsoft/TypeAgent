// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    parseToolsJsonSchema,
    toPascalCase,
    toJSONParsedActionSchema,
} from "@typeagent/action-schema";
import { SchemaContent } from "@typeagent/agent-sdk";
import { WorkflowIR } from "workflow-model";

/**
 * Convert a workflow name to a PascalCase TypeScript type name.
 * "d1-standup-prep" -> "D1StandupPrepAction"
 */
export function toTypeName(name: string): string {
    return toPascalCase(name) + "Action";
}

/**
 * Generate a dynamic schema from discovered workflows.
 * Returns a parsed action schema in "pas" format, or undefined
 * if no workflows are loaded (falls back to the static schema).
 */
export function generateDynamicSchema(
    workflows: Map<string, WorkflowIR>,
): SchemaContent | undefined {
    if (workflows.size === 0) {
        return undefined;
    }

    const tools = [...workflows.values()].map((ir) => ({
        name: ir.name,
        description: ir.description,
        inputSchema: ir.inputSchema,
    }));

    const parsed = parseToolsJsonSchema(tools, "WorkflowAction", {
        nameTransform: toTypeName,
    });

    return {
        format: "pas",
        content: JSON.stringify(toJSONParsedActionSchema(parsed)),
    };
}
