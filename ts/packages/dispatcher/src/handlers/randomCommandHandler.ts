// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CommandHandlerContext } from "./common/commandHandlerContext.js";
import fs from "node:fs";
import { randomInt } from "crypto";
import { processCommandNoLock } from "../command.js";
import { ChatModelWithStreaming, CompletionSettings, openai } from "aiclient";
import { createTypeChat, promptLib } from "typeagent";
import { PromptSection, Result, TypeChatJsonTranslator } from "typechat";
import { ActionContext, AppAgentEvent } from "@typeagent/agent-sdk";
import {
    CommandHandler,
    CommandHandlerTable,
} from "@typeagent/agent-sdk/helpers/commands";
import { displayStatus } from "./common/interactiveIO.js";

export type UserRequestList = {
    messages: UserRequest[];
};

export type UserRequest = {
    // A request a user would make of an intelligent conversational computational interface.
    message: string;
};

const UserRequestSchema = `export type UserRequestList = {
    messages: UserRequest[];
}

export type UserRequest = {
    // A request a user would make of an intelligent conversational computational interface.
    message: string;
};`;

class RandomOfflineCommandHandler implements CommandHandler {
    private list: string[] | undefined;

    public readonly description =
        "Issues a random request from a dataset of pre-generated requests.";

    public async run(
        request: string,
        context: ActionContext<CommandHandlerContext>,
    ) {
        displayStatus(`Selecting random request...`, context);

        if (this.list == undefined) {
            this.list = await this.getRequests();
        }

        const randomRequest = this.list[randomInt(0, this.list.length)];

        const systemContext = context.sessionContext.agentContext;
        systemContext.requestIO.notify(
            "randomCommandSelected",
            systemContext.requestId,
            {
                message: randomRequest,
            },
        );
        systemContext.requestIO.notify(
            AppAgentEvent.Info,
            systemContext.requestId,
            randomRequest,
        );

        await processCommandNoLock(randomRequest, systemContext);
    }

    public async getRequests(): Promise<string[]> {
        if (fs.existsSync("../dispatcher/data/requests.txt")) {
            const content = await fs.promises.readFile(
                "../dispatcher/data/requests.txt",
                "utf-8",
            );
            return content.split("\n");
        }

        return new Array();
    }
}

class RandomOnlineCommandHandler implements CommandHandler {
    private instructions = `You are an Siri/Alexa/Cortana prompt generator. You create user prompts that are both supported and unsupported.`;

    public readonly description = "Uses the LLM to generate random requests.";

    public async run(
        request: string,
        context: ActionContext<CommandHandlerContext>,
    ) {
        displayStatus(`Generating random request using LLM...`, context);

        //
        // Create Model
        //
        let chatModel = this.createModel();
        //
        // Create Chat History
        //
        let maxContextLength = 8196; // characters
        let maxWindowLength = 30;
        let chatHistory: PromptSection[] = [];

        const chat = createTypeChat<UserRequestList>(
            chatModel,
            UserRequestSchema,
            "UserRequestList",
            this.instructions,
            chatHistory,
            maxContextLength,
            maxWindowLength,
            (data: UserRequestList) => data.messages.toString(), // Stringify responses for Chat History
        );

        const response = await this.getTypeChatResponse(
            "Generate 10 random user requests.",
            chat,
        );

        if (response.success) {
            const message =
                response.data.messages[
                    randomInt(0, response.data.messages.length)
                ].message;

            const systemContext = context.sessionContext.agentContext;
            systemContext.requestIO.notify(
                "randomCommandSelected",
                systemContext.requestId,
                {
                    message: message,
                },
            );

            await processCommandNoLock(message, systemContext);
        } else {
            throw new Error(response.message);
        }
    }

    async getTypeChatResponse(
        userInput: string,
        chat: TypeChatJsonTranslator<UserRequestList>,
    ): Promise<Result<UserRequestList>> {
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
            temperature: 1.0,
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

export function getRandomCommandHandlers(): CommandHandlerTable {
    return {
        description: "Random request commands",
        defaultSubCommand: new RandomOfflineCommandHandler(),
        commands: {
            online: new RandomOnlineCommandHandler(),
            offline: new RandomOfflineCommandHandler(),
        },
    };
}
