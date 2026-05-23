// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomUUID } from "node:crypto";
import {
    DispatcherConnectOptions,
    registerClientType,
    unregisterClient,
} from "@typeagent/agent-server-protocol";
import {
    Dispatcher,
    DispatcherOptions,
    ClientIO,
    RequestId,
} from "agent-dispatcher";
import type {
    CancelResult,
    PendingInteractionRequest,
    PendingInteractionResponse,
    QueueCancelReason,
    QueuedRequest,
    QueueSnapshot,
    SubmitResult,
} from "@typeagent/dispatcher-types";
import {
    QueueFullError,
    ServerStoppingError,
} from "@typeagent/dispatcher-types";
import {
    closeCommandHandlerContext,
    initializeCommandHandlerContext,
    createDispatcherFromContext,
} from "agent-dispatcher/internal";
import { PendingInteractionManager } from "agent-dispatcher/internal";
import { RequestQueue, type QueueExecutionContext } from "./requestQueue.js";
import { createSnapshotCoalescer } from "./snapshotCoalescer.js";

import registerDebug from "debug";
const debugConnect = registerDebug("agent-server:connect");
const debugClientIOError = registerDebug("agent-server:clientIO:error");
const debugInteraction = registerDebug("agent-server:interaction");
const debugCommand = registerDebug("agent-server:command");

type ClientRecord = {
    clientIO: ClientIO;
    filter: boolean;
};

export async function createSharedDispatcher(
    hostName: string,
    options?: DispatcherOptions,
) {
    if (options?.clientIO !== undefined) {
        throw new Error(
            "SharedDispatcher manages ClientIO internally; do not provide one in options",
        );
    }
    let nextConnectionId = 0;
    const clients = new Map<string, ClientRecord>();
    const pendingInteractions = new PendingInteractionManager();

    // Timeouts for pending interactions. All currently set to 10 minutes but
    // kept separate so they can be tuned independently.
    const INTERACTION_TIMEOUT_MS = {
        question: 10 * 60 * 1000,
        proposeAction: 10 * 60 * 1000,
    };

    // Grace period before the queue cancels its contents after the last client
    // disconnects. Tunable per-test via `__testSetNoClientsGraceMs`.
    let noClientsGraceMs = 30 * 1000;

    // Returns the number of clients the message was sent to.
    const broadcast = (
        name: string,
        requestId: RequestId | undefined,
        fn: (clientIO: ClientIO) => void,
    ): number => {
        let count = 0;
        for (const [connectionId, clientRecord] of clients) {
            if (
                clientRecord.filter &&
                requestId?.connectionId !== connectionId
            ) {
                continue;
            }
            try {
                fn(clientRecord.clientIO);
                count++;
            } catch (error) {
                // Ignore errors in server mode.
                debugClientIOError(
                    `ClientIO error on ${name} for client ${connectionId}: ${error}`,
                );
            }
        }
        return count;
    };

    const callback = <T>(
        requestId: RequestId,
        fn: (clientIO: ClientIO) => T,
    ) => {
        const connectionId = requestId.connectionId;
        if (connectionId === undefined) {
            throw new Error(
                "Cannot perform async call without a connectionId in the requestId",
            );
        }
        const record = clients.get(connectionId);
        if (record === undefined) {
            throw new Error(
                `ClientIO not found for connectionId ${connectionId}`,
            );
        }
        return fn(record.clientIO);
    };

    // Create a routing ClientIO that forwards calls to the current request's client
    // Wraps all methods to catch "Agent channel disconnected" errors gracefully
    const clientIO: ClientIO = {
        clear: (requestId, ...args) =>
            callback(requestId, (clientIO) =>
                clientIO.clear(requestId, ...args),
            ),
        exit: (requestId, ...args) =>
            callback(requestId, (clientIO) =>
                clientIO.exit(requestId, ...args),
            ),
        shutdown: (requestId, ...args) =>
            callback(requestId, (clientIO) =>
                clientIO.shutdown(requestId, ...args),
            ),
        setUserRequest: (requestId, ...args) => {
            broadcast("setUserRequest", requestId, (clientIO) =>
                clientIO.setUserRequest(requestId, ...args),
            );
        },
        setDisplayInfo: (requestId, ...args) => {
            broadcast("setDisplayInfo", requestId, (clientIO) =>
                clientIO.setDisplayInfo(requestId, ...args),
            );
        },
        setDisplay: (message) => {
            broadcast("setDisplay", message.requestId, (clientIO) =>
                clientIO.setDisplay(message),
            );
        },
        appendDisplay: (message, ...args) => {
            broadcast("appendDisplay", message.requestId, (clientIO) =>
                clientIO.appendDisplay(message, ...args),
            );
        },
        appendDiagnosticData: (requestId, ...args) => {
            broadcast("appendDiagnosticData", requestId, (clientIO) =>
                clientIO.appendDiagnosticData(requestId, ...args),
            );
        },
        setDynamicDisplay: (requestId, ...args) => {
            broadcast("setDynamicDisplay", requestId, (clientIO) =>
                clientIO.setDynamicDisplay(requestId, ...args),
            );
        },

        // ===== Async deferred pattern for blocking interactions =====
        // Create a deferred promise and broadcast to all clients; the first
        // client to respondToInteraction resolves it.

        question: async (requestId, message, choices, defaultId?, source?) => {
            const interactionId = randomUUID();
            const request: PendingInteractionRequest = {
                interactionId,
                type: "question",
                ...(requestId !== undefined ? { requestId } : {}),
                source: source ?? requestId?.connectionId ?? "unknown",
                timestamp: Date.now(),
                message,
                choices,
                ...(defaultId !== undefined ? { defaultId } : {}),
            };

            debugInteraction(
                `question created: ${interactionId} message="${message}"`,
            );

            // Broadcast to all connected clients
            broadcast("requestInteraction", requestId, (cio) =>
                cio.requestInteraction(request),
            );

            context.displayLog.logPendingInteraction(request);
            context.displayLog.saveQueued();

            // Mark the running entry blocked so the queue snapshot and
            // no-clients grace timer can react.
            const rid = requestId?.requestId;
            if (rid !== undefined) requestQueue.markBlocked(rid, "interaction");
            try {
                return await pendingInteractions.create<number>(
                    request,
                    INTERACTION_TIMEOUT_MS.question,
                );
            } finally {
                if (rid !== undefined) requestQueue.markUnblocked(rid);
            }
        },

        proposeAction: async (requestId, actionTemplates, source) => {
            const interactionId = randomUUID();
            const request: PendingInteractionRequest = {
                interactionId,
                type: "proposeAction",
                requestId,
                source,
                timestamp: Date.now(),
                actionTemplates,
            };

            debugInteraction(
                `proposeAction created: ${interactionId} source="${source}"`,
            );

            // Log + queue unconditionally so the interaction survives in
            // DisplayLog and is included in JoinSessionResult on next join.
            context.displayLog.logPendingInteraction(request);
            context.displayLog.saveQueued();

            broadcast("requestInteraction", requestId, (cio) =>
                cio.requestInteraction(request),
            );

            const rid = requestId?.requestId;
            if (rid !== undefined) requestQueue.markBlocked(rid, "interaction");
            try {
                return await pendingInteractions.create<unknown>(
                    request,
                    INTERACTION_TIMEOUT_MS.proposeAction,
                );
            } finally {
                if (rid !== undefined) requestQueue.markUnblocked(rid);
            }
        },

        notify: (notificationId, ...args) => {
            broadcast(
                "notify",
                typeof notificationId === "string" ? undefined : notificationId,
                (clientIO) => clientIO.notify(notificationId, ...args),
            );
        },
        openLocalView: async (requestId, ...args) =>
            callback(requestId, (clientIO) =>
                clientIO.openLocalView(requestId, ...args),
            ),
        closeLocalView: async (requestId, ...args) =>
            callback(requestId, (clientIO) =>
                clientIO.closeLocalView(requestId, ...args),
            ),
        requestChoice: (requestId, ...args) =>
            callback(requestId, (clientIO) =>
                clientIO.requestChoice(requestId, ...args),
            ),
        requestInteraction: (interaction) => {
            // Broadcast to all clients
            broadcast("requestInteraction", interaction.requestId, (cio) =>
                cio.requestInteraction(interaction),
            );
        },
        interactionResolved: (interactionId, response) => {
            broadcast("interactionResolved", undefined, (cio) =>
                cio.interactionResolved(interactionId, response),
            );
        },
        interactionCancelled: (interactionId) => {
            broadcast("interactionCancelled", undefined, (cio) =>
                cio.interactionCancelled(interactionId),
            );
        },
        takeAction: (requestId, ...args) =>
            callback(requestId, (clientIO) =>
                clientIO.takeAction(requestId, ...args),
            ),
        onUserFeedback: (entry) => {
            // Fan out to every connected client (including the originator —
            // dispatcher relies on the broadcast for its own local UI update).
            broadcast("onUserFeedback", entry.requestId, (cio) =>
                cio.onUserFeedback?.(entry),
            );
        },
        onUserHide: (entry) => {
            broadcast("onUserHide", entry.requestId, (cio) =>
                cio.onUserHide?.(entry),
            );
        },
    };
    const context = await initializeCommandHandlerContext(hostName, {
        ...options,
        clientIO,
    });

    // Intercept display methods on the shared clientIO to mirror display
    // traffic into the DisplayLog for later replay. Patches context.clientIO
    // (which IS the broadcast `clientIO` above) so future references through
    // context also see the patched version.
    {
        const log = context.displayLog;
        const orig = context.clientIO;

        const origSetUserRequest = orig.setUserRequest.bind(orig);
        orig.setUserRequest = (requestId, ...args) => {
            origSetUserRequest(requestId, ...args);
            log.logUserRequest(requestId, args[0]);
            log.saveQueued();
        };

        const origSetDisplay = orig.setDisplay.bind(orig);
        orig.setDisplay = (message) => {
            origSetDisplay(message);
            // Skip ephemeral toast/inline kinds so they don't replay on reconnect.
            if (message.kind !== "toast" && message.kind !== "inline") {
                log.logSetDisplay(message);
                log.saveQueued();
            }
        };

        const origAppendDisplay = orig.appendDisplay.bind(orig);
        orig.appendDisplay = (message, mode, ...rest) => {
            origAppendDisplay(message, mode, ...rest);
            // Skip ephemeral output: toast/inline kinds and mode === "temporary"
            // (transient status like "Thinking..."). Persisting causes replayed
            // duplicate bubbles and DisplayLog bloat proportional to stream tokens.
            if (
                message.kind !== "toast" &&
                message.kind !== "inline" &&
                mode !== "temporary"
            ) {
                log.logAppendDisplay(message, mode);
                log.saveQueued();
            }
        };

        const origSetDisplayInfo = orig.setDisplayInfo.bind(orig);
        orig.setDisplayInfo = (
            requestId,
            source,
            actionIndex,
            action,
            ...rest
        ) => {
            origSetDisplayInfo(requestId, source, actionIndex, action, ...rest);
            log.logSetDisplayInfo(requestId, source, actionIndex, action);
            log.saveQueued();
        };

        // Notifications are ephemeral by default — only log when the producer
        // explicitly opts in via options.persist.
        const origNotify = orig.notify.bind(orig) as (
            ...args: Parameters<ClientIO["notify"]>
        ) => void;
        orig.notify = (
            notificationId: any,
            event: any,
            data: any,
            source: any,
            seq?: any,
            options?: any,
        ) => {
            origNotify(notificationId, event, data, source, seq, options);
            if (options?.persist === true) {
                log.logNotify(notificationId, event, data, source);
                log.saveQueued();
            }
        };
    }

    const dispatchers = new Map<string, Dispatcher>();
    /**
     * Per-connection inner processCommand functions (wrapped for displayLog +
     * commandComplete broadcast, but NOT for queue submission — these run
     * UNDER the queue's drain loop). The queue executes via this map, falling
     * back to the bare dispatcher if the originator has disconnected.
     */
    const innerProcessCommands = new Map<
        string,
        (
            command: string,
            clientRequestId: unknown,
            attachments: string[] | undefined,
            options: any,
            requestId: string,
        ) => Promise<any>
    >();

    // Bare per-connection dispatcher used by the drain loop when the originator
    // has disconnected. Bypasses per-connection wrappers but still produces
    // setUserRequest/setDisplay broadcasts to remaining clients.
    const bareDispatcher = createDispatcherFromContext(context, undefined);

    // Coalesce `queueStateChanged`: only the last snapshot per window goes on
    // the wire. Fine-grained lifecycle events stay immediate. Version stamps
    // make dropped stale snapshots safe.
    const SNAPSHOT_COALESCE_MS = 100;
    const snapshotCoalescer = createSnapshotCoalescer((snapshot) => {
        broadcast("queueStateChanged", undefined, (cio) =>
            cio.queueStateChanged?.(snapshot),
        );
    }, SNAPSHOT_COALESCE_MS);
    const emitSnapshot = (snapshot: QueueSnapshot): void =>
        snapshotCoalescer.schedule(snapshot);
    const flushPendingSnapshot = (): void => snapshotCoalescer.flush();

    // Per-conversation message queue. Replaces implicit serialization-via-
    // commandLock with an explicit FIFO that broadcasts lifecycle events.
    // The drain loop calls the originator's wrapped inner processCommand so
    // attribution stays correct; if the originator disconnected, falls back
    // to a bare-dispatcher path that ALSO logs results and broadcasts
    // commandComplete to remaining clients.
    const requestQueue = new RequestQueue(
        async (ctx: QueueExecutionContext) => {
            const inner = innerProcessCommands.get(ctx.originatorConnectionId);
            if (inner !== undefined) {
                return inner(
                    ctx.text,
                    ctx.clientRequestId,
                    ctx.attachments,
                    ctx.options,
                    ctx.requestId,
                );
            }
            // Originator-disconnected fallback: run via bareDispatcher, then
            // synthesize the displayLog command-result entry and broadcast
            // commandComplete so peers see completion.
            const result = await bareDispatcher.processCommand(
                ctx.text,
                ctx.clientRequestId,
                ctx.attachments,
                ctx.options,
                ctx.requestId,
            );
            try {
                context.displayLog.logCommandResult(
                    {
                        connectionId: ctx.originatorConnectionId,
                        requestId: ctx.requestId,
                        clientRequestId: ctx.clientRequestId,
                    },
                    result?.metrics,
                    result?.tokenUsage,
                );
                context.displayLog.saveQueued();
            } catch {
                // best-effort
            }
            try {
                broadcast("commandComplete", undefined, (cio) => {
                    cio.notify(
                        {
                            connectionId: ctx.originatorConnectionId,
                            requestId: ctx.requestId,
                            clientRequestId: ctx.clientRequestId,
                        },
                        "commandComplete",
                        { result: result ?? null },
                        "system",
                    );
                });
            } catch (e) {
                debugCommand(`commandComplete (orphan) broadcast failed: ${e}`);
            }
            return result;
        },
        {
            requestQueued: (entry, version) => {
                broadcast("requestQueued", undefined, (cio) =>
                    cio.requestQueued?.(entry, version),
                );
            },
            requestStarted: (entry, version) => {
                broadcast("requestStarted", undefined, (cio) =>
                    cio.requestStarted?.(entry, version),
                );
            },
            requestCancelled: (requestId, reason, version) => {
                broadcast("requestCancelled", undefined, (cio) =>
                    cio.requestCancelled?.(requestId, reason, version),
                );
            },
            queueStateChanged: (snapshot) => {
                emitSnapshot(snapshot);
            },
        },
    );
    const shared: SharedDispatcher = {
        get clientCount() {
            return clients.size;
        },
        get pendingInteractions() {
            return pendingInteractions;
        },
        join(
            clientIO: ClientIO,
            closeFn: () => void,
            options?: DispatcherConnectOptions,
        ): Dispatcher {
            // TODO: Support a stable clientId so a reconnecting client can
            // reclaim its old connectionId. Currently connectionId is ephemeral,
            // so interactions created before disconnect are unroutable after
            // reconnect. See docs/async-clientio-design.md §Open Questions.
            const connectionId = (nextConnectionId++).toString();
            const wasEmpty = clients.size === 0;
            clients.set(connectionId, {
                clientIO,
                filter: options?.filter ?? false,
            });
            // First (re)joining client — clear any pending grace timer.
            if (wasEmpty) {
                requestQueue.onClientReconnected();
            }
            // Register client type for per-request routing
            if (options?.clientType) {
                registerClientType(connectionId, options.clientType);
            }
            const dispatcher = createDispatcherFromContext(
                context,
                connectionId,
                async () => {
                    clients.delete(connectionId);
                    dispatchers.delete(connectionId);
                    innerProcessCommands.delete(connectionId);
                    unregisterClient(connectionId);
                    requestQueue.onClientDisconnect(connectionId);
                    // Last client gone — start grace timer. On expiry the queue
                    // cancels its tail; the onExpiry callback additionally cancels
                    // a running entry blocked on a clientIO interaction (which
                    // would otherwise stall forever).
                    if (clients.size === 0) {
                        requestQueue.onAllClientsDisconnected(
                            noClientsGraceMs,
                            (head) => {
                                if (head?.blockedOn !== "interaction") return;
                                const rid = head.requestId;
                                // Broadcast cancel + prime cancelReason so the
                                // drain loop preserves the reason on rejection.
                                requestQueue.cancelRunning(rid, "no_clients");
                                // command.ts only classifies AbortError-named
                                // errors as cancelled; name it accordingly so
                                // the wire state reads cancelled:no_clients.
                                const abortErr = new Error(
                                    "Cancelled by server: no clients connected",
                                );
                                abortErr.name = "AbortError";
                                try {
                                    for (const pend of pendingInteractions
                                        .getPending()
                                        .filter(
                                            (r) =>
                                                r.requestId?.requestId === rid,
                                        )) {
                                        pendingInteractions.cancel(
                                            pend.interactionId,
                                            abortErr,
                                        );
                                    }
                                } catch (e) {
                                    debugCommand(
                                        `no_clients: failed to cancel pending interactions: ${e}`,
                                    );
                                }
                                // Also abort the controller so any non-interaction
                                // await in the same command tears down.
                                try {
                                    bareDispatcher.cancelCommand(rid);
                                } catch (e) {
                                    debugCommand(
                                        `no_clients: cancelCommand(${rid}) failed: ${e}`,
                                    );
                                }
                            },
                        );
                    }

                    closeFn();
                    debugConnect(
                        `Client disconnected: ${connectionId} (total clients: ${clients.size})`,
                    );
                },
            );
            dispatchers.set(connectionId, dispatcher);
            debugConnect(
                `Client connected: ${connectionId} (total clients: ${clients.size})`,
            );

            // Extend the per-connection dispatcher with respondToInteraction
            // which delegates to the shared PendingInteractionManager
            (dispatcher as any).respondToInteraction = async (
                response: PendingInteractionResponse,
            ): Promise<void> => {
                shared.respondToInteraction(response);
            };

            (dispatcher as any).cancelInteraction = (
                interactionId: string,
            ): void => {
                shared.cancelInteraction(interactionId);
            };

            // Wrap processCommand so each completed request logs a command-result
            // entry into DisplayLog, letting history replay render timing data.
            const origProcessCommand =
                dispatcher.processCommand.bind(dispatcher);
            const innerWrapped = async (
                command: string,
                clientRequestId: unknown,
                attachments: string[] | undefined,
                processOptions: any,
                requestId: string,
            ) => {
                const result = await origProcessCommand(
                    command,
                    clientRequestId,
                    attachments,
                    processOptions,
                    requestId,
                );
                try {
                    context.displayLog.logCommandResult(
                        {
                            connectionId,
                            requestId,
                            clientRequestId,
                        },
                        result?.metrics,
                        result?.tokenUsage,
                    );
                    context.displayLog.saveQueued();
                } catch {
                    // best effort
                }
                try {
                    // Notify peer panels (other clients sharing this session)
                    // so they can clear lingering temporary status messages and
                    // apply timing metrics. Skip the originator: it already
                    // gets the result via its resolved processCommand RPC, and
                    // a duplicate notify would run completion twice (causing a
                    // stray "⚠ Cancelled" bubble in the VS Code webview).
                    let sent = 0;
                    for (const [peerId, peerRecord] of clients) {
                        if (peerId === connectionId) continue;
                        if (peerRecord.filter && peerId !== connectionId) {
                            // Filtered clients only receive their own events.
                            continue;
                        }
                        try {
                            peerRecord.clientIO.notify(
                                {
                                    connectionId,
                                    requestId,
                                    clientRequestId,
                                },
                                "commandComplete",
                                { result: result ?? null },
                                "system",
                            );
                            sent++;
                        } catch (e) {
                            debugClientIOError(
                                `commandComplete notify failed for ${peerId}: ${e}`,
                            );
                        }
                    }
                    debugCommand(
                        `commandComplete broadcast: connectionId=${connectionId} requestId=${requestId} clientRequestId=${clientRequestId} sent=${sent} clients=${clients.size}`,
                    );
                } catch (e) {
                    debugCommand(`commandComplete broadcast failed: ${e}`);
                }
                return result;
            };
            // Register the wrapped function so the queue's drain loop invokes
            // it directly without re-entering the public processCommand wrapper
            // (which would re-queue).
            innerProcessCommands.set(connectionId, innerWrapped);

            // Replace the public processCommand with one that submits to the
            // queue and awaits completion. The drain loop invokes innerWrapped
            // directly via the registry above. CommandHandlerContext.commandLock
            // remains as defense-in-depth.
            dispatcher.processCommand = async (
                command: any,
                clientRequestId?: any,
                attachments?: any,
                processOptions?: any,
                _requestId?: any,
            ) => {
                const submitInput: any = {
                    text: command,
                    originatorConnectionId: connectionId,
                };
                if (attachments != null) submitInput.attachments = attachments;
                if (processOptions != null)
                    submitInput.options = processOptions;
                if (clientRequestId !== undefined)
                    submitInput.clientRequestId = clientRequestId;
                // Typed errors propagate so in-process callers can branch;
                // submitCommand's discriminated SubmitResult handles RPC.
                const entry = requestQueue.submit(submitInput);
                return entry.completion;
            };

            // Capability flag so clients can gate queue-aware UX.
            Object.defineProperty(dispatcher, "supportsQueueing", {
                value: true,
                enumerable: true,
                configurable: false,
                writable: false,
            });

            dispatcher.submitCommand = async (
                command,
                attachments,
                options,
                clientRequestId,
            ): Promise<SubmitResult> => {
                const submitInput: any = {
                    text: command,
                    originatorConnectionId: connectionId,
                };
                if (attachments != null) submitInput.attachments = attachments;
                if (options != null) submitInput.options = options;
                if (clientRequestId !== undefined)
                    submitInput.clientRequestId = clientRequestId;
                // Convert typed errors into discriminated SubmitResult variants
                // so cross-RPC clients receive structured failure information.
                let entry;
                try {
                    entry = requestQueue.submit(submitInput);
                } catch (e) {
                    if (e instanceof QueueFullError) {
                        return {
                            ok: false,
                            error: "queue_full",
                            maxDepth: e.maxDepth,
                        };
                    }
                    if (e instanceof ServerStoppingError) {
                        return { ok: false, error: "server_stopping" };
                    }
                    throw e;
                }
                // Ack-only submit never awaits entry.completion; attach a
                // passive catch so a drain-loop rejection (or abandon-for-
                // shutdown) doesn't surface as unhandledRejection. Other
                // awaiters' `.catch` chains remain independent.
                void entry.completion.catch((e) => {
                    debugCommand(
                        `submit:completion-error rid=${entry.requestId} ${e instanceof Error ? e.message : String(e)}`,
                    );
                });
                // Don't await; submitCommand returns once queued. Build a
                // wire-safe copy (no raw attachments).
                const out: QueuedRequest = {
                    requestId: entry.requestId,
                    originatorConnectionId: entry.originatorConnectionId,
                    text: entry.text,
                    submittedAt: entry.submittedAt,
                    state: entry.state,
                };
                if (entry.clientRequestId !== undefined)
                    out.clientRequestId = entry.clientRequestId;
                // Always advertise attachmentCount so submit-response and
                // snapshot/broadcast copies stay consistent (0 if none).
                out.attachmentCount = entry.attachmentCount ?? 0;
                if (entry.options !== undefined) out.options = entry.options;
                if (entry.startedAt !== undefined)
                    out.startedAt = entry.startedAt;
                if (entry.finishedAt !== undefined)
                    out.finishedAt = entry.finishedAt;
                if (entry.error !== undefined) out.error = entry.error;
                return { ok: true, entry: out };
            };

            dispatcher.getQueueSnapshot = async () => {
                return requestQueue.getSnapshot();
            };

            // Cancel hook: classify the requestId, route the running case
            // through the existing AbortController path, and return a typed
            // CancelResult so clients can render an honest message.
            const origCancelCommand = dispatcher.cancelCommand.bind(dispatcher);
            dispatcher.cancelCommand = async (
                rid: string,
            ): Promise<CancelResult> => {
                const kind = requestQueue.classifyCancel(rid, "user");
                if (kind === "queued") {
                    return { kind: "cancelled_queued", requestId: rid };
                }
                if (kind === "running") {
                    // Broadcast immediately so other clients see the cancel
                    // before the drain loop finishes. Idempotent.
                    requestQueue.cancelRunning(rid, "user");
                    // Fire the AbortController via the original cancelCommand.
                    try {
                        await Promise.resolve(origCancelCommand(rid));
                    } catch {
                        // best effort
                    }
                    return { kind: "cancelled_running", requestId: rid };
                }
                // Phase 1 does not track completion history.
                return { kind: "not_found", requestId: rid };
            };

            // Steering: cancel-current-and-replace. Atomic by virtue of the
            // single-threaded JS event loop; safe in either order because new
            // submits always push to the tail.
            dispatcher.interrupt = async (
                command,
                attachments,
                options,
                clientRequestId,
            ): Promise<SubmitResult> => {
                const submitInput: any = {
                    text: command,
                    originatorConnectionId: connectionId,
                };
                if (attachments != null) submitInput.attachments = attachments;
                if (options != null) submitInput.options = options;
                if (clientRequestId !== undefined)
                    submitInput.clientRequestId = clientRequestId;
                let entry;
                try {
                    entry = requestQueue.interrupt(submitInput);
                } catch (e) {
                    if (e instanceof QueueFullError) {
                        return {
                            ok: false,
                            error: "queue_full",
                            maxDepth: e.maxDepth,
                        };
                    }
                    if (e instanceof ServerStoppingError) {
                        return { ok: false, error: "server_stopping" };
                    }
                    throw e;
                }
                // Ack-only RPC; mirror submitCommand's passive completion catch.
                void entry.completion.catch((e) => {
                    debugCommand(
                        `interrupt:completion-error rid=${entry.requestId} ${e instanceof Error ? e.message : String(e)}`,
                    );
                });
                // Cancel the previously-running entry, if any. Use the snapshot
                // captured *after* the unshift so we don't cancel the interrupting
                // entry itself (still in tail, not running).
                const snap = requestQueue.getSnapshot();
                if (
                    snap.running !== null &&
                    snap.running.requestId !== entry.requestId
                ) {
                    // Broadcast immediately so other clients see the cancel.
                    requestQueue.cancelRunning(snap.running.requestId, "user");
                    try {
                        await Promise.resolve(
                            origCancelCommand(snap.running.requestId),
                        );
                    } catch {
                        // best-effort; prepend has already taken effect
                    }
                }
                // Wire-safe copy (same shape as submitCommand).
                const out: QueuedRequest = {
                    requestId: entry.requestId,
                    originatorConnectionId: entry.originatorConnectionId,
                    text: entry.text,
                    submittedAt: entry.submittedAt,
                    state: entry.state,
                };
                if (entry.clientRequestId !== undefined)
                    out.clientRequestId = entry.clientRequestId;
                out.attachmentCount = entry.attachmentCount ?? 0;
                if (entry.options !== undefined) out.options = entry.options;
                if (entry.startedAt !== undefined)
                    out.startedAt = entry.startedAt;
                if (entry.finishedAt !== undefined)
                    out.finishedAt = entry.finishedAt;
                if (entry.error !== undefined) out.error = entry.error;
                return { ok: true, entry: out };
            };

            return dispatcher;
        },
        respondToInteraction(response: PendingInteractionResponse): void {
            debugInteraction(
                `respondToInteraction: ${response.interactionId} type=${response.type}`,
            );
            const resolved = pendingInteractions.resolve(
                response.interactionId,
                response.value,
            );
            if (!resolved) {
                debugInteraction(
                    `respondToInteraction: interaction ${response.interactionId} not found (may have expired or been resolved already)`,
                );
            } else {
                // Notify all clients that this interaction was resolved
                broadcast("interactionResolved", undefined, (cio) =>
                    cio.interactionResolved(
                        response.interactionId,
                        response.value,
                    ),
                );

                // Log the resolution
                context.displayLog.logInteractionResolved(
                    response.interactionId,
                    response.value,
                );
                context.displayLog.saveQueued();
            }
        },
        cancelInteraction(interactionId: string): void {
            debugInteraction(`cancelInteraction: ${interactionId}`);
            const cancelled = pendingInteractions.cancel(
                interactionId,
                new Error("Cancelled by client"),
            );
            if (!cancelled) {
                debugInteraction(
                    `cancelInteraction: interaction ${interactionId} not found (may have expired or been resolved already)`,
                );
            } else {
                broadcast("interactionCancelled", undefined, (cio) =>
                    cio.interactionCancelled(interactionId),
                );
                context.displayLog.logInteractionCancelled(interactionId);
                context.displayLog.saveQueued();
            }
        },
        getPendingInteractions(
            connectionId: string,
            filter: boolean,
        ): PendingInteractionRequest[] {
            return pendingInteractions.getPending().filter((r) => {
                const targetConnection = r.requestId?.connectionId;
                if (filter) {
                    // Filtered client: only interactions routed to this connection
                    return targetConnection === connectionId;
                }
                // Unfiltered client: interactions broadcast to all, plus those
                // routed specifically to this connection
                return (
                    targetConnection === undefined ||
                    targetConnection === connectionId
                );
            });
        },
        broadcastSystemMessage(
            message: string,
            excludeConnectionId?: string,
        ): void {
            // "system" is a reserved requestId sentinel for server-broadcast
            // messages. The renderer (chatView.ts) checks for it to auto-create
            // a notification MessageGroup — keep these in sync.
            const agentMessage = {
                message: {
                    type: "text" as const,
                    content: message,
                    kind: "status" as const,
                },
                requestId: { requestId: "system" },
                source: "system",
            };
            for (const [connectionId, clientRecord] of clients) {
                if (connectionId === excludeConnectionId) {
                    continue;
                }
                try {
                    clientRecord.clientIO.appendDisplay(agentMessage, "block");
                } catch (error) {
                    debugClientIOError(
                        `ClientIO error on broadcastSystemMessage for client ${connectionId}: ${error}`,
                    );
                }
            }
        },
        async leave(connectionId: string) {
            const dispatcher = dispatchers.get(connectionId);
            if (dispatcher) {
                // Remove synchronously so clientCount reflects post-leave state
                // before any async close work completes. The close callback
                // also calls clients.delete; the double-delete is idempotent.
                clients.delete(connectionId);
                await dispatcher.close();
            }
        },
        async closeAllClients() {
            const promises: Promise<void>[] = [];
            for (const dispatcher of dispatchers.values()) {
                promises.push(dispatcher.close());
            }
            await Promise.all(promises);
        },
        async close() {
            pendingInteractions.cancelAll(
                new Error("SharedDispatcher closing"),
            );
            // Drain so in-flight/queued entries settle before teardown.
            try {
                await requestQueue.drainAndStop();
            } catch {
                // best-effort
            }
            // Flush coalesced snapshot so the final state is observed.
            flushPendingSnapshot();
            await this.closeAllClients();
            await closeCommandHandlerContext(context);
        },
        getQueueSnapshot(): QueueSnapshot {
            return requestQueue.getSnapshot();
        },
        isQueueIdle(): boolean {
            return requestQueue.isIdle();
        },
        cancelQueued(requestId: string, reason: QueueCancelReason): boolean {
            return requestQueue.cancelQueued(requestId, reason);
        },
        __testSetNoClientsGraceMs(ms: number): void {
            noClientsGraceMs = ms;
        },
    };
    return shared;
}

export type SharedDispatcher = {
    readonly clientCount: number;
    readonly pendingInteractions: PendingInteractionManager;
    join(
        clientIO: ClientIO,
        closeFn: () => void,
        options?: DispatcherConnectOptions,
    ): Dispatcher;
    respondToInteraction(response: PendingInteractionResponse): void;
    cancelInteraction(interactionId: string): void;
    getPendingInteractions(
        connectionId: string,
        filter: boolean,
    ): PendingInteractionRequest[];
    leave(connectionId: string): Promise<void>;
    broadcastSystemMessage(message: string, excludeConnectionId?: string): void;
    closeAllClients(): Promise<void>;
    close(): Promise<void>;
    /** Snapshot of the per-conversation message queue. */
    getQueueSnapshot(): QueueSnapshot;
    /** True iff the queue has nothing running and nothing queued. */
    isQueueIdle(): boolean;
    /** Cancel a queued (not running) entry by requestId. */
    cancelQueued(requestId: string, reason: QueueCancelReason): boolean;
    /** @internal Test-only: tighten the no-clients grace window. */
    __testSetNoClientsGraceMs(ms: number): void;
};
