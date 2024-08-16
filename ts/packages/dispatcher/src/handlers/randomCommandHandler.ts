// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { log } from "node:console";
import { CommandHandler, HandlerTable } from "./common/commandHandler.js";
import {
    CommandHandlerContext,
    updateCorrectionContext,
} from "./common/commandHandlerContext.js";
import { RequestAction, printProcessRequestActionResult } from "agent-cache";
import fs from "node:fs";
import { randomInt } from "crypto";
import { request } from "node:http";
import { processCommandNoLock } from "../command.js";
import { ChatModelWithStreaming, CompletionSettings, openai } from "aiclient";
import {
    MessageSourceRole,
    createTypeChat,
    getContextFromHistory,
    promptLib,
} from "typeagent";
import { PromptSection, Result, TypeChatJsonTranslator } from "typechat";

export type UserRequest = {
    // A request a user would make of an intelligent conversational computational interface.
    message: string;
};

const UserRequestSchema = `export type UserRequest = {
    // A request a user would make of an intelligent conversational computational interface.
    message: string;
};`;

class RandomOfflineCommandHandler implements CommandHandler {
    private list: string[] | undefined;

    public readonly description =
        "Issues a random request from a dataset of pre-generated requests.";

    public async run(request: string, context: CommandHandlerContext) {

        context.requestIO.status(
            `Selecting random request...`,
        );

        if (this.list == undefined) {
            this.list = await this.getRequests();
        }
        
        const randomRequest = this.list[randomInt(0, this.list.length)];
        
        context.requestIO.notify("randomCommandSelected", { message: randomRequest });
        
        await processCommandNoLock(randomRequest, context, context.requestId);
    }

    public async getRequests(): Promise<string[]> {
        
        if (fs.existsSync("../dispatcher/data/requests.txt")) {
            const content = await fs.promises.readFile("../dispatcher/data/requests.txt", "utf-8");
            return content.split("\n"); 
        }

        return new Array();
    }
}

class RandomOnlineCommandHandler implements CommandHandler {
    
    private instructions = "You are an AI assistant who helps the user";

    public readonly description =
        "Uses the LLM to generate a random request.";

    public async run(request: string, context: CommandHandlerContext) {

        context.requestIO.status(
            `Generating random request using LLM...`,
        );

        //
        // Create Model
        //
        let chatModel= this.createModel();
        //
        // Create Chat History
        //
        let maxContextLength = 8196; // characters
        let maxWindowLength = 30;
        let chatHistory: PromptSection[] = [];
        
        const chat = createTypeChat<UserRequest>(
            chatModel,
            UserRequestSchema,
            "UserRequest",
            this.instructions,
            chatHistory,
            maxContextLength,
            maxWindowLength,
            (data: UserRequest) => data.message, // Stringify responses for Chat History
        );

        const response = await this.getTypeChatResponse("Generate a random request a user would make of an AI system.", chat);

        if (response.success) {
            context.requestIO.notify("randomCommandSelected", { message: response.data.message });
        
            await processCommandNoLock(response.data.message, context, context.requestId);    
        } else {
            context.requestIO.error(response.message);
        }

    }

    async getTypeChatResponse(
        userInput: string,
        chat: TypeChatJsonTranslator<UserRequest>
    ): Promise<Result<UserRequest>> {

        const chatResponse = await chat.translate(
            userInput,
            promptLib.dateTimePrompt(), // Always include the current date and time. Makes the bot much smarter
        );
       
        return chatResponse;
    }

    private createModel(): ChatModelWithStreaming {
        let apiSettings: openai.ApiSettings | undefined;
        if (!apiSettings) {
            // Create default model
            apiSettings = openai.apiSettingsFromEnv();
        }
        let completionSettings: CompletionSettings = {
            temperature: 0.8,
            max_tokens: 1000, // Max response tokens
        };
        if (apiSettings.supportsResponseFormat) {
            completionSettings.response_format = { type: "json_object" };
        }
        const chatModel = openai.createChatModel(
            apiSettings,
            completionSettings,
        );

        return chatModel;
    }
}

export function getRandomCommandHandlers(): HandlerTable {
    return {
        description: "Random request commands",
        defaultCommand: new RandomOfflineCommandHandler(),
        commands: {
            online: new RandomOnlineCommandHandler(),
            offline: new RandomOfflineCommandHandler(),
        },
    };
}
