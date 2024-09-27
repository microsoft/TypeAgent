// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    AppAgent,
    AppAction,
    ActionResult,
} from "@typeagent/agent-sdk";
import {
    createActionResult,
} from "@typeagent/agent-sdk/helpers/action";

import {GreetingAction, PersonalizedGreetingAction} from "./greetingActionSchema.js";
import { randomInt } from "node:crypto";
//import { getLookupInstructions, getLookupSettings, LookupSettings, searchWeb } from "chat-agent/agent/handlers";
//import { StopWatch } from "common-utils";
//import { generateAnswerFromWebPages } from "typeagent";
import { CommandHandler, CommandHandlerTable, getCommandInterface } from "@typeagent/agent-sdk/helpers/command";

export function instantiate(): AppAgent {
    return {
        executeAction: executeGreetingAction,
        ...getCommandInterface(handlers),
    };
}

export class GreetingCommandHandler implements CommandHandler {
    public readonly description = "Have the agent generate a personalized greeting.";
    public async run(_input: string, context: ActionContext) {
        // TODO: implement
    }
}

const handlers: CommandHandlerTable = {
    description: "Generate agent greeting.",
    defaultSubCommand: new GreetingCommandHandler(),
    commands: {
    },
};

async function executeGreetingAction(
    action: AppAction,
    context: ActionContext,
) {
    let result = await handleGreetingAction(action as GreetingAction, context);
    return result;
}

async function handleGreetingAction(
    action: GreetingAction,
    context: ActionContext,
) {
    let result: ActionResult | undefined = undefined;
    switch (action.actionName) {
        case "personalizedGreetingResponse": {
            const greetingAction = action as PersonalizedGreetingAction;
            let result = createActionResult("Hi!");
            if (greetingAction.parameters !== undefined) {
                const count =
                    greetingAction.parameters.possibleGreetings.length;
                console.log(`Received ${count} generated greetings`);

                // randomly decide on a conversation starter (or not)
                // TODO: personalize list based on user preferences
                // let intiatorTopic: string[] = [ "breaking news", "local headlines", "current local weather"];
                // let index: number = randomInt(intiatorTopic.length);

                // if (index > 0 && index < intiatorTopic.length) {
                //     let lookupSettings: LookupSettings = await getLookupSettings(true);
                //     lookupSettings.lookupOptions.rewriteFocus = `Use the greeting '${greetingAction.parameters.possibleGreetings[randomInt(0, count)].generatedGreeting}' and the supplied initiator topic to make a better conversation starter. Keep the mood LIGHT.`
                //     //return await handleLookup([intiatorTopic[index]], context, lookupSettings);    
                //     let greeting: string | undefined = await runLookup(intiatorTopic[index], context, lookupSettings);

                //     if (greeting) {
                //         result = createActionResult(greeting);
                //     }

                // } else if (index == 0) {
                //     // TODO: add chat history from conversation manager.  Waiting for time bounded API lookup.
                //     result = createActionResult(
                //         greetingAction.parameters.possibleGreetings[
                //             randomInt(0, count)
                //         ].generatedGreeting,
                //     );
                // } else {
                    result = createActionResult(
                        greetingAction.parameters.possibleGreetings[
                            randomInt(0, count)
                        ].generatedGreeting,
                    );
                // }
            }
            return result;
        }
        default:
            throw new Error(`Unknown action: ${action.actionName}`);
    }
    return result;
}

// async function runLookup(
//     lookup: string,
//     actionContext: ActionContext,
//     settings: LookupSettings,
// ): Promise<string | undefined> {
//     const stopWatch = new StopWatch();
//     stopWatch.start("WEB SEARCH: " + lookup);
//     const urls = await searchWeb(lookup, settings.maxSearchResults);
//     stopWatch.stop("WEB SEARCH: " + lookup);
//     if (!urls) {
//         return undefined;
//     }
//     const answer = await generateAnswerFromWebPages(
//         settings.fastMode ? "Speed" : "Quality",
//         settings.answerGenModel,
//         urls,
//         lookup,
//         settings.lookupOptions,
//         1,
//         getLookupInstructions(), 
//     );

//     return answer?.generatedText;
// }

// function streamPartialGreetingAction(
//     actionName: string,
//     name: string,
//     value: string,
//     delta: string | undefined,
//     context: ActionContext,
// ) {
//     if (actionName !== "generateResponse") {
//         return;
//     }

//     // don't stream empty string and undefined as well.
//     if (name === "parameters.generatedText") {
//         if (delta === undefined) {
//             // we finish the streaming text.  add an empty string to flush the speaking buffer.
//             context.actionIO.appendDisplay("");
//         }
//         // Don't stream empty deltas
//         if (delta) {
//             if (context.streamingContext === undefined) {
//                 context.streamingContext = "";
//             }
//             context.streamingContext += delta;
//             context.actionIO.appendDisplay({
//                 type: "text",
//                 content: delta,
//                 speak: true,
//             });
//         }
//     }
// }