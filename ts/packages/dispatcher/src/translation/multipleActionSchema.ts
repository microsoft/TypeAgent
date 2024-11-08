// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TranslatorSchemaDef } from "common-utils";
import { AppAction } from "@typeagent/agent-sdk";
import { TranslatedAction } from "../handlers/requestCommandHandler.js";

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

export function getMultipleActionSchemaDef(type: string): TranslatorSchemaDef {
    return {
        kind: "inline",
        typeName: multipleActionType,
        schema: `
export type ${multipleActionType} = {
    actionName: "${multipleActionName}";
    parameters: {
        requests: {
            request: string;
            action: ${type};
        }[];
    };
};`,
    };
}
