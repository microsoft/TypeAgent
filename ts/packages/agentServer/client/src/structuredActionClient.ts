// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomUUID } from "node:crypto";
import {
    connectAgentServer,
    type AgentServerConnection,
} from "./agentServerClient.js";
import { AGENT_SERVER_DEFAULT_URL } from "@typeagent/agent-server-protocol";
import type {
    ClientIO,
    Dispatcher,
    ActionSearchRequest,
    ActionIdentity,
    ExecuteActionRequest,
    ContinueActionRequest,
    CancelActionRequest,
} from "@typeagent/dispatcher-rpc/types";
import { findOrCreateNamedConversation } from "./conversation/lifecycle.js";

export interface StructuredActionClientOptions {
    url?: string;
    conversationId?: string;
    clientIO?: ClientIO;
    /** Called once when this client needs its own named conversation. */
    createConversationName?: () => string;
    /** Optional connection factory for embedded transports and offline tests. */
    connect?: (onDisconnect: () => void) => Promise<AgentServerConnection>;
}

/** Public metadata only. Never contains the private resume capability. */
export interface StructuredActionBinding {
    conversationId?: string;
    connected: boolean;
}

export type StructuredActionClientErrorReason =
    | "connection_failed"
    | "binding_unavailable"
    | "resume_rejected"
    | "resume_failed"
    | "conversation_not_found"
    | "client_closed"
    | "caller_cancelled"
    | "delivery_uncertain";

const errorMessages: Record<StructuredActionClientErrorReason, string> = {
    connection_failed:
        "The structured request was not dispatched. Unable to establish the TypeAgent connection.",
    binding_unavailable:
        "The structured request was not dispatched. The server did not provide a usable binding, or the initial binding reply was lost. No replacement owner was created.",
    resume_rejected:
        "The server rejected resuming the structured binding. The capability may be invalid, belong to another conversation, have expired, or have been lost after a session or host restart. No replacement owner was created. Do not replay interrupted work.",
    resume_failed:
        "Unable to resume the existing structured binding. No replacement owner was created. Prior delivery may be uncertain; do not replay interrupted work.",
    conversation_not_found:
        "The requested structured conversation no longer exists. No replacement conversation or owner was created. Do not replay interrupted work.",
    client_closed:
        "The structured client is closed; this request was not dispatched. Closing does not imply cancellation or rollback of prior work.",
    caller_cancelled:
        "The caller cancelled this structured request. Cancellation does not establish rollback or completion; do not replay a dispatched call.",
    delivery_uncertain:
        "No authoritative structured result was received. Delivery is uncertain; do not replay the call.",
};

/** No raw transport exception is exposed, since it may contain join arguments. */
export class StructuredActionClientError extends Error {
    constructor(
        readonly dispatched: boolean,
        readonly reason: StructuredActionClientErrorReason = dispatched
            ? "delivery_uncertain"
            : "connection_failed",
    ) {
        super(errorMessages[reason]);
        this.name = "StructuredActionClientError";
    }
}

function joinFailureReason(
    error: unknown,
    resuming: boolean,
): StructuredActionClientErrorReason {
    // The RPC protocol currently flattens server errors to messages. Match only
    // known protocol rejections; never return or interpolate server text.
    const message = error instanceof Error ? error.message : undefined;
    if (message?.startsWith("Conversation not found:")) {
        return "conversation_not_found";
    }
    if (resuming) {
        if (
            message === "Invalid structured action resume capability" ||
            message ===
                "Structured action resume state is unavailable; do not replay an interrupted action" ||
            message === "Structured action binding is closed"
        ) {
            return "resume_rejected";
        }
        return "resume_failed";
    }
    return "binding_unavailable";
}

function defaultClientIO(): ClientIO {
    const unsupported = async (): Promise<never> => {
        throw new Error(
            "Structured interactions require an explicit user response through continueAction.",
        );
    };
    return {
        clear() {},
        exit() {},
        setUserRequest() {},
        setDisplayInfo() {},
        setDisplay() {},
        appendDisplay() {},
        appendDiagnosticData() {},
        setDynamicDisplay() {},
        notify() {},
        takeAction() {},
        shutdown() {},
        async openLocalView() {},
        async closeLocalView() {},
        question: unsupported,
        askForm: unsupported,
        proposeAction: unsupported,
        requestChoice() {},
        requestForm() {},
        requestInteraction() {},
        interactionResolved() {},
        interactionCancelled() {},
    };
}

/**
 * One explicit server binding per long-lived caller. The resume capability
 * never leaves this object. A new process cannot adopt another process's
 * pending work merely by using the same public conversation id.
 */
export class StructuredActionClient {
    #resumeToken: string | undefined;
    #conversationId: string | undefined;
    #connection: AgentServerConnection | undefined;
    #dispatcher: Dispatcher | undefined;
    #connecting: Promise<Dispatcher> | undefined;
    #closed = false;
    #joinAttempted = false;
    #generation = 0;
    #name: string | undefined;
    readonly #createConversationName: () => string;
    readonly #clientIO: ClientIO;
    readonly #connect: NonNullable<StructuredActionClientOptions["connect"]>;

    constructor(options: StructuredActionClientOptions = {}) {
        const configured = options.conversationId;
        if (
            configured !== undefined &&
            (typeof configured !== "string" || !configured.trim())
        ) {
            throw new Error("TypeAgent conversationId must not be empty.");
        }
        this.#conversationId = configured;
        this.#clientIO = options.clientIO ?? defaultClientIO();
        this.#createConversationName =
            options.createConversationName ??
            (() => `Structured actions ${randomUUID()}`);
        this.#connect =
            options.connect ??
            ((onDisconnect) =>
                connectAgentServer(
                    options.url ?? AGENT_SERVER_DEFAULT_URL,
                    onDisconnect,
                ));
    }

    get binding(): StructuredActionBinding {
        return {
            ...(this.#conversationId === undefined
                ? {}
                : { conversationId: this.#conversationId }),
            connected: this.#dispatcher !== undefined && !this.#closed,
        };
    }

    searchActions(request?: ActionSearchRequest, signal?: AbortSignal) {
        return this.invoke(
            (dispatcher) => dispatcher.searchActions(request),
            signal,
        );
    }

    getActionContract(identity: ActionIdentity, signal?: AbortSignal) {
        return this.invoke(
            (dispatcher) => dispatcher.getActionContract(identity),
            signal,
        );
    }

    executeAction(request: ExecuteActionRequest, signal?: AbortSignal) {
        return this.invoke(
            (dispatcher) => dispatcher.executeAction(request),
            signal,
        );
    }

    continueAction(request: ContinueActionRequest, signal?: AbortSignal) {
        return this.invoke(
            (dispatcher) => dispatcher.continueAction(request),
            signal,
        );
    }

    cancelAction(request: CancelActionRequest, signal?: AbortSignal) {
        return this.invoke(
            (dispatcher) => dispatcher.cancelAction(request),
            signal,
        );
    }

    private async invoke<T>(
        operation: (dispatcher: Dispatcher) => Promise<T>,
        signal?: AbortSignal,
    ): Promise<T> {
        let dispatched = false;
        let onAbort: (() => void) | undefined;
        const work = async () => {
            if (signal?.aborted)
                throw new StructuredActionClientError(
                    false,
                    "caller_cancelled",
                );
            const dispatcher = await this.dispatcher();
            if (signal?.aborted)
                throw new StructuredActionClientError(
                    false,
                    "caller_cancelled",
                );
            dispatched = true;
            return operation(dispatcher);
        };
        try {
            const aborted = new Promise<never>((_, reject) => {
                onAbort = () =>
                    reject(
                        new StructuredActionClientError(
                            dispatched,
                            "caller_cancelled",
                        ),
                    );
                signal?.addEventListener("abort", onAbort, { once: true });
            });
            return await Promise.race([work(), aborted]);
        } catch (error) {
            if (error instanceof StructuredActionClientError) throw error;
            throw new StructuredActionClientError(dispatched);
        } finally {
            if (onAbort) signal?.removeEventListener("abort", onAbort);
        }
    }

    private async dispatcher(): Promise<Dispatcher> {
        if (this.#closed)
            throw new StructuredActionClientError(false, "client_closed");
        if (this.#dispatcher) return this.#dispatcher;
        if (!this.#connecting) {
            this.#connecting = this.connect().finally(() => {
                this.#connecting = undefined;
            });
        }
        return this.#connecting;
    }

    private async connect(): Promise<Dispatcher> {
        // A failed join may have created an owner but lost its reply. Without
        // its capability there is no safe way to recover that owner.
        if (this.#joinAttempted && this.#resumeToken === undefined) {
            throw new StructuredActionClientError(false, "binding_unavailable");
        }
        const generation = ++this.#generation;
        let connected = true;
        let joining = false;
        const resuming = this.#resumeToken !== undefined;
        let connection: AgentServerConnection | undefined;
        try {
            connection = await this.#connect(() => {
                connected = false;
                if (this.#generation === generation) {
                    this.#dispatcher = undefined;
                    this.#connection = undefined;
                }
            });
            if (this.#conversationId === undefined) {
                this.#name ??= this.#createConversationName();
                const conversation = await findOrCreateNamedConversation(
                    connection,
                    this.#name,
                );
                this.#conversationId = conversation.conversationId;
            }
            if (this.#closed)
                throw new StructuredActionClientError(false, "client_closed");
            this.#joinAttempted = true;
            joining = true;
            const joined = await connection.joinConversation(this.#clientIO, {
                conversationId: this.#conversationId,
                structuredActions:
                    this.#resumeToken === undefined
                        ? {}
                        : { resumeToken: this.#resumeToken },
            });
            if (
                joined.structuredActions === undefined ||
                joined.conversationId !== this.#conversationId
            ) {
                throw new StructuredActionClientError(
                    false,
                    resuming ? "resume_failed" : "binding_unavailable",
                );
            }
            this.#resumeToken = joined.structuredActions.resumeToken;
            if (this.#closed)
                throw new StructuredActionClientError(false, "client_closed");
            if (!connected)
                throw new StructuredActionClientError(
                    false,
                    "connection_failed",
                );
            this.#connection = connection;
            this.#dispatcher = joined.dispatcher;
            return joined.dispatcher;
        } catch (error) {
            // Transport errors may include serialized join arguments. Never
            // expose their text (in particular the private resume capability).
            await connection?.close().catch(() => {});
            if (error instanceof StructuredActionClientError) throw error;
            throw new StructuredActionClientError(
                false,
                joining
                    ? joinFailureReason(error, resuming)
                    : "connection_failed",
            );
        }
    }

    /** Disconnect without claiming pending work was cancelled or rolled back. */
    async close(): Promise<void> {
        this.#closed = true;
        await this.#connecting?.catch(() => {});
        const connection = this.#connection;
        this.#connection = undefined;
        this.#dispatcher = undefined;
        await connection?.close().catch(() => {});
    }
}
