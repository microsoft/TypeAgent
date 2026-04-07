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
import { ensureAndConnectSession } from "@typeagent/agent-server-client";
import { getStatusSummary } from "agent-dispatcher/helpers/status";

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

        const separator =
            result.separatorMode === "space" ||
            result.separatorMode === "spacePunctuation"
                ? " "
                : "";

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
        "Connect to the agent server in interactive mode. Resumes the most recently active session, or specify --session <id> to join a specific one.";
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
            description: "Port for type agent server",
            default: 8999,
        }),
        session: Flags.string({
            description:
                "Session ID to join. Omit to resume the most recently active session.",
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

        await withEnhancedConsoleClientIO(async (clientIO, bindDispatcher) => {
            const { dispatcher, name } = await ensureAndConnectSession(
                clientIO,
                flags.port,
                flags.session ? { sessionId: flags.session } : undefined,
                () => {
                    console.error("Disconnected from dispatcher");
                    process.exit(1);
                },
            );
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
