// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Args, Command, Flags } from "@oclif/core";
import { composeTranslatorSchemas } from "common-utils";
import {
    getAssistantSelectionSchemas,
    getFullSchemaText,
    getSchemaNamesFromDefaultAppAgentProviders,
    getActionConfigProviderFromDefaultAppAgentProviders,
    getActionSchema,
} from "agent-dispatcher/internal";
import { generateSchemaTypeDefinition } from "action-schema";

export default class Schema extends Command {
    static description = "Show schema used by translators";

    static flags = {
        active: Flags.string({
            description:
                "Active schemas to include for consideration (inject and inline switch)",
            multiple: true,
        }),
        change: Flags.boolean({
            description: "Include inline change assistant schema",
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
            options: getSchemaNamesFromDefaultAppAgentProviders(),
        }),
        actionName: Args.string({
            description: "Action name",
            required: false,
        }),
    };

    async run(): Promise<void> {
        const { args, flags } = await this.parse(Schema);
        const provider = getActionConfigProviderFromDefaultAppAgentProviders();
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
                    flags.change,
                    flags.multiple,
                    flags.generated,
                ),
            );
        } else {
            const schemas = getAssistantSelectionSchemas(
                getSchemaNamesFromDefaultAppAgentProviders(),
                provider,
            ).map((entry) => entry.schema);
            console.log(
                composeTranslatorSchemas("AllAssistantSelection", schemas),
            );
        }
    }
}
