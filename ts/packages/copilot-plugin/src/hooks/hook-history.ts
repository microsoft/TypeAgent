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
import type { Dispatcher } from "@typeagent/agent-server-client";
import {
    createClientIO,
    connectToTypeAgent,
} from "../shared/typeagent-client.js";

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

/**
 * Parse the transcript JSONL and extract the last complete turn
 * (user message + assistant response + tools used).
 */
function extractLastTurn(transcriptPath: string): TurnSummary | undefined {
    let lines: string[];
    try {
        const content = readFileSync(transcriptPath, "utf-8");
        lines = content.trim().split("\n").filter(Boolean);
    } catch {
        return undefined;
    }

    // Parse events from the end, looking for the last user.message
    // and all assistant.message events after it
    const events: TranscriptEvent[] = [];
    for (const line of lines) {
        try {
            events.push(JSON.parse(line));
        } catch {
            // Skip malformed lines
        }
    }

    // Find the last user.message
    let lastUserIdx = -1;
    for (let i = events.length - 1; i >= 0; i--) {
        if (events[i].type === "user.message") {
            lastUserIdx = i;
            break;
        }
    }

    if (lastUserIdx === -1) return undefined;

    const userEvent = events[lastUserIdx];
    const userMessage = userEvent.data.content ?? "";

    // Collect assistant messages and tool calls after the user message
    let assistantMessage = "";
    const toolsUsed: string[] = [];
    let handledByTypeAgent = false;

    for (let i = lastUserIdx + 1; i < events.length; i++) {
        const event = events[i];

        if (event.type === "assistant.message") {
            // Accumulate assistant text
            if (event.data.content) {
                assistantMessage += event.data.content;
            }

            // Check tool requests for TypeAgent MCP calls
            if (event.data.toolRequests) {
                for (const tool of event.data.toolRequests) {
                    toolsUsed.push(tool.name);
                    if (
                        tool.mcpServerName === "typeagent" ||
                        tool.name.includes("typeagent")
                    ) {
                        handledByTypeAgent = true;
                    }
                }
            }
        }

        // Also check tool execution results for the tool names
        if (event.type === "tool.execution_complete") {
            const toolName = (event.data as { toolName?: string }).toolName;
            if (toolName && !toolsUsed.includes(toolName)) {
                toolsUsed.push(toolName);
            }
        }
    }

    // Also check if the hook itself handled it (direct mode)
    // In direct mode, there's a hook.end event with handled: true before user.message
    for (let i = lastUserIdx - 1; i >= 0 && i >= lastUserIdx - 5; i--) {
        const event = events[i];
        if (event.type === "hook.end") {
            const output = (
                event.data as {
                    output?: { handled?: boolean; handledBy?: string };
                }
            ).output;
            if (output?.handled && output?.handledBy === "typeagent") {
                handledByTypeAgent = true;
                break;
            }
        }
    }

    if (!userMessage) return undefined;

    return {
        userMessage,
        assistantMessage,
        toolsUsed,
        handledByTypeAgent,
    };
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

        await dispatcher.processCommand(`@history insert ${json}`);

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
