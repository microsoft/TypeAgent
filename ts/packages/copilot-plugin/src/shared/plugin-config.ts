// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { SkillSelection } from "../extension/skill-session.js";

export type Mode = "direct" | "mcp" | "dev" | "bypass";
export type McpRouting = "delegate" | "mixed";

export interface PluginConfig {
    mode: Mode;
    mcpRouting?: McpRouting;
    /** Public server conversation id, never a structured resume capability. */
    conversationId?: string;
    powershell?: {
        enabled?: boolean;
    };
    /** Catalog revisions to expose to this Copilot session. */
    selectedSkills?: SkillSelection[];
    [key: string]: unknown;
}

export function getConfigDir(): string {
    return (
        process.env.TYPEAGENT_PLUGIN_DATA ??
        process.env.CLAUDE_PLUGIN_DATA ??
        join(homedir(), ".typeagent-copilot")
    );
}

export function getConfigPath(): string {
    return join(getConfigDir(), "config.json");
}

export function readConfig(): PluginConfig | undefined {
    try {
        return JSON.parse(readFileSync(getConfigPath(), "utf-8"));
    } catch {
        return undefined;
    }
}

export function writeConfig(config: PluginConfig): void {
    const dir = getConfigDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(getConfigPath(), JSON.stringify(config, null, 2) + "\n");
}

export function getMode(): Mode {
    const envMode = process.env.TYPEAGENT_MODE;
    if (
        envMode === "direct" ||
        envMode === "mcp" ||
        envMode === "dev" ||
        envMode === "bypass"
    ) {
        return envMode;
    }
    const configMode = readConfig()?.mode;
    if (
        configMode === "direct" ||
        configMode === "mcp" ||
        configMode === "dev" ||
        configMode === "bypass"
    ) {
        return configMode;
    }
    return "direct";
}

export function isPowerShellGuidanceEnabled(): boolean {
    return readConfig()?.powershell?.enabled ?? true;
}

export function getMcpRouting(): McpRouting {
    return readConfig()?.mcpRouting === "mixed" ? "mixed" : "delegate";
}

export function isMixedMcpMode(): boolean {
    return getMode() === "mcp" && getMcpRouting() === "mixed";
}

export function getConversationId(): string | undefined {
    return (
        process.env.TYPEAGENT_CONVERSATION_ID ?? readConfig()?.conversationId
    );
}

export function getModeLabel(): string {
    const mode = getMode();
    return mode === "mcp" ? `mcp (${getMcpRouting()})` : mode;
}

export function getSelectedSkills(): SkillSelection[] {
    const environment = process.env.TYPEAGENT_SELECTED_SKILLS;
    const value =
        environment === undefined
            ? readConfig()?.selectedSkills
            : parse(environment);
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
        throw new Error("selectedSkills must be an array.");
    }
    return value.map((selection, index) =>
        parseSkillSelection(selection, index),
    );
}

function parse(value: string): unknown {
    try {
        return JSON.parse(value);
    } catch {
        throw new Error("TYPEAGENT_SELECTED_SKILLS must be valid JSON.");
    }
}

function parseSkillSelection(value: unknown, index: number): SkillSelection {
    if (typeof value !== "object" || value === null) {
        throw invalidSelection(index);
    }
    const selection = value as Record<string, unknown>;
    const identity = selection.identity;
    if (typeof identity !== "object" || identity === null) {
        throw invalidSelection(index);
    }
    const candidate = identity as Record<string, unknown>;
    if (
        !["builtin", "user", "project", "package"].includes(
            candidate.scope as string,
        ) ||
        typeof candidate.origin !== "string" ||
        candidate.origin.length === 0 ||
        typeof candidate.name !== "string" ||
        candidate.name.length === 0 ||
        (selection.revision !== undefined &&
            (typeof selection.revision !== "string" ||
                !/^[a-fA-F0-9]{64}$/.test(selection.revision)))
    ) {
        throw invalidSelection(index);
    }
    return {
        identity: {
            scope: candidate.scope as SkillSelection["identity"]["scope"],
            origin: candidate.origin,
            name: candidate.name,
        },
        ...(selection.revision === undefined
            ? {}
            : { revision: selection.revision as string }),
    };
}

function invalidSelection(index: number): Error {
    return new Error(`Invalid selectedSkills entry at index ${index}.`);
}
