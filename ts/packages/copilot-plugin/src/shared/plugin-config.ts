// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export type Mode = "direct" | "mcp" | "dev" | "bypass";

export interface PluginConfig {
    mode: Mode;
    powershell?: {
        enabled?: boolean;
    };
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
