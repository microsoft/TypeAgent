// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext, AppAgent } from "@typeagent/agent-sdk";
import { AddAction } from "./schema.js";
import { createActionResult } from "@typeagent/agent-sdk/helpers/action";

export function instantiate(): AppAgent {
    return {
        executeAction,
    };
}

async function executeAction(action: AddAction, context: ActionContext<void>) {
    switch (action.actionName) {
        case "add":
            const { a, b } = action.parameters;
            return createActionResult(`The sum of ${a} and ${b} is ${a + b}`);
        default:
            throw new Error(`Unknown action: ${action.actionName}`);
    }
}
