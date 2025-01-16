// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    AppAgent,
    ParsedCommandParams,
} from "@typeagent/agent-sdk";
import { TestActions } from "./schema.js";
import { createActionResult } from "@typeagent/agent-sdk/helpers/action";
import {
    CommandHandler,
    getCommandInterface,
} from "@typeagent/agent-sdk/helpers/command";

class RequestCommandHandler implements CommandHandler {
    public readonly description = "Request a test";
    public readonly parameters = {
        args: {
            test: {
                description: "Test to request",
                implicitQuotes: true,
            },
        },
    } as const;
    public async run(
        context: ActionContext<void>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        context.actionIO.setDisplay(params.args.test);
    }
}

const handlers = {
    description: "Test App Agent Commands",
    commands: {
        request: new RequestCommandHandler(),
    },
};
export function instantiate(): AppAgent {
    return {
        executeAction,
        ...getCommandInterface(handlers),
    };
}

async function executeAction(
    action: TestActions,
    context: ActionContext<void>,
) {
    switch (action.actionName) {
        case "add":
            const { a, b } = action.parameters;
            return createActionResult(`The sum of ${a} and ${b} is ${a + b}`);
        default:
            throw new Error(`Unknown action: ${action.actionName}`);
    }
}
