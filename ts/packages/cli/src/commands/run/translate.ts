// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Args, Command, Flags } from "@oclif/core";
import { ClientIO, createDispatcher } from "agent-dispatcher";
import { getDefaultAppAgentProviders } from "default-agent-provider";
import { getChatModelNames } from "aiclient";
import {
    createActionConfigProvider,
    getInstanceDir,
    getSchemaNamesForActionConfigProvider,
} from "agent-dispatcher/internal";
import { withConsoleClientIO } from "agent-dispatcher/helpers/console";

const modelNames = await getChatModelNames();
const defaultAppAgentProviders = getDefaultAppAgentProviders(getInstanceDir());
const schemaNames = getSchemaNamesForActionConfigProvider(
    await createActionConfigProvider(defaultAppAgentProviders),
);

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
            options: schemaNames,
            multiple: true,
        }),
        multiple: Flags.boolean({
            description: "Include multiple action schema",
            allowNo: true,
        }),
        model: Flags.string({
            description: "Translation model to use",
            options: modelNames,
        }),
        jsonSchema: Flags.boolean({
            description: "Output JSON schema",
            allowNo: true,
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

        await withConsoleClientIO(async (clientIO: ClientIO) => {
            const dispatcher = await createDispatcher("cli run translate", {
                appAgentProviders: defaultAppAgentProviders,
                schemas,
                actions: null,
                commands: { dispatcher: true },
                translation: {
                    model: flags.model,
                    multiple: { enabled: flags.multiple },
                    schema: { generation: { jsonSchema: flags.jsonSchema } },
                },
                cache: { enabled: false },
                clientIO,
                persist: true,
                dblogging: true,
            });
            try {
                await dispatcher.processCommand(
                    `@dispatcher translate ${args.request}`,
                );
            } finally {
                await dispatcher.close();
            }
        });
    }
}
