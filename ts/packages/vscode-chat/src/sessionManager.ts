// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import type { DisplayAppendMode } from "@typeagent/agent-sdk";
import type {
    AgentServerConnection,
    ConversationDispatcher,
} from "@typeagent/agent-server-client";
import type {
    ClientIO,
    Dispatcher,
    DisplayLogEntry,
    IAgentMessage,
    RequestId,
} from "@typeagent/dispatcher-types";
import type { DisplayContent } from "@typeagent/agent-sdk";
import {
    renderDisplayToMarkdown,
    renderDisplayToText,
} from "./displayRender.js";
import { ConnectionHolder } from "./connectionHolder.js";

// TODO: Replace these private constructor casts when VS Code exposes a
// supported way for chat session providers to restore request/response turns.
type ChatRequestTurnConstructor = new (
    prompt: string,
    command: string | undefined,
    references: vscode.ChatPromptReference[],
    participant: string,
    toolReferences: vscode.ChatLanguageModelToolReference[],
) => vscode.ChatRequestTurn;

type ChatResponseTurnConstructor = new (
    response: ReadonlyArray<
        | vscode.ChatResponseMarkdownPart
        | vscode.ChatResponseFileTreePart
        | vscode.ChatResponseAnchorPart
        | vscode.ChatResponseCommandButtonPart
    >,
    result: vscode.ChatResult,
    participant: string,
    command?: string,
) => vscode.ChatResponseTurn;

const ChatRequestTurn =
    vscode.ChatRequestTurn as unknown as ChatRequestTurnConstructor;
const ChatResponseTurn =
    vscode.ChatResponseTurn as unknown as ChatResponseTurnConstructor;

function chatMarkdown(value: string): vscode.MarkdownString {
    const markdown = new vscode.MarkdownString(value);
    markdown.supportHtml = true;
    return markdown;
}

class ResponseSink {
    constructor(
        public readonly stream: vscode.ChatResponseStream,
        public readonly token: vscode.CancellationToken,
    ) {}
    write(content: DisplayContent) {
        const md = renderDisplayToMarkdown(content);
        if (md.length > 0) {
            this.stream.markdown(chatMarkdown(md));
        }
    }
    progress(content: DisplayContent) {
        const text = renderDisplayToText(content);
        if (text.length > 0) {
            this.stream.progress(text);
        }
    }
}

/**
 * Resolve after `ms`, or reject with a CancellationError if `token` fires
 * first. Used to back off between connection retries while a prompt waits.
 */
function delayWithToken(
    ms: number,
    token: vscode.CancellationToken,
): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        let sub: vscode.Disposable | undefined;
        const timer = setTimeout(() => {
            sub?.dispose();
            resolve();
        }, ms);
        sub = token.onCancellationRequested(() => {
            clearTimeout(timer);
            sub?.dispose();
            reject(new vscode.CancellationError());
        });
    });
}

class SessionState {
    private dispatcher: ConversationDispatcher | undefined;
    private joinPromise: Promise<ConversationDispatcher> | undefined;
    private readonly inFlight = new Map<string, ResponseSink>();
    private pendingDropTimer: NodeJS.Timeout | undefined;

    constructor(public readonly conversationId: string) {}

    cancelPendingDrop(): void {
        if (this.pendingDropTimer !== undefined) {
            clearTimeout(this.pendingDropTimer);
            this.pendingDropTimer = undefined;
        }
    }

    schedulePendingDrop(delayMs: number, onFire: () => void): void {
        this.cancelPendingDrop();
        this.pendingDropTimer = setTimeout(() => {
            this.pendingDropTimer = undefined;
            onFire();
        }, delayMs);
    }

    private async join(
        conn: AgentServerConnection,
    ): Promise<ConversationDispatcher> {
        if (this.dispatcher) return this.dispatcher;
        if (this.joinPromise) return this.joinPromise;
        const clientIO = this.createClientIO();
        this.joinPromise = conn
            .joinConversation(clientIO, {
                conversationId: this.conversationId,
                clientType: "extension",
            })
            .then((d) => {
                this.dispatcher = d;
                return d;
            });
        return this.joinPromise;
    }

    async ensureJoined(
        conn: AgentServerConnection,
    ): Promise<ConversationDispatcher> {
        return this.join(conn);
    }

    /**
     * Drop the cached join so the next join() re-joins. Called after a
     * reconnect, which invalidates the prior per-conversation channels.
     */
    resetJoin(): void {
        this.dispatcher = undefined;
        this.joinPromise = undefined;
    }

    leave(holder: ConnectionHolder): Promise<void> | undefined {
        const wasJoined = this.dispatcher !== undefined;
        this.dispatcher = undefined;
        this.joinPromise = undefined;
        if (!wasJoined) return undefined;
        // Only issue an explicit leave while still connected; a dropped
        // connection has already released the server-side dispatcher.
        const conn = holder.currentIfConnected();
        if (!conn) return undefined;
        return conn.leaveConversation(this.conversationId).catch(() => {});
    }

    private routeToSink(
        rid: RequestId,
        fn: (sink: ResponseSink) => void,
    ): void {
        const sink = this.inFlight.get(rid.requestId);
        if (sink) fn(sink);
    }

    private createClientIO(): ClientIO {
        const noop = () => {};
        return {
            clear: noop,
            exit: noop,
            shutdown: noop,
            setUserRequest: noop,
            setDisplayInfo: noop,
            setDisplay: (msg: IAgentMessage) =>
                this.routeToSink(msg.requestId, (s) => s.write(msg.message)),
            appendDisplay: (msg: IAgentMessage, mode: DisplayAppendMode) => {
                this.routeToSink(msg.requestId, (s) => {
                    if (mode === "temporary") {
                        s.progress(msg.message);
                    } else {
                        s.write(msg.message);
                    }
                });
            },
            appendDiagnosticData: noop,
            setDynamicDisplay: noop,
            question: async (_rid, message, choices, defaultId) => {
                const pick = await vscode.window.showQuickPick(choices, {
                    placeHolder: message,
                });
                if (pick === undefined) return defaultId ?? 0;
                const idx = choices.indexOf(pick);
                return idx < 0 ? (defaultId ?? 0) : idx;
            },
            proposeAction: async () => undefined,
            notify: noop,
            openLocalView: async () => {},
            closeLocalView: async () => {},
            requestChoice: noop,
            requestForm: noop,
            requestInteraction: noop,
            interactionResolved: noop,
            interactionCancelled: noop,
            takeAction: noop,
        };
    }

    /**
     * Resolve a live connection for a prompt. If already connected, returns it
     * immediately. Otherwise mirrors the shell's queued-send UX: shows a
     * "waiting" progress line and retries the connection with backoff until it
     * comes up or the user cancels the request.
     */
    private async connectForPrompt(
        holder: ConnectionHolder,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken,
    ): Promise<AgentServerConnection> {
        if (holder.isConnected()) {
            return holder.ensureConnected(token);
        }
        stream.progress("Waiting for TypeAgent connection…");
        let delayMs = 1000;
        const maxDelayMs = 15000;
        for (;;) {
            if (token.isCancellationRequested) {
                throw new vscode.CancellationError();
            }
            try {
                return await holder.ensureConnected(token);
            } catch (e) {
                if (token.isCancellationRequested) {
                    throw e;
                }
                await delayWithToken(delayMs, token);
                delayMs = Math.min(delayMs * 2, maxDelayMs);
            }
        }
    }

    async handleRequest(
        holder: ConnectionHolder,
        request: vscode.ChatRequest,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken,
    ): Promise<void> {
        return this.handlePrompt(holder, request.prompt, stream, token);
    }

    async handlePrompt(
        holder: ConnectionHolder,
        prompt: string,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken,
    ): Promise<void> {
        let conn: AgentServerConnection;
        try {
            conn = await this.connectForPrompt(holder, stream, token);
        } catch (e) {
            if (token.isCancellationRequested) {
                stream.markdown(new vscode.MarkdownString(`_Cancelled._`));
            } else {
                stream.markdown(
                    new vscode.MarkdownString(
                        `**Error:** Could not connect to TypeAgent (${
                            (e as Error).message
                        }).`,
                    ),
                );
            }
            return;
        }
        const session = await this.join(conn);
        const sink = new ResponseSink(stream, token);
        const submitResult = await session.dispatcher.submitCommand(prompt);
        if (!submitResult.ok) {
            stream.markdown(
                new vscode.MarkdownString(
                    `**Error:** TypeAgent rejected the request (${submitResult.error}).`,
                ),
            );
            return;
        }
        const entry = submitResult.entry;
        this.inFlight.set(entry.requestId, sink);
        const cancelReg = token.onCancellationRequested(() => {
            session.dispatcher
                .cancelCommand(entry.requestId)
                .catch(() => undefined);
        });
        try {
            const result = await entry.completion;
            if (result?.cancelled) {
                stream.markdown(new vscode.MarkdownString(`_Cancelled._`));
            } else if (result?.lastError) {
                stream.markdown(
                    new vscode.MarkdownString(
                        `\n\n**Error:** ${result.lastError}`,
                    ),
                );
            }
        } catch (e) {
            stream.markdown(
                new vscode.MarkdownString(
                    `\n\n**Error:** ${(e as Error).message}`,
                ),
            );
        } finally {
            this.inFlight.delete(entry.requestId);
            cancelReg.dispose();
        }
    }
}

// Must match the participant ID registered in VS Code
export const PARTICIPANT_ID = "typeagent";

async function buildHistory(
    dispatcher: Dispatcher,
    participantId: string,
): Promise<(vscode.ChatRequestTurn | vscode.ChatResponseTurn)[]> {
    let entries: DisplayLogEntry[];
    try {
        entries = await dispatcher.getDisplayHistory();
    } catch {
        return [];
    }

    // Accumulate per-request: userText + concatenated markdown output
    const groups = new Map<
        string,
        { userText: string | undefined; lines: string[] }
    >();
    const order: string[] = [];

    const touch = (rid: string) => {
        if (!groups.has(rid)) {
            groups.set(rid, { userText: undefined, lines: [] });
            order.push(rid);
        }
        return groups.get(rid)!;
    };

    for (const entry of entries) {
        if (entry.type === "user-request") {
            touch(entry.requestId.requestId).userText = entry.command;
        } else if (
            entry.type === "set-display" ||
            entry.type === "append-display"
        ) {
            if (entry.type === "append-display" && entry.mode === "temporary") {
                continue;
            }
            const md = renderDisplayToMarkdown(entry.message.message);
            if (md) touch(entry.message.requestId.requestId).lines.push(md);
        }
    }

    const history: (vscode.ChatRequestTurn | vscode.ChatResponseTurn)[] = [];
    for (const rid of order) {
        const group = groups.get(rid)!;
        if (!group.userText) continue;

        history.push(
            new ChatRequestTurn(
                group.userText,
                undefined,
                [],
                participantId,
                [],
            ),
        );

        if (group.lines.length > 0) {
            history.push(
                new ChatResponseTurn(
                    [
                        new vscode.ChatResponseMarkdownPart(
                            chatMarkdown(group.lines.join("\n\n")),
                        ),
                    ],
                    {},
                    participantId,
                ),
            );
        }
    }

    return history;
}

export const IDLE_DROP_DELAY_MS = 60_000;

export class SessionManager {
    private readonly sessions = new Map<string, SessionState>();

    constructor(private readonly holder: ConnectionHolder) {
        // After a reconnect the prior per-conversation channels are gone, so
        // every cached join is stale; drop them all so the next use re-joins.
        holder.setOnReconnect(() => this.resetAllJoins());
    }

    getOrCreate(conversationId: string): SessionState {
        let state = this.sessions.get(conversationId);
        if (!state) {
            state = new SessionState(conversationId);
            this.sessions.set(conversationId, state);
        }
        return state;
    }

    private resetAllJoins(): void {
        for (const state of this.sessions.values()) {
            state.resetJoin();
        }
    }

    async openSession(conversationId: string): Promise<vscode.ChatSession> {
        const state = this.getOrCreate(conversationId);
        state.cancelPendingDrop();
        try {
            const conn = await this.holder.ensureConnected();
            const conv = await state.ensureJoined(conn);
            const history = await buildHistory(conv.dispatcher, PARTICIPANT_ID);
            // Intentionally no requestHandler / activeResponseCallback: VS Code
            // routes the initial prompt and subsequent requests to our
            // participant via chatService.sendRequest (agentIdSilent), so
            // handling them here would double-fire.
            return { history, requestHandler: undefined };
        } catch {
            // Server unavailable — open the view with empty history so the
            // session still loads; the first prompt waits for a live
            // connection before running (see SessionState.handlePrompt).
            return { history: [], requestHandler: undefined };
        }
    }

    // Schedule a delayed drop. If the session is reopened before the delay
    // elapses, openSession() cancels the timer. The delay lets a server-side
    // idle timer eventually unload the dispatcher once clientCount hits 0.
    scheduleDrop(conversationId: string, delayMs = IDLE_DROP_DELAY_MS): void {
        const state = this.sessions.get(conversationId);
        if (!state) return;
        state.schedulePendingDrop(delayMs, () => {
            this.sessions.delete(conversationId);
            void state.leave(this.holder);
        });
    }

    async dispose(): Promise<void> {
        const pending: Promise<void>[] = [];
        for (const state of this.sessions.values()) {
            state.cancelPendingDrop();
            const p = state.leave(this.holder);
            if (p) pending.push(p);
        }
        this.sessions.clear();
        await Promise.all(pending);
    }
}
