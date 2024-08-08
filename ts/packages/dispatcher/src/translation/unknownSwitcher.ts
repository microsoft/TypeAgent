// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getTranslatorConfig } from "./agentTranslators.js";
import { ISymbol, SchemaParser, NodeType } from "schema-parser";
import { getPackageFilePath } from "../utils/getPackageFilePath.js";
import {
    InlineTranslatorSchemaDef,
    createJsonTranslatorFromSchemaDef,
    SearchMenuItem,
    TemplateParamField,
} from "common-utils";
import { getTranslatorActionInfo as getTranslatorActionInfos } from "./actionInfo.js";
import { Result, success } from "typechat";
import registerDebug from "debug";

const debugSwitchSearch = registerDebug("typeagent:switch:search");

function createSelectionSchema(
    translatorName: string,
): InlineTranslatorSchemaDef | undefined {
    const translatorConfig = getTranslatorConfig(translatorName);

    if (translatorConfig.injected) {
        // No need to select for injected schemas
        selectSchemaCache.set(translatorName, undefined);
        return undefined;
    }
    const actionInfos = getTranslatorActionInfos(translatorConfig);

    const actionNames: string[] = [];
    const actionComments: string[] = [];
    for (const info of actionInfos) {
        if (info !== undefined) {
            actionNames.push(`"${info.name}"`);
            actionComments.push(
                `"${info.name}"${info.comments ? ` - ${info.comments}` : ""}`,
            );
        }
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
): InlineTranslatorSchemaDef | undefined {
    if (selectSchemaCache.has(translatorName)) {
        return selectSchemaCache.get(translatorName);
    }

    const result = createSelectionSchema(translatorName);
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
export function getAssistantSelectionSchemas(translatorNames: string[]) {
    return translatorNames
        .map((name) => {
            return { name, schema: getSelectionSchema(name) };
        })
        .filter(
            (entry) => entry.schema !== undefined,
        ) as AssistantSelectionSchemaEntry[];
}

export type AssistantSelection = {
    assistant: string;
    action: string;
};

export function getActionInfo(translatorNames: string[]) {
    const actionNames: string[] = [];
    const actionComments: string[] = [];
    const actionItems: SearchMenuItem[] = [];
    for (const name of translatorNames) {
        const translatorConfig = getTranslatorConfig(name);
        if (translatorConfig.injected) {
            continue;
        }
        const actionInfos = getTranslatorActionInfos(translatorConfig);
        for (const info of actionInfos) {
            if (info !== undefined) {
                actionNames.push(info.name);
                actionComments.push(
                    `"${info.name}"${info.comments ? ` - ${info.comments}` : ""}`,
                );
                actionItems.push({
                    matchText: info.name,
                    emojiChar: translatorConfig.emojiChar,
                    groupName: name,
                });
            }
        }
    }
    return { actionNames, actionItems, actionComments };
}

function getTemplateParamFieldType(
    parser: SchemaParser,
    param: ISymbol,
    valueType?: NodeType,
): TemplateParamField {
    let type = param.type;
    if (valueType !== undefined) {
        type = valueType;
    }
    switch (type) {
        case NodeType.String:
            return { type: "string" };
        case NodeType.Numeric:
            return { type: "number" };
        case NodeType.Boolean:
            return { type: "boolean" };
        case NodeType.Object:
        case NodeType.Interface:
        case NodeType.TypeReference:
            parser.open(param.name);
            const tree = getTemplateParamObjectType(parser);
            parser.close();
            return tree;
        case NodeType.Array:
            return {
                type: "array",
                elementType: getTemplateParamFieldType(
                    parser,
                    param,
                    param.valueType,
                ),
            };
        case NodeType.Property:
            return getTemplateParamFieldType(parser, param, param.valueType);
        case NodeType.Union:
            if (param.valueType === NodeType.String) {
                return {
                    type: "string-union",
                    // remove quotes and split by pipe
                    typeEnum: param.value
                        .split("|")
                        .map((v) => v.trim().slice(1, -1)),
                };
            }
            break;
        case NodeType.ObjectArray:
            parser.open(param.name);
            const elementType = getTemplateParamObjectType(parser);
            parser.close();
            return {
                type: "array",
                elementType,
            };
        default:
            console.log(`Unhandled type ${param.type}`);
    }
    return { type: "string", value: "unhandled" };
}

// assumes parser is open to the correct object
function getTemplateParamObjectType(parser: SchemaParser): TemplateParamField {
    let fields: { [key: string]: any } = {};
    const paramChildren = parser.symbols();
    if (paramChildren !== undefined) {
        for (const param of paramChildren) {
            const fieldType = getTemplateParamFieldType(parser, param);
            fields[param.name] = {
                fieldType,
                optional: param.optional,
            };
        }
    }
    return {
        type: "object",
        fields,
    };
}

export function getParams(actionName: string, translatorName: string) {
    const parser = new SchemaParser();
    const translatorConfig = getTranslatorConfig(translatorName);
    parser.loadSchema(getPackageFilePath(translatorConfig.schemaFile));
    const fullActionName = `${actionName}Action`;
    let node = parser.openActionNode(fullActionName);
    if (node === undefined) {
        return undefined;
    } else {
        parser.open("parameters");
        return getTemplateParamObjectType(parser);
    }
}

// GPT-4 has 8192 token window, with an estimated 4 chars per token, so use only 3 times to leave room for output.
const assistantSelectionLimit = 8192 * 3;

export function loadAssistantSelectionJsonTranslator(
    translatorNames: string[],
) {
    const schemas = getAssistantSelectionSchemas(translatorNames);

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
