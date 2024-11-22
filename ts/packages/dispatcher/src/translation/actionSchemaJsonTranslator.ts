// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { error, Result, success, TypeChatJsonValidator } from "typechat";
import { TranslatedAction } from "../handlers/requestCommandHandler.js";
import {
    ActionSchemaFile,
    generateActionSchema,
    parseActionSchemaSource,
    validateAction,
} from "action-schema";
import {
    TranslatorSchemaDef,
    createJsonTranslatorWithValidator,
    JsonTranslatorOptions,
    composeTranslatorSchemas,
} from "common-utils";

function createActionSchemaJsonValidator<T extends TranslatedAction>(
    actionSchemaFile: ActionSchemaFile,
    typeName: string,
): TypeChatJsonValidator<T> {
    const schema = generateActionSchema(actionSchemaFile, typeName, true);
    return {
        getSchemaText: () => schema,
        getTypeName: () => typeName,
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

    const validator = createActionSchemaJsonValidator<T>(
        actionSchemas,
        typeName,
    );

    return createJsonTranslatorWithValidator(
        typeName.toLowerCase(),
        validator,
        options,
    );
}
