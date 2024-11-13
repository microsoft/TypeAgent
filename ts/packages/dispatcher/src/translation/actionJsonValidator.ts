// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { error, Result, success, TypeChatJsonValidator } from "typechat";
import { TranslatedAction } from "../handlers/requestCommandHandler.js";
import { ActionSchema, generateSchema, validateAction } from "action-schema";

export function createTypeAgentJsonValidator(
    actionInfos: ActionSchema[],
): TypeChatJsonValidator<TranslatedAction> {
    const schema = generateSchema(actionInfos);
    return {
        getSchemaText: () => schema,
        getTypeName: () => "AllActions",
        validate(jsonObject: object): Result<TranslatedAction> {
            const value: any = jsonObject;
            if (value.actionName === undefined) {
                return error("Missing actionName property");
            }
            const actionInfo = actionInfos.find(
                (a) => a.actionName === value.actionName,
            );
            if (actionInfo === undefined) {
                return error(`Unknown action name: ${value.actionName}`);
            }

            try {
                validateAction(actionInfo, value);
                return success(value);
            } catch (e: any) {
                return error(e.message);
            }
            return error("Validation failed");
        },
    };
}
