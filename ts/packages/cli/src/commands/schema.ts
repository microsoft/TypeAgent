// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Args, Command, Flags } from "@oclif/core";
import { composeTranslatorSchemas } from "common-utils";
import {
    getAssistantSelectionSchemas,
    getFullSchemaText,
    getBuiltinTranslatorNames,
    getBuiltinTranslatorConfigProvider,
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
            options: getBuiltinTranslatorNames(),
        }),
    };

    async run(): Promise<void> {
        const { args, flags } = await this.parse(Schema);
        const provider = getBuiltinTranslatorConfigProvider();
        if (!flags.assistant) {
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
