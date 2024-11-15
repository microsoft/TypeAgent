// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    InlineTranslatorSchemaDef,
    createJsonTranslatorFromSchemaDef,
} from "common-utils";
import { getTranslatorActionSchemas } from "./actionSchema.js";
import { Result, success } from "typechat";
import registerDebug from "debug";
import { TranslatorConfigProvider } from "./agentTranslators.js";

const debugSwitchSearch = registerDebug("typeagent:switch:search");

function createSelectionSchema(
    translatorName: string,
    provider: TranslatorConfigProvider,
): InlineTranslatorSchemaDef | undefined {
    const translatorConfig = provider.getTranslatorConfig(translatorName);
    // Skip injected schemas except for chat; investigate whether we can get chat always on first pass
    if (translatorConfig.injected && translatorName !== "chat") {
        // No need to select for injected schemas
        selectSchemaCache.set(translatorName, undefined);
        return undefined;
    }
    const actionSchemas = getTranslatorActionSchemas(
        translatorConfig,
        translatorName,
    );

    const actionNames: string[] = [];
    const actionComments: string[] = [];
    for (const info of actionSchemas.values()) {
        actionNames.push(`"${info.actionName}"`);
        actionComments.push(
            `"${info.actionName}"${info.definition.comments ? ` - ${info.definition.comments[0]}` : ""}`,
        );
    }

    if (actionNames.length === 0) {
        selectSchemaCache.set(translatorName, undefined);
        return undefined;
    }
    const typeName = `${translatorConfig.schemaType}Assistant`;
    const schema = `
export type ${typeName} = {
    // ${translatorConfig.description}
    assistant: "${translatorName}";
    // ${actionComments.join("\n    // ")}
    action: ${actionNames.join(" | ")};
};`;

    return { kind: "inline", typeName, schema };
}

const selectSchemaCache = new Map<
    string,
    InlineTranslatorSchemaDef | undefined
>();
function getSelectionSchema(
    translatorName: string,
    provider: TranslatorConfigProvider,
): InlineTranslatorSchemaDef | undefined {
    if (selectSchemaCache.has(translatorName)) {
        return selectSchemaCache.get(translatorName);
    }

    const result = createSelectionSchema(translatorName, provider);
    selectSchemaCache.set(translatorName, result);
    return result;
}

const unknownAssistantSelectionSchemaDef: InlineTranslatorSchemaDef = {
    kind: "inline",
    typeName: "UnknownAssistantSelection",
    schema: `
export type UnknownAssistantSelection = {
    assistant: "unknown";
    action: "unknown";
};`,
};

type AssistantSelectionSchemaEntry = {
    name: string;
    schema: InlineTranslatorSchemaDef;
};
export function getAssistantSelectionSchemas(
    translatorNames: string[],
    provider: TranslatorConfigProvider,
) {
    return translatorNames
        .map((name) => {
            return { name, schema: getSelectionSchema(name, provider) };
        })
        .filter(
            (entry) => entry.schema !== undefined,
        ) as AssistantSelectionSchemaEntry[];
}

export type AssistantSelection = {
    assistant: string;
    action: string;
};

// GPT-4 has 8192 token window, with an estimated 4 chars per token, so use only 3 times to leave room for output.
const assistantSelectionLimit = 8192 * 3;

export function loadAssistantSelectionJsonTranslator(
    translatorNames: string[],
    provider: TranslatorConfigProvider,
) {
    const schemas = getAssistantSelectionSchemas(translatorNames, provider);

    let currentLength = 0;
    let current: AssistantSelectionSchemaEntry[] = [];
    const limit = assistantSelectionLimit; // TODO: this should be adjusted based on model used.
    const partitions = [current];
    for (const entry of schemas) {
        const schema = entry.schema.schema;
        if (currentLength + schema.length > limit) {
            if (current.length === 0) {
                throw new Error(
                    `The assistant section schema for '${entry.name}' is too large to fit in the limit ${limit}`,
                );
            }
            current = [];
            currentLength = 0;
            partitions.push(current);
        }
        current.push(entry);
        currentLength += schema.length;
    }
    const translators = partitions.map((entries) => {
        return {
            names: entries.map((entry) => entry.name),
            translator: createJsonTranslatorFromSchemaDef<AssistantSelection>(
                "AllAssistantSelection",
                entries
                    .map((entry) => entry.schema)
                    .concat(unknownAssistantSelectionSchemaDef),
                undefined,
                [
                    {
                        role: "system",
                        content: "Select the assistant to handle the request",
                    },
                ],
            ),
        };
    });

    return {
        translate: async (
            request: string,
        ): Promise<Result<AssistantSelection>> => {
            for (const { names, translator } of translators) {
                // TODO: we can parallelize this
                debugSwitchSearch(`Switch: searching ${names.join(", ")}`);
                const result = await translator.translate(request);
                if (!result.success) {
                    return result;
                }
                if (result.data.assistant !== "unknown") {
                    return result;
                }
            }
            return success({
                assistant: "unknown",
                action: "unknown",
            });
        },
    };
}
