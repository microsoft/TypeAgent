// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IAction } from "agent-cache";
import { TranslatorSchemaDef } from "common-utils";
import { DispatcherAction } from "dispatcher-agent";

// Multiple Action is what is used and returned from the LLM
const multipleActionName = "multiple";
const multipleActionType = "MultipleAction";
export type MultipleAction = {
    actionName: "multiple";
    parameters: {
        requests: {
            request: string;
            action: IAction;
        }[];
    };
};

export function isMultipleAction(
    action: DispatcherAction,
): action is MultipleAction {
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
