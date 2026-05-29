// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createRpc } from "@typeagent/agent-rpc/rpc";
import type { RpcChannel } from "@typeagent/agent-rpc/channel";
import type {
    ClientIO,
    CommandResult,
    ConnectionId,
    Dispatcher,
    QueueCancelReason,
    SubmitResult,
} from "@typeagent/dispatcher-types";
import { ServerStoppingError } from "@typeagent/dispatcher-types";
import type {
    DispatcherCallFunctions,
    DispatcherInvokeFunctions,
    WireSubmitResult,
} from "./dispatcherTypes.js";

/**
 * The result of `createDispatcherRpcClient`.
 *
 * - `dispatcher` is the standard `Dispatcher` facade. Callers use it
 *   exactly as they would an in-process dispatcher; in particular,
 *   `submitCommand` / `interrupt` return a `SubmitResult` whose
 *   `entry.completion` promise resolves with the eventual `CommandResult`.
 *
 * - `notifyCommandComplete` and `notifyRequestCancelled` are hooks
 *   that the host MUST wire into its `ClientIO` so the completion
 *   correlation map can fulfil outstanding `completion` promises.
 *   Without them, callers awaiting `r.entry.completion` will block forever.
 *   Use `wrapClientIOForCompletion` to do the wiring automatically.
 *
 * See `docs/architecture/messageQueueing.md` for the broader design.
 */
export interface DispatcherRpcClient {
    dispatcher: Dispatcher;
    notifyCommandComplete(
        requestId: string,
        result: CommandResult | undefined,
    ): void;
    notifyRequestCancelled(requestId: string, reason: QueueCancelReason): void;
}

type PendingEntry = {
    resolve: (value: CommandResult | undefined) => void;
    reject: (err: unknown) => void;
};

type SettledEntry =
    | { kind: "result"; result: CommandResult | undefined }
    | { kind: "error"; error: unknown };

export function createDispatcherRpcClient(
    channel: RpcChannel,
    connectionId?: ConnectionId,
): DispatcherRpcClient {
    const rpc = createRpc<DispatcherInvokeFunctions, DispatcherCallFunctions>(
        "dispatcher",
        channel,
    );

    // requestId → pending submitCommand awaiter (set on submit, resolved by
    // commandComplete / requestCancelled push events).
    const pending = new Map<string, PendingEntry>();

    // Holds completion events that arrived BEFORE the submitCommand ack
    // returned (possible because the dispatcher RPC channel and the ClientIO
    // push channel are independently ordered). The next attachCompletion()
    // call for this requestId consumes the buffered entry instead of waiting.
    const settledEarly = new Map<string, SettledEntry>();

    const resolveCompletion = (
        requestId: string,
        result: CommandResult | undefined,
    ) => {
        const entry = pending.get(requestId);
        if (entry !== undefined) {
            pending.delete(requestId);
            entry.resolve(result);
            return;
        }
        settledEarly.set(requestId, { kind: "result", result });
    };

    const rejectCompletion = (requestId: string, err: unknown) => {
        const entry = pending.get(requestId);
        if (entry !== undefined) {
            pending.delete(requestId);
            entry.reject(err);
            return;
        }
        settledEarly.set(requestId, { kind: "error", error: err });
    };

    const attachCompletion = (
        requestId: string,
    ): Promise<CommandResult | undefined> => {
        const early = settledEarly.get(requestId);
        if (early !== undefined) {
            settledEarly.delete(requestId);
            return early.kind === "result"
                ? Promise.resolve(early.result)
                : Promise.reject(early.error);
        }
        return new Promise<CommandResult | undefined>((resolve, reject) => {
            pending.set(requestId, { resolve, reject });
        });
    };

    const hydrate = (wire: WireSubmitResult): SubmitResult => {
        if (!wire.ok) {
            return wire;
        }
        const completion = attachCompletion(wire.entry.requestId);
        // Defensive absorbing handler: keeps an ignored completion from
        // surfacing as unhandledRejection on server_stopping / close.
        void completion.catch(() => {});
        return { ok: true, entry: { ...wire.entry, completion } };
    };

    const dispatcher: Dispatcher = {
        get connectionId() {
            return connectionId;
        },
        async submitCommand(...args) {
            const wire = await rpc.invoke("submitCommand", ...args);
            return hydrate(wire);
        },
        async interrupt(...args) {
            const wire = await rpc.invoke("interrupt", ...args);
            return hydrate(wire);
        },
        async getQueueSnapshot() {
            return rpc.invoke("getQueueSnapshot");
        },
        async getDynamicDisplay(...args) {
            return rpc.invoke("getDynamicDisplay", ...args);
        },
        async getTemplateSchema(...args) {
            return rpc.invoke("getTemplateSchema", ...args);
        },
        async getTemplateCompletion(...args) {
            return rpc.invoke("getTemplateCompletion", ...args);
        },
        async getCommandCompletion(...args) {
            return rpc.invoke("getCommandCompletion", ...args);
        },
        async checkCache(...args) {
            return rpc.invoke("checkCache", ...args);
        },
        async close() {
            try {
                await rpc.invoke("close");
            } finally {
                // Drain any outstanding completion awaiters so callers don't
                // block forever after the dispatcher is gone.
                const err = new Error("Dispatcher closed");
                const all = Array.from(pending.values());
                pending.clear();
                settledEarly.clear();
                for (const p of all) {
                    try {
                        p.reject(err);
                    } catch {
                        // best-effort
                    }
                }
            }
        },
        async getStatus() {
            return rpc.invoke("getStatus");
        },
        async getAgentSchemas(...args) {
            return rpc.invoke("getAgentSchemas", ...args);
        },
        async respondToChoice(...args) {
            return rpc.invoke("respondToChoice", ...args);
        },
        getDisplayHistory(...args) {
            return rpc.invoke("getDisplayHistory", ...args);
        },
        async respondToInteraction(...args) {
            return rpc.invoke("respondToInteraction", ...args);
        },
        cancelInteraction(...args) {
            return rpc.send("cancelInteraction", ...args);
        },
        async cancelCommand(...args) {
            return rpc.invoke("cancelCommand", ...args);
        },
        cancelCommandByClientId(...args) {
            return rpc.send("cancelCommandByClientId", ...args);
        },
        async recordUserFeedback(...args) {
            return rpc.invoke("recordUserFeedback", ...args);
        },
        async recordUserHide(...args) {
            return rpc.invoke("recordUserHide", ...args);
        },
        async restoreAllHidden() {
            return rpc.invoke("restoreAllHidden");
        },
        async flushHidden() {
            return rpc.invoke("flushHidden");
        },
    };

    return {
        dispatcher,
        notifyCommandComplete(requestId, result) {
            resolveCompletion(requestId, result);
        },
        notifyRequestCancelled(requestId, reason) {
            if (reason === "server_stopping") {
                rejectCompletion(requestId, new ServerStoppingError());
                return;
            }
            // For other cancel reasons (user cancel of a queued entry,
            // disconnect, etc.) no `commandComplete` will follow, so resolve
            // with the in-process equivalent of `entry.completion`.
            resolveCompletion(requestId, { cancelled: true });
        },
    };
}

/**
 * Wrap a host's `ClientIO` so that `commandComplete` notifications and
 * `requestCancelled` push events are forwarded to the dispatcher RPC
 * client's completion-correlation hooks. Any other call passes through
 * untouched.
 *
 * Returns the wrapped ClientIO. Pass it to `createClientIORpcServer`
 * instead of the raw host clientIO. The host's own methods still run —
 * we only tap the two events the correlation map needs.
 *
 * Implementation note: uses a Proxy rather than `{...clientIO, notify:...}`
 * so we correctly forward through class-instance ClientIO implementations
 * whose methods live on the prototype and would not be copied by spread.
 */
export function wrapClientIOForCompletion(
    clientIO: ClientIO,
    client: Pick<
        DispatcherRpcClient,
        "notifyCommandComplete" | "notifyRequestCancelled"
    >,
): ClientIO {
    return new Proxy(clientIO, {
        get(target, prop, receiver) {
            if (prop === "notify") {
                return function notifyWrapped(
                    notificationId: string | RequestIdLike | undefined,
                    event: string,
                    data: unknown,
                    source: string,
                    seq?: number,
                    options?: unknown,
                ): void {
                    if (event === "commandComplete") {
                        const rid = extractRequestId(notificationId);
                        if (rid !== undefined) {
                            const result =
                                data != null && typeof data === "object"
                                    ? ((
                                          data as {
                                              result?: CommandResult | null;
                                          }
                                      ).result ?? undefined)
                                    : undefined;
                            client.notifyCommandComplete(rid, result);
                        }
                    }
                    // Delegate to the underlying clientIO (any overload).
                    (target.notify as (...a: unknown[]) => void).call(
                        target,
                        notificationId,
                        event,
                        data,
                        source,
                        seq,
                        options,
                    );
                };
            }
            if (prop === "requestCancelled") {
                return function requestCancelledWrapped(
                    requestId: string,
                    reason: QueueCancelReason,
                    version: number,
                ): void {
                    client.notifyRequestCancelled(requestId, reason);
                    target.requestCancelled?.(requestId, reason, version);
                };
            }
            return Reflect.get(target, prop, receiver);
        },
    });
}

type RequestIdLike = { requestId: string; [key: string]: unknown };

function extractRequestId(
    notificationId: string | RequestIdLike | undefined,
): string | undefined {
    if (typeof notificationId === "string") {
        return notificationId;
    }
    if (
        notificationId !== undefined &&
        typeof notificationId === "object" &&
        "requestId" in notificationId &&
        typeof notificationId.requestId === "string"
    ) {
        return notificationId.requestId;
    }
    return undefined;
}
