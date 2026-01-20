#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { config } from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

// Load .env file from the TypeAgent repository root (ts directory)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../../..");
config({ path: path.join(repoRoot, ".env") });

import {
    query,
    type SDKMessage,
    type Options,
} from "@anthropic-ai/claude-agent-sdk";
import * as readline from "readline";
import { CacheClient } from "coder-wrapper";
import { DebugLogger } from "coder-wrapper";
import { VoiceInputHandler } from "./voiceInput.js";

/**
 * ClaudeSDKClient wrapper for continuous conversation with memory.
 * Uses the SDK's continue mode to maintain context across multiple queries.
 */
class ClaudeSDKClient {
    private options: Options;
    private connected: boolean = false;
    private isFirstQuery: boolean = true;

    constructor(options: Options) {
        this.options = options;
    }

    /**
     * Connect to the SDK (just marks as connected)
     */
    async connect(): Promise<void> {
        if (this.connected) {
            return;
        }
        this.connected = true;
    }

    /**
     * Query the agent with a message and return an async generator of responses
     */
    async *queryAndReceive(message: string): AsyncGenerator<SDKMessage, void> {
        if (!this.connected) {
            throw new Error("Client not connected. Call connect() first.");
        }

        // Use continue mode after first query to maintain context
        const queryOptions: Options = {
            ...this.options,
            continue: !this.isFirstQuery,
        };

        // Mark that we've done the first query
        if (this.isFirstQuery) {
            this.isFirstQuery = false;
        }

        // Execute query and yield all messages
        const queryInstance = query({
            prompt: message,
            options: queryOptions,
        });

        yield* queryInstance;
    }

    /**
     * Disconnect from the session
     */
    disconnect(): void {
        this.connected = false;
        this.isFirstQuery = true;
    }
}

/**
 * CLI options
 */
interface CliOptions {
    model: string;
    debug: boolean;
    enableCache: boolean;
    tools: string[];
    help: boolean;
}

/**
 * Parse command line arguments
 */
function parseArgs(): CliOptions {
    const args = process.argv.slice(2);
    let model = "claude-sonnet-4-5-20250929";
    let debug = false;
    let enableCache = true;
    let tools: string[] = [];
    let help = false;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        switch (arg) {
            case "--help":
            case "-h":
                help = true;
                break;
            case "--model":
            case "-m":
                const modelArg = args[++i]?.toLowerCase();
                if (modelArg === "sonnet") {
                    model = "claude-sonnet-4-5-20250929";
                } else if (modelArg === "opus") {
                    model = "claude-opus-4-5-20251101";
                } else {
                    model = args[i]; // Use custom model string
                }
                break;
            case "--debug":
            case "-d":
                debug = true;
                break;
            case "--no-cache":
                enableCache = false;
                break;
            case "--tools":
            case "-t":
                tools = args[++i]?.split(",") || [];
                break;
        }
    }

    return { model, debug, enableCache, tools, help };
}

/**
 * Print usage information
 */
function printUsage(): void {
    console.log(`
Usage: agent-sdk-wrapper [options]

Options:
  -m, --model <name>     Specify the model to use (default: sonnet)
                         - sonnet: Claude Sonnet 4.5
                         - opus: Claude Opus 4.5
                         - or provide a full model ID
  -d, --debug           Enable debug logging with cache timing information
  --no-cache            Disable cache checking
  -t, --tools <list>    Comma-separated list of tools to enable (e.g., bash,read,write)
                        Default: all tools enabled
  -h, --help            Show this help message

Examples:
  agent-sdk-wrapper                    # Use Claude Sonnet with cache
  agent-sdk-wrapper -m opus            # Use Claude Opus
  agent-sdk-wrapper --debug            # Enable debug logging
  agent-sdk-wrapper --no-cache         # Disable cache checking
  agent-sdk-wrapper -t bash,read       # Enable only bash and read tools

Description:
  Direct integration with the Anthropic Agent SDK with TypeAgent caching support.
  Uses ClaudeSDKClient for continuous conversation with memory across multiple inputs.
  The wrapper maintains context across user inputs like a REPL and checks the cache
  before making API calls to Claude. Cache hits are returned immediately without
  calling the API.

  Type 'exit' or press Ctrl+C to quit.
`);
}

/**
 * Format output with gray separators like coderWrapper
 */
function formatOutput(text: string, terminalWidth: number): string {
    const grayColor = "\x1b[90m";
    const resetColor = "\x1b[0m";
    const separator = grayColor + "─".repeat(terminalWidth) + resetColor;
    return `${separator}\n${text}\n${separator}`;
}

/**
 * Main CLI entry point
 */
async function main() {
    const options = parseArgs();

    if (options.help) {
        printUsage();
        process.exit(0);
    }

    // Initialize debug logger
    const debugLogger = options.debug ? new DebugLogger(true) : null;

    // Initialize cache client
    const cacheClient = options.enableCache
        ? new CacheClient(undefined, debugLogger || undefined)
        : null;

    if (cacheClient) {
        try {
            await cacheClient.connect();
            if (debugLogger) {
                debugLogger.log("Cache client connected");
            }
        } catch (error) {
            console.error(
                `[AgentSDK] Warning: Failed to connect to cache: ${error instanceof Error ? error.message : String(error)}`,
            );
            if (debugLogger) {
                debugLogger.error("Cache connection failed", error);
            }
        }
    }

    // Build tool configuration
    const allowedTools =
        options.tools.length > 0
            ? options.tools
            : [
                  "Read",
                  "Write",
                  "Edit",
                  "Bash",
                  "Glob",
                  "Grep",
                  "WebSearch",
                  "WebFetch",
                  "Task",
                  "NotebookEdit",
                  "TodoWrite",
                  // Allow all tools from the command-executor MCP server
                  "mcp__command-executor__*",
              ];

    // Track cache hits for context injection
    let lastCacheHit: { request: string; result: string } | null = null;

    // Initialize ClaudeSDKClient for continuous conversation with Claude Code configuration
    if (debugLogger) {
        debugLogger.log(
            "Creating ClaudeSDKClient with Claude Code configuration",
        );
    }

    // Configure the command-executor MCP server
    const currentFilePath = fileURLToPath(import.meta.url);
    const currentDir = path.dirname(currentFilePath);
    const commandExecutorPath = path.resolve(
        currentDir,
        "../../commandExecutor/dist/server.js",
    );

    if (debugLogger) {
        debugLogger.log(`Command executor path: ${commandExecutorPath}`);
    }

    const client = new ClaudeSDKClient({
        systemPrompt: {
            type: "preset",
            preset: "claude_code",
        },
        model: options.model,
        permissionMode: "acceptEdits",
        allowedTools,
        cwd: process.cwd(),
        settingSources: ["project"],
        maxTurns: 20,
        maxThinkingTokens: 10000,
        mcpServers: {
            "command-executor": {
                command: "node",
                args: [commandExecutorPath],
            },
        },
        hooks: {
            UserPromptSubmit: [
                {
                    hooks: [
                        async (input) => {
                            // If there was a recent cache hit, inject it as context
                            if (lastCacheHit) {
                                const contextMessage = `\n\n[Previous cached interaction - for context only]\nUser previously asked: "${lastCacheHit.request}"\nResult: ${lastCacheHit.result.substring(0, 500)}${lastCacheHit.result.length > 500 ? "..." : ""}`;
                                // Clear after injecting once
                                lastCacheHit = null;
                                return {
                                    hookSpecificOutput: {
                                        hookEventName: "UserPromptSubmit",
                                        additionalContext: contextMessage,
                                    },
                                };
                            }
                            return { continue: true };
                        },
                    ],
                },
            ],
        },
    });

    // Connect to the client
    await client.connect();

    if (debugLogger) {
        debugLogger.log("ClaudeSDKClient connected successfully");
    }

    console.log(`[AgentSDK] Starting Anthropic Agent SDK wrapper`);
    console.log(`[AgentSDK] Model: ${options.model}`);
    console.log(
        `[AgentSDK] Cache: ${options.enableCache ? "enabled" : "disabled"}`,
    );
    if (options.debug) {
        console.log(
            `[AgentSDK] Debug mode enabled - cache timing will be logged`,
        );
        if (debugLogger) {
            console.log(
                `[AgentSDK] Debug log: ${debugLogger.getLogFilePath()}`,
            );
        }
    }
    if (options.tools.length > 0) {
        console.log(`[AgentSDK] Tools: ${options.tools.join(", ")}`);
    } else {
        console.log(`[AgentSDK] Tools: ${allowedTools.join(", ")}`);
    }
    // Initialize voice input handler
    const voiceHandler = new VoiceInputHandler();
    const voiceEnabled = await voiceHandler.isWhisperServiceAvailable();
    const provider = voiceHandler.getProvider();

    if (voiceEnabled) {
        const providerName =
            provider === "openai" ? "OpenAI Whisper API" : "Local Whisper";
        console.log(
            `[AgentSDK] Voice input enabled (${providerName}) - type '/voice' or press Ctrl+V`,
        );
    } else {
        console.log(
            `[AgentSDK] Voice input disabled - No transcription service available`,
        );
        console.log(
            `[AgentSDK] Set OPENAI_API_KEY environment variable or start local Whisper service`,
        );
    }

    console.log(`[AgentSDK] Type 'exit' or press Ctrl+C to quit\n`);

    // Create readline interface
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: "> ",
    });

    // Enable keypress events for Ctrl+V hotkey
    let isProcessingVoice = false;
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY && process.stdin.setRawMode) {
        process.stdin.setRawMode(true);

        // Handle keypress events
        process.stdin.on("keypress", async (str, key) => {
            // Ctrl+V triggers voice input
            if (
                key &&
                key.ctrl &&
                key.name === "v" &&
                voiceEnabled &&
                !isProcessingVoice
            ) {
                isProcessingVoice = true;

                try {
                    const transcribedText =
                        await voiceHandler.recordAndTranscribe();
                    if (transcribedText) {
                        console.log(`📝 Transcribed: "${transcribedText}"\n`);
                        // Emit as a line event to process it
                        rl.write(transcribedText + "\n");
                    } else {
                        console.log("⚠️  No speech detected\n");
                        rl.prompt();
                    }
                } catch (error) {
                    console.error(
                        `❌ Voice input error: ${error instanceof Error ? error.message : String(error)}\n`,
                    );
                    rl.prompt();
                } finally {
                    isProcessingVoice = false;
                }
                return;
            }

            // Ctrl+C to exit
            if (key && key.ctrl && key.name === "c") {
                console.log("\n[AgentSDK] Goodbye!");
                client.disconnect();
                rl.close();
                if (cacheClient) {
                    await cacheClient.close();
                }
                if (debugLogger) {
                    debugLogger.close();
                }
                process.exit(0);
            }
        });
    }

    rl.prompt();

    rl.on("line", async (input: string) => {
        const trimmed = input.trim();

        // Handle exit commands
        if (
            trimmed === "exit" ||
            trimmed === "quit" ||
            trimmed === ".exit" ||
            trimmed === ".quit"
        ) {
            console.log("\n[AgentSDK] Goodbye!");
            client.disconnect();
            rl.close();
            if (cacheClient) {
                await cacheClient.close();
            }
            if (debugLogger) {
                debugLogger.close();
            }
            process.exit(0);
        }

        // Handle voice input command
        if (
            (trimmed === "/voice" || trimmed === ":v" || trimmed === "/v") &&
            voiceEnabled
        ) {
            try {
                const transcribedText =
                    await voiceHandler.recordAndTranscribe();
                if (transcribedText) {
                    console.log(`📝 Transcribed: "${transcribedText}"\n`);
                    // Recursively process the transcribed text
                    rl.write(transcribedText + "\n");
                } else {
                    console.log("⚠️  No speech detected\n");
                    rl.prompt();
                }
            } catch (error) {
                console.error(
                    `❌ Voice input error: ${error instanceof Error ? error.message : String(error)}\n`,
                );
                rl.prompt();
            }
            return;
        }

        // Skip empty inputs
        if (!trimmed) {
            rl.prompt();
            return;
        }

        const terminalWidth = process.stdout.columns || 80;
        const startTime = performance.now();

        try {
            // Check cache first if enabled
            if (cacheClient) {
                if (debugLogger) {
                    debugLogger.log(`Checking cache for: "${trimmed}"`);
                }

                const cacheResult = await cacheClient.checkCache(trimmed);
                const elapsedMs = performance.now() - startTime;

                if (cacheResult.hit && cacheResult.result) {
                    // Cache hit!
                    if (debugLogger) {
                        debugLogger.log(
                            `✓ Cache HIT (${elapsedMs.toFixed(2)}ms)`,
                        );
                    }

                    // Store cache hit for context injection into next user message
                    lastCacheHit = {
                        request: trimmed,
                        result: cacheResult.result,
                    };

                    // Print timing on cache hit (always show timing for cache hits)
                    console.log(`(${Math.round(elapsedMs)}ms)`);

                    // Print the cached result with separators
                    if (cacheResult.result.trim()) {
                        console.log(
                            formatOutput(cacheResult.result, terminalWidth),
                        );
                    }

                    rl.prompt();
                    return;
                } else {
                    // Cache miss
                    if (debugLogger) {
                        debugLogger.log(
                            `✗ Cache MISS (${elapsedMs.toFixed(2)}ms): ${cacheResult.error || "not found"}`,
                        );
                        debugLogger.log("Calling ClaudeSDKClient");
                    }
                }
            }

            // Call ClaudeSDKClient
            if (debugLogger) {
                debugLogger.log("Sending query to ClaudeSDKClient");
            }

            const apiStartTime = performance.now();

            // Query client and receive responses
            let finalResult = "";
            let hasShownReasoning = false;
            for await (const message of client.queryAndReceive(trimmed)) {
                if (message.type === "result") {
                    // Final result from the agent
                    if (message.subtype === "success") {
                        finalResult = message.result || "";
                    } else {
                        // Handle error results
                        const errors =
                            "errors" in message
                                ? (message as any).errors
                                : undefined;
                        finalResult = `Error: ${errors?.join(", ") || "Unknown error"}`;
                    }
                    break; // Exit loop after result
                } else if (message.type === "assistant") {
                    // Assistant message during processing - check for reasoning
                    const msg = message.message;
                    const content = msg.content;

                    if (Array.isArray(content)) {
                        // Look for thinking/reasoning blocks
                        for (const block of content) {
                            if (block.type === "thinking" && block.thinking) {
                                // Display reasoning in gray
                                if (!hasShownReasoning) {
                                    const grayColor = "\x1b[90m";
                                    const resetColor = "\x1b[0m";
                                    console.log(
                                        `\n${grayColor}${block.thinking}${resetColor}\n`,
                                    );
                                    hasShownReasoning = true;
                                }
                            }
                        }
                    }

                    if (options.debug && debugLogger) {
                        const textContent = Array.isArray(content)
                            ? content.find((c: any) => c.type === "text")?.text
                            : "";
                        debugLogger.log(
                            `Assistant message: ${textContent?.substring(0, 100) || "(no text)"}...`,
                        );
                    }
                }
            }

            const apiElapsedMs = performance.now() - apiStartTime;

            if (debugLogger) {
                debugLogger.log(
                    `ClaudeSDKClient query completed (${apiElapsedMs.toFixed(2)}ms)`,
                );
            }

            // Don't print timing for API calls (only cache hits show timing)

            // Print the result with separators
            if (finalResult && finalResult.trim()) {
                console.log(formatOutput(finalResult, terminalWidth));
            }
        } catch (error) {
            const elapsedMs = performance.now() - startTime;
            const errorMsg = `Error: ${error instanceof Error ? error.message : String(error)}`;

            if (debugLogger) {
                debugLogger.error(
                    `Error after ${elapsedMs.toFixed(2)}ms`,
                    error,
                );
            }

            console.error(`\n${errorMsg}\n`);
        }

        rl.prompt();
    });

    rl.on("close", async () => {
        // Don't print goodbye here - it's already printed by the exit command handler
        client.disconnect();
        if (cacheClient) {
            await cacheClient.close();
        }
        if (debugLogger) {
            debugLogger.close();
        }
        process.exit(0);
    });

    // Handle Ctrl+C
    process.on("SIGINT", async () => {
        console.log("\n[AgentSDK] Received SIGINT, shutting down...");
        client.disconnect();
        if (cacheClient) {
            await cacheClient.close();
        }
        if (debugLogger) {
            debugLogger.close();
        }
        process.exit(0);
    });
}

// Run the CLI
main().catch((error) => {
    console.error(
        `[AgentSDK] Fatal error: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
});
