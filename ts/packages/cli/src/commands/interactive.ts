// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Args, Command, Flags } from "@oclif/core";
import { createDispatcher, Dispatcher } from "agent-dispatcher";
import {
    getCacheFactory,
    getAllActionConfigProvider,
} from "agent-dispatcher/internal";
import { getTraceId, getInstanceDir } from "agent-dispatcher/helpers/data";
import {
    getDefaultAppAgentProviders,
    getDefaultConstructionProvider,
    getDefaultAppAgentInstaller,
    getIndexingServiceRegistry,
} from "default-agent-provider";
import inspector from "node:inspector";
import { getChatModelNames } from "aiclient";
import {
    getConsolePrompt,
    processCommands,
    withConsoleClientIO,
} from "agent-dispatcher/helpers/console";
import {
    getEnhancedConsolePrompt,
    processCommandsEnhanced,
    withEnhancedConsoleClientIO,
} from "../enhancedConsole.js";
import { getStatusSummary } from "agent-dispatcher/helpers/status";
import { getFsStorageProvider } from "dispatcher-node-providers";
import { createInterface } from "readline/promises";
import { CopilotClient, CopilotSession } from "@github/copilot-sdk";

const modelNames = await getChatModelNames();
const instanceDir = getInstanceDir();
const defaultAppAgentProviders = getDefaultAppAgentProviders(instanceDir);
const { schemaNames } = await getAllActionConfigProvider(
    defaultAppAgentProviders,
);

/**
 * Get completions for the current input line using dispatcher's command completion API
 */
// Return completion data including where filtering starts
type CompletionData = {
    allCompletions: string[]; // All available completions (just the completion text)
    filterStartIndex: number; // Where user typing should filter (after the space/trigger)
    prefix: string; // Fixed prefix before completions
};

async function getCompletionsData(
    line: string,
    dispatcher: Dispatcher,
): Promise<CompletionData | null> {
    try {
        const result = await dispatcher.getCommandCompletion(line);
        if (!result || !result.completions || result.completions.length === 0) {
            return null;
        }

        // Extract just the completion strings
        const allCompletions: string[] = [];
        for (const group of result.completions) {
            for (const completion of group.completions) {
                allCompletions.push(completion);
            }
        }

        const prefix = line.substring(0, result.startIndex);
        const filterStartIndex = result.startIndex;

        return {
            allCompletions,
            filterStartIndex,
            prefix,
        };
    } catch (e) {
        return null;
    }
}

export default class Interactive extends Command {
    static description = "Interactive mode";
    static flags = {
        agent: Flags.string({
            description: "Schema names",
            options: schemaNames,
            multiple: true,
        }),
        explainer: Flags.string({
            description:
                "Explainer name (defaults to the explainer associated with the translator)",
            options: getCacheFactory().getExplainerNames(),
        }),
        model: Flags.string({
            description: "Translation model to use",
            options: modelNames,
        }),
        debug: Flags.boolean({
            description: "Enable debug mode",
            default: false,
        }),
        memory: Flags.boolean({
            description: "In memory session",
            default: false,
        }),
        exit: Flags.boolean({
            description: "Exit after processing input file",
            default: true,
            allowNo: true,
        }),
        testUI: Flags.boolean({
            description:
                "Enable enhanced terminal UI with spinners and visual prompts",
            default: false,
        }),
        agentMode: Flags.boolean({
            description: "Enable agent mode",
            default: false,
        }),
    };
    static args = {
        input: Args.file({
            description:
                "A text input file containing one interactive command per line",
            exists: true,
        }),
    };
    async run(): Promise<void> {
        const { args, flags } = await this.parse(Interactive);

        if (flags.debug) {
            inspector.open(undefined, undefined, true);
        }

        if (flags.agentMode && flags.testUI) {
            this.warn("Cannot have both Agent Mode and Test UI enabled at the same time. Disabling Test UI.");
            flags.testUI = false;
        }

        if (flags.agentMode) {
            this.log("Starting Agent mode...");

            const client = new CopilotClient();
            this.log("Creating session with GPT-4.1 model...");
            const session: CopilotSession = await client.createSession({
                model: "gpt-4.1",
                hooks: {
                    onUserPromptSubmitted: async (input, invocation) => {
                        console.log("🔔 HOOK: onUserPromptSubmitted activated");
                        console.log("  Prompt:", input.prompt);
                        console.log("  Session ID:", invocation.sessionId);
                        console.log("  Timestamp:", input.timestamp);
                        console.log("  CWD:", input.cwd);

                        // You can analyze the prompt here
                        if (input.prompt.includes("blue")) {
                            // Block it from being sent
                            return {
                                suppressOutput: true
                            };
                        }
                        
                        // Or modify it before sending
                        if (input.prompt.includes("translate")) {
                            return {
                                modifiedPrompt: `[TRANSLATION REQUEST] ${input.prompt}`,
                                additionalContext: "User requested a translation to german"
                            };
                        }
                        
                        // Or just add context without modifying
                        return {
                            additionalContext: `User timezone: ${new Date().toTimeString()}`
                        };
                        
                        // Return nothing to send the prompt as-is                        
                    },

                    onPreToolUse: async (input, invocation) => {
                        console.log("🔔 HOOK: onPreToolUse activated");
                        console.log("  Tool Name:", input.toolName);
                        console.log("  Tool Args:", input.toolArgs);
                        console.log("  Session ID:", invocation.sessionId);
                        console.log("  Timestamp:", input.timestamp);
                        console.log("  CWD:", input.cwd);

                        // Example: Control tool execution
                        // return {
                        //     permissionDecision: "allow", // or "deny" or "ask"
                        //     permissionDecisionReason: "Tool allowed by policy"
                        // };
                    },

                    onPostToolUse: async (input, invocation) => {
                        console.log("🔔 HOOK: onPostToolUse activated");
                        console.log("  Tool Name:", input.toolName);
                        console.log("  Tool Args:", input.toolArgs);
                        console.log("  Tool Result:", input.toolResult);
                        console.log("  Session ID:", invocation.sessionId);
                        console.log("  Timestamp:", input.timestamp);
                        console.log("  CWD:", input.cwd);
                    },

                    onSessionStart: async (input, invocation) => {
                        console.log("🔔 HOOK: onSessionStart activated");
                        console.log("  Source:", input.source);
                        console.log("  Initial Prompt:", input.initialPrompt);
                        console.log("  Session ID:", invocation.sessionId);
                        console.log("  Timestamp:", input.timestamp);
                        console.log("  CWD:", input.cwd);
                    },

                    onSessionEnd: async (input, invocation) => {
                        console.log("🔔 HOOK: onSessionEnd activated");
                        console.log("  Reason:", input.reason);
                        console.log("  Final Message:", input.finalMessage);
                        console.log("  Error:", input.error);
                        console.log("  Session ID:", invocation.sessionId);
                        console.log("  Timestamp:", input.timestamp);
                        console.log("  CWD:", input.cwd);
                    },

                    onErrorOccurred: async (input, invocation) => {
                        console.log("🔔 HOOK: onErrorOccurred activated");
                        console.log("  Error:", input.error);
                        console.log("  Error Context:", input.errorContext);
                        console.log("  Recoverable:", input.recoverable);
                        console.log("  Session ID:", invocation.sessionId);
                        console.log("  Timestamp:", input.timestamp);
                        console.log("  CWD:", input.cwd);

                        // Example: Handle errors
                        // if (input.recoverable) {
                        //     return {
                        //         errorHandling: "retry",
                        //         retryCount: 3
                        //     };
                        // }
                    }
                }
            });
            this.log("Session created with ID:", session.sessionId);

            // Session events
            session.on("session.start", (message) => {
                console.log("Session started:", message);
            });

            session.on("session.resume", (message) => {
                console.log("Session resumed:", message);
            });

            session.on("session.error", (message) => {
                console.log("Session error:", message);
            });

            session.on("session.idle", (message) => {
                console.log("Session idle:", message);
            });

            session.on("session.title_changed", (message) => {
                console.log("Session title changed:", message);
            });

            session.on("session.info", (message) => {
                console.log("Session info:", message);
            });

            session.on("session.warning", (message) => {
                console.log("Session warning:", message);
            });

            session.on("session.model_change", (message) => {
                console.log("Session model change:", message);
            });

            session.on("session.mode_changed", (message) => {
                console.log("Session mode changed:", message);
            });

            session.on("session.plan_changed", (message) => {
                console.log("Session plan changed:", message);
            });

            session.on("session.workspace_file_changed", (message) => {
                console.log("Session workspace file changed:", message);
            });

            session.on("session.handoff", (message) => {
                console.log("Session handoff:", message);
            });

            session.on("session.truncation", (message) => {
                console.log("Session truncation:", message);
            });

            session.on("session.snapshot_rewind", (message) => {
                console.log("Session snapshot rewind:", message);
            });

            session.on("session.shutdown", (message) => {
                console.log("Session shutdown:", message);
            });

            session.on("session.context_changed", (message) => {
                console.log("Session context changed:", message);
            });

            session.on("session.usage_info", (message) => {
                console.log("Session usage info:", message);
            });

            session.on("session.compaction_start", (message) => {
                console.log("Session compaction start:", message);
            });

            session.on("session.compaction_complete", (message) => {
                console.log("Session compaction complete:", message);
            });

            // User events
            session.on("user.message", (message) => {
                console.log("User message:", message);
                session.rpc
            });

            session.on("pending_messages.modified", (message) => {
                console.log("Pending messages modified:", message);
            });

            // Assistant events
            session.on("assistant.turn_start", (message) => {
                console.log("Assistant turn started:", message);
            });

            session.on("assistant.intent", (message) => {
                console.log("Assistant intent:", message);
            });

            session.on("assistant.reasoning", (message) => {
                console.log("Assistant reasoning:", message);
            });

            session.on("assistant.reasoning_delta", (message) => {
                console.log("Assistant reasoning delta:", message);
            });

            session.on("assistant.message", (message) => {
                console.log("Assistant message:", message);
            });

            session.on("assistant.message_delta", (message) => {
                console.log("Assistant message delta:", message);
            });

            session.on("assistant.turn_end", (message) => {
                console.log("Assistant turn ended:", message);
            });

            session.on("assistant.usage", (message) => {
                console.log("Assistant usage:", message);
            });

            // Abort event
            session.on("abort", (message) => {
                console.log("Abort:", message);
            });

            // Tool events
            session.on("tool.user_requested", (message) => {
                console.log("Tool user requested:", message);
            });

            session.on("tool.execution_start", (message) => {
                console.log("Tool execution start:", message);
            });

            session.on("tool.execution_partial_result", (message) => {
                console.log("Tool execution partial result:", message);
            });

            session.on("tool.execution_progress", (message) => {
                console.log("Tool execution progress:", message);
            });

            session.on("tool.execution_complete", (message) => {
                console.log("Tool execution complete:", message);
            });

            // Skill event
            session.on("skill.invoked", (message) => {
                console.log("Skill invoked:", message);
            });

            // Subagent events
            session.on("subagent.started", (message) => {
                console.log("Subagent started:", message);
            });

            session.on("subagent.completed", (message) => {
                console.log("Subagent completed:", message);
            });

            session.on("subagent.failed", (message) => {
                console.log("Subagent failed:", message);
            });

            session.on("subagent.selected", (message) => {
                console.log("Subagent selected:", message);
            });

            // Hook events
            session.on("hook.start", (message) => {
                console.log("Hook start:", message);
            });

            session.on("hook.end", (message) => {
                console.log("Hook end:", message);
            });

            // System event
            session.on("system.message", (message) => {
                console.log("System message:", message);
            });

            this.log("Sending message: What is 2 + 2?");
            const response = await session.sendAndWait({ prompt: "What is 2 + 2?" });
            this.log("Received response:");
            console.log(response?.data.content);

            this.log("Sending message: Why is the sky blue?");
            const response2 = await session.sendAndWait({ prompt: "Why is the sky blue?" });
            this.log("Received response:");
            console.log(response2?.data.content);

            await client.stop();
            process.exit(0);            
        }

        // Choose between standard and enhanced UI
        const withClientIO = flags.testUI
            ? withEnhancedConsoleClientIO
            : withConsoleClientIO;
        const processCommandsFn = flags.testUI
            ? processCommandsEnhanced
            : processCommands;
        const getPromptFn = flags.testUI
            ? getEnhancedConsolePrompt
            : getConsolePrompt;

        // Only create readline for standard console - enhanced console creates its own
        const rl = flags.testUI
            ? undefined
            : createInterface({
                  input: process.stdin,
                  output: process.stdout,
                  terminal: true,
              });

        await withClientIO(async (clientIO) => {
            const persistDir = !flags.memory ? instanceDir : undefined;
            const dispatcher = await createDispatcher("cli interactive", {
                appAgentProviders: defaultAppAgentProviders,
                agentInstaller: getDefaultAppAgentInstaller(instanceDir),
                agents: flags.agent,
                translation: { model: flags.model },
                explainer: { name: flags.explainer },
                persistSession: !flags.memory,
                persistDir,
                storageProvider:
                    persistDir !== undefined
                        ? getFsStorageProvider()
                        : undefined,
                clientIO,
                dblogging: true,
                indexingServiceRegistry:
                    await getIndexingServiceRegistry(persistDir),
                traceId: getTraceId(),
                constructionProvider: getDefaultConstructionProvider(),
            });

            try {
                if (args.input) {
                    await dispatcher.processCommand(`@run ${args.input}`);
                    if (flags.exit) {
                        return;
                    }
                }

                await processCommandsFn(
                    async (dispatcher: Dispatcher) =>
                        getPromptFn(
                            getStatusSummary(await dispatcher.getStatus(), {
                                showPrimaryName: false,
                            }),
                        ),
                    (command: string, dispatcher: Dispatcher) =>
                        dispatcher.processCommand(command),
                    dispatcher,
                    undefined, // inputs
                    flags.testUI
                        ? (line: string) => getCompletionsData(line, dispatcher)
                        : undefined,
                );
            } finally {
                await dispatcher.close();
            }
        }, rl);

        // Some background network (like mongo) might keep the process live, exit explicitly.
        process.exit(0);
    }
}
