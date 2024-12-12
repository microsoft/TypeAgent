// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TranslatorSchemaDef } from "common-utils";
import { AppAction } from "@typeagent/agent-sdk";
import { TranslatedAction } from "./agentTranslators.js";
import {
    ActionSchemaTypeDefinition,
    ActionSchemaUnion,
    generateSchemaTypeDefinition,
} from "action-schema";
import { ActionSchemaCreator as sc } from "action-schema";

// Multiple Action is what is used and returned from the LLM
const multipleActionName = "multiple";
const multipleActionType = "MultipleAction";
export type MultipleAction = {
    actionName: "multiple";
    parameters: {
        requests: {
            request: string;
            action: TranslatedAction;
        }[];
    };
};

export function isMultipleAction(action: AppAction): action is MultipleAction {
    return action.actionName === multipleActionName;
}

export function createMultipleActionSchema(
    types: ActionSchemaUnion,
): ActionSchemaTypeDefinition {
    const schema = sc.type(
        multipleActionType,
        sc.obj({
            actionName: sc.string(multipleActionName),
            parameters: sc.obj({
                requests: sc.array(
                    sc.obj({
                        request: sc.string(),
                        action: types,
                    }),
                ),
            }),
        }),
        undefined,
        true,
    );
    return schema;
}
export function getMultipleActionSchemaDef(
    types: string[],
): TranslatorSchemaDef {
    const union: ActionSchemaUnion = sc.union(
        types.map((type) => sc.ref<ActionSchemaTypeDefinition>(type)),
    );
    const multipleActionSchema = createMultipleActionSchema(union);
    return {
        kind: "inline",
        typeName: multipleActionType,
        schema: generateSchemaTypeDefinition(multipleActionSchema, {
            strict: false, // have unresolved references.
            exact: true,
        }),
    };
}
