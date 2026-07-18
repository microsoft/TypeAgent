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

// A short identifier for a result within a multiple action, so a later request
// can reference it. Format: a token matching ^[A-Za-z0-9_]+$ (e.g. '0',
// 'favoritesList'). To use the result inside a later action's parameters,
// reference it as ${result-<ResultEntityId>}.
export type ResultEntityId = string;

export type PendingRequestEntry = {
    request: string;
    pendingResultEntityId: ResultEntityId;
};

type ActionRequestEntry = {
    request: string;
    action: TranslatedAction;
    // if the action has a result, the result entity id can be used in future action parameters
    resultEntityId?: ResultEntityId;
    // Set when this action depends on the CONTENT of an earlier result that is
    // not known yet. The action provided is a best-effort placeholder; the
    // request is deferred and regenerated once the referenced result resolves.
    pendingResultEntityId?: ResultEntityId;
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
        // Actions to perform now, in order. Tag any whose result a later
        // request needs with resultEntityId.
        requests: ActionRequestEntry[];
        // "Next" requests that cannot be generated yet because they need the
        // CONTENT of a result produced above; each is deferred and regenerated
        // once its pendingResultEntityId resolves.
        pendingRequests?: PendingRequestEntry[];
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
    if (pending) {
        // Tolerate the model's natural shape: an action entry that ALSO carries a
        // pending reference ("build createPlaylist, but it needs the favorites
        // result"). When present, the runtime defers this request (see
        // isPendingRequest) and regenerates it once the referenced result is
        // available, so the placeholder action above is discarded.
        actionRequestEntryFields.pendingResultEntityId = sc.optional(
            sc.string(),
            [
                "Set this ONLY when this action needs the CONTENT of an earlier result that you cannot know yet (e.g. filtering or choosing from a list a previous action produces).",
                "Set it to the resultEntityId of the earlier request whose result this action needs; this request will be deferred and regenerated once that result is available.",
            ],
        );
    }

    const actionRequestEntryType = sc.obj(actionRequestEntryFields);

    const parametersFields: any = {
        requests: sc.array(actionRequestEntryType),
    };
    if (pending) {
        // A dedicated place for the "next" requests: ones you CANNOT generate an
        // action for yet because they need the CONTENT of a result produced by
        // an action in 'requests' above. Giving the model an explicit slot for
        // these (instead of making it attach a reference to an action) is what
        // keeps it from emitting a malformed action/reference hybrid.
        parametersFields.pendingRequests = sc.optional(
            sc.array(
                sc.obj({
                    request: sc.string(),
                    pendingResultEntityId: sc.field(
                        sc.string(),
                        "The resultEntityId of the earlier request whose result this request needs.",
                    ),
                }),
            ),
            [
                "Requests you CANNOT act on yet because they need the CONTENT of a result produced by an action in 'requests' above (e.g. filtering, sorting, or choosing from that result).",
                "Put the natural-language request here and do NOT invent an action for it; set pendingResultEntityId to the resultEntityId of the action whose result it needs. It is regenerated once that result is available.",
            ],
        );
    }

    const schema = sc.type(
        multipleActionType,
        sc.obj({
            actionName: sc.string(multipleActionName),
            parameters: sc.obj(parametersFields),
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
