// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    RunbookBindingCatalog,
    RunbookBindingSuggestion,
    RunbookBindingSuggestionRequest,
    RunbookBindingTarget,
} from "@typeagent/agent-server-protocol";

function object(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
}

function fit(
    request: RunbookBindingSuggestionRequest,
    target: RunbookBindingTarget,
) {
    const inputs = object(request.inputSchema.properties);
    const targetInputs = object(target.inputSchema.properties);
    const required = Array.isArray(target.inputSchema.required)
        ? target.inputSchema.required
        : [];
    const missing = required.filter(
        (name) => typeof name !== "string" || !(name in inputs),
    );
    const mismatched = Object.entries(targetInputs).filter(([name, schema]) => {
        const expected = object(schema).type;
        const supplied = object(inputs[name]).type;
        return (
            name in inputs && expected !== undefined && expected !== supplied
        );
    });
    return { missing, mismatched };
}

// Metadata ranking, not JSON Schema validation or authority to accept/execute.
export function rankRunbookBindings(
    request: RunbookBindingSuggestionRequest,
    catalog: RunbookBindingCatalog,
): { suggestions: RunbookBindingSuggestion[]; notices: string[] } {
    const suggestions = catalog.targets.flatMap(
        (target): RunbookBindingSuggestion[] => {
            const { missing, mismatched } = fit(request, target);
            if (missing.length > 0 || mismatched.length > 0) return [];
            const exact =
                JSON.stringify(request.inputSchema) ===
                JSON.stringify(target.inputSchema);
            return [
                {
                    kind: target.kind,
                    target,
                    schemaFit: exact ? "exact" : "partial",
                    reasons: [
                        target.kind === "mcp"
                            ? "Registered current MCP tool."
                            : "Current approved replayable automation.",
                        exact
                            ? "Input schema matches exactly."
                            : "Required input names and declared types fit; author must review remaining schema constraints.",
                        "Explicit author and safety confirmation plus current catalog revalidation are required.",
                    ],
                },
            ];
        },
    );
    suggestions.sort(
        (left, right) =>
            (left.kind === "mcp" ? 1 : 0) - (right.kind === "mcp" ? 1 : 0) ||
            (left.schemaFit === "exact" ? 0 : 1) -
                (right.schemaFit === "exact" ? 0 : 1),
    );
    if (request.commandText?.trim()) {
        suggestions.push({
            kind: "commandText",
            schemaFit: "manual",
            reasons: [
                "Command text is a non-executable fallback requiring manual author review.",
            ],
        });
    }
    suggestions.push({
        kind: "manual",
        schemaFit: "manual",
        reasons: [
            "Keep this step manual; no executable target is selected or approved.",
        ],
    });
    return { suggestions, notices: catalog.notices };
}
