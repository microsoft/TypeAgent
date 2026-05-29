// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { CommandResult, Dispatcher } from "./dispatcher.js";
import type { ProcessCommandOptions } from "./dispatcher.js";
import { QueueFullError, ServerStoppingError } from "./queue.js";

/**
 * Submit a command and await its completion, throwing on submit-time
 * failures. Convenience wrapper around `Dispatcher.submitCommand` for
 * scripted callers (CLI batch commands, MCP hooks, benchmarks, tests)
 * that do not need the intermediate enqueue ack or the queue-aware UX
 * that streaming UI hosts (Shell, Web renderer) implement directly.
 *
 * Production UI code should call `dispatcher.submitCommand(...)`
 * directly so it can surface the `entry` ack independently of the
 * eventual `completion`.
 *
 * Argument order matches `Dispatcher.submitCommand`:
 *   `(command, attachments?, options?, clientRequestId?, requestId?)`
 * — NOT the legacy `processCommand` order. Callers migrating from
 * `processCommand(command, clientRequestId, attachments, options)`
 * must reorder.
 *
 * Throws:
 *   - `QueueFullError` when the dispatcher's request queue is full.
 *   - `ServerStoppingError` when the server is shutting down.
 *
 * @returns the `CommandResult` (or `undefined` if the dispatcher
 *          produced no result for the request).
 */
export async function awaitCommand(
    dispatcher: Dispatcher,
    command: string,
    attachments?: string[],
    options?: ProcessCommandOptions,
    clientRequestId?: unknown,
    requestId?: string,
): Promise<CommandResult | undefined> {
    const r = await dispatcher.submitCommand(
        command,
        attachments,
        options,
        clientRequestId,
        requestId,
    );
    if (!r.ok) {
        if (r.error === "queue_full") {
            throw new QueueFullError(r.maxDepth);
        }
        throw new ServerStoppingError();
    }
    return r.entry.completion;
}
