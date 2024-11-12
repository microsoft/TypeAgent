// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Args, Command, Flags } from "@oclif/core";
import { createDispatcher } from "agent-dispatcher";
import {
    getCacheFactory,
    getBuiltinTranslatorNames,
} from "agent-dispatcher/internal";
import chalk from "chalk";
import { readFileSync, existsSync } from "fs";

export default class RequestCommand extends Command {
    static args = {
        request: Args.string({
            description:
                "Request to translate and get an explanation of the translation",
            required: true,
        }),
        attachment: Args.string({
            description: "A path to a file to attach with the request",
            required: false,
        }),
    };

    static flags = {
        translator: Flags.string({
            description: "Translator name",
            options: getBuiltinTranslatorNames(),
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
        const dispatcher = await createDispatcher("cli run request", {
            translators,
            explainer: { name: flags.explainer },
            cache: { enabled: false },
        });
        await dispatcher.processCommand(
            `@dispatcher request ${args.request}`,
            undefined,
            this.loadAttachment(args.attachment),
        );
    }

    loadAttachment(fileName: string | undefined): string[] | undefined {
        if (fileName === undefined) {
            return undefined;
        }

        if (!existsSync(fileName)) {
            console.error(
                chalk.red(`ERROR: The file '${fileName}' does not exist.`),
            );

            throw Error(`ERROR: The file '${fileName}' does not exist.`);
        }

        let retVal: string[] = new Array<string>();
        retVal.push(Buffer.from(readFileSync(fileName)).toString("base64"));

        return retVal;
    }
}
