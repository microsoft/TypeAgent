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

export type PendingRequestEntry = {
    request: string;
    pendingResultEntityId: string;
};

type ActionRequestEntry = {
    request: string;
    action: TranslatedAction;
    // if the action has a result, the result entity id can be used in future action parameters
    resultEntityId?: string;
};

export type RequestEntry = ActionRequestEntry | PendingRequestEntry;

export function isPendingRequest(
    entry: RequestEntry,
): entry is PendingRequestEntry {
    return "pendingResultEntityId" in entry;
}

export type MultipleAction = {
    actionName: "multiple";
    parameters: {
        requests: RequestEntry[];
    };
};

export function isMultipleAction(action: AppAction): action is MultipleAction {
    return action.actionName === multipleActionName;
}

export type MultipleActionConfig = {
    enabled: boolean;
    result: boolean;
    pending: boolean;
};

export type MultipleActionOptions = MultipleActionConfig | boolean;

export function createMultipleActionSchema(
    types: ActionSchemaUnion,
    multipleActionOptions: MultipleActionOptions,
): ActionSchemaTypeDefinition {
    const result =
        typeof multipleActionOptions === "object"
            ? multipleActionOptions.result
            : true;
    const pending =
        result &&
        (typeof multipleActionOptions === "object"
            ? multipleActionOptions.pending
            : true);

    const actionRequestEntryFields: any = {
        request: sc.string(),
        action: types,
    };
    if (result) {
        actionRequestEntryFields.resultEntityId = sc.optional(
            sc.string(),
            "if the action has a result, the result entity id can be used in future action parameters",
        );
    }

    const actionRequestEntryType = sc.obj(actionRequestEntryFields);

    let requestEntryType = pending
        ? sc.union(
              actionRequestEntryType,
              sc.obj({
                  request: sc.string(),
                  pendingResultEntityId: sc.field(
                      sc.string(),
                      "The request references result of previous action, but the content of the result will be needed to generate an action for the request.",
                  ),
              }),
          )
        : actionRequestEntryType;

    const schema = sc.type(
        multipleActionType,
        sc.obj({
            actionName: sc.string(multipleActionName),
            parameters: sc.obj({
                requests: sc.array(requestEntryType),
            }),
        }),
        undefined,
        true,
    );
    return schema;
}
export function getMultipleActionSchemaDef(
    types: string[],
    multipleActionOptions: MultipleActionOptions,
): TranslatorSchemaDef {
    const union: ActionSchemaUnion = sc.union(
        types.map((type) => sc.ref<ActionSchemaTypeDefinition>(type)),
    );
    const multipleActionSchema = createMultipleActionSchema(
        union,
        multipleActionOptions,
    );
    return {
        kind: "inline",
        typeName: multipleActionType,
        schema: generateSchemaTypeDefinition(multipleActionSchema, {
            strict: false, // have unresolved references.
            exact: true,
        }),
    };
}
