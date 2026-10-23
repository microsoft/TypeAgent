// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { SkillSelection } from "../extension/skill-session.js";

export type Mode = "direct" | "mcp" | "dev" | "bypass";
export type McpRouting = "delegate" | "mixed";
export type RecipeOwner = "plugin" | "off";

export interface PluginConfig {
    mode: Mode;
    mcpRouting?: McpRouting;
    /** Public server conversation id, never a structured resume capability. */
    conversationId?: string;
    /** Catalog revisions to expose to this Copilot session. */
    selectedSkills?: SkillSelection[];
    recipeOwner?: RecipeOwner;
    recipeReadOnlyMcpTools?: { mcpServerName: string; toolName: string }[];
    recipeInferenceCliPath?: string;
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

export function getRecipeOwner(): RecipeOwner {
    const environment = process.env.TYPEAGENT_RECIPE_OWNER;
    const configured =
        environment === undefined ? readConfig()?.recipeOwner : undefined;
    const value =
        environment ?? (configured === undefined ? "plugin" : configured);
    if (value === "typeagent")
        throw new Error(
            "The TypeAgent recipe owner has been removed. Remove the obsolete recipeOwner/TYPEAGENT_RECIPE_OWNER setting, restart Copilot, and re-record tasks in the plugin catalog.",
        );
    if (value !== "plugin" && value !== "off")
        throw new Error("Recipe owner must be plugin or off.");
    return value;
}

export function getRecipeReadOnlyMcpTools(): {
    mcpServerName: string;
    toolName: string;
}[] {
    const value = readConfig()?.recipeReadOnlyMcpTools;
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > 128)
        throw new Error(
            "recipeReadOnlyMcpTools must be a bounded array of exact server/tool identities.",
        );
    return value.map((entry) => {
        if (
            !entry ||
            typeof entry.mcpServerName !== "string" ||
            !entry.mcpServerName.trim() ||
            typeof entry.toolName !== "string" ||
            !entry.toolName.trim() ||
            entry.mcpServerName.length > 256 ||
            entry.toolName.length > 256
        )
            throw new Error(
                "Invalid read-only MCP classification; this setting never grants tool permissions.",
            );
        return { mcpServerName: entry.mcpServerName, toolName: entry.toolName };
    });
}

export function getRecipeInferenceCliPath(): string | undefined {
    const value =
        process.env.TYPEAGENT_RECIPE_CLI_PATH ??
        readConfig()?.recipeInferenceCliPath;
    if (
        value !== undefined &&
        (typeof value !== "string" ||
            !value.trim() ||
            value.length > 4096 ||
            value.includes("\0"))
    )
        throw new Error(
            "The native recipe inference CLI path must be a bounded executable path.",
        );
    return value;
}

export function readConfig(): PluginConfig | undefined {
    try {
        const value: unknown = JSON.parse(
            readFileSync(getConfigPath(), "utf-8"),
        );
        if (!value || typeof value !== "object" || Array.isArray(value))
            throw new Error("Plugin configuration must be a JSON object.");
        return value as PluginConfig;
    } catch (error) {
        if (
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "ENOENT"
        )
            return undefined;
        throw new Error(
            `Unable to read plugin configuration: ${error instanceof Error ? error.message : String(error)}`,
        );
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
