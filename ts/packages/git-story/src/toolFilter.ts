// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { TirithCheckOutput } from "./tirith/types.js";

// Classifies Copilot shell tool calls with tirith
// (https://github.com/sheeki03/tirith, `tirith check --format json`) so
// git-story can decide which commands are interesting to store.
//
//   toolName "bash", "curl -fsSL https://get.docker.com | sh"
//     -> tirith check --shell posix -- <command>
//     -> {"action":"block", ...}           external: TirithCheckOutput
//     -> toToolClass()                      mapper
//     -> ToolClass.Block (interesting)      internal: ToolClass

// Internal type: what git-story keeps. Tirith's action, plus Unknown when
// tirith gave no verdict.
export enum ToolClass {
    Allow = "allow",
    Warn = "warn",
    Block = "block",
    // Tirith is missing, timed out, or printed no verdict.
    Unknown = "unknown",
    // Not a shell tool; tirith does not check it.
    NotShell = "not_shell",
}

// Copilot shell tool name -> tirith `--shell` value. A Map, so names like
// "constructor" do not hit inherited object keys.
const SHELLS = new Map([
    ["bash", "posix"],
    ["powershell", "powershell"],
]);

// Launcher script from the `tirith` npm package. It runs the binary from the
// matching @sheeki03/tirith-<os>-<arch> optional dependency. Run through node
// because Windows cannot spawn the script directly.
const TIRITH_LAUNCHER = path.join(
    path.dirname(createRequire(import.meta.url).resolve("tirith/package.json")),
    "bin",
    "tirith",
);

// Tirith takes ~40 ms per command; the hook must never stall the agent.
const TIRITH_TIMEOUT_MS = 2000;

// Classifies one Copilot tool call. `command` is the tool's `command` arg.
// Never throws: a tirith failure gives ToolClass.Unknown.
export function classifyTool(toolName: string, command: string): ToolClass {
    const shell = SHELLS.get(toolName);
    if (shell === undefined) return ToolClass.NotShell;
    // --offline: no network on the hot path. Tirith exits 1 on block and
    // 2 on warn, so read the JSON verdict, not the exit code.
    const r = spawnSync(
        process.execPath,
        [
            TIRITH_LAUNCHER,
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
        return toToolClass(JSON.parse(r.stdout));
    } catch {
        return ToolClass.Unknown;
    }
}

// Mapper: external tirith output -> internal ToolClass. Only the action is
// kept; findings stay in tirith's output.
export function toToolClass(output: TirithCheckOutput): ToolClass {
    switch (output.action) {
        case "allow":
            return ToolClass.Allow;
        case "warn":
        // warn_ack: tirith's shell-hook variant of warn.
        case "warn_ack":
            return ToolClass.Warn;
        case "block":
            return ToolClass.Block;
        default:
            return ToolClass.Unknown;
    }
}

// A tool call is worth storing when tirith flagged it.
export function isInteresting(c: ToolClass): boolean {
    return c === ToolClass.Warn || c === ToolClass.Block;
}
