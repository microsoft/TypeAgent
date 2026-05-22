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

    // Grace period before the request queue cancels its contents
    // after the last client disconnects. Tunable per-test via
    // `__testSetNoClientsGraceMs`. See messageQueueing.md §11.4.
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
        // Instead of blocking via callback(), we create a deferred promise
        // and broadcast the request to all clients. The first client to
        // respond via respondToInteraction resolves the promise.

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

            // Mark the running entry as blocked on the interaction so
            // the queue snapshot reflects it (used by the no-clients
            // grace timer in §11.4 and by client-side UX badges).
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

            // Log and queue unconditionally so the interaction survives in
            // the DisplayLog and is included in JoinSessionResult.pendingInteractions
            // on the next join.
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
            // Fan out the rating change to every connected client (including
            // the originator — the dispatcher relies on the broadcast for its
            // own local UI update too).
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

    // Intercept the three display methods on the shared clientIO so that all
    // display traffic is mirrored into the DisplayLog for later replay.
    // We patch context.clientIO (which IS the broadcast `clientIO` object above)
    // rather than the local variable so any future reference through context also
    // sees the patched version.
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
            // Toast and inline kinds are ephemeral (visual notifications, not
            // chat history). Skip logging so they don't replay on reconnect —
            // matches notify's default-not-persisted behavior. Bubble (or
            // absent kind = a normal request response) always logs.
            if (message.kind !== "toast" && message.kind !== "inline") {
                log.logSetDisplay(message);
                log.saveQueued();
            }
        };

        const origAppendDisplay = orig.appendDisplay.bind(orig);
        orig.appendDisplay = (message, mode, ...rest) => {
            origAppendDisplay(message, mode, ...rest);
            // Skip ephemeral output:
            //   - toast/inline kinds (visual-only notifications)
            //   - mode === "temporary" (transient status indicators like
            //     "Executing action ...", reasoning's "Thinking..." stream).
            // Persisting either causes replayed bubbles on reconnect,
            // DisplayLog growth proportional to streaming tokens, and
            // apparent "duplicate" bubbles next to the real reply.
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
        // explicitly opts in via options.persist. Agents (e.g. OS-notification
        // forwarding) that should never enter durable history MUST leave the
        // flag unset.
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
     * Per-connection inner processCommand functions (wrapped for
     * displayLog + commandComplete broadcast, but NOT wrapped for
     * queue submission — these run UNDER the queue's drain loop).
     * SharedDispatcher's queue executes via this map; falling back to
     * the bare dispatcher if the originator has disconnected.
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

    // Bare per-connection dispatcher used by the queue's drain loop when
    // the originator has disconnected — bypasses the per-connection
    // wrappers (DisplayLog commandComplete, etc.) but still produces
    // setUserRequest/setDisplay broadcasts to remaining clients.
    const bareDispatcher = createDispatcherFromContext(context, undefined);

    // Coalesce `queueStateChanged` broadcasts: only the **last**
    // snapshot per `SNAPSHOT_COALESCE_MS` window goes out on the
    // wire. Fine-grained lifecycle events (queued/started/cancelled)
    // stay immediate. Bounded event volume under bursty submits +
    // version-stamped snapshots = stale broadcasts are safe to drop.
    // See messageQueueing.md §8.2.
    const SNAPSHOT_COALESCE_MS = 100;
    const snapshotCoalescer = createSnapshotCoalescer((snapshot) => {
        broadcast("queueStateChanged", undefined, (cio) =>
            cio.queueStateChanged?.(snapshot),
        );
    }, SNAPSHOT_COALESCE_MS);
    const emitSnapshot = (snapshot: QueueSnapshot): void =>
        snapshotCoalescer.schedule(snapshot);
    const flushPendingSnapshot = (): void => snapshotCoalescer.flush();

    // ===== Message queue (Phase 1) =====
    // One queue per conversation. Replaces implicit serialization-via-
    // commandLock with an explicit FIFO that broadcasts lifecycle
    // events to every connected client.
    //
    // The drain loop calls the originator's wrapped inner processCommand
    // (display logging + commandComplete broadcast) so attribution stays
    // correct when the originator is still connected. If they
    // disconnected, fall back to a bare-dispatcher path that ALSO logs
    // the result and broadcasts commandComplete to remaining clients —
    // F8 / R2P-H-2: peers must see completion regardless of originator
    // presence.
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
            // ── Originator disconnected fallback (F8) ──
            // Run via the bare dispatcher, then synthesize the
            // displayLog command-result entry AND broadcast
            // commandComplete to every still-connected client. Without
            // this peers never see completion for entries whose
            // originator left mid-queue.
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
                // Originator is gone; broadcast helper iterates only
                // live clients, so duplication isn't a concern.
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
            // TODO: Support a stable clientId in DispatcherConnectOptions so that a
            // reconnecting client can reclaim its old connectionId (or have pending
            // interactions retargeted to its new one).  Currently connectionId is
            // ephemeral: each join() mints a fresh value, so askYesNo/proposeAction
            // interactions created before a disconnect are permanently unroutable to
            // the reconnected client because requestId.connectionId no longer matches
            // and getPendingInteractions() filters them out.  See
            // docs/async-clientio-design.md §Open Questions for the full design note.
            const connectionId = (nextConnectionId++).toString();
            const wasEmpty = clients.size === 0;
            clients.set(connectionId, {
                clientIO,
                filter: options?.filter ?? false,
            });
            // First client (re)joining after a period of no clients —
            // clear any pending grace timer so the queue keeps
            // running. See messageQueueing.md §11.4.
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
                    // Last client disconnected — start the 30s grace
                    // timer. On expiry the queue cancels its tail
                    // with reason "no_clients"; the onExpiry callback
                    // additionally cancels a running entry that is
                    // blocked on a clientIO interaction (the entry
                    // would otherwise stall forever waiting for a
                    // response from a non-existent client). See
                    // messageQueueing.md §11.4.
                    if (clients.size === 0) {
                        requestQueue.onAllClientsDisconnected(
                            noClientsGraceMs,
                            (head) => {
                                if (head?.blockedOn !== "interaction") return;
                                const rid = head.requestId;
                                // R2 review fix: broadcast
                                // requestCancelled(no_clients) for
                                // the running entry so any reconnecting
                                // client sees the explicit cancel.
                                // Also primes entry.cancelReason so
                                // the drain loop preserves the reason
                                // when the awaiting agent rejects.
                                requestQueue.cancelRunning(rid, "no_clients");
                                // R3 review fix: pendingInteractions
                                // rejects awaited promises with the
                                // Error we pass; command.ts only
                                // classifies `e.name === "AbortError"`
                                // as cancelled, so name the Error
                                // accordingly. Otherwise the agent's
                                // throw would surface as `failed`
                                // instead of `cancelled:no_clients`.
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
                                // Also abort the controller so any
                                // non-interaction await in the same
                                // command tears down.
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

            // Wrap processCommand so each completed request logs a
            // command-result entry into the DisplayLog (carrying its
            // metrics). This lets history replay re-render timing data
            // exactly the way live commandComplete does.
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
                    // Notify peer panels (other clients sharing this
                    // session) that the command finished so they can
                    // clear lingering temporary status messages and
                    // apply timing metrics. We deliberately skip the
                    // originator: it already gets the result back via
                    // the resolved processCommand RPC promise, and a
                    // duplicate notify would run completion twice (in
                    // the VS Code webview that produces a stray
                    // "⚠ Cancelled" bubble after the first pass cleared
                    // the request mapping).
                    let sent = 0;
                    for (const [peerId, peerRecord] of clients) {
                        if (peerId === connectionId) continue;
                        if (peerRecord.filter && peerId !== connectionId) {
                            // Filtered clients only receive their own
                            // events; don't leak peer completions.
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
            // Register the inner-wrapped function so the message queue's
            // drain loop can invoke it directly without re-entering the
            // public processCommand wrapper (which would re-queue).
            innerProcessCommands.set(connectionId, innerWrapped);

            // ===== Message-queue integration (Phase 1) =====
            // Replace the public processCommand with one that submits to
            // the queue and awaits completion. Direct callers continue
            // to get Promise<CommandResult> semantics. The queue's drain
            // loop invokes `innerWrapped` directly via the registry
            // above, so there is no need (or way) to bypass the queue
            // by passing a `requestId` to processCommand.
            //
            // CommandHandlerContext.commandLock remains as
            // defense-in-depth — the RequestQueue already serializes
            // commands at this layer.
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
                // submit() may throw QueueFullError or
                // ServerStoppingError. Let the typed errors propagate
                // so in-process callers can branch; the discriminated
                // SubmitResult on submitCommand handles the cross-RPC
                // case.
                const entry = requestQueue.submit(submitInput);
                return entry.completion;
            };

            // Mark this dispatcher as queue-backed so clients can gate
            // queue-aware UX on the capability flag.
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
                // F5/F7 (R2-H-1, R2P-M-3): convert typed errors into
                // discriminated result variants so cross-RPC clients
                // receive structured failure information instead of a
                // flattened generic Error.
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
                // R1 review fix: the ack-only submit path returns the
                // entry without ever awaiting `entry.completion`. The
                // drain loop rejects that promise on execution failure
                // (or via abandonForShutdown), which would otherwise
                // surface as an unhandledRejection and potentially
                // terminate the Node process. Attach a passive catch
                // that logs at debug level. Other awaiters (e.g. the
                // legacy `processCommand` wrapper) still see their own
                // rejection — `.catch` chains independently.
                void entry.completion.catch((e) => {
                    debugCommand(
                        `submit:completion-error rid=${entry.requestId} ${e instanceof Error ? e.message : String(e)}`,
                    );
                });
                // Don't await completion — submitCommand returns as
                // soon as the entry is queued. Build a wire-safe copy
                // (no raw attachments — see B.1 redaction rule).
                const out: QueuedRequest = {
                    requestId: entry.requestId,
                    originatorConnectionId: entry.originatorConnectionId,
                    text: entry.text,
                    submittedAt: entry.submittedAt,
                    state: entry.state,
                    attempt: entry.attempt,
                };
                if (entry.clientRequestId !== undefined)
                    out.clientRequestId = entry.clientRequestId;
                // F2 (R2-L-2): always advertise attachmentCount so
                // submit-response and snapshot/broadcast copies stay
                // consistent (zero when there are none).
                out.attachmentCount = entry.attachmentCount ?? 0;
                if (entry.options !== undefined) out.options = entry.options;
                if (entry.startedAt !== undefined)
                    out.startedAt = entry.startedAt;
                if (entry.finishedAt !== undefined)
                    out.finishedAt = entry.finishedAt;
                if (entry.schemaHint !== undefined)
                    out.schemaHint = entry.schemaHint;
                if (entry.activityHint !== undefined)
                    out.activityHint = entry.activityHint;
                if (entry.error !== undefined) out.error = entry.error;
                return { ok: true, entry: out };
            };

            dispatcher.getQueueSnapshot = async () => {
                return requestQueue.getSnapshot();
            };

            // Hook cancellation: classify the requestId against the
            // queue (queued / running / not_found) and route the
            // running case through the existing AbortController path.
            // Returns a typed CancelResult so clients can render an
            // honest message instead of a generic "cancel requested".
            const origCancelCommand = dispatcher.cancelCommand.bind(dispatcher);
            dispatcher.cancelCommand = async (
                rid: string,
            ): Promise<CancelResult> => {
                const kind = requestQueue.classifyCancel(rid, "user");
                if (kind === "queued") {
                    return { kind: "cancelled_queued", requestId: rid };
                }
                if (kind === "running") {
                    // R2 review fix: broadcast requestCancelled for
                    // the running entry so other clients see the
                    // explicit cancel event (not just an eventual
                    // queueStateChanged when the drain loop finishes).
                    // Idempotent: a second cancelRunning is a no-op.
                    requestQueue.cancelRunning(rid, "user");
                    // Fire the AbortController via the original
                    // dispatcher.cancelCommand. Note: original is
                    // sync void; we ignore its return.
                    try {
                        await Promise.resolve(origCancelCommand(rid));
                    } catch {
                        // best effort
                    }
                    return { kind: "cancelled_running", requestId: rid };
                }
                // Phase 1 does not track completion history — report
                // not_found rather than already_completed.
                return { kind: "not_found", requestId: rid };
            };

            // Steering: cancel-current-and-replace. Atomicity is
            // guaranteed by the single-threaded JS event loop — the
            // prepend and the cancel both run synchronously before
            // any other client's submit can land. The two steps are
            // safe in either order because new submits always `push`
            // (tail end), so they cannot race ahead of an unshifted
            // interrupt. See messageSteering.md §4.5.
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
                // R1 review fix (mirror of submitCommand) — interrupt
                // is also an ack-only RPC. See submitCommand comment
                // above for the rationale.
                void entry.completion.catch((e) => {
                    debugCommand(
                        `interrupt:completion-error rid=${entry.requestId} ${e instanceof Error ? e.message : String(e)}`,
                    );
                });
                // Cancel the previously-running entry, if any. Use the
                // snapshot captured *after* the unshift so we never
                // accidentally cancel the interrupting entry itself
                // (it is still in tail, not running).
                const snap = requestQueue.getSnapshot();
                if (
                    snap.running !== null &&
                    snap.running.requestId !== entry.requestId
                ) {
                    // R2 review fix: broadcast requestCancelled for
                    // the interrupted entry so other clients see the
                    // explicit cancel event. Use reason "user" —
                    // interrupt is a user-initiated cancel of the
                    // previously-running request.
                    requestQueue.cancelRunning(snap.running.requestId, "user");
                    try {
                        await Promise.resolve(
                            origCancelCommand(snap.running.requestId),
                        );
                    } catch {
                        // best-effort; the prepend has already taken effect
                    }
                }
                // Build a wire-safe copy (same shape as submitCommand).
                const out: QueuedRequest = {
                    requestId: entry.requestId,
                    originatorConnectionId: entry.originatorConnectionId,
                    text: entry.text,
                    submittedAt: entry.submittedAt,
                    state: entry.state,
                    attempt: entry.attempt,
                };
                if (entry.clientRequestId !== undefined)
                    out.clientRequestId = entry.clientRequestId;
                out.attachmentCount = entry.attachmentCount ?? 0;
                if (entry.options !== undefined) out.options = entry.options;
                if (entry.startedAt !== undefined)
                    out.startedAt = entry.startedAt;
                if (entry.finishedAt !== undefined)
                    out.finishedAt = entry.finishedAt;
                if (entry.schemaHint !== undefined)
                    out.schemaHint = entry.schemaHint;
                if (entry.activityHint !== undefined)
                    out.activityHint = entry.activityHint;
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
            // "system" is a reserved requestId sentinel used to identify
            // server-broadcast messages (e.g. client join/leave notifications).
            // It can never collide with a real UUID from randomUUID().
            // The renderer (chatView.ts) checks for this sentinel to auto-create
            // a notification MessageGroup — keep these two values in sync.
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
                // Remove from clients synchronously so clientCount reflects the
                // post-leave state before any async close work completes.
                // The close callback also calls clients.delete, but that is
                // idempotent so the double-delete is harmless.
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
            // Cancel all pending interactions
            pendingInteractions.cancelAll(
                new Error("SharedDispatcher closing"),
            );
            // Drain the message queue so any in-flight or queued
            // entry settles before we tear down the dispatcher.
            try {
                await requestQueue.drainAndStop();
            } catch {
                // best-effort
            }
            // Flush any pending coalesced snapshot so the final state
            // is observed by clients before they get disconnected.
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
