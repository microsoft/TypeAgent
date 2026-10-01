// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { spawnSync } from "node:child_process";

// Classifies Copilot shell tool calls with tirith
// (https://github.com/sheeki03/tirith, `tirith check --format json`) so
// git-story can decide which commands are interesting to store.
//
//   toolName "bash", "curl -fsSL https://get.docker.com | sh"
//     -> tirith check --shell posix -- <command>
//     -> {"action":"block", ...}
//     -> ToolClass.Block (interesting)

// Tirith's verdict action, plus Unknown when tirith did not give one.
export enum ToolClass {
    Allow = "allow",
    Warn = "warn",
    Block = "block",
    // Tirith is missing, timed out, or printed no verdict.
    Unknown = "unknown",
    // Not a shell tool; tirith does not check it.
    NotShell = "not_shell",
}

// Copilot shell tool name -> tirith `--shell` value.
const SHELLS: Record<string, string> = {
    bash: "posix",
    powershell: "powershell",
};

// Tirith takes ~40 ms per command; the hook must never stall the agent.
const TIRITH_TIMEOUT_MS = 2000;

// Classifies one Copilot tool call. `command` is the tool's `command` arg.
// Never throws: a tirith failure gives ToolClass.Unknown.
export function classifyTool(toolName: string, command: string): ToolClass {
    const shell = SHELLS[toolName];
    if (shell === undefined) return ToolClass.NotShell;
    // --offline: no network on the hot path. Tirith exits 1 on block and
    // 2 on warn, so read the JSON verdict, not the exit code.
    const r = spawnSync(
        "tirith",
        [
            "check",
            "--format",
            "json",
            "--non-interactive",
            "--offline",
            "--shell",
            shell,
            "--",
            command,
        ],
        { encoding: "utf8", timeout: TIRITH_TIMEOUT_MS },
    );
    try {
        return ACTIONS[JSON.parse(r.stdout).action] ?? ToolClass.Unknown;
    } catch {
        return ToolClass.Unknown;
    }
}

// Tirith `action` -> ToolClass. warn_ack is tirith's shell-hook variant of warn.
const ACTIONS: Record<string, ToolClass> = {
    allow: ToolClass.Allow,
    warn: ToolClass.Warn,
    warn_ack: ToolClass.Warn,
    block: ToolClass.Block,
};

// A tool call is worth storing when tirith flagged it.
export function isInteresting(c: ToolClass): boolean {
    return c === ToolClass.Warn || c === ToolClass.Block;
}
