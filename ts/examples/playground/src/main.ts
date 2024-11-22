// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import dotenv from "dotenv";
import { ChatModelWithStreaming, CompletionSettings, openai } from "aiclient";
import {
    CommandHandler,
    InteractiveAppSettings,
    InteractiveIo,
    StopWatch,
    dispatchCommand,
    displayHelp,
    getArg,
    getBooleanArg,
    getNumberArg,
    runConsole,
} from "interactive-app";
import {
    MessageSourceRole,
    createTypeChat,
    getContextFromHistory,
    promptLib,
    lookupAnswersOnWeb,
    WebLookupAnswer,
} from "typeagent";
import { PromptSection } from "typechat";
import * as fs from "fs";

const envPath = new URL("../../../.env", import.meta.url);
dotenv.config({ path: envPath });

type ChatResponse = {
    message: string;
    // Lookup *facts* you don't know or if your facts are out of date.
    // E.g. stock prices, time sensitive data, etc
    // the search strings to look up on the user's behalf should be specific enough to return the correct information
    // it is recommended to include the same entities as in the user request
    lookups?: string[];
};
const ChatSchema = `export type ChatResponse = {
    message: string;
    // Lookup *facts* you don't know or if your facts are out of date.
    // E.g. stock prices, time sensitive data, etc
    // the search strings to look up on the user's behalf should be specific enough to return the correct information
    // it is recommended to include the same entities as in the user request
    lookups?: string[];
};`;

async function runPlayground(): Promise<void> {
    // Bot instructions
    let instructions = "You are an AI assistant who helps the user";
    //
    // Create Model
    //
    let [apiSettings, chatModel, completionSettings] = createModel(false);
    //
    // Create Chat History
    //
    let maxContextLength = 8196; // characters
    let maxWindowLength = 30;
    let chatHistory: PromptSection[] = [];
    //
    // Create TypeChat...
    // Actual chatting happens in calls to "nextChatTurn" below
    //
    let rawChatMode: boolean = false;
    let streamChatMode: boolean = false;
    const chat = createTypeChat<ChatResponse>(
        chatModel,
        ChatSchema,
        "ChatResponse",
        instructions,
        chatHistory,
        maxContextLength,
        maxWindowLength,
        (data: ChatResponse) => data.message, // Stringify responses for Chat History
    );
    //
    // Set up playground application
    //
    let playgroundCommands: Record<string, CommandHandler> = {
        clearHistory,
        history,
        saveHistory,
        loadHistory,
        temperature,
        rawMode,
        streamMode,
        help,
    };
    let interactiveApp: InteractiveAppSettings = {
        onStart: onStart,
        inputHandler: nextChatTurn,
        commandHandler: (cmdLine, io) =>
            dispatchCommand(cmdLine, playgroundCommands, io, true),
    };
    const stopWatch = new StopWatch();
    //
    // Run the bot in the chat console
    //
    await runConsole(interactiveApp);

    function onStart(io: InteractiveIo): void {
        printWelcome(io);
    }

    /**
     * Run the next chat turn.. respond to the user
     * @param userInput
     * @param io
     */
    async function nextChatTurn(
        userInput: string,
        io: InteractiveIo,
    ): Promise<void> {
        if (rawChatMode) {
            if (streamChatMode) {
                await getStreamResponse(userInput, io);
            } else {
                await getRawResponse(userInput, io);
            }
        } else {
            await getTypeChatResponse(userInput, io);
        }
    }

    async function getTypeChatResponse(
        userInput: string,
        io: InteractiveIo,
    ): Promise<void> {
        stopWatch.start();
        const chatResponse = await chat.translate(
            userInput,
            promptLib.dateTimePrompt(), // Always include the current date and time. Makes the bot much smarter
        );
        io.writer.writeLine();
        if (chatResponse.success) {
            const response = chatResponse.data;
            io.writer.writeLine(response.message);
            if (response.lookups && response.lookups.length > 0) {
                io.writer.writeLine(
                    `[Doing ${response.lookups.length} Lookups]`,
                );
                for (let i = 0; i < response.lookups.length; i++) {
                    io.writer.writeLine(
                        `\n[Lookup ${i + 1}: ${response.lookups[i]}]`,
                    );
                    const answer: WebLookupAnswer = await lookupAnswersOnWeb(
                        chatModel,
                        response.lookups[i],
                        5,
                        {
                            maxCharsPerChunk: 2000,
                            maxTextLengthToSearch: 10000,
                        },
                        undefined,
                        undefined,
                        (item, index, result) => true,
                    );
                    if (answer.answer.answer) {
                        io.writer.writeLine(
                            "\n" + answer.answer.answer.trimEnd(),
                        );
                    }
                }
            }
        } else {
            io.writer.writeLine(chatResponse.message);
        }
        stopWatch.stop(io);
        io.writer.writeLine();
    }

    async function getRawResponse(
        userInput: string,
        io: InteractiveIo,
    ): Promise<void> {
        const userMessage: PromptSection = {
            role: MessageSourceRole.user,
            content: userInput,
        };
        const context: PromptSection[] = [
            { role: "system", content: instructions },
            ...getContextFromHistory(
                chatHistory,
                maxContextLength,
                maxWindowLength,
            ),
            userMessage,
        ];
        const chatResponse = await chatModel.complete(context);
        if (chatResponse.success) {
            const responseText = chatResponse.data;
            io.writer.writeLine(responseText);
            chatHistory.push(userMessage);
            chatHistory.push({
                role: MessageSourceRole.assistant,
                content: responseText,
            });
        } else {
            io.writer.writeLine(chatResponse.message);
        }
    }

    async function getStreamResponse(userInput: string, io: InteractiveIo) {
        const userMessage: PromptSection = {
            role: MessageSourceRole.user,
            content: userInput,
        };
        const context: PromptSection[] = [
            { role: "system", content: instructions },
            ...getContextFromHistory(
                chatHistory,
                maxContextLength,
                maxWindowLength,
            ),
            userMessage,
        ];
        let responseText = "";
        stopWatch.start();
        let i = 0;
        const result = await chatModel.completeStream(context);
        if (result.success) {
            for await (const responseChunk of result.data) {
                if (i === 0) {
                    stopWatch.stop(io);
                    i++;
                }
                io.writer.write(responseChunk);
                responseText += responseChunk;
            }
            io.writer.writeLine();
            if (responseText) {
                chatHistory.push(userMessage);
                chatHistory.push({
                    role: MessageSourceRole.assistant,
                    content: responseText,
                });
            }
        } else {
            io.writer.writeLine(result.message);
        }
        stopWatch.stop(io);
        io.writer.writeLine();
    }

    function createModel(
        preferLocal: boolean,
    ): [openai.ApiSettings, ChatModelWithStreaming, CompletionSettings] {
        // First see if there is a local model
        let apiSettings: openai.ApiSettings | undefined;
        if (preferLocal) {
            apiSettings = openai.localOpenAIApiSettingsFromEnv(
                openai.ModelType.Chat,
                undefined,
                undefined,
                ["playground"],
            );
        }
        if (!apiSettings) {
            // Create default model
            apiSettings = openai.apiSettingsFromEnv();
        }
        let completionSettings: CompletionSettings = {
            temperature: 0.8,
            max_tokens: 1000, // Max response tokens
            response_format: { type: "json_object" }, // createChatModel will remove it if the model doesn't support it
        };
        const chatModel = openai.createChatModel(
            apiSettings,
            completionSettings,
            undefined,
            ["playground"],
        );

        return [apiSettings, chatModel, completionSettings];
    }

    //=============
    //
    // Inline Chat Commands
    //
    //=============

    async function help(args: string[], io: InteractiveIo): Promise<void> {
        displayHelp(args, playgroundCommands, io);
    }

    playgroundCommands.clearHistory.metadata = "Clear chat history";
    async function clearHistory(args: string[]): Promise<void> {
        // Clear chat history
        chatHistory.splice(0);
    }

    playgroundCommands.history.metadata = "Display chat history";
    async function history(args: string[], io: InteractiveIo): Promise<void> {
        for await (const section of chatHistory) {
            io.writer.writeLine(`\n${section.role}:\n ${section.content}`);
            io.writer.writeLine();
            io.writer.writeLine("------------------------");
        }
    }

    playgroundCommands.saveHistory.metadata = "Save chat history to a file";
    async function saveHistory(
        args: string[],
        io: InteractiveIo,
    ): Promise<void> {
        const json = JSON.stringify(chatHistory);
        await fs.promises.writeFile(getArg(args, 0), json);
    }

    playgroundCommands.loadHistory.metadata = "Load chat history from file";
    async function loadHistory(args: string[], io: InteractiveIo) {
        const json = await fs.promises.readFile(getArg(args, 0), "utf-8");
        const loadedHistory: PromptSection[] =
            json && json.length > 0 ? JSON.parse(json) : [];
        if (loadedHistory.length > 0) {
            chatHistory = loadedHistory;
        }
    }

    playgroundCommands.temperature.metadata =
        "Display or set the current temperature";
    async function temperature(
        args: string[],
        io: InteractiveIo,
    ): Promise<void> {
        if (args.length > 0) {
            completionSettings.temperature = getNumberArg(args, 0);
        }
        io.writer.writeLine("Temperature:");
        io.writer.writeLine(completionSettings.temperature ?? "0");
    }

    async function rawMode(args: string[], io: InteractiveIo) {
        if (args.length > 0) {
            rawChatMode = getBooleanArg(args, 0);
        }
        io.writer.writeLine(`Raw Chat: ${rawChatMode}`);
    }

    async function streamMode(args: string[], io: InteractiveIo) {
        if (args.length > 0) {
            streamChatMode = getBooleanArg(args, 0);
            rawChatMode = streamChatMode;
        }
        io.writer.writeLine(
            `Stream mode: ${streamChatMode}, RawChatMode: ${rawChatMode}`,
        );
    }

    function printWelcome(io: InteractiveIo): void {
        let modelName = apiSettings.modelName ?? apiSettings.endpoint;
        io.writer.writeLine(`💬 🛝\nWelcome to Interactive Chat Playground.\n`);
        io.writer.writeLine(`Model: ${modelName}`);
        io.writer.writeLine(
            `Max Context Length:${maxContextLength}\nMax Window Length: ${maxWindowLength}`,
        );
        io.writer.writeLine("@help for a list of available commands.");
        io.writer.writeLine();
        io.writer.writeLine(
            "To start, type something like 'hello' and hit Enter.",
        );
    }
}

await runPlayground();
