// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    initializeCommandHandlerContext,
    closeCommandHandlerContext,
    type CommandHandlerContext,
} from "agent-dispatcher/internal";
import { getDefaultAppAgentProviders } from "default-agent-provider";
import type { CommandArg, CommandFlag, CommandInfo } from "./types.js";

// Command descriptor tables are walked structurally: each node may carry a
// `description`, a `commands` map of sub-handlers, a `defaultSubCommand` (an
// inline descriptor or a string reference), and a `parameters` block with
// `args` / `flags`. We only read those fields, so a loose shape keeps this
// decoupled from the agent-sdk's descriptor types.
interface HandlerNode {
    description?: unknown;
    commands?: Record<string, HandlerNode> | undefined;
    defaultSubCommand?: HandlerNode | string | undefined;
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
 * Enumerate every bundled agent's `@command` tree, tagged by host.
 *
 * The unprefixed commands (`@config`, `@session`, …) are hosted by the built-in
 * "system" agent; every other agent hosts its own prefixed commands
 * (`@dispatcher reason`). Unlike the rest of the catalog this boots a headless,
 * read-only dispatcher (no API keys; translation, explanation, and caching are
 * off) so agents that assemble their command tables at runtime are enumerated
 * the same way the command-reference doc generator does. Best-effort: any
 * failure yields an empty list so the rest of the catalog still generates.
 */
export async function collectCommands(): Promise<CommandInfo[]> {
    let context: CommandHandlerContext;
    try {
        context = await initializeCommandHandlerContext("action-browser", {
            appAgentProviders: getDefaultAppAgentProviders(undefined),
            agents: { actions: false, schemas: false, commands: true },
            translation: { enabled: false },
            explainer: { enabled: false },
            cache: { enabled: false },
        });
    } catch {
        return [];
    }

    const out: CommandInfo[] = [];
    try {
        const agents = context.agents;
        for (const host of agents.getAppAgentNames()) {
            if (!agents.isCommandEnabled(host)) {
                continue;
            }
            const appAgent = agents.getAppAgent(host);
            if (appAgent.getCommands === undefined) {
                continue;
            }
            let commands: HandlerNode;
            try {
                commands = (await appAgent.getCommands(
                    agents.getSessionContext(host),
                )) as unknown as HandlerNode;
            } catch {
                continue;
            }
            collectHostCommands(host, commands, out);
        }
    } finally {
        await closeCommandHandlerContext(context);
    }

    return out.sort(
        (a, b) => a.host.localeCompare(b.host) || a.path.localeCompare(b.path),
    );
}

// A host either exposes a table of sub-commands (walked recursively) or a
// single top-level command invoked as bare `@<host>` (path left empty).
function collectHostCommands(
    host: string,
    node: HandlerNode,
    out: CommandInfo[],
): void {
    if (node.commands !== undefined && typeof node.commands === "object") {
        walk(host, node, [], out);
    } else {
        out.push({
            host,
            path: "",
            description:
                typeof node.description === "string" ? node.description : "",
            group: false,
            args: extractArgs(node.parameters),
            flags: extractFlags(node.parameters),
        });
    }
}

function walk(
    host: string,
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
        // A string `defaultSubCommand` references another entry that the loop
        // renders on its own; only an inline descriptor contributes parameters.
        const defaultSub =
            typeof child.defaultSubCommand === "object"
                ? child.defaultSubCommand
                : undefined;
        const params = child.parameters ?? defaultSub?.parameters;
        out.push({
            host,
            path: currentPath.join(" "),
            description:
                typeof child.description === "string" ? child.description : "",
            group: hasSub,
            args: extractArgs(params),
            flags: extractFlags(params),
        });
        if (hasSub) {
            walk(host, child, currentPath, out);
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
