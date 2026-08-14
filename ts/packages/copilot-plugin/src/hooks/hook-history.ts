// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * agentStop hook handler for tracking Copilot interactions in TypeAgent history.
 *
 * Reads the session transcript to extract the last user prompt and assistant
 * response, then sends them to TypeAgent for history/context tracking.
 *
 * Skips tracking when:
 * - The interaction was handled by TypeAgent (to avoid duplicates)
 * - The transcript can't be read
 * - No user/assistant messages are found
 */

import { readFileSync } from "fs";
import { readFile } from "node:fs/promises";
import type { Dispatcher } from "@typeagent/agent-server-client";
import { awaitCommand } from "@typeagent/dispatcher-types";
import {
    createClientIO,
    connectToTypeAgent,
} from "../shared/typeagent-client.js";
import { isTypeAgentAgentServerTool } from "../shared/tool-identities.js";
import { connectToAgentServer } from "../shared/typeagent-client.js";
import { normalizeRecordedInteraction } from "./macro-transcript.js";

interface TranscriptEvent {
    type: string;
    data: {
        content?: string;
        toolRequests?: Array<{
            name: string;
            mcpServerName?: string;
            arguments?: unknown;
        }>;
        [key: string]: unknown;
    };
    timestamp: string;
}

interface TurnSummary {
    userMessage: string;
    assistantMessage: string;
    toolsUsed: string[];
    handledByTypeAgent: boolean;
}

function readTranscriptEvents(
    transcriptPath: string,
): TranscriptEvent[] | undefined {
    let content: string;
    try {
        content = readFileSync(transcriptPath, "utf-8");
    } catch {
        return undefined;
    }

    const events: TranscriptEvent[] = [];
    for (const line of content.trim().split("\n").filter(Boolean)) {
        try {
            events.push(JSON.parse(line));
        } catch {
            // Skip malformed lines
        }
    }
    return events;
}

function findLastUserIndex(events: TranscriptEvent[]): number {
    let index = events.length - 1;
    while (index >= 0 && events[index].type !== "user.message") index--;
    return index;
}

function recordAssistantEvent(
    event: TranscriptEvent,
    summary: TurnSummary,
): void {
    if (event.data.content) summary.assistantMessage += event.data.content;
    for (const tool of event.data.toolRequests ?? []) {
        summary.toolsUsed.push(tool.name);
        if (isTypeAgentAgentServerTool(tool.name, tool.mcpServerName)) {
            summary.handledByTypeAgent = true;
        }
    }
}

function recordToolCompletion(
    event: TranscriptEvent,
    toolsUsed: string[],
): void {
    const toolName = (event.data as { toolName?: string }).toolName;
    if (toolName && !toolsUsed.includes(toolName)) toolsUsed.push(toolName);
}

function collectTurnEvents(
    events: TranscriptEvent[],
    lastUserIndex: number,
    summary: TurnSummary,
): void {
    for (const event of events.slice(lastUserIndex + 1)) {
        if (event.type === "assistant.message") {
            recordAssistantEvent(event, summary);
        }
        if (event.type === "tool.execution_complete") {
            recordToolCompletion(event, summary.toolsUsed);
        }
    }
}

function wasHandledByHook(
    events: TranscriptEvent[],
    lastUserIndex: number,
): boolean {
    const firstCandidate = Math.max(0, lastUserIndex - 5);
    for (let index = lastUserIndex - 1; index >= firstCandidate; index--) {
        const event = events[index];
        if (event.type !== "hook.end") continue;
        const output = (
            event.data as {
                output?: { handled?: boolean; handledBy?: string };
            }
        ).output;
        if (output?.handled && output.handledBy === "typeagent") return true;
    }
    return false;
}

async function readStableTranscript(
    transcriptPath: string,
    timeoutMs = 2_000,
    intervalMs = 100,
): Promise<string | undefined> {
    const deadline = Date.now() + timeoutMs;
    let previous: string | undefined;
    while (Date.now() < deadline) {
        let current: string;
        try {
            current = await readFile(transcriptPath, "utf8");
        } catch {
            return undefined;
        }
        if (current === previous) return current;
        previous = current;
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    return undefined;
}

async function captureMacroRecording(input: AgentStopInput): Promise<void> {
    const connection = await connectToAgentServer();
    let tokenId: string | undefined;
    try {
        const state = await connection.getMacroRecordingState(input.sessionId);
        if (state.status !== "claimed" || !state.token) return;
        tokenId = state.token.id;

        const transcript = await readStableTranscript(input.transcriptPath);
        const trace = transcript
            ? normalizeRecordedInteraction(
                  transcript,
                  input.sessionId,
                  state.token.cwd ?? input.cwd,
                  state.token.promptHash,
              )
            : undefined;
        if (!trace) {
            await connection.failMacroRecording(
                input.sessionId,
                tokenId,
                "The selected interaction was incomplete and was not stored.",
            );
            return;
        }

        const summary = await connection.finalizeMacroRecording({
            tokenId,
            trace,
        });
        console.error(`[macro] Captured trace ${summary.traceId}`);
    } catch (error) {
        if (tokenId) {
            await connection.failMacroRecording(
                input.sessionId,
                tokenId,
                "The selected interaction could not be stored.",
            );
        }
        console.error(
            `[macro] Capture failed: ${error instanceof Error ? error.message : String(error)}`,
        );
    } finally {
        await connection.close();
    }
}

/**
 * Parse the transcript JSONL and extract the last complete turn
 * (user message + assistant response + tools used).
 */
function extractLastTurn(transcriptPath: string): TurnSummary | undefined {
    const events = readTranscriptEvents(transcriptPath);
    if (!events) return undefined;
    const lastUserIdx = findLastUserIndex(events);
    if (lastUserIdx < 0) return undefined;

    const userEvent = events[lastUserIdx];
    const userMessage = userEvent.data.content ?? "";
    if (!userMessage) return undefined;

    const summary: TurnSummary = {
        userMessage,
        assistantMessage: "",
        toolsUsed: [],
        handledByTypeAgent: false,
    };
    collectTurnEvents(events, lastUserIdx, summary);
    summary.handledByTypeAgent ||= wasHandledByHook(events, lastUserIdx);
    return summary;
}

/**
 * Send a turn summary to TypeAgent for history tracking
 * using the @history insert command with proper JSON format.
 */
async function sendToTypeAgentHistory(turn: TurnSummary): Promise<void> {
    let dispatcher: Dispatcher | null = null;
    try {
        const clientIO = createClientIO({});
        dispatcher = await connectToTypeAgent(clientIO);

        const toolsSummary =
            turn.toolsUsed.length > 0
                ? ` [tools: ${turn.toolsUsed.join(", ")}]`
                : "";

        const historyMessage = {
            user: turn.userMessage,
            assistant: {
                text: turn.assistantMessage.substring(0, 1000) + toolsSummary,
                source: "copilot-cli",
            },
        };

        const json = JSON.stringify(historyMessage);
        console.error(
            `[agentStop] Inserting history: ${json.substring(0, 200)}`,
        );

        await awaitCommand(dispatcher, `@history insert ${json}`);

        console.error("[agentStop] History insert succeeded");
    } catch (error) {
        console.error(
            "[agentStop] History insert failed:",
            error instanceof Error ? error.message : String(error),
        );
    } finally {
        if (dispatcher) {
            await dispatcher.close();
        }
    }
}

export interface AgentStopInput {
    sessionId: string;
    timestamp: number;
    cwd: string;
    transcriptPath: string;
    stopReason: string;
}

export interface AgentStopOutput {
    decision?: "block" | "allow";
    reason?: string;
}

/**
 * Handle the agentStop hook. Reads the transcript, extracts the last turn,
 * and sends it to TypeAgent for history tracking if it wasn't already
 * handled by TypeAgent.
 */
export async function handleAgentStop(
    input: AgentStopInput,
): Promise<AgentStopOutput> {
    if (!input.transcriptPath) {
        console.error("[agentStop] No transcriptPath, skipping");
        return {};
    }

    await captureMacroRecording(input);

    const turn = extractLastTurn(input.transcriptPath);
    if (!turn) {
        console.error(
            "[agentStop] Could not extract last turn from transcript",
        );
        return {};
    }

    console.error(
        `[agentStop] Turn: user="${turn.userMessage.substring(0, 80)}" tools=[${turn.toolsUsed.join(",")}] typeagent=${turn.handledByTypeAgent} response="${turn.assistantMessage.substring(0, 80)}"`,
    );

    // Skip if TypeAgent already handled this interaction
    if (turn.handledByTypeAgent) {
        console.error("[agentStop] Skipping — already handled by TypeAgent");
        return {};
    }

    console.error("[agentStop] Sending to TypeAgent history...");

    // Send to TypeAgent history in the background (fire-and-forget)
    // Don't block the session on history tracking
    sendToTypeAgentHistory(turn).catch((err) => {
        console.error(`[agentStop] History send failed: ${err}`);
    });

    return {};
}
