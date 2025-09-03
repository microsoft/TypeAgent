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
import { SchemaCreator as sc } from "action-schema";

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
            "If the action has a result, the result entity id can be referenced in later action's parameters with in this multiple action.",
            "The reference to the result must be in the format '${result-<resultEntityId>}', where resultEntityId is uniquely generated name within this multiple action",
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
