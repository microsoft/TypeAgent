// Minimal test: can we call the Claude Agent SDK at all?
import { query } from "@anthropic-ai/claude-agent-sdk";

console.log("Starting Claude Agent SDK test...");
console.log("API key set:", !!process.env.ANTHROPIC_API_KEY);

try {
    const q = query({
        prompt: "Say hello in one sentence.",
        options: {
            model: "claude-sonnet-4-20250514",
            maxTurns: 1,
            permissionMode: "acceptEdits",
            systemPrompt: "You are a helpful assistant. Respond briefly.",
        },
    });

    for await (const message of q) {
        if (message.type === "assistant") {
            for (const content of message.message.content) {
                if (content.type === "text") {
                    console.log("Response:", content.text);
                }
            }
        } else if (message.type === "result") {
            console.log("Done. Session:", message.session_id);
        } else {
            console.log("Message type:", message.type);
        }
    }
    console.log("SUCCESS - SDK works!");
} catch (err) {
    console.error("FAILED:", err.message);
    if (err.message.includes("context-1m")) {
        console.error("\n--- Beta header issue confirmed in bare SDK call ---");
    }
}
