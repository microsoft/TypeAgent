/**
 * postToolUse hook entry point.
 * Tracks non-TypeAgent tool results in TypeAgent history
 * using the @history insert command.
 */

import type { Dispatcher } from "@typeagent/agent-server-client";
import { createClientIO, connectToTypeAgent } from "../shared/typeagent-client.js";

interface PostToolInput {
    sessionId: string;
    timestamp: number;
    cwd: string;
    toolName: string;
    toolArgs: unknown;
    toolResult: {
        resultType: string;
        textResultForLlm: string;
    };
}

// Tools to skip — either internal or already tracked by TypeAgent
const SKIP_TOOLS = new Set([
    "report_intent",
]);

async function main(): Promise<void> {
    let inputData = "";
    process.stdin.setEncoding("utf8");

    for await (const chunk of process.stdin) {
        inputData += chunk;
    }

    let input: PostToolInput;
    try {
        input = JSON.parse(inputData);
    } catch {
        console.error("[postToolUse] Failed to parse input");
        process.exit(1);
    }

    // Skip TypeAgent tool calls — already tracked on the TypeAgent side
    if (input.toolName.includes("typeagent")) {
        console.log("{}");
        return;
    }

    // Skip internal/noise tools
    if (SKIP_TOOLS.has(input.toolName)) {
        console.log("{}");
        return;
    }

    console.error(`[postToolUse] Tracking: tool=${input.toolName}`);

    // Send to TypeAgent history — fire and forget
    sendToolHistory(input).catch((err) => {
        console.error(`[postToolUse] History insert failed: ${err}`);
    });

    console.log("{}");
}

async function sendToolHistory(input: PostToolInput): Promise<void> {
    let dispatcher: Dispatcher | null = null;
    try {
        const clientIO = createClientIO({});
        dispatcher = await connectToTypeAgent(clientIO);

        const argsStr = typeof input.toolArgs === "string"
            ? input.toolArgs
            : JSON.stringify(input.toolArgs);

        const historyMessage = {
            user: `[Copilot tool: ${input.toolName}] ${argsStr.substring(0, 200)}`,
            assistant: {
                text: input.toolResult.textResultForLlm.substring(0, 1000),
                source: "copilot-cli",
            },
        };

        const json = JSON.stringify(historyMessage);
        await dispatcher.processCommand(`@history insert ${json}`);

        console.error("[postToolUse] History insert succeeded");
    } catch (error) {
        console.error(
            "[postToolUse] History insert failed:",
            error instanceof Error ? error.message : String(error),
        );
    } finally {
        if (dispatcher) {
            await dispatcher.close();
        }
    }
}

main().catch((error) => {
    console.error(`[postToolUse] error: ${error}`);
    console.log("{}");
});
