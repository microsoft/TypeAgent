// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    ActionResult,
    ActionResultSuccess,
    AppAction,
    AppAgent,
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
    public readonly parameters = {
        // Must have a single string parameter and implicit quotes
        // in order to support '@config request <agent>'
        args: {
            question: {
                description: "Request for Oracle",
                type: "string",
                optional: false,
                implicitQuotes: true,
            },
        },
    } as const;
    public async run(
        context: ActionContext<OracleActionContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ): Promise<void> {
        if (typeof params.args?.question === "string") {
            const result = makeRandomResponse(params.args.question);
            context.actionIO.appendDisplay(result.displayContent);
        }
    }
}

const handlers: CommandHandlerTable = {
    description: "Oracle commands",
    defaultSubCommand: "request",
    commands: {
        // Command name "request" is special for '@config request <agent>'
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

type OracleActionContext = {};

async function initializeOracleContext(): Promise<OracleActionContext> {
    return {};
}

async function executeOracleAction(
    action: AppAction,
    context: ActionContext<OracleActionContext>,
): Promise<ActionResult> {
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
The sun sets not in defeat, but to gift the stars their turn to shine.
A seed does not question the soil, yet it trusts the earth to cradle its roots.
The echo answers not with clarity, but with the truth it has found in the void.
A path reveals itself only to those who dare take the first uncertain step.
The wind whispers not to be heard, but to remind the trees they can dance.
A flame does not ponder its end, for its purpose lies in the light it casts.
The mountain does not move, yet it shapes every journey that dares to face it.
The clock measures time not in seconds, but in the stories that unfold between its ticks.
A mirror reflects all, yet shows nothing of what lies behind its surface.
Rain falls not to quench, but to awaken the promise sleeping beneath the soil.
The star does not seek the sky, yet it burns brightly where it belongs.
A bridge spans the chasm not for itself, but for those who dare cross it.
The tide retreats not in surrender, but to gather strength for its return.
A shadow moves not on its own, but it dances where light and form agree.
The book holds wisdom not in its pages, but in the hands that dare to open it.
A storm does not roar for destruction, but to cleanse the air for what follows.
The stone does not resent the sculptor’s chisel, for it reveals its truest form.
The owl hoots not for the world to hear, but to remind the night of its watchful eyes.
A river bends not out of weakness, but to find the way that leads it home.
The flame does not fear the dark; it knows its existence is to banish it.
The tree stands silent, rooted in a ground it did not choose, reaching for a sky it can never touch.\
 Its branches twist and turn, shaped by winds it cannot see, yet it grows, inch by inch, year by year, without question or regret.\
 When the storm comes, it bends but does not break, trusting the strength it gained in seasons long forgotten.\
 Its leaves fall not in despair but in surrender to the cycle it cannot control, knowing the earth will cradle them,\
 and in time, they will return as nourishment to the roots below. The tree does not ask if its life has meaning;\
 it simply grows, offering shade to the weary, shelter to the small,\
 and beauty to the eyes that pause to notice—all without knowing it gives.
`
    .trim()
    .split("\n"); // Written by GPT-4o. (The last, very long one, is meant as a prank.)

async function handleOracleAction(
    action: OracleAction,
    oracleContext: OracleActionContext,
): Promise<ActionResult> {
    switch (action.actionName) {
        case "queryOracle": {
            return makeRandomResponse(action.parameters.query);
            break;
        }
        default:
            throw new Error(`Unknown action: ${action.actionName}`);
    }
}

function makeRandomResponse(input: string): ActionResultSuccess {
    const randomIndex = Math.floor(Math.random() * oracularResponses.length);
    const displayText = oracularResponses[randomIndex];
    return createActionResultFromTextDisplay(displayText, displayText);
}
