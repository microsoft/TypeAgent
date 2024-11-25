// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Args, Command, Flags } from "@oclif/core";
import readline from "readline/promises";
import {
    getBuiltinSchemaNames,
    getCacheFactory,
    processCommand,
    processRequests,
    getPrompt,
    initializeCommandHandlerContext,
    CommandHandlerContext,
    closeCommandHandlerContext,
} from "agent-dispatcher/internal";
import inspector from "node:inspector";
import { getChatModelNames } from "aiclient";

const modelNames = await getChatModelNames();

export default class Interactive extends Command {
    static description = "Interactive mode";
    static flags = {
        translator: Flags.string({
            description: "Schema names",
            options: getBuiltinSchemaNames(),
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
        const stdio = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });

        let context: CommandHandlerContext | undefined;

        const schemas = flags.translator
            ? Object.fromEntries(flags.translator.map((name) => [name, true]))
            : undefined;
        try {
            context = await initializeCommandHandlerContext("cli interactive", {
                schemas,
                translation: { model: flags.model },
                explainer: { name: flags.explainer },
                stdio,
                persistSession: !flags.memory,
                enableServiceHost: true,
            });

            if (args.input) {
                await processCommand(`@run ${args.input}`, context);
                if (flags.exit) {
                    return;
                }
            }

            await processRequests<CommandHandlerContext>(
                getPrompt,
                stdio,
                processCommand,
                context,
            );
        } finally {
            if (context) {
                await closeCommandHandlerContext(context);
            }
            stdio?.close();
        }

        // Some background network (like monogo) might keep the process live, exit explicitly.
        process.exit(0);
    }
}
