// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Args, Command, Flags } from "@oclif/core";
import type { Dispatcher } from "@typeagent/dispatcher-types";
import { createCompletionController } from "agent-dispatcher/helpers/completion";
import {
    getEnhancedConsolePrompt,
    processCommandsEnhanced,
    replayDisplayHistory,
    withEnhancedConsoleClientIO,
} from "../enhancedConsole.js";
import { setConversationCommandContext } from "../slashCommands.js";
import type { ConversationCommandContext } from "../conversationCommands.js";
import {
    connectAgentServer,
    ensureAgentServer,
    ensureAndConnectConversation,
    AgentServerConnection,
} from "@typeagent/agent-server-client";
import { getStatusSummary } from "@typeagent/dispatcher-types/helpers/status";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as readline from "readline";

const CLI_STATE_FILE = path.join(os.homedir(), ".typeagent", "cli-state.json");
const CLI_CONVERSATION_NAME = "CLI";

function loadLastConversationId(): string | undefined {
    try {
        const raw = fs.readFileSync(CLI_STATE_FILE, "utf8");
        return (
            JSON.parse(raw).lastSessionId ??
            JSON.parse(raw).lastConversationId ??
            undefined
        );
    } catch {
        return undefined;
    }
}

function saveLastConversationId(conversationId: string): void {
    try {
        fs.mkdirSync(path.dirname(CLI_STATE_FILE), { recursive: true });
        fs.writeFileSync(
            CLI_STATE_FILE,
            JSON.stringify({ lastConversationId: conversationId }),
        );
    } catch {
        // Non-fatal: persistence failure should not block the conversation.
    }
}

function clearLastConversationId(): void {
    try {
        fs.unlinkSync(CLI_STATE_FILE);
    } catch {
        // Ignore if already gone.
    }
}

function promptYesNo(question: string): Promise<boolean> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    return new Promise((resolve) => {
        rl.question(`${question} [y/N] `, (answer) => {
            rl.close();
            resolve(answer.trim().toLowerCase() === "y");
        });
    });
}

export default class Connect extends Command {
    static description =
        "Connect to the agent server in interactive mode. Defaults to the 'CLI' conversation, or specify --conversation <id> to join a specific one.";
    static flags = {
        request: Flags.string({
            description:
                "Initial request to send to the type agent upon connection",
        }),
        exit: Flags.boolean({
            description:
                "Exit after processing --request or input file.  No effect if request or file is not provided.",
            default: true,
            allowNo: true,
        }),
        port: Flags.integer({
            char: "p",
            description: "Port for type agent server",
            default: 8999,
        }),
        resume: Flags.boolean({
            char: "r",
            description:
                "Resume the last used conversation instead of defaulting to 'CLI'. Ignored if --conversation is provided.",
            default: false,
        }),
        conversation: Flags.string({
            char: "c",
            description:
                "Conversation ID to join. Takes priority over --resume.",
            required: false,
        }),
        verbose: Flags.string({
            description:
                "Enable verbose debug output (optional: comma-separated debug namespaces, default: typeagent:*)",
            required: false,
        }),
        memory: Flags.boolean({
            description:
                "Use an ephemeral conversation that is automatically deleted on exit",
            default: false,
            exclusive: ["conversation", "resume"],
        }),
        hidden: Flags.boolean({
            description:
                "Start the agent server without a visible window (background mode). Only applies when the server is not already running.",
            default: false,
        }),
        idleTimeout: Flags.integer({
            description:
                "Shut down the agent server after this many seconds with no connected clients. 0 disables (default). Only applies when the server is spawned by this command.",
            default: 0,
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
        const { args, flags } = await this.parse(Connect);

        if (flags.verbose !== undefined) {
            const { default: registerDebug } = await import("debug");
            const namespaces = flags.verbose || "typeagent:*";
            registerDebug.enable(namespaces);
            process.env.DEBUG = namespaces;
            const { enableVerboseFromFlag } = await import(
                "../slashCommands.js"
            );
            enableVerboseFromFlag(namespaces);
        }

        const { installDebugInterceptor } = await import(
            "../debugInterceptor.js"
        );
        installDebugInterceptor();

        // Clear screen and move cursor to top for a clean full-height start
        if (process.stdout.isTTY) {
            process.stdout.write("\x1b[2J\x1b[H");
        }

        const persistedConversationId =
            flags.conversation ??
            (flags.resume ? loadLastConversationId() : undefined);
        // Only intercept "Conversation not found" when using the client-side default
        // (no explicit --conversation flag). Explicit --conversation errors propagate as-is.
        const isDefaultConversation = flags.conversation === undefined;
        const isEphemeral = flags.memory;

        await withEnhancedConsoleClientIO(async (clientIO, bindDispatcher) => {
            const url = `ws://localhost:${flags.port}`;

            const onDisconnect = () => {
                console.error("Disconnected from dispatcher");
                process.exit(1);
            };

            // Helper: find the "CLI" conversation by name (creating it if absent) and join it.
            const connectToCliConversation = async () => {
                await ensureAgentServer(
                    flags.port,
                    flags.hidden,
                    flags.idleTimeout,
                );
                const connection = await connectAgentServer(url, onDisconnect);
                const existing = await connection.listConversations(
                    CLI_CONVERSATION_NAME,
                );
                const match = existing.find(
                    (s) =>
                        s.name.toLowerCase() ===
                        CLI_CONVERSATION_NAME.toLowerCase(),
                );
                const cliConversationId =
                    match !== undefined
                        ? match.conversationId
                        : (
                              await connection.createConversation(
                                  CLI_CONVERSATION_NAME,
                              )
                          ).conversationId;
                const conversation = await connection.joinConversation(
                    clientIO,
                    {
                        conversationId: cliConversationId,
                    },
                );
                conversation.dispatcher.close = async () => {
                    await connection.close();
                };
                return { conversation, connection };
            };

            // Helper: create an ephemeral conversation for --memory flag.
            const connectToEphemeralConversation = async () => {
                await ensureAgentServer(
                    flags.port,
                    flags.hidden,
                    flags.idleTimeout,
                );
                const connection = await connectAgentServer(url, onDisconnect);
                const ephemeralName = `cli-ephemeral-${crypto.randomUUID()}`;
                const created =
                    await connection.createConversation(ephemeralName);
                const conversation = await connection.joinConversation(
                    clientIO,
                    {
                        conversationId: created.conversationId,
                    },
                );
                conversation.dispatcher.close = async () => {
                    await connection.close();
                };
                return {
                    conversation,
                    connection,
                    ephemeralConversationId: created.conversationId,
                };
            };

            let conversation: Awaited<
                ReturnType<typeof connectToCliConversation>
            >["conversation"];
            let connection: AgentServerConnection | undefined;
            let ephemeralConversationId: string | undefined;

            if (isEphemeral) {
                // --memory: use an ephemeral conversation, delete on exit
                const result = await connectToEphemeralConversation();
                conversation = result.conversation;
                connection = result.connection;
                ephemeralConversationId = result.ephemeralConversationId;
            } else {
                // Resolve the conversation to join:
                //   1. explicit --conversation flag
                //   2. persisted last-used conversation ID (with "not found" recovery)
                //   3. default: find-or-create the "CLI" conversation
                const result =
                    persistedConversationId !== undefined
                        ? await ensureAndConnectConversation(
                              clientIO,
                              flags.port,
                              { conversationId: persistedConversationId },
                              onDisconnect,
                              flags.hidden,
                              flags.idleTimeout,
                          )
                              .then((s) => ({
                                  conversation: s,
                                  connection: undefined as
                                      | AgentServerConnection
                                      | undefined,
                              }))
                              .catch(async (err: any) => {
                                  if (
                                      isDefaultConversation &&
                                      typeof err?.message === "string" &&
                                      err.message.startsWith(
                                          "Conversation not found:",
                                      )
                                  ) {
                                      console.log(
                                          `The last used conversation no longer exists on the server.`,
                                      );
                                      const join = await promptYesNo(
                                          `Join the default '${CLI_CONVERSATION_NAME}' conversation?`,
                                      );
                                      if (!join) {
                                          clearLastConversationId();
                                          return null;
                                      }
                                      clearLastConversationId();
                                      return connectToCliConversation();
                                  }
                                  throw err;
                              })
                        : await connectToCliConversation();

                if (result === null) {
                    return;
                }
                conversation = result.conversation;
                connection = result.connection;
            }

            const {
                dispatcher: initialDispatcher,
                name: initialName,
                conversationId: initialConversationId,
            } = conversation;

            // Mutable conversation state — updated by switchConversation callback
            let activeDispatcher = initialDispatcher;
            let activeConversationId = initialConversationId;
            let activeName = initialName;

            if (!isEphemeral) {
                saveLastConversationId(activeConversationId);
            }
            bindDispatcher(activeDispatcher);
            await replayDisplayHistory(activeDispatcher, clientIO, activeName);

            // Set up ConversationCommandContext for @conversation commands.
            // Only available when the AgentServerConnection is accessible
            // (connectToCliConversation / connectToEphemeralConversation paths).
            // The ensureAndConnectConversation path (--session / --resume flags)
            // does not expose the connection, so convCtx stays undefined there.
            let convCtx: ConversationCommandContext | undefined;
            if (connection !== undefined) {
                convCtx = {
                    connection,
                    getCurrentConversationId: () => activeConversationId,
                    getCurrentConversationName: () => activeName,
                    switchConversation: async (newConversationId: string) => {
                        // Join the new conversation first so that if it fails we
                        // haven't already left the old one (avoids stranded state).
                        const newConversation =
                            await connection.joinConversation(clientIO, {
                                conversationId: newConversationId,
                            });
                        newConversation.dispatcher.close = async () => {
                            await connection.close();
                        };
                        await connection.leaveConversation(
                            activeConversationId,
                        );
                        activeDispatcher = newConversation.dispatcher;
                        activeConversationId = newConversation.conversationId;
                        activeName = newConversation.name;
                        bindDispatcher(activeDispatcher);
                        if (!isEphemeral) {
                            saveLastConversationId(activeConversationId);
                        }
                        await replayDisplayHistory(
                            activeDispatcher,
                            clientIO,
                            activeName,
                        );
                        return newConversation;
                    },
                };
                setConversationCommandContext(convCtx);
            }

            try {
                let processed = false;
                if (flags.request) {
                    await activeDispatcher.processCommand(flags.request);
                    processed = true;
                }
                if (args.input) {
                    await activeDispatcher.processCommand(`@run ${args.input}`);
                    processed = true;
                }
                if (processed && flags.exit) {
                    return;
                }
                await processCommandsEnhanced(
                    async (_dispatcher: Dispatcher) =>
                        getEnhancedConsolePrompt(
                            getStatusSummary(
                                await activeDispatcher.getStatus(),
                                { showPrimaryName: false },
                            ),
                        ),
                    async (command: string, _dispatcher: Dispatcher) => {
                        return activeDispatcher.processCommand(command);
                    },
                    activeDispatcher,
                    undefined,
                    createCompletionController(activeDispatcher),
                    activeDispatcher,
                );
            } finally {
                if (
                    ephemeralConversationId !== undefined &&
                    connection !== undefined
                ) {
                    try {
                        await connection.deleteConversation(
                            ephemeralConversationId,
                        );
                    } catch {
                        // Best effort cleanup of ephemeral conversation
                    }
                }
                if (activeDispatcher) {
                    await activeDispatcher.close();
                }
            }
        });

        // Some background network (like mongo) might keep the process live, exit explicitly.
        process.exit(0);
    }
}
