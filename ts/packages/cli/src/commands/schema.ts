// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Args, Command, Flags } from "@oclif/core";
import { composeTranslatorSchemas } from "common-utils";
import {
    getAssistantSelectionSchemas,
    getFullSchemaText,
    getTranslatorNames,
} from "agent-dispatcher";

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
            options: getTranslatorNames(),
        }),
    };

    async run(): Promise<void> {
        const { args, flags } = await this.parse(Schema);
        if (!flags.assistant) {
            console.log(
                getFullSchemaText(
                    args.translator,
                    flags.change,
                    flags.multiple,
                ),
            );
        } else {
            const schemas = getAssistantSelectionSchemas(
                getTranslatorNames(),
            ).map((entry) => entry.schema);
            console.log(
                composeTranslatorSchemas("AllAssistantSelection", schemas),
            );
        }
    }
}
