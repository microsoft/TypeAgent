// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Args, Command, Flags } from "@oclif/core";
import { createDispatcher } from "agent-dispatcher";
import {
    getSchemaNamesFromDefaultAppAgentProviders,
    getDefaultAppAgentProviders,
} from "agent-dispatcher/internal";
import { getChatModelNames } from "aiclient";

const modelNames = await getChatModelNames();
export default class TranslateCommand extends Command {
    static args = {
        request: Args.string({
            description:
                "Request to translate and get and explanation of the translation",
            required: true,
        }),
    };

    static flags = {
        translator: Flags.string({
            description: "Translator name",
            options: getSchemaNamesFromDefaultAppAgentProviders(),
            multiple: true,
        }),
        model: Flags.string({
            description: "Translation model to use",
            options: modelNames,
        }),
    };

    static description = "Translate a request into action";
    static example = [
        `$ <%= config.bin %> <%= command.id %> 'play me some bach'`,
    ];

    async run(): Promise<void> {
        const { args, flags } = await this.parse(TranslateCommand);
        const schemas = flags.translator
            ? Object.fromEntries(flags.translator.map((name) => [name, true]))
            : undefined;

        const dispatcher = await createDispatcher("cli run translate", {
            appAgentProviders: getDefaultAppAgentProviders(),
            schemas,
            actions: null,
            commands: { dispatcher: true },
            translation: { model: flags.model },
            cache: { enabled: false },
        });
        await dispatcher.processCommand(
            `@dispatcher translate ${args.request}`,
        );
        await dispatcher.close();
    }
}
