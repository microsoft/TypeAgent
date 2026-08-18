// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    initializeCommandHandlerContext,
    closeCommandHandlerContext,
    type CommandHandlerContext,
} from "agent-dispatcher/internal";
import { getDefaultAppAgentProviders } from "default-agent-provider";
import type {
    CommandActionLink,
    CommandArg,
    CommandFlag,
    CommandInfo,
} from "./types.js";

// Command descriptor tables are walked structurally: each node may carry a
// `description`, a `commands` map of sub-handlers, a `defaultSubCommand` (an
// inline descriptor or a string reference), and a `parameters` block with
// `args` / `flags`. We only read those fields, so a loose shape keeps this
// decoupled from the agent-sdk's descriptor types.
interface HandlerNode {
    description?: unknown;
    commands?: Record<string, HandlerNode> | undefined;
    defaultSubCommand?: HandlerNode | string | undefined;
    action?: string | { schema?: unknown; actionName?: unknown } | undefined;
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
export type CollectCommandsOptions = {
    strict?: boolean;
};

export async function collectCommands(
    options: CollectCommandsOptions = {},
): Promise<CommandInfo[]> {
    let context: CommandHandlerContext;
    try {
        context = await initializeCommandHandlerContext("action-browser", {
            appAgentProviders: getDefaultAppAgentProviders(undefined),
            agents: { actions: false, schemas: false, commands: true },
            translation: { enabled: false },
            explainer: { enabled: false },
            cache: { enabled: false },
        });
    } catch (error) {
        if (options.strict) {
            throw new Error(
                `Failed to initialize command collection: ${getErrorMessage(error)}`,
            );
        }
        return [];
    }

    try {
        return await collectCommandsFromContext(
            context,
            options.strict ?? false,
        );
    } finally {
        await closeCommandHandlerContext(context);
    }
}

export async function collectCommandsFromContext(
    context: CommandHandlerContext,
    strict: boolean,
): Promise<CommandInfo[]> {
    const out: CommandInfo[] = [];
    const agents = context.agents;
    for (const host of agents.getAppAgentNames()) {
        if (!agents.isCommandEnabled(host)) {
            // getCommandEnabledState returns null when the agent genuinely has
            // no command interface, and undefined when it never loaded. Without
            // this check a failed agent is dropped from the enumeration and the
            // coverage gate still reports full coverage over what is left.
            if (strict && agents.getCommandEnabledState(host) === undefined) {
                throw new Error(
                    `Agent "${host}" did not load, so its commands cannot be collected. Coverage would be reported against an incomplete command set.`,
                );
            }
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
        } catch (error) {
            if (strict) {
                throw new Error(
                    `Failed to collect commands for host "${host}": ${getErrorMessage(error)}`,
                );
            }
            continue;
        }
        collectHostCommands(host, commands, out);
    }
    return out.sort(
        (a, b) => a.host.localeCompare(b.host) || a.path.localeCompare(b.path),
    );
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

// A host either exposes a table of sub-commands (walked recursively) or a
// single top-level command invoked as bare `@<host>` (path left empty).
export function collectHostCommands(
    host: string,
    node: HandlerNode,
    out: CommandInfo[],
): void {
    if (node.commands !== undefined && typeof node.commands === "object") {
        const rootDefault = getDefaultDescriptor(node);
        if (rootDefault !== undefined) {
            out.push(createCommandInfo(host, "", node, true, rootDefault));
        }
        walk(host, node, [], out);
    } else {
        out.push(createCommandInfo(host, "", node, false, { node }));
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
        const endpoint = hasSub ? getDefaultDescriptor(child) : { node: child };
        out.push(
            createCommandInfo(
                host,
                currentPath.join(" "),
                child,
                hasSub,
                endpoint,
            ),
        );
        if (hasSub) {
            walk(host, child, currentPath, out);
        }
    }
}

type DefaultDescriptor = {
    node: HandlerNode;
    name?: string;
};

function getDefaultDescriptor(
    table: HandlerNode,
): DefaultDescriptor | undefined {
    const defaultSubCommand = table.defaultSubCommand;
    if (typeof defaultSubCommand === "string") {
        const target = table.commands?.[defaultSubCommand];
        if (
            target === undefined ||
            (target.commands !== undefined &&
                typeof target.commands === "object")
        ) {
            return undefined;
        }
        return { node: target, name: defaultSubCommand };
    }
    if (
        defaultSubCommand === undefined ||
        (defaultSubCommand.commands !== undefined &&
            typeof defaultSubCommand.commands === "object")
    ) {
        return undefined;
    }
    return { node: defaultSubCommand };
}

function createCommandInfo(
    host: string,
    commandPath: string,
    displayNode: HandlerNode,
    group: boolean,
    endpoint: DefaultDescriptor | undefined,
): CommandInfo {
    const action = normalizeActionLink(endpoint?.node.action);
    return {
        host,
        path: commandPath,
        description:
            typeof displayNode.description === "string"
                ? displayNode.description
                : "",
        group,
        executable: endpoint !== undefined,
        ...(endpoint?.name === undefined
            ? {}
            : { defaultSubCommand: endpoint.name }),
        args: extractArgs(endpoint?.node.parameters),
        flags: extractFlags(endpoint?.node.parameters),
        ...(action ? { action } : {}),
    };
}

// Normalize a handler's declared `action` (a bare actionName or a
// {schema, actionName} pair) into the catalog's link shape.
function normalizeActionLink(
    action: HandlerNode["action"],
): CommandActionLink | undefined {
    if (typeof action === "string") {
        return action ? { actionName: action } : undefined;
    }
    if (
        action !== null &&
        typeof action === "object" &&
        typeof action.actionName === "string"
    ) {
        return typeof action.schema === "string"
            ? { schema: action.schema, actionName: action.actionName }
            : { actionName: action.actionName };
    }
    return undefined;
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
