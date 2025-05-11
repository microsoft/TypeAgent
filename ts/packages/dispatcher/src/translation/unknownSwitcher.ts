// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    InlineTranslatorSchemaDef,
    createJsonTranslatorFromSchemaDef,
} from "common-utils";
import { Result, success } from "typechat";
import registerDebug from "debug";
import { ActionConfigProvider } from "./actionConfigProvider.js";
import {
    generateSchemaTypeDefinition,
    ActionSchemaCreator as sc,
} from "action-schema";
import { getCombinedSchemaTypeName } from "./agentTranslators.js";
const debugSwitchSearch = registerDebug("typeagent:switch:search");

function createSelectionActionTypeDefinition(
    schemaName: string,
    provider: ActionConfigProvider,
) {
    const actionConfig = provider.getActionConfig(schemaName);
    // Skip injected schemas except for chat; investigate whether we can get chat always on first pass
    if (actionConfig.injected && schemaName !== "chat") {
        // No need to select for injected schemas
        return undefined;
    }
    const actionSchemaFile =
        provider.getActionSchemaFileForConfig(actionConfig);

    const actionNames: string[] = [];
    const actionComments: string[] = [];
    for (const [
        name,
        info,
    ] of actionSchemaFile.parsedActionSchema.actionSchemas.entries()) {
        actionNames.push(name);
        actionComments.push(
            ` "${name}"${info.comments ? ` - ${info.comments[0].trim()}` : ""}`,
        );
    }

    if (actionNames.length === 0) {
        return undefined;
    }

    const typeName = `${getCombinedSchemaTypeName(actionConfig.schemaType)}Assistant`;

    const schema = sc.type(
        typeName,
        sc.obj({
            assistant: sc.field(
                sc.string(schemaName),
                ` ${actionConfig.description}`,
            ),
            action: sc.field(sc.string(actionNames), actionComments),
        }),
    );
    return schema;
}

function createSelectionSchema(
    schemaName: string,
    provider: ActionConfigProvider,
): InlineTranslatorSchemaDef | undefined {
    const schema = createSelectionActionTypeDefinition(schemaName, provider);
    if (schema === undefined) {
        return undefined;
    }
    const typeName = schema.name;
    return {
        kind: "inline",
        typeName,
        schema: generateSchemaTypeDefinition(schema),
    };
}

const selectSchemaCache = new Map<
    string,
    InlineTranslatorSchemaDef | undefined
>();
function getSelectionSchema(
    schemaName: string,
    provider: ActionConfigProvider,
): InlineTranslatorSchemaDef | undefined {
    if (selectSchemaCache.has(schemaName)) {
        return selectSchemaCache.get(schemaName);
    }

    const result = createSelectionSchema(schemaName, provider);
    selectSchemaCache.set(schemaName, result);
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
    schemaNames: string[],
    provider: ActionConfigProvider,
) {
    return schemaNames
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
    schemaNames: string[],
    provider: ActionConfigProvider,
) {
    const schemas = getAssistantSelectionSchemas(schemaNames, provider);

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
                {
                    instructions: [
                        {
                            role: "system",
                            content:
                                "Select the assistant to handle the request",
                        },
                    ],
                },
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
