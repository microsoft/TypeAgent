// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getModeLabel, readConfig, writeConfig } from "./plugin-config.js";

export function handleModeSetting(args: string, command: string): string {
    const value = args.trim().toLowerCase();
    if (!value) return `TypeAgent mode: ${getModeLabel()}`;

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
    return saved === effective
        ? `TypeAgent mode switched to ${effective}.`
        : `Saved TypeAgent mode: ${saved}. Effective mode: ${effective} (TYPEAGENT_MODE override).`;
}
