// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Standalone entry point for the agentStop hook.
 * Reads input from stdin and delegates to the history handler.
 */

import { handleAgentStop, type AgentStopInput } from "./hook-history.js";
import { makeTurnId, writeDemoState } from "./demo-state.js";

async function main(): Promise<void> {
    let inputData = "";
    process.stdin.setEncoding("utf8");

    for await (const chunk of process.stdin) {
        inputData += chunk;
    }

    let input: AgentStopInput;
    try {
        input = JSON.parse(inputData);
    } catch {
        console.error("[agentStop] Failed to parse input");
        process.exit(1);
    }

    console.error(
        `[agentStop] Hook fired. stopReason=${input.stopReason} transcriptPath=${input.transcriptPath}`,
    );

    const output = await handleAgentStop(input);
    console.error(`[agentStop] Result: ${JSON.stringify(output)}`);
    console.log(JSON.stringify(output));

    // Demo driver signal: turn finished. We don't have the assistant text
    // here (it's in the transcript file, racing with writes), so we emit
    // an empty lastResponse. The demo driver can still use @wait-completion;
    // @expect text matching is handled in hook-router.ts for direct mode
    // where we own the response text.
    writeDemoState({
        event: "turnComplete",
        turnId: makeTurnId(input.sessionId),
        ts: Date.now(),
        mode: "mcp",
        handledBy: "copilot",
        lastResponse: "",
        sessionId: input.sessionId,
    });
}

main().catch((error) => {
    console.error("agentStop hook error:", error);
    process.exit(1);
});
