// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    redactTraceValue,
    type RecordedInteractionTrace,
    type RecordedToolCall,
} from "@typeagent/copilot-macros";
import { createHash } from "node:crypto";

export interface ExtensionSessionEvent {
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

export class ExtensionTraceAssembler {
    private turn: ActiveTurn | undefined;

    public constructor(
        private readonly sessionId: string,
        private readonly cwd: string,
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
                  }
                : undefined;
            return;
        }
        if (!this.turn) return;

        switch (event.type) {
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
            !turn?.completedAt ||
            turn.completedCalls.size !== turn.calls.size
        ) {
            return undefined;
        }

        const prompt = redactTraceValue(turn.prompt) as string;
        if (
            expectedPromptHash &&
            createHash("sha256").update(prompt).digest("hex") !==
                expectedPromptHash
        ) {
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

    public reset(): void {
        this.turn = undefined;
    }

    private recordAssistantMessage(event: ExtensionSessionEvent): void {
        if (event.agentId) return;
        const content = getString(event.data, "content");
        if (content) this.turn?.response.push(content);
        this.markProgress(event.timestamp);
    }

    private recordToolStart(event: ExtensionSessionEvent): void {
        const turn = this.turn;
        const toolCallId = getString(event.data, "toolCallId");
        const name = getString(event.data, "toolName");
        if (!turn || !toolCallId || !name) return;

        const key = callKey(event, toolCallId);
        if (turn.completedCalls.has(key)) return;
        const existing = turn.calls.get(key);
        const mcpServerName = getString(event.data, "mcpServerName");
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
        const call = turn.calls.get(key);
        if (!call || turn.completedCalls.has(key)) return;

        call.result = redactTraceValue(event.data.result ?? event.data.error);
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
