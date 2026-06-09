// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Args, Command, Flags } from "@oclif/core";
import type { Dispatcher } from "@typeagent/dispatcher-types";
import { awaitCommand } from "@typeagent/dispatcher-types";
import { createCompletionController } from "agent-dispatcher/helpers/completion";
import {
    getEnhancedConsolePrompt,
    processCommandsEnhanced,
    replayDisplayHistory,
    withEnhancedConsoleClientIO,
    applyQueueSnapshot,
    clearRecentSubmissions,
} from "../enhancedConsole.js";
import {
    setConversationCommandContext,
    setServerPort,
    setServerConnection,
    setQueueDispatcher,
    setCliConnectionId,
} from "../slashCommands.js";
import type { ConversationCommandContext } from "../conversationCommands.js";
import {
    connectAgentServer,
    ensureAgentServer,
    AgentServerConnection,
    type ConversationDispatcher,
    AGENT_SERVER_DEFAULT_PORT,
} from "@typeagent/agent-server-client";
import {
    createEphemeralConversation,
    deleteEphemeralConversation,
    findOrCreateNamedConversation,
    joinNamedOrFallback,
} from "@typeagent/agent-server-client/conversation";
import { getStatusSummary } from "@typeagent/dispatcher-types/helpers/status";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as readline from "readline";
import { loadUserSettings } from "agent-dispatcher/helpers/userSettings";

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
            default: AGENT_SERVER_DEFAULT_PORT,
        }),
        resume: Flags.boolean({
            char: "r",
            description:
                "Resume the last used conversation instead of defaulting to 'CLI'. Ignored if --conversation is provided. Use --no-resume to override a saved user setting.",
            allowNo: true,
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
                "Start the agent server without a visible window (background mode). Only applies when the server is not already running. Use --no-hidden to override a saved user setting.",
            allowNo: true,
        }),
        idleTimeout: Flags.integer({
            description:
                "Shut down the agent server after this many seconds with no connected clients. 0 disables. Only applies when the server is spawned by this command. Omit to use saved user setting.",
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
        const { args, flags: rawFlags } = await this.parse(Connect);

        // Merge persistent user settings as defaults for flags not explicitly set.
        // With allowNo / no default, omitted flags are undefined, so ?? falls
        // through to the saved user setting. Explicit --flag or --no-flag wins.
        const userSettings = loadUserSettings();
        const flags = {
            ...rawFlags,
            hidden: rawFlags.hidden ?? userSettings.server.hidden,
            idleTimeout:
                rawFlags.idleTimeout ?? userSettings.server.idleTimeout,
            resume: rawFlags.resume ?? userSettings.conversation.resume,
        };

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
                const target = await findOrCreateNamedConversation(
                    connection,
                    CLI_CONVERSATION_NAME,
                );
                const conversation = await connection.joinConversation(
                    clientIO,
                    {
                        conversationId: target.conversationId,
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
                const eph = await createEphemeralConversation(
                    connection,
                    clientIO,
                    "cli-ephemeral",
                );
                eph.conversation.dispatcher.close = async () => {
                    await connection.close();
                };
                return {
                    conversation: eph.conversation,
                    connection,
                    ephemeralConversationId: eph.ephemeralConversationId,
                };
            };

            let conversation: Awaited<
                ReturnType<typeof connectToCliConversation>
            >["conversation"];
            let connection: AgentServerConnection | undefined;
            let ephemeralConversationId: string | undefined;

            if (isEphemeral) {
                const result = await connectToEphemeralConversation();
                conversation = result.conversation;
                connection = result.connection;
                ephemeralConversationId = result.ephemeralConversationId;
            } else if (persistedConversationId !== undefined) {
                // Restore the persisted/explicit conversation, falling back
                // to find-or-create only when the user opts in (default flow)
                // and the server returned "Conversation not found:".
                await ensureAgentServer(
                    flags.port,
                    flags.hidden,
                    flags.idleTimeout,
                );
                const conn = await connectAgentServer(url, onDisconnect);
                let userDeclined = false;
                try {
                    const result = await joinNamedOrFallback(conn, clientIO, {
                        savedConversationId: persistedConversationId,
                        defaultName: CLI_CONVERSATION_NAME,
                        shouldFallback: async (err: unknown) => {
                            const msg = (err as { message?: string })?.message;
                            if (
                                !isDefaultConversation ||
                                typeof msg !== "string" ||
                                !msg.startsWith("Conversation not found:")
                            ) {
                                return false;
                            }
                            console.log(
                                `The last used conversation no longer exists on the server.`,
                            );
                            const join = await promptYesNo(
                                `Join the default '${CLI_CONVERSATION_NAME}' conversation?`,
                            );
                            clearLastConversationId();
                            if (!join) {
                                userDeclined = true;
                                return false;
                            }
                            return true;
                        },
                    });
                    result.conversation.dispatcher.close = async () => {
                        await conn.close();
                    };
                    conversation = result.conversation;
                    connection = conn;
                } catch (err) {
                    if (userDeclined) {
                        await conn.close().catch(() => {});
                        return;
                    }
                    throw err;
                }
            } else {
                const result = await connectToCliConversation();
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
            // Wire slash-command dispatcher and bootstrap the queue snapshot for the first prompt.
            setQueueDispatcher(activeDispatcher);
            setCliConnectionId(conversation.connectionId);
            clearRecentSubmissions();
            applyQueueSnapshot(conversation.queueSnapshot);
            await replayDisplayHistory(activeDispatcher, clientIO, activeName);

            // Set up ConversationCommandContext for @conversation commands.
            // Available on all connection paths since each path now exposes the
            // AgentServerConnection.
            let convCtx: ConversationCommandContext | undefined;
            if (connection !== undefined) {
                const conn = connection;
                const rebindAfterSwitch = async (
                    newConversation: ConversationDispatcher,
                ) => {
                    newConversation.dispatcher.close = async () => {
                        await conn.close();
                    };
                    activeDispatcher = newConversation.dispatcher;
                    activeConversationId = newConversation.conversationId;
                    activeName = newConversation.name;
                    bindDispatcher(activeDispatcher);
                    setQueueDispatcher(activeDispatcher);
                    setCliConnectionId(newConversation.connectionId);
                    clearRecentSubmissions();
                    applyQueueSnapshot(newConversation.queueSnapshot);
                    await replayDisplayHistory(
                        activeDispatcher,
                        clientIO,
                        activeName,
                    );
                };
                convCtx = {
                    connection: conn,
                    clientIO,
                    getCurrentConversationId: () => activeConversationId,
                    getCurrentConversationName: () => activeName,
                    onSwitched: rebindAfterSwitch,
                    ...(isEphemeral
                        ? {}
                        : {
                              onPersistSwitched: (id: string) =>
                                  saveLastConversationId(id),
                          }),
                };
                setConversationCommandContext(convCtx);
                setServerPort(flags.port);
                setServerConnection(connection);
            }

            try {
                let processed = false;
                if (flags.request) {
                    await awaitCommand(activeDispatcher, flags.request);
                    processed = true;
                }
                if (args.input) {
                    await awaitCommand(activeDispatcher, `@run ${args.input}`);
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
                    async (
                        command: string,
                        _dispatcher: Dispatcher,
                        clientRequestId: string,
                    ) => {
                        return awaitCommand(
                            activeDispatcher,
                            command,
                            undefined,
                            undefined,
                            clientRequestId,
                        );
                    },
                    activeDispatcher,
                    undefined,
                    createCompletionController({
                        getCommandCompletion: (input, direction) =>
                            activeDispatcher.getCommandCompletion(
                                input,
                                direction,
                            ),
                    }),
                    activeDispatcher,
                    () => loadUserSettings().ui.autoComplete,
                );
            } finally {
                if (
                    ephemeralConversationId !== undefined &&
                    connection !== undefined
                ) {
                    await deleteEphemeralConversation(
                        connection,
                        ephemeralConversationId,
                    );
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
