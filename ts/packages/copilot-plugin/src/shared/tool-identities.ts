// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const TYPEAGENT_AGENT_SERVER_TOOLS = [
    "typeagent-searchactions",
    "typeagent-executeaction",
    "typeagent-continueaction",
    "typeagent-cancelaction",
    "typeagent-processcommand",
    "typeagent-listagents",
    "typeagent-getstatus",
    "typeagent-powershell-list",
    "typeagent-powershell-import",
];

export function isCopilotTelemetryTool(
    toolName: string,
    mcpServerName?: string,
): boolean {
    return (
        mcpServerName === undefined &&
        ["report_intent", "functions.report_intent"].includes(
            toolName.toLowerCase(),
        )
    );
}

export function isTypeAgentAgentServerTool(
    toolName: string,
    mcpServerName?: string,
): boolean {
    if (mcpServerName !== undefined) {
        return mcpServerName.toLowerCase() === "typeagent";
    }
    const normalized = toolName.toLowerCase();
    return TYPEAGENT_AGENT_SERVER_TOOLS.some((name) =>
        normalized.includes(name),
    );
}
