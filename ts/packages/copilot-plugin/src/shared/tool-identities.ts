// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const TYPEAGENT_AGENT_SERVER_TOOLS = [
    "typeagent-processcommand",
    "typeagent-discoveractions",
    "typeagent-executeaction",
    "typeagent-listagents",
    "typeagent-getstatus",
    "typeagent-powershell-list",
    "typeagent-powershell-import",
];

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
