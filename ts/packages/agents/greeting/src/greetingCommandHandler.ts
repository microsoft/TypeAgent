// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    AppAgent,
    ActionResult,
    ActionResultSuccess,
} from "@typeagent/agent-sdk";
import { createTypeChat } from "typeagent";
import { createActionResult } from "@typeagent/agent-sdk/helpers/action";
import { randomInt } from "node:crypto";
import {
    CommandHandlerNoParams,
    CommandHandlerTable,
    getCommandInterface,
} from "@typeagent/agent-sdk/helpers/command";
import { ChatModelWithStreaming, CompletionSettings, openai } from "aiclient";
import { PromptSection, Result } from "typechat";
import {
    displayError,
    displayResult,
    displayStatus,
} from "@typeagent/agent-sdk/helpers/display";
import {
    GreetingAction,
    PersonalizedGreetingAction,
} from "./greetingActionSchema.js";
import { conversation as Conversation } from "knowledge-processor";

export function instantiate(): AppAgent {
    return {
        ...getCommandInterface(handlers),
    };
}

const personalizedGreetingSchema = `

export type GreetingAction = PersonalizedGreetingAction;

// Use this action greet the user.
// Generate a three possible greetings and make sure they are varied in tone, length, cadence, delivery, and style.
// Make sure they don't sound similar and are appropriate for the time and day (i.e. Happy Friday, good evening, etc.).
// Some examples should borrow common greetings from languages other than English.
// Come up with a spontaneous greeting that conveys one of the following moods: friendly, enthusiastic, excited, polite, cheerful, happy, positive, welcoming, affectionate, warm, jovial, lively, energetic, radiant, or breezy.
// The goal is to create a warm and inviting atmosphere for the person you're greeting, so feel free to be creative and use your own style
// If there is chat history incorporate it into the greeting with a possible continuation action.
export interface PersonalizedGreetingAction {
    actionName: "personalizedGreetingAction";
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
    // you can also use greetings such as Namaste/Shalom/Bonjour or similar.
    generatedGreeting: string;
}

`;

/**
 * Implements the @greeting command.
 */
export class GreetingCommandHandler implements CommandHandlerNoParams {
    public readonly description =
        "Have the agent generate a personalized greeting.";
    private instructions = `You are a breezy greeting generator.`;

    /**
     * Handle the @greeting command
     *
     * @param context The command context.
     */
    public async run(context: ActionContext) {
        // Initial output to let the user know the agent is thinking...
        displayStatus("...", context);

        const response = await this.getTypeChatResponse(context);

        if (response.success) {
            context.actionIO.appendDiagnosticData(response.data);

            let action: GreetingAction = response.data as GreetingAction;
            let result: ActionResultSuccess | undefined = undefined;
            switch (action.actionName) {
                case "personalizedGreetingAction":
                    result = (await handlePersonalizedGreetingAction(
                        action as PersonalizedGreetingAction,
                        context,
                    )) as ActionResultSuccess;

                    displayResult(result.literalText!, context);
                    break;

                // case "contextualGreetingAction":

                //     result = await handleContextualGreetingAction(
                //         action as ContextualGreetingAction,
                //     ) as ActionResultSuccess;

                //     displayResult(result.literalText!, context);
                //     break;
            }
        } else {
            displayError("Unable to generate greeting.", context);
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
            // Max response tokens
            max_tokens: 1000,
            // createChatModel will remove it if the model doesn't support it
            response_format: { type: "json_object" },
        };
        const chatModel = openai.createChatModel(
            apiSettings,
            completionSettings,
            undefined,
            ["greeting"],
        );

        return chatModel;
    }

    async getTypeChatResponse(
        context: ActionContext,
    ): Promise<Result<GreetingAction>> {
        // Create Model instance
        let chatModel = this.createModel(true);

        // Create Chat History
        let maxContextLength = 8196;
        let maxWindowLength = 30;
        let chatHistory: PromptSection[] = [];

        // create TypeChat object
        const chat = createTypeChat<GreetingAction>(
            chatModel,
            personalizedGreetingSchema, //loadSchema(["greetingActionSchema.ts"]),
            "GreetingAction",
            this.instructions,
            chatHistory,
            maxContextLength,
            maxWindowLength,
        );

        // get chat history
        const history = await getRecentChatHistory(context);
        history.push("Hi!");
        history.push("###");
        history.push(
            `Current Date is ${new Date().toLocaleDateString("en-US")}. The time is ${new Date().toLocaleTimeString()}.`,
        );

        // make the request
        const chatResponse = await chat.translate(history.join("\n"));

        return chatResponse;
    }
}

/**
 * The commands this agent supports
 */
const handlers: CommandHandlerTable = {
    description: "Generate agent greeting.",
    defaultSubCommand: new GreetingCommandHandler(),
    commands: {},
};

async function handlePersonalizedGreetingAction(
    greetingAction: PersonalizedGreetingAction,
    context: ActionContext,
): Promise<ActionResult> {
    let result = createActionResult("Hi!");
    if (greetingAction.parameters !== undefined) {
        const count = greetingAction.parameters.possibleGreetings.length;
        console.log(`Received ${count} generated greetings`);

        // //randomly decide on a conversation starter (or not)
        // //TODO: personalize list based on user preferences
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
        result = createActionResult(
            greetingAction.parameters.possibleGreetings[randomInt(0, count)]
                .generatedGreeting,
        );
        // } else {
        //     result = createActionResult(
        //         greetingAction.parameters.possibleGreetings[randomInt(0, count)]
        //             .generatedGreeting,
        //     );
        // }
    }
    return result;
}

// function handleContextualGreetingAction(
//     greetingAction: ContextualGreetingAction,
// ): ActionResult {
//     let result = createActionResult("Hi!");
//     if (greetingAction.parameters !== undefined) {
//         result = createActionResult(greetingAction.parameters.greeting.generatedGreeting);
//     }
//     return result;
// }

// async function runLookup(
//     lookup: string,
//     actionContext: ActionContext,
//     settings: LookupSettings,
// ): Promise<string | undefined> {
//     const stopWatch = new StopWatch();
//     stopWatch.start("WEB SEARCH: " + lookup);
//     const urls: bing.WebPage[] = await bing.searchWeb(lookup, settings.maxSearchResults);
//     stopWatch.stop("WEB SEARCH: " + lookup);
//     if (!urls) {
//         return undefined;
//     }
//     const sUrls: string[] = [];
//     urls.map((wp) => { sUrls.push(wp.url); });

//     const answer = await generateAnswerFromWebPages(
//         settings.fastMode ? "Speed" : "Quality",
//         settings.answerGenModel,
//         sUrls,
//         lookup,
//         settings.lookupOptions,
//         1,
//         getLookupInstructions(),
//     );

//     return answer?.generatedText;
// }

async function getRecentChatHistory(context: ActionContext): Promise<string[]> {
    const conversationManager: Conversation.ConversationManager = (
        context.sessionContext as any
    ).conversationManager;

    const chatHistory: string[] = [];

    if (conversationManager !== undefined) {
        let searchResponse = await conversationManager.getSearchResponse(
            "What were we talking about last?",
            [{ terms: ["last conversation"] }],
        );
        if (searchResponse && searchResponse.response?.hasHits()) {
            chatHistory.push(
                "The following is a summary of the last conversation:",
            );
            chatHistory.push("###");
            chatHistory.push(
                "Recent entities found in chat history, in order, most recent first:",
            );
            searchResponse.response?.entities.map((ee) => {
                ee.entities?.map((e) => {
                    chatHistory.push(`${e.name} (${e.type})`);
                });
            });

            // chatHistory.push("###");
            // chatHistory.push("Information about the lastest assistant action.");
            // searchResponse.response?.actions?.map((aa) => {
            //     aa.actions?.map((a) => {
            //         a.
            //     });
            // });

            chatHistory.push("###");
            chatHistory.push("Here are the last few user messages:");
            searchResponse.response?.messages?.map((msg) => {
                chatHistory.push(`- \"${msg.value.value}\"`);
            });

            const matches =
                await conversationManager.generateAnswerForSearchResponse(
                    "What were we talking about last?",
                    searchResponse,
                );
            console.log(matches);
        }
    }

    return chatHistory;
}
