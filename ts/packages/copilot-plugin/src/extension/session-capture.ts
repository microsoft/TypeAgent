// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Dispatcher } from "@typeagent/agent-server-client";
import { awaitCommand } from "@typeagent/dispatcher-types";
import type { RecordedInteractionTrace } from "@typeagent/copilot-macros";
import {
    connectToAgentServer,
    connectToTypeAgent,
    createClientIO,
} from "../shared/typeagent-client.js";
import { isTypeAgentAgentServerTool } from "../shared/tool-identities.js";
import { makeTurnId, writeDemoState } from "../hooks/demo-state.js";
import {
    ExtensionTraceAssembler,
    type ExtensionSessionEvent,
} from "./trace-assembler.js";

const skippedTools = new Set(["report_intent"]);

interface ToolMetadata {
    toolName: string;
    mcpServerName?: string;
}

export interface SessionCaptureDependencies {
    connectAgentServer: typeof connectToAgentServer;
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
    operation: (dispatcher: Dispatcher) => Promise<void>,
): Promise<void> {
    const dispatcher = await connectToTypeAgent(createClientIO({}));
    try {
        await operation(dispatcher);
    } finally {
        await dispatcher.close();
    }
}

async function insertToolHistory(event: ExtensionSessionEvent): Promise<void> {
    if (event.data.success !== true) return;
    const toolName =
        typeof event.data.toolName === "string"
            ? event.data.toolName
            : undefined;
    if (
        !toolName ||
        skippedTools.has(toolName) ||
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
    await withDispatcher(async (dispatcher) => {
        await awaitCommand(
            dispatcher,
            `@history insert ${JSON.stringify(message)}`,
        );
    });
}

async function insertTurnHistory(
    trace: RecordedInteractionTrace,
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
    await withDispatcher(async (dispatcher) => {
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

    public constructor(
        private readonly sessionId: string,
        cwd: string,
        private readonly logError: (message: string) => void,
        private readonly dependencies: SessionCaptureDependencies = defaultDependencies,
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

    public flush(): Promise<void> {
        return this.pending;
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
                await this.dependencies.insertToolHistory({
                    ...event,
                    data: { ...event.data, ...metadata },
                });
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
            const trace = this.assembler.finish(
                state.status === "claimed"
                    ? state.token?.promptHash
                    : undefined,
                aborted,
            );
            if (state.status === "claimed" && state.token) {
                if (trace) {
                    await connection.finalizeMacroRecording({
                        tokenId: state.token.id,
                        trace,
                    });
                } else {
                    await connection.failMacroRecording(
                        this.sessionId,
                        state.token.id,
                        "The selected interaction was incomplete and was not stored.",
                    );
                }
            }
            if (trace && !aborted) {
                await this.dependencies.insertTurnHistory(trace);
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
