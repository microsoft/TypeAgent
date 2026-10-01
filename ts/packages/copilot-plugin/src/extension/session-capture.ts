// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    AgentServerConnection,
    Dispatcher,
} from "@typeagent/agent-server-client";
import { awaitCommand } from "@typeagent/dispatcher-types";
import type { RecordedInteractionTrace } from "@typeagent/copilot-macros";
import {
    connectToAgentServer,
    connectToTypeAgent,
    createClientIO,
} from "../shared/typeagent-client.js";
import {
    isCopilotTelemetryTool,
    isTypeAgentAgentServerTool,
} from "../shared/tool-identities.js";
import { makeTurnId, writeDemoState } from "../hooks/demo-state.js";
import {
    ExtensionTraceAssembler,
    type ExtensionSessionEvent,
} from "./trace-assembler.js";

interface ToolMetadata {
    toolName: string;
    mcpServerName?: string;
}

export interface SessionCaptureDependencies {
    connectAgentServer: () => Promise<
        Pick<
            AgentServerConnection,
            | "getMacroRecordingState"
            | "finalizeMacroRecording"
            | "failMacroRecording"
            | "close"
        >
    >;
    insertToolHistory: typeof insertToolHistory;
    insertTurnHistory: typeof insertTurnHistory;
}

const defaultDependencies: SessionCaptureDependencies = {
    connectAgentServer: connectToAgentServer,
    insertToolHistory,
    insertTurnHistory,
};

function toolCallKey(event: ExtensionSessionEvent): string | undefined {
    const toolCallId =
        typeof event.data.toolCallId === "string"
            ? event.data.toolCallId
            : undefined;
    return toolCallId ? `${event.agentId ?? "root"}:${toolCallId}` : undefined;
}

function resultText(result: unknown): string {
    if (typeof result === "string") return result;
    if (result && typeof result === "object") {
        const content = (result as { content?: unknown }).content;
        if (typeof content === "string") return content;
    }
    return JSON.stringify(result) ?? "";
}

async function withDispatcher(
    sessionId: string,
    operation: (dispatcher: Dispatcher) => Promise<void>,
): Promise<void> {
    const dispatcher = await connectToTypeAgent(createClientIO({}), sessionId);
    try {
        await operation(dispatcher);
    } finally {
        await dispatcher.close();
    }
}

async function insertToolHistory(
    event: ExtensionSessionEvent,
    sessionId: string,
): Promise<void> {
    if (event.data.success !== true) return;
    const toolName =
        typeof event.data.toolName === "string"
            ? event.data.toolName
            : undefined;
    if (
        !toolName ||
        isCopilotTelemetryTool(
            toolName,
            typeof event.data.mcpServerName === "string"
                ? event.data.mcpServerName
                : undefined,
        ) ||
        isTypeAgentAgentServerTool(
            toolName,
            typeof event.data.mcpServerName === "string"
                ? event.data.mcpServerName
                : undefined,
        )
    ) {
        return;
    }

    const message = {
        user: `[Copilot tool: ${toolName}]`,
        assistant: {
            text: resultText(event.data.result).substring(0, 1000),
            source: "copilot-cli",
        },
    };
    await withDispatcher(sessionId, async (dispatcher) => {
        await awaitCommand(
            dispatcher,
            `@history insert ${JSON.stringify(message)}`,
        );
    });
}

async function insertTurnHistory(
    trace: RecordedInteractionTrace,
    sessionId: string,
): Promise<void> {
    if (
        trace.toolCalls.some((tool) =>
            isTypeAgentAgentServerTool(tool.name, tool.mcpServerName),
        )
    ) {
        return;
    }
    const tools = trace.toolCalls.map((tool) => tool.name);
    const suffix = tools.length > 0 ? ` [tools: ${tools.join(", ")}]` : "";
    const message = {
        user: trace.prompt,
        assistant: {
            text: trace.response.substring(0, 1000) + suffix,
            source: "copilot-cli",
        },
    };
    await withDispatcher(sessionId, async (dispatcher) => {
        await awaitCommand(
            dispatcher,
            `@history insert ${JSON.stringify(message)}`,
        );
    });
}

export class SessionCapture {
    private readonly assembler: ExtensionTraceAssembler;
    private readonly toolMetadata = new Map<string, ToolMetadata>();
    private pending = Promise.resolve();
    private historyPending = Promise.resolve();
    private historyQueueLength = 0;

    public constructor(
        private readonly sessionId: string,
        cwd: string,
        private readonly logError: (message: string) => void,
        private readonly dependencies: SessionCaptureDependencies = defaultDependencies,
        private readonly notifyLearning: (
            message: string,
        ) => Promise<void> = async (message) => logError(message),
    ) {
        this.assembler = new ExtensionTraceAssembler(sessionId, cwd);
    }

    public enqueue(event: ExtensionSessionEvent & { id?: string }): void {
        this.pending = this.pending
            .then(() => this.handle(event))
            .catch((error) =>
                this.logError(
                    `[typeagent-extension] ${error instanceof Error ? error.message : String(error)}`,
                ),
            );
    }

    public async failInterruptedRecording(): Promise<void> {
        let connection;
        try {
            connection = await this.dependencies.connectAgentServer();
            const state = await connection.getMacroRecordingState(
                this.sessionId,
            );
            if (state.status === "claimed" && state.token) {
                await connection.failMacroRecording(
                    this.sessionId,
                    state.token.id,
                    "The extension was reloaded before the interaction completed.",
                );
            }
        } catch (error) {
            this.logError(
                `[typeagent-extension] ${error instanceof Error ? error.message : String(error)}`,
            );
        } finally {
            await connection?.close();
        }
    }

    public async flush(): Promise<void> {
        await this.pending;
        await this.historyPending;
    }

    private queueHistory(operation: () => Promise<void>): void {
        if (this.historyQueueLength >= 32) {
            this.logError(
                "[typeagent-extension] History queue is full; optional indexing was skipped.",
            );
            return;
        }
        this.historyQueueLength++;
        this.historyPending = this.historyPending
            .then(operation)
            .catch((error) =>
                this.logError(
                    `[typeagent-extension] History indexing failed: ${error instanceof Error ? error.message : String(error)}`,
                ),
            )
            .finally(() => {
                this.historyQueueLength--;
            });
    }

    private async handle(
        event: ExtensionSessionEvent & { id?: string },
    ): Promise<void> {
        this.assembler.record(event);
        const key = toolCallKey(event);
        if (event.type === "tool.execution_start" && key) {
            const toolName =
                typeof event.data.toolName === "string"
                    ? event.data.toolName
                    : undefined;
            const mcpServerName =
                typeof event.data.mcpServerName === "string"
                    ? event.data.mcpServerName
                    : undefined;
            if (toolName) {
                this.toolMetadata.set(key, {
                    toolName,
                    ...(mcpServerName ? { mcpServerName } : {}),
                });
            }
        }
        if (event.type === "tool.execution_complete" && key) {
            const metadata = this.toolMetadata.get(key);
            this.toolMetadata.delete(key);
            if (metadata) {
                const historyEvent = {
                    ...event,
                    data: { ...event.data, ...metadata },
                };
                this.queueHistory(() =>
                    this.dependencies.insertToolHistory(
                        historyEvent,
                        this.sessionId,
                    ),
                );
            }
        }
        if (event.type === "session.idle") {
            await this.finishTurn(event.data.aborted === true);
        }
        if (event.type === "session.shutdown") {
            try {
                await this.failClaimedRecording(
                    "The session ended before the selected interaction completed.",
                );
            } finally {
                this.assembler.reset();
                this.toolMetadata.clear();
            }
        }
    }

    private async finishTurn(aborted: boolean): Promise<void> {
        let connection;
        try {
            connection = await this.dependencies.connectAgentServer();
            const state = await connection.getMacroRecordingState(
                this.sessionId,
            );
            const selectedToken =
                state.status === "claimed" &&
                state.token?.promptHash &&
                state.token.promptHash === this.assembler.getPromptHash()
                    ? state.token
                    : undefined;
            const trace = this.assembler.finish(
                selectedToken?.promptHash,
                aborted,
            );
            if (selectedToken) {
                if (trace) {
                    const summary = await connection.finalizeMacroRecording({
                        tokenId: selectedToken.id,
                        trace,
                    });
                    if (summary.learningJobId) {
                        await this.notifyLearning(
                            `Macro learning queued (${summary.learningJobId}). Use /typeagent-macro-status to inspect preparation or readiness. No additional task execution is required.`,
                        );
                    }
                } else {
                    await connection.failMacroRecording(
                        this.sessionId,
                        selectedToken.id,
                        "The selected interaction was incomplete and was not stored.",
                    );
                }
            }
            if (trace && !aborted) {
                this.queueHistory(() =>
                    this.dependencies.insertTurnHistory(trace, this.sessionId),
                );
                writeDemoState({
                    event: "turnComplete",
                    turnId: makeTurnId(this.sessionId),
                    ts: Date.now(),
                    mode: "mcp",
                    handledBy: "copilot",
                    lastResponse: trace.response,
                    sessionId: this.sessionId,
                });
            }
        } finally {
            this.assembler.reset();
            this.toolMetadata.clear();
            await connection?.close();
        }
    }

    private async failClaimedRecording(error: string): Promise<void> {
        const connection = await this.dependencies.connectAgentServer();
        try {
            const state = await connection.getMacroRecordingState(
                this.sessionId,
            );
            if (state.status === "claimed" && state.token) {
                await connection.failMacroRecording(
                    this.sessionId,
                    state.token.id,
                    error,
                );
            }
        } finally {
            await connection.close();
        }
    }
}
