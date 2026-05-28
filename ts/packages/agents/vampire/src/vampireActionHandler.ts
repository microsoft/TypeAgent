// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext, AppAgent, TypeAgentAction } from "@typeagent/agent-sdk";
import { createActionResultFromTextDisplay } from "@typeagent/agent-sdk/helpers/action";
import { VampireAction } from "./vampireSchema.js";

export function instantiate(): AppAgent {
    return {
        executeAction: executeVampireAction,
    };
}

async function executeVampireAction(
    action: TypeAgentAction<VampireAction>,
    _context: ActionContext<unknown>,
) {
    const fullName = `${action.schemaName}.${action.actionName}`;
    console.log(
        `[vampire] fired: ${fullName} parameters=${JSON.stringify(action.parameters)}`,
    );
    const message = `vampire fired: ${fullName}`;
    return createActionResultFromTextDisplay(message, message);
}
