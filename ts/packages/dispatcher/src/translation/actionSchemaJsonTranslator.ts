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
        getTypeName: () => actionSchemaFile.definition.name,
        validate(jsonObject: object): Result<T> {
            const value: any = jsonObject;
            if (value.actionName === undefined) {
                return error("Missing actionName property");
            }
            const actionSchema = actionSchemaFile.actionSchemaMap.get(
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

function loadActionSchemas(
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
            this.definitions.push(actionSchemaFile.definition);
        }
    }

    addTypeDefinition(definition: ActionSchemaTypeDefinition) {
        this.definitions.push(definition);
    }

    getTypeUnion() {
        return sc.union(
            this.definitions.map((definition) => sc.ref(definition)),
        );
    }

    build(typeName: string = "AllActions") {
        const definition = sc.type(typeName, this.getTypeUnion());

        return generateSchemaTypeDefinition(definition);
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
