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
    ensureAndConnectSession,
    AgentServerConnection,
} from "@typeagent/agent-server-client";
import { getStatusSummary } from "@typeagent/dispatcher-types/helpers/status";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as readline from "readline";

const CLI_STATE_FILE = path.join(os.homedir(), ".typeagent", "cli-state.json");
const CLI_SESSION_NAME = "CLI";

function loadLastSessionId(): string | undefined {
    try {
        const raw = fs.readFileSync(CLI_STATE_FILE, "utf8");
        return JSON.parse(raw).lastSessionId ?? undefined;
    } catch {
        return undefined;
    }
}

function saveLastSessionId(sessionId: string): void {
    try {
        fs.mkdirSync(path.dirname(CLI_STATE_FILE), { recursive: true });
        fs.writeFileSync(
            CLI_STATE_FILE,
            JSON.stringify({ lastSessionId: sessionId }),
        );
    } catch {
        // Non-fatal: persistence failure should not block the session.
    }
}

function clearLastSessionId(): void {
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
        "Connect to the agent server in interactive mode. Defaults to the 'CLI' session, or specify --session <id> to join a specific one.";
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
                "Resume the last used session instead of defaulting to 'CLI'. Ignored if --session is provided.",
            default: false,
        }),
        session: Flags.string({
            char: "s",
            description: "Session ID to join. Takes priority over --resume.",
            required: false,
        }),
        verbose: Flags.string({
            description:
                "Enable verbose debug output (optional: comma-separated debug namespaces, default: typeagent:*)",
            required: false,
        }),
        memory: Flags.boolean({
            description:
                "Use an ephemeral session that is automatically deleted on exit",
            default: false,
            exclusive: ["session", "resume"],
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

        const persistedSessionId =
            flags.session ?? (flags.resume ? loadLastSessionId() : undefined);
        // Only intercept "Session not found" when using the client-side default
        // (no explicit --session flag). Explicit --session errors propagate as-is.
        const isDefaultSession = flags.session === undefined;
        const isEphemeral = flags.memory;

        await withEnhancedConsoleClientIO(async (clientIO, bindDispatcher) => {
            const url = `ws://localhost:${flags.port}`;

            const onDisconnect = () => {
                console.error("Disconnected from dispatcher");
                process.exit(1);
            };

            // Helper: find the "CLI" session by name (creating it if absent) and join it.
            const connectToCliSession = async () => {
                await ensureAgentServer(
                    flags.port,
                    flags.hidden,
                    flags.idleTimeout,
                );
                const connection = await connectAgentServer(url, onDisconnect);
                const existing =
                    await connection.listSessions(CLI_SESSION_NAME);
                const match = existing.find(
                    (s) =>
                        s.name.toLowerCase() === CLI_SESSION_NAME.toLowerCase(),
                );
                const cliSessionId =
                    match !== undefined
                        ? match.sessionId
                        : (await connection.createSession(CLI_SESSION_NAME))
                              .sessionId;
                const session = await connection.joinSession(clientIO, {
                    sessionId: cliSessionId,
                });
                session.dispatcher.close = async () => {
                    await connection.close();
                };
                return { session, connection };
            };

            // Helper: create an ephemeral session for --memory flag.
            const connectToEphemeralSession = async () => {
                await ensureAgentServer(
                    flags.port,
                    flags.hidden,
                    flags.idleTimeout,
                );
                const connection = await connectAgentServer(url, onDisconnect);
                const ephemeralName = `cli-ephemeral-${crypto.randomUUID()}`;
                const created = await connection.createSession(ephemeralName);
                const session = await connection.joinSession(clientIO, {
                    sessionId: created.sessionId,
                });
                session.dispatcher.close = async () => {
                    await connection.close();
                };
                return {
                    session,
                    connection,
                    ephemeralSessionId: created.sessionId,
                };
            };

            let session: Awaited<
                ReturnType<typeof connectToCliSession>
            >["session"];
            let connection: AgentServerConnection | undefined;
            let ephemeralSessionId: string | undefined;

            if (isEphemeral) {
                // --memory: use an ephemeral session, delete on exit
                const result = await connectToEphemeralSession();
                session = result.session;
                connection = result.connection;
                ephemeralSessionId = result.ephemeralSessionId;
            } else {
                // Resolve the session to join:
                //   1. explicit --session flag
                //   2. persisted last-used session ID (with "not found" recovery)
                //   3. default: find-or-create the "CLI" session
                const result =
                    persistedSessionId !== undefined
                        ? await ensureAndConnectSession(
                              clientIO,
                              flags.port,
                              { sessionId: persistedSessionId },
                              onDisconnect,
                              flags.hidden,
                              flags.idleTimeout,
                          )
                              .then((s) => ({
                                  session: s,
                                  connection: undefined as
                                      | AgentServerConnection
                                      | undefined,
                              }))
                              .catch(async (err: any) => {
                                  if (
                                      isDefaultSession &&
                                      typeof err?.message === "string" &&
                                      err.message.startsWith(
                                          "Session not found:",
                                      )
                                  ) {
                                      console.log(
                                          `The last used session no longer exists on the server.`,
                                      );
                                      const join = await promptYesNo(
                                          `Join the default '${CLI_SESSION_NAME}' session?`,
                                      );
                                      if (!join) {
                                          clearLastSessionId();
                                          return null;
                                      }
                                      clearLastSessionId();
                                      return connectToCliSession();
                                  }
                                  throw err;
                              })
                        : await connectToCliSession();

                if (result === null) {
                    return;
                }
                session = result.session;
                connection = result.connection;
            }

            const {
                dispatcher: initialDispatcher,
                name: initialName,
                sessionId: initialSessionId,
            } = session;

            // Mutable session state — updated by switchSession callback
            let activeDispatcher = initialDispatcher;
            let activeSessionId = initialSessionId;
            let activeName = initialName;

            if (!isEphemeral) {
                saveLastSessionId(activeSessionId);
            }
            bindDispatcher(activeDispatcher);
            await replayDisplayHistory(activeDispatcher, clientIO, activeName);

            // Set up ConversationCommandContext for @conversation commands.
            // Only available when the AgentServerConnection is accessible
            // (connectToCliSession / connectToEphemeralSession paths).
            // The ensureAndConnectSession path (--session / --resume flags)
            // does not expose the connection, so convCtx stays undefined there.
            let convCtx: ConversationCommandContext | undefined;
            if (connection !== undefined) {
                convCtx = {
                    connection,
                    getCurrentSessionId: () => activeSessionId,
                    getCurrentSessionName: () => activeName,
                    switchSession: async (newSessionId: string) => {
                        // Join the new session first so that if it fails we
                        // haven't already left the old one (avoids stranded state).
                        const newSession = await connection.joinSession(
                            clientIO,
                            { sessionId: newSessionId },
                        );
                        newSession.dispatcher.close = async () => {
                            await connection.close();
                        };
                        await connection.leaveSession(activeSessionId);
                        activeDispatcher = newSession.dispatcher;
                        activeSessionId = newSession.sessionId;
                        activeName = newSession.name;
                        bindDispatcher(activeDispatcher);
                        if (!isEphemeral) {
                            saveLastSessionId(activeSessionId);
                        }
                        await replayDisplayHistory(
                            activeDispatcher,
                            clientIO,
                            activeName,
                        );
                        return newSession;
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
                    ephemeralSessionId !== undefined &&
                    connection !== undefined
                ) {
                    try {
                        await connection.deleteSession(ephemeralSessionId);
                    } catch {
                        // Best effort cleanup of ephemeral session
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
