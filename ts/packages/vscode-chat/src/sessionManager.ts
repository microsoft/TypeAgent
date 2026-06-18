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

    leave(conn: AgentServerConnection): Promise<void> | undefined {
        if (!this.dispatcher) return undefined;
        const id = this.conversationId;
        this.dispatcher = undefined;
        this.joinPromise = undefined;
        return conn.leaveConversation(id).catch(() => {});
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
            requestInteraction: noop,
            interactionResolved: noop,
            interactionCancelled: noop,
            takeAction: noop,
        };
    }

    async handleRequest(
        conn: AgentServerConnection,
        request: vscode.ChatRequest,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken,
    ): Promise<void> {
        return this.handlePrompt(conn, request.prompt, stream, token);
    }

    async handlePrompt(
        conn: AgentServerConnection,
        prompt: string,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken,
    ): Promise<void> {
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

    constructor(private readonly conn: AgentServerConnection) {}

    getOrCreate(conversationId: string): SessionState {
        let state = this.sessions.get(conversationId);
        if (!state) {
            state = new SessionState(conversationId);
            this.sessions.set(conversationId, state);
        }
        return state;
    }

    async openSession(conversationId: string): Promise<vscode.ChatSession> {
        const state = this.getOrCreate(conversationId);
        state.cancelPendingDrop();
        const conv = await state.ensureJoined(this.conn);
        const history = await buildHistory(conv.dispatcher, PARTICIPANT_ID);
        // Intentionally no requestHandler / activeResponseCallback: VS Code
        // routes the initial prompt and subsequent requests to our participant
        // via chatService.sendRequest (agentIdSilent), so handling them here
        // would double-fire.
        return { history, requestHandler: undefined };
    }

    // Schedule a delayed drop. If the session is reopened before the delay
    // elapses, openSession() cancels the timer. The delay lets a server-side
    // idle timer eventually unload the dispatcher once clientCount hits 0.
    scheduleDrop(conversationId: string, delayMs = IDLE_DROP_DELAY_MS): void {
        const state = this.sessions.get(conversationId);
        if (!state) return;
        state.schedulePendingDrop(delayMs, () => {
            this.sessions.delete(conversationId);
            void state.leave(this.conn);
        });
    }

    async dispose(): Promise<void> {
        const pending: Promise<void>[] = [];
        for (const state of this.sessions.values()) {
            state.cancelPendingDrop();
            const p = state.leave(this.conn);
            if (p) pending.push(p);
        }
        this.sessions.clear();
        await Promise.all(pending);
    }
}
