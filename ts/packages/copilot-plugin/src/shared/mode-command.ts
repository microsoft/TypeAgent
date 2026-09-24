// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    getMcpRouting,
    getMode,
    getModeLabel,
    readConfig,
    writeConfig,
} from "./plugin-config.js";

export function getModeDescription(): string {
    switch (getMode()) {
        case "mcp":
            return getMcpRouting() === "mixed"
                ? "Mixed policy: Copilot chooses whole-request delegation through processCommand or owns the task and uses searchActions/executeAction for TypeAgent steps it selects."
                : "Delegate policy (default): delegate the user's exact request through processCommand. Copilot-selected discovery/direct calls are routing guidance only in MCP mixed policy; structured tools remain available.";
        case "direct":
            return "The hook handles user natural language directly. The persistent MCP bridge remains available for structured actions.";
        case "dev":
            return "TypeAgent handles registered PowerShell flows and recording directives; other requests fall through to Copilot.";
        case "bypass":
            return "TypeAgent routing is disabled; requests fall through to Copilot.";
    }
}

export function handleModeSetting(args: string, command: string): string {
    const value = args.trim().toLowerCase();
    if (!value)
        return `TypeAgent mode: ${getModeLabel()}\n${getModeDescription()}`;

    const [mode, routing, ...extra] = value.split(/\s+/);
    if (
        (mode !== "direct" &&
            mode !== "mcp" &&
            mode !== "dev" &&
            mode !== "bypass") ||
        extra.length > 0 ||
        (routing !== undefined &&
            (mode !== "mcp" || (routing !== "delegate" && routing !== "mixed")))
    ) {
        return `Usage: ${command} direct|mcp [delegate|mixed]|dev|bypass`;
    }

    const config = readConfig() ?? { mode: "direct" };
    config.mode = mode;
    if (routing === "delegate" || routing === "mixed") {
        config.mcpRouting = routing;
    }
    writeConfig(config);
    const saved =
        mode === "mcp" ? `mcp (${config.mcpRouting ?? "delegate"})` : mode;
    const effective = getModeLabel();
    const message =
        saved === effective
            ? `TypeAgent mode switched to ${effective}.`
            : `Saved TypeAgent mode: ${saved}. Effective mode: ${effective} (TYPEAGENT_MODE override).`;
    return `${message}\n${getModeDescription()}`;
}
