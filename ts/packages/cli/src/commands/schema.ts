// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Args, Command, Flags } from "@oclif/core";
import { composeTranslatorSchemas } from "common-utils";
import {
    getAssistantSelectionSchemas,
    getFullSchemaText,
    getBuiltinSchemaNames,
    getBuiltinActionConfigProvider,
    getActionSchema,
} from "agent-dispatcher/internal";
import { generateSchemaTypeDefinition } from "action-schema";

export default class Schema extends Command {
    static description = "Show schema used by translators";

    static flags = {
        active: Flags.string({
            description:
                "Active scheam to include in the inlined change assistant schema",
            multiple: true,
        }),
        multiple: Flags.boolean({
            description: "Include multiple action schema",
            default: false,
        }),
        assistant: Flags.boolean({
            description: "Show all assistant selection schema",
            default: false,
        }),
        generated: Flags.boolean({
            description: "Generated schema",
            allowNo: true,
            default: true,
        }),
    };
    static args = {
        translator: Args.string({
            description: "Translator name",
            required: true,
            options: getBuiltinSchemaNames(),
        }),
        actionName: Args.string({
            description: "Action name",
            required: false,
        }),
    };

    async run(): Promise<void> {
        const { args, flags } = await this.parse(Schema);
        const provider = getBuiltinActionConfigProvider();
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
                    console.log(generateSchemaTypeDefinition(actionSchema));
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
                    flags.active,
                    flags.multiple,
                    flags.generated,
                ),
            );
        } else {
            const schemas = getAssistantSelectionSchemas(
                getBuiltinSchemaNames(),
                provider,
            ).map((entry) => entry.schema);
            console.log(
                composeTranslatorSchemas("AllAssistantSelection", schemas),
            );
        }
    }
}
