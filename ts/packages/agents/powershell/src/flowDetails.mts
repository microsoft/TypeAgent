// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { PowerShellFlowDefinition } from "./store/powerShellStore.mjs";

export function formatPowerShellFlowDetails(
    flow: PowerShellFlowDefinition,
    script: string | null,
    usageCount: number,
): string {
    const paramLines = flow.parameters.map(
        (parameter) =>
            `    ${parameter.name} (${parameter.type}${parameter.required ? ", required" : ""}): ${parameter.description}${parameter.default !== undefined ? ` [default: ${parameter.default}]` : ""}`,
    );
    const grammarLines = flow.grammarPatterns.map(
        (pattern) =>
            `    "${pattern.pattern}"${pattern.isAlias ? " (alias)" : ""}`,
    );
    const cmdletList = flow.sandbox.allowedCmdlets.join(", ");

    return [
        `Flow: ${flow.actionName}`,
        `Description: ${flow.description}`,
        `Display Name: ${flow.displayName}`,
        `Source: ${flow.source?.type ?? "unknown"}`,
        `Usage Count: ${usageCount}`,
        "",
        "Parameters:",
        paramLines.length > 0 ? paramLines.join("\n") : "    (none)",
        "",
        "Grammar Patterns:",
        grammarLines.length > 0 ? grammarLines.join("\n") : "    (none)",
        "",
        "Sandbox:",
        `    Cmdlets: ${cmdletList || "(none)"}`,
        `    Timeout: ${flow.sandbox.maxExecutionTime}s`,
        `    Network: ${flow.sandbox.networkAccess ? "allowed" : "blocked"}`,
        "",
        "Script:",
        "```powershell",
        script ?? "(script not found)",
        "```",
    ].join("\n");
}
