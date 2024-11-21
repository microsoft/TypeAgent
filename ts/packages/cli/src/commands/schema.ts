// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Args, Command, Flags } from "@oclif/core";
import { composeTranslatorSchemas } from "common-utils";
import {
    getAssistantSelectionSchemas,
    getFullSchemaText,
    getBuiltinTranslatorNames,
    getBuiltinTranslatorConfigProvider,
    getActionSchema,
} from "agent-dispatcher/internal";
import { generateSchema } from "action-schema";

export default class Schema extends Command {
    static description = "Show schema used by translators";

    static flags = {
        change: Flags.boolean({
            description: "Include change assistant schema",
            default: false,
        }),
        multiple: Flags.boolean({
            description: "Include multiple action schema",
            default: false,
        }),
        assistant: Flags.boolean({
            description: "Show all assistant selection schema",
            default: false,
        }),
    };
    static args = {
        translator: Args.string({
            description: "Translator name",
            required: true,
            options: getBuiltinTranslatorNames(),
        }),
        actionName: Args.string({
            description: "Action name",
            required: false,
        }),
    };

    async run(): Promise<void> {
        const { args, flags } = await this.parse(Schema);
        const provider = getBuiltinTranslatorConfigProvider();
        if (!flags.assistant) {
            if (args.actionName) {
                const actionSchema = getActionSchema(
                    {
                        translatorName: args.translator,
                        actionName: args.actionName,
                    },
                    provider,
                );
                if (actionSchema) {
                    console.log(generateSchema([actionSchema]));
                } else {
                    console.error(
                        `Action ${args.actionName} not found in translator ${args.translator}`,
                    );
                }

                return;
            }
            console.log(
                getFullSchemaText(
                    args.translator,
                    provider,
                    flags.change,
                    flags.multiple,
                ),
            );
        } else {
            const schemas = getAssistantSelectionSchemas(
                getBuiltinTranslatorNames(),
                provider,
            ).map((entry) => entry.schema);
            console.log(
                composeTranslatorSchemas("AllAssistantSelection", schemas),
            );
        }
    }
}
