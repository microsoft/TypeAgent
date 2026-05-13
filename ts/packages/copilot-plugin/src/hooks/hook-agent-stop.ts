/**
 * Standalone entry point for the agentStop hook.
 * Reads input from stdin and delegates to the history handler.
 */

import { handleAgentStop, type AgentStopInput } from "./hook-history.js";

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

    console.error(`[agentStop] Hook fired. stopReason=${input.stopReason} transcriptPath=${input.transcriptPath}`);

    const output = await handleAgentStop(input);
    console.error(`[agentStop] Result: ${JSON.stringify(output)}`);
    console.log(JSON.stringify(output));
}

main().catch((error) => {
    console.error("agentStop hook error:", error);
    process.exit(1);
});
