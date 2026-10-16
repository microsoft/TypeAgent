// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    RecordedInteractionTrace,
    TraceSummary,
} from "@typeagent/copilot-macros";
import type { MacroOwnerConnection } from "../shared/macro-owner.js";
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
    prepareTrace?: (
        trace: RecordedInteractionTrace,
    ) => RecordedInteractionTrace;
    normalizeToolResult?: (
        result: unknown,
        call?: { name: string; mcpServerName?: string },
    ) => unknown;
    resolveToolIdentity?: (
        toolName: string,
        mcpServerName?: string,
    ) => Promise<ToolMetadata>;
    connectOwner: () => Promise<
        Pick<
            MacroOwnerConnection,
            | "getMacroRecordingState"
            | "finalizeMacroRecording"
            | "failMacroRecording"
            | "close"
        >
    >;
}

export class SessionCapture {
    private readonly assembler: ExtensionTraceAssembler;
    private pending = Promise.resolve();

    public constructor(
        private readonly sessionId: string,
        cwd: string,
        private readonly logError: (message: string) => void,
        private readonly dependencies: SessionCaptureDependencies,
        private readonly notifyLearning: (
            message: string,
        ) => Promise<void> = async (message) => logError(message),
        private readonly onFinalizedTrace: (
            summary: TraceSummary,
        ) => Promise<void> = async () => {},
    ) {
        this.assembler = new ExtensionTraceAssembler(
            sessionId,
            cwd,
            true,
            dependencies.normalizeToolResult,
        );
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
            connection = await this.dependencies.connectOwner();
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
    }

    private async handle(
        event: ExtensionSessionEvent & { id?: string },
    ): Promise<void> {
        if (event.agentId && event.type === "session.idle") return;
        if (
            event.type === "tool.execution_start" &&
            this.dependencies.resolveToolIdentity &&
            typeof event.data.toolName === "string"
        ) {
            const identity = await this.dependencies.resolveToolIdentity(
                event.data.toolName,
                typeof event.data.mcpServerName === "string"
                    ? event.data.mcpServerName
                    : undefined,
            );
            event = { ...event, data: { ...event.data, ...identity } };
        }
        this.assembler.record(event);
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
            }
        }
    }

    private async finishTurn(aborted: boolean): Promise<void> {
        let connection;
        try {
            connection = await this.dependencies.connectOwner();
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
            const childAuthoring = this.assembler.getChildAuthoringCapture();
            if (selectedToken) {
                if (
                    trace &&
                    (!selectedToken.learning ||
                        childAuthoring?.recordingTokenId === selectedToken.id)
                ) {
                    let preparedTrace = trace;
                    try {
                        preparedTrace =
                            this.dependencies.prepareTrace?.(trace) ?? trace;
                    } catch (error) {
                        await connection.failMacroRecording(
                            this.sessionId,
                            selectedToken.id,
                            error instanceof Error
                                ? error.message
                                : "Recording normalization failed.",
                        );
                        throw error;
                    }
                    const summary = await connection.finalizeMacroRecording({
                        tokenId: selectedToken.id,
                        trace: preparedTrace,
                        ...(selectedToken.learning && childAuthoring
                            ? { childAuthoring }
                            : {}),
                    });
                    await this.onFinalizedTrace(summary);
                    if (summary.learningJobId) {
                        await this.notifyLearning(
                            `Macro learning queued (${summary.learningJobId}). Use /typeagent-macro-status to inspect preparation or readiness. No additional task execution is required.`,
                        );
                    }
                } else {
                    await connection.failMacroRecording(
                        this.sessionId,
                        selectedToken.id,
                        selectedToken.learning
                            ? "The selected task has no explicit root success receipt correlated to this recording and final output; Copilot authoring was not queued."
                            : "The selected interaction was incomplete and was not stored.",
                    );
                }
            }
            if (trace && !aborted) {
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
            await connection?.close();
        }
    }

    private async failClaimedRecording(error: string): Promise<void> {
        const connection = await this.dependencies.connectOwner();
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
