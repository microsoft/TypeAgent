// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    getOrCreateSubagentManager,
    SubagentManagerHost,
} from "./subagentManager.js";

/**
 * Shared, engine-agnostic definitions for the reasoning subagent tools. The
 * Claude and Copilot reasoning loops each wrap these into their own SDK tool
 * shapes; the descriptions and handler logic live here so both engines stay in
 * sync.
 *
 * A subagent is a separate command-executor process (its own action-execution
 * instance) running in an isolated conversation. The reasoning model creates,
 * invokes, lists, and stops subagents through these tools.
 */

export const SUBAGENT_TOOL_DESCRIPTIONS = {
    create_subagent: [
        "Create a subagent: a separate worker with its own command-executor instance,",
        "running in an isolated conversation. Use this to delegate a self-contained",
        "sub-task that should run independently (e.g. a focused investigation or a",
        "parallel line of work) without disturbing the main conversation.",
        "Params: name (short role label), instructions (optional persistent role/context",
        "prepended to the subagent's first task).",
        "Returns the subagent id — pass it to invoke_subagent to give the subagent work.",
    ].join("\n"),
    invoke_subagent: [
        "Send a task to an existing subagent and get its result back. The subagent",
        "runs the task autonomously using its own command-executor instance (it can",
        "discover and execute TypeAgent actions), then returns a textual result.",
        "Params: id (from create_subagent), task (natural-language instruction).",
    ].join("\n"),
    list_subagents: [
        "List the subagents you have created, with their id, name, and status.",
    ].join("\n"),
    stop_subagent: [
        "Stop a subagent and release its command-executor process. Params: id.",
        "Stop subagents you no longer need so their resources are freed.",
    ].join("\n"),
};

export async function handleCreateSubagent(
    host: SubagentManagerHost,
    args: { name: string; instructions?: string | undefined },
): Promise<string> {
    const manager = getOrCreateSubagentManager(host);
    const info = await manager.createSubagent({
        name: args.name,
        instructions: args.instructions,
    });
    return (
        `Created subagent '${info.name}' (id: ${info.id}, status: ${info.status}). ` +
        `Give it work with invoke_subagent using this id.`
    );
}

export async function handleInvokeSubagent(
    host: SubagentManagerHost,
    args: { id: string; task: string },
): Promise<string> {
    const manager = getOrCreateSubagentManager(host);
    return await manager.invokeSubagent(args.id, args.task);
}

export function handleListSubagents(host: SubagentManagerHost): string {
    const list = host.subagentManager?.listSubagents() ?? [];
    if (list.length === 0) {
        return "No subagents have been created.";
    }
    return JSON.stringify(
        list.map((s) => ({
            id: s.id,
            name: s.name,
            status: s.status,
            createdAt: s.createdAt,
        })),
        null,
        2,
    );
}

export async function handleStopSubagent(
    host: SubagentManagerHost,
    args: { id: string },
): Promise<string> {
    const manager = host.subagentManager;
    if (manager === undefined) {
        throw new Error(`Unknown subagent id '${args.id}'`);
    }
    await manager.stopSubagent(args.id);
    return `Stopped subagent '${args.id}'.`;
}
