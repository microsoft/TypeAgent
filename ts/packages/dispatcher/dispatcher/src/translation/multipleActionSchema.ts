// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TranslatorSchemaDef } from "typechat-utils";
import { AppAction } from "@typeagent/agent-sdk";
import { TranslatedAction } from "./agentTranslators.js";
import {
    ActionSchemaTypeDefinition,
    ActionSchemaUnion,
    generateSchemaTypeDefinition,
} from "@typeagent/action-schema";
import { SchemaCreator as sc } from "@typeagent/action-schema";

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
        actionRequestEntryFields.resultEntityId = sc.optional(sc.string(), [
            "If the action produces a result that will be used in later actions, set this to a unique identifier within this multiple action (e.g., '0', '1', 'listId', etc.).",
            "To reference this result in a later action's parameters, use the format '${result-<resultEntityId>}' where <resultEntityId> is the value you set here.",
            "Example: If you set resultEntityId to '0', then reference it in later actions as '${result-0}'.",
        ]);
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
        "ONLY use when the current user request has multiple parts and require multiple actions. Do NOT include completed requests from chat history.",
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
