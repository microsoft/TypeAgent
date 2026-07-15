// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { systemHandlers } from "agent-dispatcher/internal";
import type { CommandArg, CommandFlag, CommandInfo } from "./types.js";

// The command handler tables are walked structurally: each node may carry a
// `description`, a `commands` map of sub-handlers, a `defaultSubCommand`, and a
// `parameters` block with `args` / `flags`. We only read those fields, so a
// loose shape keeps this decoupled from the dispatcher's internal handler types.
interface HandlerNode {
    description?: unknown;
    commands?: Record<string, HandlerNode> | undefined;
    defaultSubCommand?: HandlerNode | undefined;
    parameters?:
        | {
              args?: Record<string, ParameterDef> | undefined;
              flags?: Record<string, ParameterDef> | undefined;
          }
        | undefined;
}

interface ParameterDef {
    type?: unknown;
    optional?: unknown;
    description?: unknown;
    char?: unknown;
    default?: unknown;
}

/**
 * Enumerate the TypeAgent system `@command` tree (help, config, session, …)
 * into a flat, sorted list. Best-effort: any failure yields an empty list so
 * the rest of the catalog still generates.
 */
export function collectSystemCommands(): CommandInfo[] {
    const out: CommandInfo[] = [];
    try {
        walk(systemHandlers as unknown as HandlerNode, [], out);
    } catch {
        return [];
    }
    return out.sort((a, b) => a.path.localeCompare(b.path));
}

function walk(
    node: HandlerNode,
    pathParts: string[],
    out: CommandInfo[],
): void {
    const commands = node.commands;
    if (commands === undefined || typeof commands !== "object") {
        return;
    }
    for (const [name, child] of Object.entries(commands)) {
        if (child === null || typeof child !== "object") {
            continue;
        }
        const currentPath = [...pathParts, name];
        const hasSub =
            child.commands !== undefined &&
            Object.keys(child.commands).length > 0;
        const params = child.parameters ?? child.defaultSubCommand?.parameters;
        out.push({
            path: currentPath.join(" "),
            description:
                typeof child.description === "string" ? child.description : "",
            group: hasSub,
            args: extractArgs(params),
            flags: extractFlags(params),
        });
        if (hasSub) {
            walk(child, currentPath, out);
        }
    }
}

function extractArgs(params: HandlerNode["parameters"]): CommandArg[] {
    const args = params?.args;
    if (args === undefined) {
        return [];
    }
    return Object.entries(args).map(([name, def]) => ({
        name,
        type: typeof def?.type === "string" ? def.type : "string",
        optional: def?.optional === true,
        description:
            typeof def?.description === "string" ? def.description : "",
    }));
}

function extractFlags(params: HandlerNode["parameters"]): CommandFlag[] {
    const flags = params?.flags;
    if (flags === undefined) {
        return [];
    }
    return Object.entries(flags).map(([name, def]) => ({
        name,
        char: typeof def?.char === "string" ? def.char : "",
        type: typeof def?.type === "string" ? def.type : "string",
        default: def?.default === undefined ? "" : String(def.default),
        description:
            typeof def?.description === "string" ? def.description : "",
    }));
}
