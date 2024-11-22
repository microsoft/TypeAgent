// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { error, Result, success, TypeChatJsonValidator } from "typechat";
import { TranslatedAction } from "../handlers/requestCommandHandler.js";
import {
    ActionSchemaFile,
    generateActionSchema,
    parseActionSchemaFile,
    parseActionSchemaSource,
    validateAction,
    ActionSchemaCreator as sc,
    generateSchemaTypeDefinition,
    ActionSchemaEntryTypeDefinition,
    ActionSchemaTypeDefinition,
    ActionSchemaUnion,
} from "action-schema";
import {
    TranslatorSchemaDef,
    createJsonTranslatorWithValidator,
    JsonTranslatorOptions,
    composeTranslatorSchemas,
} from "common-utils";
import {
    getInjectedTranslatorConfigs,
    ActionConfigProvider,
    ActionConfig,
    createChangeAssistantActionSchema,
} from "./agentTranslators.js";
import { createMultipleActionSchema } from "./multipleActionSchema.js";

function createActionSchemaJsonValidator<T extends TranslatedAction>(
    actionSchemaFile: ActionSchemaFile,
): TypeChatJsonValidator<T> {
    const schema = generateActionSchema(actionSchemaFile, { exact: true });
    return {
        getSchemaText: () => schema,
        getTypeName: () => actionSchemaFile.entry.name,
        validate(jsonObject: object): Result<T> {
            const value: any = jsonObject;
            if (value.actionName === undefined) {
                return error("Missing actionName property");
            }
            const actionSchema = actionSchemaFile.actionSchemas.get(
                value.actionName,
            );
            if (actionSchema === undefined) {
                return error(`Unknown action name: ${value.actionName}`);
            }

            try {
                validateAction(actionSchema, value);
                return success(value);
            } catch (e: any) {
                return error(e.message);
            }
        },
    };
}

export function loadActionSchemas(
    typeName: string,
    schemas: TranslatorSchemaDef[],
): ActionSchemaFile {
    const schema = composeTranslatorSchemas(typeName, schemas);
    const translatorName = "";
    return parseActionSchemaSource(schema, translatorName, typeName);
}

export function createActionJsonTranslatorFromSchemaDef<
    T extends TranslatedAction,
>(
    typeName: string,
    schemas: string | TranslatorSchemaDef[],
    options?: JsonTranslatorOptions<T>,
) {
    const actionSchemas = loadActionSchemas(
        typeName,
        Array.isArray(schemas)
            ? schemas
            : [
                  {
                      kind: "inline",
                      typeName,
                      schema: schemas,
                  },
              ],
    );

    const validator = createActionSchemaJsonValidator<T>(actionSchemas);

    return createJsonTranslatorWithValidator(
        typeName.toLowerCase(),
        validator,
        options,
    );
}

class ActionSchemaBuilder {
    private readonly files: ActionSchemaFile[] = [];
    private readonly definitions: ActionSchemaEntryTypeDefinition[] = [];

    addActionConfig(...configs: ActionConfig[]) {
        for (const config of configs) {
            const actionSchemaFile = parseActionSchemaFile(
                config.schemaFile,
                config.schemaName,
                config.schemaType,
            );
            this.files.push(actionSchemaFile);
            this.definitions.push(actionSchemaFile.entry);
        }
    }

    addTypeDefinition(definition: ActionSchemaTypeDefinition) {
        this.definitions.push(definition);
    }

    getTypeUnion(): ActionSchemaUnion {
        return sc.union(
            this.definitions.map((definition) => sc.ref(definition)),
        );
    }

    build(typeName: string = "AllActions"): ActionSchemaFile {
        const entry = sc.type(typeName, this.getTypeUnion(), undefined, true);
        const order = new Map<string, number>();
        for (const file of this.files) {
            if (file.order) {
                const base = order.size;
                for (const [name, num] of file.order) {
                    order.set(name, base + num);
                }
            }
        }

        const actionSchemas: [string, ActionSchemaTypeDefinition][] = [];
        const pending: ActionSchemaEntryTypeDefinition[] = [
            ...this.definitions,
        ];
        while (pending.length > 0) {
            const current = pending.shift()!;
            const currentType = current.type;
            switch (currentType.type) {
                case "type-union":
                    for (const t of currentType.types) {
                        if (t.definition === undefined) {
                            throw new Error(
                                `Schema Builder Error: unresolved type reference '${t.name}' in entry tryp union`,
                            );
                        }
                        pending.push(t.definition);
                    }
                    break;
                case "type-reference":
                    if (currentType.definition === undefined) {
                        throw new Error(
                            `Schema Builder Error: unresolved type reference '${currentType.name}' in entry tryp union`,
                        );
                    }
                    pending.push(currentType.definition);
                    break;
                case "object":
                    actionSchemas.push([
                        current.name,
                        current as ActionSchemaTypeDefinition,
                    ]);
                    break;
                default:
                    // Should not reach here.
                    throw new Error("Invalid type");
            }
        }

        return {
            entry,
            actionSchemas: new Map(actionSchemas),
            order,
        };
    }
}

export function composeActionSchema(
    translatorName: string,
    provider: ActionConfigProvider,
    activeSchemas: { [key: string]: boolean } | undefined,
    multipleActions: boolean = false,
) {
    const builder = new ActionSchemaBuilder();
    builder.addActionConfig(provider.getTranslatorConfig(translatorName));
    builder.addActionConfig(
        ...getInjectedTranslatorConfigs(
            translatorName,
            provider,
            activeSchemas,
        ),
    );

    if (activeSchemas) {
        const changeAssistantActionSchema = createChangeAssistantActionSchema(
            provider,
            translatorName,
            activeSchemas,
        );
        if (changeAssistantActionSchema) {
            builder.addTypeDefinition(changeAssistantActionSchema);
        }
    }

    if (multipleActions) {
        builder.addTypeDefinition(
            createMultipleActionSchema(builder.getTypeUnion()),
        );
    }
    return builder.build();
}
