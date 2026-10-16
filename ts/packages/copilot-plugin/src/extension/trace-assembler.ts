// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    redactTraceValue,
    type MacroChildCapture,
    type RecordedInteractionTrace,
    type RecordedToolCall,
} from "@typeagent/copilot-macros";
import { createHash } from "node:crypto";
import {
    isCopilotTelemetryTool,
    isMacroTaskReceiptTool,
} from "../shared/tool-identities.js";

export interface ExtensionSessionEvent {
    id?: string;
    type: string;
    timestamp: string;
    data: Record<string, unknown>;
    agentId?: string;
}

interface ActiveTurn {
    prompt: string;
    startedAt: string;
    completedAt?: string;
    response: string[];
    calls: Map<string, RecordedToolCall>;
    completedCalls: Set<string>;
    firstEventId?: string;
    finalEventId?: string;
    ended: boolean;
    failed: boolean;
    receiptCalls: Set<string>;
    receipt?: { eventId: string; tokenId: string };
}

function getString(data: Record<string, unknown>, ...keys: string[]) {
    for (const key of keys) {
        const value = data[key];
        if (typeof value === "string") return value;
    }
    return undefined;
}

function callKey(event: ExtensionSessionEvent, toolCallId: string): string {
    return `${event.agentId ?? "root"}:${toolCallId}`;
}

function permissionWasDenied(result: unknown): boolean {
    const kind =
        typeof result === "string"
            ? result
            : result && typeof result === "object"
              ? getString(result as Record<string, unknown>, "kind", "result")
              : undefined;
    return kind === "cancelled" || kind?.startsWith("denied") === true;
}

function getModelResult(result: unknown): unknown {
    if (!result || typeof result !== "object") return undefined;
    const content = (result as Record<string, unknown>).content;
    if (typeof content !== "string") return undefined;
    try {
        return JSON.parse(content);
    } catch (error) {
        // Plain text (including truncated JSON) is the actual model-visible value.
        if (error instanceof SyntaxError) return content;
        throw error;
    }
}

export class ExtensionTraceAssembler {
    private turn: ActiveTurn | undefined;

    public constructor(
        private readonly sessionId: string,
        private readonly cwd: string,
        private readonly retainPrivateResults = false,
        private readonly normalizeToolResult?: (result: unknown) => unknown,
    ) {}

    public record(event: ExtensionSessionEvent): void {
        if (event.type === "user.message" && !event.agentId) {
            const prompt = getString(event.data, "content");
            this.turn = prompt
                ? {
                      prompt,
                      startedAt: event.timestamp,
                      response: [],
                      calls: new Map(),
                      completedCalls: new Set(),
                      ...(event.id ? { firstEventId: event.id } : {}),
                      ended: false,
                      failed: false,
                      receiptCalls: new Set(),
                  }
                : undefined;
            return;
        }
        if (!this.turn) return;

        switch (event.type) {
            case "assistant.turn_end":
                if (!event.agentId) this.turn.ended = true;
                break;
            case "session.error":
            case "abort":
                if (!event.agentId) this.turn.failed = true;
                break;
            case "assistant.message":
                this.recordAssistantMessage(event);
                break;
            case "tool.execution_start":
                this.recordToolStart(event);
                break;
            case "tool.execution_complete":
                this.recordToolCompletion(event);
                break;
            case "permission.completed":
                this.recordPermission(event);
                break;
        }
    }

    public finish(
        expectedPromptHash?: string,
        aborted = false,
    ): RecordedInteractionTrace | undefined {
        const turn = this.turn;
        if (
            aborted ||
            turn?.failed ||
            !turn?.completedAt ||
            turn.completedCalls.size !== turn.calls.size
        ) {
            return undefined;
        }

        const prompt = redactTraceValue(turn.prompt) as string;
        if (expectedPromptHash && this.getPromptHash() !== expectedPromptHash) {
            return undefined;
        }

        return {
            schemaVersion: 1,
            sessionId: this.sessionId,
            cwd: this.cwd,
            prompt,
            response: redactTraceValue(turn.response.join("")) as string,
            startedAt: turn.startedAt,
            completedAt: turn.completedAt,
            toolCalls: [...turn.calls.values()],
        };
    }

    public getPromptHash(): string | undefined {
        return this.turn
            ? createHash("sha256")
                  .update(redactTraceValue(this.turn.prompt) as string)
                  .digest("hex")
            : undefined;
    }

    public getChildAuthoringCapture(): MacroChildCapture | undefined {
        const turn = this.turn;
        if (
            !turn?.firstEventId ||
            !turn.finalEventId ||
            !turn.receipt ||
            !turn.ended ||
            turn.failed ||
            !turn.response.join("").trim() ||
            !turn.calls.size ||
            turn.completedCalls.size !== turn.calls.size ||
            [...turn.calls.values()].some((call) => call.status !== "completed")
        )
            return undefined;
        return {
            taskId: `${this.sessionId}:${turn.firstEventId}`,
            firstEventId: turn.firstEventId,
            successEventId: turn.receipt.eventId,
            outputEventId: turn.finalEventId,
            recordingTokenId: turn.receipt.tokenId,
        };
    }

    public reset(): void {
        this.turn = undefined;
    }

    private recordAssistantMessage(event: ExtensionSessionEvent): void {
        if (event.agentId) return;
        const content = getString(event.data, "content");
        if (content && this.turn) {
            this.turn.response.push(content);
            if (event.id) this.turn.finalEventId = event.id;
        }
        this.markProgress(event.timestamp);
    }

    private recordToolStart(event: ExtensionSessionEvent): void {
        const turn = this.turn;
        const toolCallId = getString(event.data, "toolCallId");
        const name = getString(event.data, "toolName");
        if (!turn || !toolCallId || !name) return;
        if (!event.agentId) {
            turn.ended = false;
            delete turn.finalEventId;
        }
        const mcpServerName = getString(event.data, "mcpServerName");
        if (isMacroTaskReceiptTool(name, mcpServerName)) {
            if (!event.agentId)
                turn.receiptCalls.add(callKey(event, toolCallId));
            return;
        }
        if (isCopilotTelemetryTool(name, mcpServerName)) return;
        delete turn.receipt;

        const key = callKey(event, toolCallId);
        if (turn.completedCalls.has(key)) return;
        const existing = turn.calls.get(key);
        turn.calls.set(key, {
            toolCallId,
            name,
            ...(mcpServerName ? { mcpServerName } : {}),
            arguments: redactTraceValue(event.data.arguments),
            status: existing?.status ?? "completed",
            ...(existing?.permission !== undefined
                ? { permission: existing.permission }
                : {}),
        });
        this.markProgress(event.timestamp);
    }

    private recordToolCompletion(event: ExtensionSessionEvent): void {
        const turn = this.turn;
        const toolCallId = getString(event.data, "toolCallId", "id");
        if (!turn || !toolCallId) return;
        const key = callKey(event, toolCallId);
        if (turn.receiptCalls.delete(key)) {
            const receipt = getModelResult(event.data.result);
            if (
                !event.agentId &&
                event.id &&
                event.data.success === true &&
                receipt !== null &&
                typeof receipt === "object" &&
                "status" in receipt &&
                receipt.status === "succeeded" &&
                "recordingTokenId" in receipt &&
                typeof receipt.recordingTokenId === "string" &&
                "promptHash" in receipt &&
                receipt.promptHash === this.getPromptHash()
            )
                turn.receipt = {
                    eventId: event.id,
                    tokenId: receipt.recordingTokenId,
                };
            return;
        }
        const call = turn.calls.get(key);
        if (!call || turn.completedCalls.has(key)) return;

        const rawResult = event.data.result ?? event.data.error;
        const actualResult =
            event.data.success !== false && this.normalizeToolResult
                ? this.normalizeToolResult(rawResult)
                : rawResult;
        call.result = this.retainPrivateResults
            ? structuredClone(actualResult)
            : redactTraceValue(actualResult);
        const modelResult = getModelResult(event.data.result);
        if (modelResult !== undefined) {
            call.modelResult = this.retainPrivateResults
                ? modelResult
                : redactTraceValue(modelResult);
        }
        if (call.status !== "denied") {
            call.status = event.data.success === false ? "failed" : "completed";
        }
        turn.completedCalls.add(key);
        this.markProgress(event.timestamp);
    }

    private recordPermission(event: ExtensionSessionEvent): void {
        const turn = this.turn;
        const toolCallId = getString(event.data, "toolCallId");
        if (!turn || !toolCallId) return;
        const key = callKey(event, toolCallId);
        const call = turn.calls.get(key);
        if (!call) return;

        call.permission = redactTraceValue(event.data.result);
        if (permissionWasDenied(event.data.result)) {
            call.status = "denied";
            call.result = call.permission;
            turn.completedCalls.add(key);
        }
        this.markProgress(event.timestamp);
    }

    private markProgress(timestamp: string): void {
        if (this.turn) this.turn.completedAt = timestamp;
    }
}
