// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Args, Command, Flags } from "@oclif/core";
import { Dispatcher } from "agent-dispatcher";
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
import { isSlashCommand, getSlashCompletions } from "../slashCommands.js";
import { ensureAndConnectDispatcher } from "@typeagent/agent-server-client";
import { getStatusSummary } from "agent-dispatcher/helpers/status";
import { createInterface } from "readline/promises";

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
    static description = "Interactive mode";
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
        classicUI: Flags.boolean({
            description:
                "Use classic terminal UI instead of enhanced UI with spinners and visual prompts",
            default: false,
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

        const enhancedUI = !flags.classicUI;

        if (enhancedUI) {
            const { installDebugInterceptor } = await import(
                "../debugInterceptor.js"
            );
            installDebugInterceptor();
        }

        const withClientIO = enhancedUI
            ? withEnhancedConsoleClientIO
            : withConsoleClientIO;
        const processCommandsFn = enhancedUI
            ? processCommandsEnhanced
            : processCommands;
        const getPromptFn = enhancedUI
            ? getEnhancedConsolePrompt
            : getConsolePrompt;

        const rl = enhancedUI
            ? undefined
            : createInterface({
                  input: process.stdin,
                  output: process.stdout,
                  terminal: true,
              });

        await withClientIO(async (clientIO, bindDispatcher) => {
            const dispatcher = await ensureAndConnectDispatcher(
                clientIO,
                flags.port,
                undefined,
                () => {
                    console.error("Disconnected from dispatcher");
                    process.exit(1);
                },
            );
            bindDispatcher?.(dispatcher);
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
                    undefined,
                    enhancedUI
                        ? (line: string) => getCompletionsData(line, dispatcher)
                        : undefined,
                    enhancedUI ? dispatcher : undefined,
                );
            } finally {
                if (dispatcher) {
                    await dispatcher.close();
                }
            }
        }, rl);

        // Some background network (like mongo) might keep the process live, exit explicitly.
        process.exit(0);
    }
}
