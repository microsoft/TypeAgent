// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Args, Command, Flags } from "@oclif/core";
import { ClientIO, createDispatcher } from "agent-dispatcher";
import { getDefaultAppAgentProviders } from "default-agent-provider";
import { getChatModelNames } from "aiclient";
import { getAllActionConfigProvider } from "agent-dispatcher/internal";
import { withConsoleClientIO } from "agent-dispatcher/helpers/console";
import { getClientId, getInstanceDir } from "agent-dispatcher/helpers/data";

const modelNames = await getChatModelNames();
const instanceDir = getInstanceDir();
const defaultAppAgentProviders = getDefaultAppAgentProviders(instanceDir);
const { schemaNames } = await getAllActionConfigProvider(
    defaultAppAgentProviders,
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
        schema: Flags.string({
            description: "Translator name",
            options: schemaNames,
            multiple: true,
        }),
        multiple: Flags.boolean({
            description: "Include multiple action schema",
            default: true, // follow DispatcherOptions default
            allowNo: true,
        }),
        model: Flags.string({
            description: "Translation model to use",
            options: modelNames,
        }),
        jsonSchema: Flags.boolean({
            description: "Output JSON schema",
            default: false, // follow DispatcherOptions default
        }),
        jsonSchemaFunction: Flags.boolean({
            description: "Output JSON schema function",
            default: false, // follow DispatcherOptions default
            exclusive: ["jsonSchema"],
        }),
        jsonSchemaValidate: Flags.boolean({
            description: "Validate the output when JSON schema is enabled",
            default: true, // follow DispatcherOptions default
            allowNo: true,
        }),
        schemaOptimization: Flags.boolean({
            description: "Enable schema optimization",
        }),
        switchEmbedding: Flags.boolean({
            description: "Use embedding to determine the first schema to use",
            default: true, // follow DispatcherOptions default
            allowNo: true,
        }),
        switchInline: Flags.boolean({
            description: "Use inline switch schema to select schema group",
            default: true, // follow DispatcherOptions default
            allowNo: true,
        }),
        switchSearch: Flags.boolean({
            description:
                "Enable second chance full switch schema to find schema group",
            default: true, // follow DispatcherOptions default
            allowNo: true,
        }),
    };

    static description = "Translate a request into action";
    static example = [
        `$ <%= config.bin %> <%= command.id %> 'play me some bach'`,
    ];

    async run(): Promise<void> {
        const { args, flags } = await this.parse(TranslateCommand);
        await withConsoleClientIO(async (clientIO: ClientIO) => {
            const dispatcher = await createDispatcher("cli run translate", {
                appAgentProviders: defaultAppAgentProviders,
                agents: {
                    schemas: flags.schema,
                    actions: false,
                    commands: ["dispatcher"],
                },
                translation: {
                    model: flags.model,
                    multiple: { enabled: flags.multiple },
                    schema: {
                        generation: {
                            jsonSchema: flags.jsonSchema,
                            jsonSchemaFunction: flags.jsonSchemaFunction,
                            jsonSchemaValidate: flags.jsonSchemaValidate,
                        },
                        optimize: {
                            enabled: flags.schemaOptimization,
                        },
                    },
                    switch: {
                        embedding: flags.switchEmbedding,
                        inline: flags.switchInline,
                        search: flags.switchSearch,
                    },
                },
                cache: { enabled: false },
                clientIO,
                persistDir: instanceDir,
                dblogging: true,
                clientId: getClientId(),
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
