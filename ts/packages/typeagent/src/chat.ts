// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createJsonTranslator,
    TypeChatLanguageModel,
    TypeChatJsonTranslator,
    PromptSection,
    Result,
} from "typechat";
import { createTypeScriptJsonValidator } from "typechat/ts";
import {
    ChatHistory,
    createPromptBuilder,
    getContextFromHistory,
    getPreambleLength,
} from "./prompt.js";
import { MessageSourceRole } from "./message.js";
import { loadSchema } from "./schema.js";

/**
 * Simplest possible TypeChat with RAG.
 * Automatically includes history and instructions as context for translations
 * @param model
 * @param schema Schema of chat messages
 * @param typeName type of chat messages
 * @param instructions Chat instructions
 * @param history Chat history just an array of prompt sections. You supply the array, and you load/save/trim it appropriately
 * @param maxPromptLength maximum length of context in chars: chat history + instructions + schema
 * @param maxWindowLength (Optional) maximum number of past chat turns (user and assistant) - window - to include.
 * @param stringify Customize how T is translated to a string for pushing into memory
 */
export function createTypeChat<T extends object>(
    model: TypeChatLanguageModel,
    schema: string,
    typeName: string,
    instructions: string | string[],
    history: PromptSection[] | ChatHistory,
    maxPromptLength: number,
    maxWindowLength: number = Number.MAX_VALUE,
    stringify?: (value: T) => string,
): TypeChatJsonTranslator<T> {
    //
    // We use a standard typechat translator. But we override the translate method and
    // transparently inject context/history into every call
    //
    const translator = createChatTranslator<T>(model, schema, typeName);
    const translationFunction = translator.translate;
    translator.translate = translate;
    return translator;

    async function translate(
        request: string,
        promptPreamble?: string | PromptSection[],
    ): Promise<Result<T>> {
        const chatContext = buildContext(request, promptPreamble);
        const response = await translationFunction(request, chatContext);
        if (response.success) {
            // If translation was successful, save in chat history
            history.push({ role: MessageSourceRole.user, content: request });
            history.push({
                role: MessageSourceRole.assistant,
                content: stringify
                    ? stringify(response.data)
                    : JSON.stringify(response.data),
            });
        }
        return response;
    }

    //
    // Chat context consists of:
    // - Past message history, with newest messages first, upto a max
    // - Instructions
    // - Prompt preamble
    // - Schema (implicitly included in request)
    //
    function buildContext(
        request: string,
        promptPreamble?: string | PromptSection[],
    ): PromptSection[] {
        const availablePromptLength =
            maxPromptLength - (request.length + schema.length);
        const maxHistoryLength =
            availablePromptLength - getPreambleLength(promptPreamble);
        // Schema consumes token budget, but must be included...
        const promptBuilder = createPromptBuilder(availablePromptLength);

        promptBuilder.begin();
        promptBuilder.push(instructions);
        promptBuilder.pushSections(
            getContextFromHistory(history, maxHistoryLength, maxWindowLength),
        );
        if (promptPreamble) {
            promptBuilder.push(promptPreamble);
        }
        return promptBuilder.complete(false).sections;
    }
}

/**
 * Create a JSON translator designed to work for Chat
 * @param model language model to use
 * @param schema schema for the chat response
 * @param typeName typename of the chat response
 * @returns
 */
export function createChatTranslator<T extends object>(
    model: TypeChatLanguageModel,
    schema: string,
    typeName: string,
): TypeChatJsonTranslator<T> {
    const validator = createTypeScriptJsonValidator<T>(schema, typeName);
    const translator = createJsonTranslator<T>(model, validator);

    translator.createRequestPrompt = createRequestPrompt;
    return translator;

    function createRequestPrompt(request: string): string {
        return (
            `Your responses are represented as JSON objects of type "${typeName}" using the following TypeScript definitions:\n` +
            `\`\`\`\n${schema}\`\`\`\n` +
            `The following is a user request:\n` +
            `"""\n${request}\n"""\n` +
            `The following is your JSON response with 2 spaces of indentation and no properties with the value undefined:\n`
        );
    }
}

/**
 * Create a Json translator
 * @param model language model to use
 * @param schemaPaths schema files to use
 * @param baseUrl base Url from where to load schema files
 * @param typeName type name of the model response
 * @param createRequestPrompt (optional) customize the prompt
 * @returns
 */
export function createTranslator<T extends object>(
    model: TypeChatLanguageModel,
    schemaPaths: string[],
    baseUrl: string,
    typeName: string,
    createRequestPrompt?:
        | ((request: string, schema: string, typeName: string) => string)
        | undefined,
): TypeChatJsonTranslator<T> {
    const schema = loadSchema(schemaPaths, baseUrl);
    const validator = createTypeScriptJsonValidator<T>(schema, typeName);
    const translator = createJsonTranslator<T>(model, validator);
    if (createRequestPrompt) {
        translator.createRequestPrompt = (request) => {
            return createRequestPrompt(
                request,
                validator.getSchemaText(),
                validator.getTypeName(),
            );
        };
    }
    return translator;
}

export interface ChatUserInterface {
    showMessage(message: string): Promise<void>;
    askYesNo(message: string): Promise<boolean>;
    getInput(message: string): Promise<string | undefined>;
}
