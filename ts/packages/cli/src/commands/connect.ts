// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Args, Command, Flags } from "@oclif/core";
import { Dispatcher } from "agent-dispatcher";
import {
    getEnhancedConsolePrompt,
    processCommandsEnhanced,
    replayDisplayHistory,
    withEnhancedConsoleClientIO,
} from "../enhancedConsole.js";
import { isSlashCommand, getSlashCompletions } from "../slashCommands.js";
import {
    connectAgentServer,
    ensureAgentServer,
    ensureAndConnectSession,
} from "@typeagent/agent-server-client";
import { getStatusSummary } from "agent-dispatcher/helpers/status";
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

type CompletionData = {
    allCompletions: string[];
    filterStartIndex: number;
    prefix: string;
};

async function getCompletionsData(
    line: string,
    dispatcher: Dispatcher,
): Promise<CompletionData | null> {
    try {
        if (isSlashCommand(line)) {
            const completions = getSlashCompletions(line);
            if (completions.length === 0) return null;
            return {
                allCompletions: completions,
                filterStartIndex: 0,
                prefix: "",
            };
        }
        const direction = "forward" as const;
        const result = await dispatcher.getCommandCompletion(line, direction);
        if (result.completions.length === 0) {
            return null;
        }

        const allCompletions: string[] = [];
        for (const group of result.completions) {
            for (const completion of group.completions) {
                allCompletions.push(completion);
            }
        }

        const filterStartIndex = result.startIndex;
        const prefix = line.substring(0, filterStartIndex);

        const needsSep = result.completions.some(
            (g) =>
                g.separatorMode === "space" ||
                g.separatorMode === "spacePunctuation",
        );
        const separator = needsSep ? " " : "";

        return {
            allCompletions,
            filterStartIndex,
            prefix: prefix + separator,
        };
    } catch (e) {
        return null;
    }
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

        const persistedSessionId =
            flags.session ?? (flags.resume ? loadLastSessionId() : undefined);
        // Only intercept "Session not found" when using the client-side default
        // (no explicit --session flag). Explicit --session errors propagate as-is.
        const isDefaultSession = flags.session === undefined;

        await withEnhancedConsoleClientIO(async (clientIO, bindDispatcher) => {
            const url = `ws://localhost:${flags.port}`;

            const onDisconnect = () => {
                console.error("Disconnected from dispatcher");
                process.exit(1);
            };

            // Helper: find the "CLI" session by name (creating it if absent) and join it.
            const connectToCliSession = async () => {
                await ensureAgentServer(flags.port);
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
                return session;
            };

            // Resolve the session to join:
            //   1. explicit --session flag
            //   2. persisted last-used session ID (with "not found" recovery)
            //   3. default: find-or-create the "CLI" session
            let session =
                persistedSessionId !== undefined
                    ? await ensureAndConnectSession(
                          clientIO,
                          flags.port,
                          { sessionId: persistedSessionId },
                          onDisconnect,
                      ).catch(async (err: any) => {
                          if (
                              isDefaultSession &&
                              typeof err?.message === "string" &&
                              err.message.startsWith("Session not found:")
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

            if (session === null) {
                return;
            }

            const { dispatcher, name, sessionId: connectedSessionId } = session;
            saveLastSessionId(connectedSessionId);
            console.log(`Connected to session '${name}'.`);
            bindDispatcher(dispatcher);
            await replayDisplayHistory(dispatcher, clientIO);
            try {
                let processed = false;
                if (flags.request) {
                    await dispatcher.processCommand(flags.request);
                    processed = true;
                }
                if (args.input) {
                    await dispatcher.processCommand(`@run ${args.input}`);
                    processed = true;
                }
                if (processed && flags.exit) {
                    return;
                }
                await processCommandsEnhanced(
                    async (dispatcher: Dispatcher) =>
                        getEnhancedConsolePrompt(
                            getStatusSummary(await dispatcher.getStatus(), {
                                showPrimaryName: false,
                            }),
                        ),
                    (command: string, dispatcher: Dispatcher) =>
                        dispatcher.processCommand(command),
                    dispatcher,
                    undefined,
                    (line: string) => getCompletionsData(line, dispatcher),
                    dispatcher,
                );
            } finally {
                if (dispatcher) {
                    await dispatcher.close();
                }
            }
        });

        // Some background network (like mongo) might keep the process live, exit explicitly.
        process.exit(0);
    }
}
