// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Args, Command, Flags } from "@oclif/core";
import {
    getSchemaNamesFromDefaultAppAgentProviders,
    getCacheFactory,
    getDefaultAppAgentProviders,
} from "agent-dispatcher/internal";
import inspector from "node:inspector";
import { getChatModelNames } from "aiclient";
import {
    processCommands,
    createConsoleClientIO,
} from "agent-dispatcher/helpers/console";
import { createDispatcher, Dispatcher } from "agent-dispatcher";

const modelNames = await getChatModelNames();

export default class Interactive extends Command {
    static description = "Interactive mode";
    static flags = {
        translator: Flags.string({
            description: "Schema names",
            options: getSchemaNamesFromDefaultAppAgentProviders(),
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

        const schemas = flags.translator
            ? Object.fromEntries(flags.translator.map((name) => [name, true]))
            : undefined;

        let closeDispatcher: Dispatcher | undefined;
        try {
            const dispatcher = await createDispatcher("cli interactive", {
                appAgentProviders: getDefaultAppAgentProviders(),
                schemas,
                translation: { model: flags.model },
                explainer: { name: flags.explainer },
                persistSession: !flags.memory,
                enableServiceHost: true,
                clientIO: createConsoleClientIO(),
            });
            closeDispatcher = dispatcher;

            if (args.input) {
                await dispatcher.processCommand(`@run ${args.input}`);
                if (flags.exit) {
                    return;
                }
            }

            await processCommands(
                () => dispatcher.getPrompt(),
                (command: string, dispatcher: Dispatcher) =>
                    dispatcher.processCommand(command),
                dispatcher,
            );
        } finally {
            if (closeDispatcher) {
                await closeDispatcher.close();
            }
        }

        // Some background network (like mongo) might keep the process live, exit explicitly.
        process.exit(0);
    }
}
