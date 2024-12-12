// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    ActionResult,
    AppAction,
    AppAgent,
    ParameterDefinitions,
    ParsedCommandParams,
} from "@typeagent/agent-sdk";
import { createActionResultFromTextDisplay } from "@typeagent/agent-sdk/helpers/action";
import { OracleAction } from "./oracleSchema.js";
import {
    CommandHandler,
    CommandHandlerTable,
    getCommandInterface,
} from "@typeagent/agent-sdk/helpers/command";

class RequestCommandHandler implements CommandHandler {
    public readonly description = "Send a request to the Oracle";
    public readonly parameters: ParameterDefinitions = {
        args: {
            question: {
                description: "Request for Oracle",
                type: "string",
                optional: false,
                implicitQuotes: true,
            },
        },
    };
    public async run(
        context: ActionContext<OracleActionContext>,
        params: ParsedCommandParams<ParameterDefinitions>,
    ): Promise<void> {
        if (typeof params?.args?.question === "string") {
            const action: OracleAction = {
                actionName: "queryOracle",
                parameters: {
                    query: params.args.question,
                },
            };
            const result = await executeOracleAction(action, context); // Or handleOracleAction?
            context.actionIO.appendDisplay(result.displayContent);
        }
    }
}

const handlers: CommandHandlerTable = {
    description: "Oracle commands",
    defaultSubCommand: "request",
    commands: {
        request: new RequestCommandHandler(),
    },
};

export function instantiate(): AppAgent {
    return {
        initializeAgentContext: initializeOracleContext,
        executeAction: executeOracleAction,
        ...getCommandInterface(handlers),
    };
}

type OracleActionContext = {
    enabled: boolean;
};

async function initializeOracleContext() {
    return { enabled: true };
}

async function executeOracleAction(
    action: AppAction,
    context: ActionContext<OracleActionContext>,
) {
    let result = await handleOracleAction(
        action as OracleAction,
        context.sessionContext.agentContext,
    );
    return result;
}

const oracularResponses = `
The river flows not where it begins, but where it is drawn by the quiet pull of unseen forces.
A key fits no lock without the will to turn and the patience to find its groove.
Shadows lengthen when the sun sets low, yet in their stretch lies the story of the day.
The flame consumes, but it also warms; what you lose may yet light your way.
A tree's roots are unseen, yet they hold the strength of its tallest branches.
The bird does not ask where the wind comes from; it simply rises and soars.
Stones do not float, but when gathered, they build bridges over the deepest waters.
A question is like an echo; its answer returns in the shape of what you’ve cast into the void.
`
    .trim()
    .split("\n"); // Written by GPT-4o

async function handleOracleAction(
    action: OracleAction,
    oracleContext: OracleActionContext,
) {
    let result: ActionResult | undefined = undefined;
    let displayText: string | undefined = undefined;
    switch (action.actionName) {
        case "queryOracle": {
            const randomIndex = Math.floor(
                Math.random() * oracularResponses.length,
            );
            displayText = oracularResponses[randomIndex];
            result = createActionResultFromTextDisplay(
                displayText,
                displayText,
            );
            break;
        }

        default:
            throw new Error(`Unknown action: ${action.actionName}`);
    }
    return result;
}
