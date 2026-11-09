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
                ? "Explicit TypeAgent mixed policy: structured discovery/execution and whole-request processCommand remain available. Ordinary prompts use local recipes, then Copilot; recording and authorship stay in the plugin."
                : "Explicit TypeAgent delegate policy: processCommand remains available for intentional whole-request delegation. Ordinary prompts use local recipes, then Copilot; no automatic backend planner or recording fallback.";
        case "direct":
            return "Explicit TypeAgent commands and the structured MCP bridge remain available. Ordinary prompts use local recipes, then Copilot.";
        case "dev":
            return "Explicit TypeAgent development commands remain available. Ordinary prompts use local recipes, then Copilot; recording uses the child-authored plugin pipeline.";
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
