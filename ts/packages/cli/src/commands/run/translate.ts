// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Args, Command, Flags } from "@oclif/core";
import { TranslateCommandHandler } from "agent-dispatcher";
import { initializeCommandHandlerContext } from "agent-dispatcher";
import { getBuiltinTranslatorNames } from "agent-dispatcher";

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
            options: getBuiltinTranslatorNames(),
            multiple: true,
        }),
    };

    static description = "Translate a request into action";
    static example = [
        `$ <%= config.bin %> <%= command.id %> 'play me some bach'`,
    ];

    async run(): Promise<void> {
        const { args, flags } = await this.parse(TranslateCommand);
        const handler = new TranslateCommandHandler();
        const translators = flags.translator
            ? Object.fromEntries(flags.translator.map((name) => [name, true]))
            : undefined;
        await handler.run(
            args.request,
            await initializeCommandHandlerContext("cli run translate", {
                translators,
                actions: {}, // We don't need any actions
                cache: false,
            }),
        );
    }
}
