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

const modelNames = await getChatModelNames();
const instanceDir = getInstanceDir();
const defaultAppAgentProviders = getDefaultAppAgentProviders(instanceDir);
const { schemaNames } = await getAllActionConfigProvider(
    defaultAppAgentProviders,
);
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
                );
            } finally {
                await dispatcher.close();
            }
        }, rl);

        // Some background network (like mongo) might keep the process live, exit explicitly.
        process.exit(0);
    }
}
