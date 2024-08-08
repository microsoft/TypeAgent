// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Args, Command, Flags } from "@oclif/core";
import { RequestCommandHandler } from "agent-dispatcher";
import { initializeCommandHandlerContext } from "agent-dispatcher";
import { getCacheFactory } from "agent-dispatcher";
import { getTranslatorNames } from "agent-dispatcher";

export default class RequestCommand extends Command {
    static args = {
        request: Args.string({
            description:
                "Request to translate and get an explanation of the translation",
            required: true,
        }),
    };

    static flags = {
        translator: Flags.string({
            description: "Translator name",
            options: getTranslatorNames(),
            multiple: true,
        }),
        explainer: Flags.string({
            description:
                "Explainer name (defaults to the explainer associated with the translator)",
            options: getCacheFactory().getExplainerNames(),
        }),
    };

    static description = "Translate a request into action and explain it";
    static example = [
        `$ <%= config.bin %> <%= command.id %> 'play me some bach'`,
    ];

    async run(): Promise<void> {
        const { args, flags } = await this.parse(RequestCommand);
        const translators = flags.translator
            ? Object.fromEntries(flags.translator.map((name) => [name, true]))
            : undefined;
        const handler = new RequestCommandHandler();
        await handler.run(
            args.request,
            await initializeCommandHandlerContext("cli run request", {
                translators,
                explainerName: flags.explainer,
                cache: false,
            }),
        );
    }
}
