// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Args, Command, Flags } from "@oclif/core";
import { ClientIO, createDispatcher } from "agent-dispatcher";
import {
    getDefaultAppAgentProviders,
    getIndexingServiceRegistry,
} from "default-agent-provider";
import { getChatModelNames } from "aiclient";
import {
    ChatHistoryInput,
    isChatHistoryInput,
    getAllActionConfigProvider,
} from "agent-dispatcher/internal";
import { withConsoleClientIO } from "agent-dispatcher/helpers/console";
import { getClientId, getInstanceDir } from "agent-dispatcher/helpers/data";
import fs from "node:fs";
import type {
    TranslateTestFile,
    TranslateTestStep,
} from "default-agent-provider/test";

const modelNames = await getChatModelNames();
const instanceDir = getInstanceDir();
const defaultAppAgentProviders = getDefaultAppAgentProviders(instanceDir);
const { schemaNames } = await getAllActionConfigProvider(
    defaultAppAgentProviders,
);

async function readHistoryFile(filePath: string): Promise<ChatHistoryInput> {
    if (!fs.existsSync(filePath)) {
        throw new Error(`History file not found: ${filePath}`);
    }

    const history = await fs.promises.readFile(filePath, "utf8");
    try {
        const data = JSON.parse(history);
        if (isChatHistoryInput(data)) {
            return data;
        }
        throw new Error(`Invalid history file format: ${filePath}.`);
    } catch (e) {
        throw new Error(
            `Failed to parse history file: ${filePath}. Error: ${e}`,
        );
    }
}

export default class ReplayCommand extends Command {
    static args = {
        history: Args.string({
            description: "History file to replay.",
            required: true,
        }),
    };

    static flags = {
        translate: Flags.boolean({
            description: "Translate only, do not execute actions",
            default: false,
        }),
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
        generateTest: Flags.string({
            description: "Record action to generate test file",
        }),
    };

    static description = "Translate a request into action";
    static example = [
        `$ <%= config.bin %> <%= command.id %> 'play me some bach'`,
    ];

    async run(): Promise<void> {
        const { args, flags } = await this.parse(ReplayCommand);

        const history = await readHistoryFile(args.history);
        await withConsoleClientIO(async (clientIO: ClientIO) => {
            const dispatcher = await createDispatcher("cli run translate", {
                appAgentProviders: defaultAppAgentProviders,
                agents: {
                    schemas: flags.schema,
                    actions: !flags.translate,
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
                execution: { history: !flags.translate }, // don't generate chat history, the test manually imports them
                explainer: { enabled: false },
                cache: { enabled: false },
                clientIO,
                persistDir: instanceDir,
                dblogging: true,
                clientId: getClientId(),
                indexingServiceRegistry:
                    await getIndexingServiceRegistry(instanceDir),
                collectCommandResult: flags.generateTest !== undefined,
            });

            const entries = Array.isArray(history) ? history : [history];
            const steps: TranslateTestStep[] = [];
            try {
                for (const entry of entries) {
                    const result = await dispatcher.processCommand(entry.user);
                    steps.push({
                        request: entry.user,
                        expected: result?.actions,
                        history: entry.assistant,
                    });

                    if (flags.translate) {
                        await dispatcher.processCommand(
                            `@history insert ${JSON.stringify(entry)}`,
                        );
                    }
                }
                if (flags.generateTest !== undefined) {
                    const fileName = flags.generateTest;
                    const data: TranslateTestFile = [steps];

                    await fs.promises.writeFile(
                        fileName,
                        JSON.stringify(data, undefined, 2),
                    );
                    console.log(
                        `Generated test file '${fileName}' with a test with ${steps.length} steps`,
                    );
                }
            } finally {
                await dispatcher.close();
            }
        });
    }
}
