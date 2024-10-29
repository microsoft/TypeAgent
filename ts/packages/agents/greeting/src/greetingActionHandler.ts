// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    AppAgent,
    AppAction,
    ActionResult,
    ActionResultSuccess,
} from "@typeagent/agent-sdk";
import { createTypeChat, promptLib } from "typeagent";
import { createActionResult } from "@typeagent/agent-sdk/helpers/action";

import {
    GreetingAction,
    PersonalizedGreetingAction,
} from "./greetingActionSchema.js";
import { randomInt } from "node:crypto";
import {
    CommandHandlerNoParams,
    CommandHandlerTable,
    getCommandInterface,
} from "@typeagent/agent-sdk/helpers/command";
import { ChatModelWithStreaming, CompletionSettings, openai } from "aiclient";
import { PromptSection, Result, TypeChatJsonTranslator } from "typechat";

export function instantiate(): AppAgent {
    return {
        executeAction: executeGreetingAction,
        ...getCommandInterface(handlers),
    };
}

const personalizedGreetingSchema = `
// Use this action greet the user.
// Generate a five possible greetings and make sure they are varied in tone, length, cadence, delivery, and style.
// Make sure they don't sound similar and are appropriate for the time and day (i.e. Happy Friday, good evening, etc.).
// Some examples should borrow common greetings from languages other than English.
// Come up with a spontaneous greeting that conveys one of the following moods: friendly, enthusiastic, excited, polite, cheerful, happy, positive, welcoming, affectionate, warm, jovial, lively, energetic, radiant, or breezy.
// The goal is to create a warm and inviting atmosphere for the person you're greeting, so feel free to be creative and use your own style
export interface PersonalizedGreetingAction {
    actionName: "personalizedGreetingResponse";
    parameters: {
        // the original request/greeting from the user
        originalRequest: string;
        // a set possible generic greeting responses to the user
        possibleGreetings: GenericGreeting[];
    };
}

// A typical greeting
// Greetings can include some color commentary and or an initiator like "Wow, you're up late" or "I'm glad it's Friday"
export interface GenericGreeting {
    // The greeting response to the user such as "Top of the morning to ya!" or "Hey, how's it going?" or "What a nice day we're having, what's up!?" or "What are we going to do today?"
    // Be sure to make the greeting relevant to time of day (i.e. don't say good morning in the afternoon).
    // you can also use greetings such as Namaste/Shalom/Bonjour or smilar.
    generatedGreeting: string;
}`;

export class GreetingCommandHandler implements CommandHandlerNoParams {
    public readonly description =
        "Have the agent generate a personalized greeting.";
    private instructions = `You are a breezy greeting generator. Greetings should NOT end with questions.`;
    public async run(context: ActionContext) {
        //
        // Create Model
        //
        let chatModel = this.createModel(true);
        //
        // Create Chat History
        //
        let maxContextLength = 8196; // characters
        let maxWindowLength = 30;
        let chatHistory: PromptSection[] = [];

        const chat = createTypeChat<GreetingAction>(
            chatModel,
            personalizedGreetingSchema,
            "PersonalizedGreetingAction",
            this.instructions,
            chatHistory,
            maxContextLength,
            maxWindowLength,
        );

        const response = await this.getTypeChatResponse("Hi!", chat);

        if (response.success) {
            let result: ActionResultSuccess = handlePersonalizedGreetingAction(
                response.data as PersonalizedGreetingAction,
            ) as ActionResultSuccess;
            context.actionIO.setDisplay(result.literalText!);
        } else {
            context.actionIO.appendDisplay("Unable to generate greeting.");
        }
    }

    private createModel(fastModel: boolean = true): ChatModelWithStreaming {
        let apiSettings: openai.ApiSettings | undefined;
        if (!apiSettings) {
            if (fastModel) {
                apiSettings = openai.localOpenAIApiSettingsFromEnv(
                    openai.ModelType.Chat,
                    undefined,
                    "GPT_35_TURBO",
                    ["greeting"],
                );
            } else {
                // Create default model
                apiSettings = openai.apiSettingsFromEnv();
            }
        }
        let completionSettings: CompletionSettings = {
            temperature: 1.0,
            max_tokens: 1000, // Max response tokens
        };
        if (apiSettings?.supportsResponseFormat) {
            completionSettings.response_format = { type: "json_object" };
        }
        const chatModel = openai.createChatModel(
            apiSettings,
            completionSettings,
            undefined,
            ["greeting"],
        );

        return chatModel;
    }

    async getTypeChatResponse(
        userInput: string,
        chat: TypeChatJsonTranslator<GreetingAction>,
    ): Promise<Result<GreetingAction>> {
        const chatResponse = await chat.translate(
            userInput,
            promptLib.dateTimePrompt(), // Always include the current date and time. Makes the bot much smarter
        );

        return chatResponse;
    }
}

const handlers: CommandHandlerTable = {
    description: "Generate agent greeting.",
    defaultSubCommand: new GreetingCommandHandler(),
    commands: {},
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
    switch (action.actionName) {
        case "personalizedGreetingResponse": {
            return handlePersonalizedGreetingAction(
                action as PersonalizedGreetingAction,
            );
        }
        default:
            throw new Error(`Unknown action: ${action.actionName}`);
    }
}

function handlePersonalizedGreetingAction(
    greetingAction: PersonalizedGreetingAction,
): ActionResult {
    let result = createActionResult("Hi!");
    if (greetingAction.parameters !== undefined) {
        const count = greetingAction.parameters.possibleGreetings.length;
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
            greetingAction.parameters.possibleGreetings[randomInt(0, count)]
                .generatedGreeting,
        );
        // }
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
