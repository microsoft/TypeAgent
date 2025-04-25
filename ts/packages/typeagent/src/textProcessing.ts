// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Functions useful and/or typically used for processing text, with AI and code.
 * Text code be:
 *  - Arrays of strings
 *  - Text files
 *  - Large text and/or large text files
 */
import {
    PromptSection,
    Result,
    TypeChatJsonTranslator,
    TypeChatLanguageModel,
    getData,
    success,
} from "typechat";
import * as cheerio from "cheerio";
import { getHtml, bing, ChatModel, TextEmbeddingModel } from "aiclient";
import { createChatTranslator } from "./chat.js";
import { MessageSourceRole } from "./message.js";
import { TypeSchema } from "./schema.js";
import { readAllLines, readAllText, writeAllLines } from "./objStream.js";
import fs from "fs";
import { textToProcessSection } from "./promptLib.js";
import { ProcessProgress, mapAsync } from "./arrayAsync.js";
import { generateTextEmbeddings, similarity, SimilarityType } from "./index.js";

function splitIntoSentences(text: string): string[] {
    return text.split(/(?<=[.!?;\r\n])\s+/);
}

/**
 * Assumes that paragraphs end with 2+ LF or 2+ CRLF
 * @param text
 * @returns paragaphs
 */
export function splitIntoParagraphs(text: string): string[] {
    return text.split(/\r?\n\r?\n+/);
}

export function splitSentenceIntoPhrases(text: string): string[] {
    return text.split(/(?<=[,:\-])\s+/);
}

/**
 * Progress callback
 * @param text The text being processed
 * @param result The result of processing the text
 */
export type Progress<T> = (text: string, result: T) => void;

/**
 * Create a set from a list of strings
 * @param items
 * @param caseSensitive
 * @returns
 */
export function setFromList(
    items: string[],
    caseSensitive: boolean = false,
): Set<string> {
    return caseSensitive
        ? new Set(items)
        : new Set(items.map((v) => v.toLowerCase()));
}

/**
 * Yields a stream of distinct strings
 * @param strings
 * @param caseSensitive
 */
export function* distinctIterator(
    strings: Iterable<string>,
    caseSensitive: boolean = false,
): IterableIterator<string> {
    const seen = new Set<string>();
    for (const item of strings) {
        const key = caseSensitive ? item : item.toLowerCase();
        if (!seen.has(key)) {
            seen.add(key);
            yield item;
        }
    }
}

/**
 * Dedupe the given list of strings.
 * Returns items in the *original* order
 * @param list
 * @param caseSensitive
 */
export function dedupeList(
    list: string[],
    caseSensitive: boolean = false,
): string[] {
    const unique = new Set<string>();
    const deDuped: string[] = [];
    for (const item of list) {
        const key = caseSensitive ? item : item.toLowerCase();
        if (!unique.has(key)) {
            unique.add(key);
            deDuped.push(item);
        }
    }
    return deDuped;
}

/**
 * Dedupe a file of lines.
 * The file is updated in-place by default
 * @param filePath Source file
 * @param outputFilePath (optional) Output file path
 */
export async function dedupeLineFile(
    filePath: string,
    outputFilePath?: string,
    caseSensitive: boolean = false,
) {
    let lines = await readAllLines(filePath);
    lines = dedupeList(lines, caseSensitive);
    await writeAllLines(lines, outputFilePath ?? filePath);
}

/**
 * Join the given text files into a single file
 * @param sourceFiles
 * @param outputFilePath
 * @param separator
 */
export async function joinFiles(
    sourceFiles: string[],
    outputFilePath: string,
    separator: string = "\n",
) {
    for (let i = 0; i < sourceFiles.length; ++i) {
        const filePath = sourceFiles[i];
        let text = await readAllText(filePath);
        if (i > 0) {
            text = separator + text;
        }
        await fs.promises.appendFile(outputFilePath, text);
    }
}

/**
 * Join the items from strings into chunks, and yield each chunk.
 * Each chunk can have maxCharsPerChunk
 * Note: will not trim individual chunks that are longer than maxCharsPerChunk
 * @param strings source strings
 * @param maxCharsPerChunk max size of a chunk
 * @param separator optional, used like separator in string.'join'
 */
export function* buildChunks(
    strings: string[],
    maxCharsPerChunk: number,
    separator: string | undefined = " ",
): IterableIterator<string> {
    let chunk = "";
    for (let str of strings) {
        if (chunk.length + str.length > maxCharsPerChunk) {
            yield chunk;
            chunk = "";
        }
        if (separator) {
            chunk += separator;
        }
        chunk += str;
    }
    if (chunk.length > 0) {
        yield chunk;
    }
}

/**
 * Yield chunks of max size maxCharsPerChunk from text
 * @param text
 * @param maxCharsPerChunk maximum size of a chunk
 */
export function getTextChunks(
    text: string,
    maxCharsPerChunk: number,
    //chunkingStrategy: ChunkingStrategy = "Sentence",
): string[] {
    if (text.length <= maxCharsPerChunk) {
        return [text];
    }
    let subStrings = splitIntoSentences(text);
    if (subStrings.some((s) => s.length > maxCharsPerChunk)) {
        let phrases: string[] = [];
        for (const sentence of subStrings) {
            if (sentence.length > maxCharsPerChunk) {
                for (let i = 0; i < sentence.length; i += maxCharsPerChunk) {
                    phrases.push(sentence.slice(i, i + maxCharsPerChunk));
                }
            } else {
                phrases.push(sentence);
            }
        }
        subStrings = phrases;
    }
    return [...buildChunks(subStrings, maxCharsPerChunk)];
}

/**
 * Given some text whose length could exceed the token limit of a model, iteratively
 * transform it with the given model.
 * If text is too large, breaks text into chunks using a sentence level chunker
 * @param text
 * @param maxCharsPerChunk
 * @param model
 * @param instruction
 * @param progress
 * @returns
 */
export async function getCompletionOnLargeText(
    text: string,
    maxCharsPerChunk: number,
    model: TypeChatLanguageModel,
    instruction: string | ((chunk: string) => string),
    progress?: Progress<string>,
): Promise<Result<string[]>> {
    let completions: string[] = [];
    for (const chunk of getTextChunks(text, maxCharsPerChunk)) {
        const result = await complete(chunk);
        if (!result.success) {
            return result;
        }
        completions.push(result.data);
    }
    return success(completions);

    async function complete(request: string): Promise<Result<string>> {
        const prompt =
            typeof instruction === "string"
                ? instruction + request
                : instruction(request);
        const result = await model.complete(prompt);
        if (result.success && progress) {
            progress(request, result.data);
        }
        return result;
    }
}

/**
 * Json translate request, using 'text' as context. If the text is large, breaks
 * text into chunks and iteratively runs requests against each chunk
 * @param translator
 * @param request User request
 * @param text Full text to break into chunks and use as context for each request
 * @param maxCharsPerChunk
 * @returns
 */
export async function* jsonTranslateLargeText<T extends object>(
    translator: TypeChatJsonTranslator<T>,
    request: string,
    text: string,
    maxCharsPerChunk: number,
): AsyncIterableIterator<[string, Result<T>]> {
    const chunks = getTextChunks(text, maxCharsPerChunk);
    for (const chunk of chunks) {
        const result = await translator.translate(request, chunk);
        yield [chunk, result];
    }
}

/**
 * Json translate request, using text from the web page as context. If the text is large, breaks
 * text into chunks and iteratively runs requests against each chunk
 * @param translator
 * @param request User request
 * @param text Full text to break into chunks and use as context for each request
 * @param maxCharsPerChunk
 * @returns
 */
export async function* jsonTranslateWebPage<T extends object>(
    translator: TypeChatJsonTranslator<T>,
    request: string,
    webPageUrl: string,
    maxChunkSize: number,
    progress?: Progress<Result<T>>,
): AsyncIterableIterator<[string, Result<T>]> {
    const htmlResponse = await getHtml(webPageUrl);
    if (!htmlResponse.success) {
        return undefined;
    }

    const html = htmlResponse.data;
    const text = htmlToText(html);
    for await (const result of jsonTranslateLargeText(
        translator,
        request,
        text,
        maxChunkSize,
    )) {
        yield result;
    }
}

const notesInstruction =
    "Generate very concise, bullet point notes for the following:\n";

/**
 * Generate bullet point notes for the given text
 * @param text
 * @param maxCharsPerChunk for long text, send no more than these many chars at a time
 * @param model model to use to generate notes
 * @param progress
 * @returns
 */
export function generateNotes(
    text: string,
    maxCharsPerChunk: number,
    model: TypeChatLanguageModel,
    progress?: Progress<string>,
): Promise<Result<string[]>> {
    return getCompletionOnLargeText(
        text,
        maxCharsPerChunk - notesInstruction.length,
        model,
        notesInstruction,
        progress,
    );
}

// duplicate type due to circular dependency
export interface Entity {
    // the name of the entity such as "Bach" or "frog"
    name: string;
    // the types of the entity such as "artist" or "animal"; an entity can have multiple types; entity types should be single words
    type: string[];
}

export interface ChunkChatResponse {
    // use "NotAnswered" if the information is not relevant to the user's question
    answerStatus: "Answered" | "NotAnswered" | "PartiallyAnswered";
    // the generated text to show the user if the provided information can be used to answer the user's question
    generatedText?: string;
    // all entities present in the generated text
    entities: Entity[];
    // the urls of the web pages that were used to generate the response
    urls?: string[];
}

export function accumulateAnswer(
    answer: ChunkChatResponse,
    chunkResponse: ChunkChatResponse,
    url?: string,
): ChunkChatResponse {
    // If fully answered the question...
    if (chunkResponse.answerStatus === "Answered") {
        if (url) {
            chunkResponse.urls = [url];
        }
        return chunkResponse;
    }

    if (chunkResponse.answerStatus === "PartiallyAnswered") {
        answer.generatedText += chunkResponse.generatedText ?? "";
        answer.answerStatus = "PartiallyAnswered";
        if (chunkResponse.entities) {
            answer.entities ??= [];
            answer.entities.push(...chunkResponse.entities);
        }
        answer.urls ??= [];
        if (url) {
            if (!answer.urls.includes(url)) {
                answer.urls.push(url);
            }
        }
    }
    return answer;
}

/**
 * Generate an answer for request from information in the given text. If the text is too big, iteratively
 * process the text in chunks of maxCharsPerChunk
 * @param request Question
 * @param text Text which may contain answer for question.
 * @param maxCharsPerChunk max size of each chunk
 * @param model model to use
 * @param concurrency generation concurrency.
 * @param progress generation progress
 * @returns
 */
export function generateAnswer(
    request: string,
    text: string,
    maxCharsPerChunk: number,
    model: TypeChatLanguageModel,
    concurrency: number,
    progress?: Progress<ChunkChatResponse>,
): Promise<Result<string | ChunkChatResponse>> {
    const preInstruction = `
    You are a service that translates user information requests into JSON objects of type "ChunkChatResponse" according to the following TypeScript definition:
    export interface Entity {
        // the name of the entity such as "Bach" or "frog"
        name: string;
        // the types of the entity such as "artist" or "animal"; an entity can have multiple types; entity types should be single words
        type: string[];
    }
    interface ChunkChatResponse {
        // use "NotAnswered" if the information is not highly relevant to the user's question
        answerStatus: "Answered" | "NotAnswered" | "PartiallyAnswered";
        // the generated text to show the user if the provided information is highly relevant and can be used to answer the user's question
        generatedText?: string;
        // all entities present in your generated text (empty array if no entities are present)
        entities: Entity[];
    }
    The following is a user information request: ${request}
    Here is some information from the web that may be relevant:
`;
    const postInstruction = `The following is the user request translated into a JSON object with 2 spaces of indentation and no properties with the value undefined:
`;
    const charsPerchunk =
        maxCharsPerChunk - (preInstruction.length + postInstruction.length + 1);
    return incrCompletionOnLargeText(
        text,
        charsPerchunk,
        model,
        preInstruction,
        postInstruction,
        concurrency,
        progress,
    );

    async function incrCompletionOnLargeText(
        text: string,
        maxCharsPerChunk: number,
        model: TypeChatLanguageModel,
        preInstruction: string,
        postInstruction: string,
        concurrency: number,
        progress?: Progress<ChunkChatResponse>,
    ): Promise<Result<string | ChunkChatResponse>> {
        let answer = {
            generatedText: "",
            entities: [],
            answerStatus: "NotAnswered",
        } as ChunkChatResponse;
        //
        // First, split text into chunks at sentence boundaries
        //
        let chunks = getTextChunks(text, maxCharsPerChunk);
        for (let i = 0; i < chunks.length; i += concurrency) {
            //
            // Then run concurrency number of chunks simultaneously
            //
            const chunkSlice = chunks.slice(i, i + concurrency);
            await Promise.all(chunkSlice.map((c) => runChunk(c)));
            if (progress) {
                progress(text, answer);
            }
            if (answer.answerStatus === "Answered") {
                return success(answer);
            }
        }
        return success(answer);

        async function runChunk(chunk: string): Promise<void> {
            const response = await complete(chunk);
            const chunkResponse = parseResponse(response);
            if (chunkResponse && chunkResponse.answerStatus !== "NotAnswered") {
                answer = accumulateAnswer(answer, chunkResponse);
            }
        }

        async function complete(text: string): Promise<string> {
            const prompt = preInstruction + text + "\n" + postInstruction;
            const result = await model.complete(prompt);
            return result.success ? result.data : "";
        }

        function parseResponse(
            response: string,
        ): ChunkChatResponse | undefined {
            if (response) {
                try {
                    return JSON.parse(response) as ChunkChatResponse;
                } catch {}
            }
            return undefined;
        }
    }
}

/**
 * Fetches HTML from a Url, extracts text from it and
 * @param model
 * @param webPageUrl
 * @param instruction Instruction can be a string, or a call back that can emit the instruction on the fly
 * @param maxChunkSize
 * @param maxTextLengthToSearch Maximum amount of text in a single web page to search. Assumes, if an answer is not found in first N chars, probably won't be
 * @param concurrency How many requests to run concurrently?
 * @param progress
 * @returns
 */
export async function generateAnswerFromWebPage(
    model: TypeChatLanguageModel,
    webPageUrl: string,
    request: string,
    maxChunkSize: number,
    maxTextLengthToSearch: number = Number.MAX_SAFE_INTEGER,
    concurrency: number,
    progress?: Progress<ChunkChatResponse>,
): Promise<ChunkChatResponse | undefined> {
    const htmlResponse = await getHtml(webPageUrl);
    if (!htmlResponse.success) {
        return undefined;
    }

    const html = htmlResponse.data;
    let text = htmlToText(html);
    if (text.length > maxTextLengthToSearch) {
        text = text.substring(0, maxTextLengthToSearch);
    }
    const answer = await generateAnswer(
        request,
        text,
        maxChunkSize,
        model,
        concurrency,
        progress,
    );
    if (answer.success) {
        return answer.data as ChunkChatResponse;
    }
    return undefined;
}

/**
 * Fetches a set of web pages and attempts to get an answer to request from them
 * @param optimizeFor Use Speed for non-GPT4 models. Speed will not emit Entities
 * @param model model to use for generating answers
 * @param webPageUrls urls of pages to retrieve
 * @param request question for which to get answers
 * @param options Lookup options
 * @param concurrency Parallel processing for an individual page
 * @param progress Callback... as the search runs
 * @returns
 */
export async function generateAnswerFromWebPages(
    optimizeFor: "Speed" | "Quality",
    model: TypeChatLanguageModel,
    webPageUrls: string[],
    request: string,
    options: LookupOptions,
    concurrency: number,
    context?: PromptSection[],
    progress?: Progress<ChunkChatResponse>,
): Promise<ChunkChatResponse | undefined> {
    let answer: ChunkChatResponse = {
        generatedText: "",
        entities: [],
        urls: [],
        answerStatus: "NotAnswered",
    };
    for (const webPageUrl of webPageUrls) {
        if (progress) {
            progress(webPageUrl, answer);
        }
        // We will eventually deprecate "Quality" mode, which also does entity extraction inline
        // But we will leave the code in place to allow us to experiment back and forth
        if (optimizeFor === "Quality") {
            const pageAnswer = await generateAnswerFromWebPage(
                model,
                webPageUrl,
                request,
                options.maxCharsPerChunk,
                options.maxTextLengthToSearch,
                concurrency,
                (_, answerChunk) => {
                    answer = accumulateAnswer(answer, answerChunk, webPageUrl);
                    if (progress) {
                        progress(webPageUrl, answer);
                    }
                },
            );
            if (pageAnswer) {
                answer = accumulateAnswer(answer, pageAnswer, webPageUrl);
            }
        } else {
            const pageAnswer = await lookupAnswerOnWebPage(
                model,
                { query: request, webPageUrl },
                options,
                concurrency,
                context,
                (lookup, i, answerResponse) => {
                    answer = accumulateAnswer(
                        answer,
                        toChunkResponse(answerResponse),
                        webPageUrl,
                    );
                    if (progress) {
                        progress(webPageUrl, answer);
                    }
                },
            );
            answer = accumulateAnswer(
                answer,
                toChunkResponse(pageAnswer),
                webPageUrl,
            );
        }
        if (
            answer.answerStatus === "Answered" ||
            (!options.deepSearch && answer.answerStatus === "PartiallyAnswered")
        ) {
            break;
        }
    }

    // Quality mode does not rewrite partial answers automatically
    if (
        options.rewriteForReadability &&
        optimizeFor === "Quality" &&
        answer.generatedText
    ) {
        await rewritePartialAnswer(
            options.rewriteModel ?? model,
            request,
            answer,
            options.rewriteFocus,
        );
    }
    return answer;

    function toChunkResponse(answer: AnswerResponse): ChunkChatResponse {
        let response: ChunkChatResponse = {
            generatedText: answer.answer ?? "",
            entities: [],
            urls: [],
            answerStatus: "NotAnswered",
        };
        if (answer.type === "FullAnswer") {
            response.answerStatus = "Answered";
        } else if (answer.type === "PartialAnswer") {
            response.answerStatus = "PartiallyAnswered";
        }
        return response;
    }

    async function rewritePartialAnswer(
        rewriteModel: TypeChatLanguageModel,
        lookup: string,
        answer: ChunkChatResponse,
        focus?: string,
    ): Promise<void> {
        if (answer.generatedText) {
            const rewritten = await rewriteText(
                rewriteModel,
                answer.generatedText,
                lookup,
                focus,
            );
            if (rewritten) {
                answer.generatedText = rewritten;
                answer.answerStatus = "Answered";
            }
        }
    }
}

export type AnswerRelevance =
    | "NoAnswer" // Query was NOT answered
    | "PartialAnswer" // Query partially answered
    | "FullAnswer"; // Fully answer question
export type AnswerResponse = {
    // use "NoAnswer" if the information is not highly relevant to the user's question
    type: AnswerRelevance;
    // the answer to display if the provided information is highly relevant and can be used to answer the user's question
    answer?: string;
};

/**
 * Answer the given query from the provided text
 * @param model
 * @param query
 * @param text
 * @returns
 */
export function answerQuery(
    model: TypeChatLanguageModel,
    query: string,
    text: string,
    context?: PromptSection[],
): Promise<Result<AnswerResponse>> {
    const answerSchema = `
    export type AnswerRelevance =
    | "NoAnswer" // Use when question was NOT answered because included information is NOT relevant to the query
    | "PartialAnswer" // partially answered
    | "FullAnswer"; // ONLY USE IF full answer

    export type AnswerResponse = {
        // Place answer (if any) here. Else empty
        answer?: string;
        // Rate the answer above based on its relevance  
        type: AnswerRelevance;
    };`;
    const request =
        `Answer the following question ACCURATELY using  ONLY HIGHLY RELEVANT information - if any - from the chat history, using information verbatim when suitable.` +
        `###\n${query}\n###\n`;
    const translator = createChatTranslator<AnswerResponse>(
        model,
        answerSchema,
        "AnswerResponse",
    );
    if (context && context.length > 0) {
        return translator.translate(request, [
            ...context,
            { role: MessageSourceRole.user, content: text },
        ]);
    }
    return translator.translate(request, text);
}

/**
 * Simple, but works great with GPT_35_Turbo
 * @param model
 * @param question
 * @param text
 * @param maxCharsPerChunk
 */
export async function answerQueryFromLargeText(
    model: TypeChatLanguageModel,
    query: string,
    text: string,
    maxCharsPerChunk: number,
    concurrency: number = 2,
    rewriteForReadability: boolean,
    rewriteFocus?: string | undefined,
    context?: PromptSection[],
    progress?: ProcessProgress<string, AnswerResponse>,
): Promise<AnswerResponse> {
    const chunks = getTextChunks(text, maxCharsPerChunk);
    console.log(`Anser Query processing ${chunks.length} text chunks.`);
    const chunkAnswers = await mapAsync(
        chunks,
        concurrency,
        (chunk) => runChunk(model, query, chunk),
        chunkProgress,
    );
    console.log(`Processed ${chunkAnswers.length} chunk answers.`);
    // First, see if we got a full answer
    let answer = emptyAnswer();
    for (const chunkAnswer of chunkAnswers) {
        answer = accumulateAnswer(answer, chunkAnswer, "FullAnswer");
    }
    if (answer.type === "NoAnswer") {
        // Accumulate any partial answers
        for (const chunkAnswer of chunkAnswers) {
            answer = accumulateAnswer(answer, chunkAnswer, "PartialAnswer");
        }
    }

    if (rewriteForReadability && answer.type !== "NoAnswer" && answer.answer) {
        const rewritten = await rewriteText(
            model,
            answer.answer,
            query,
            rewriteFocus,
        );
        if (rewritten) {
            answer.answer = rewritten;
            answer.type = "FullAnswer";
        }
    }

    console.log(`Answer Type: ${answer.type}`);

    return answer;

    async function runChunk(
        model: TypeChatLanguageModel,
        query: string,
        chunk: string,
    ): Promise<AnswerResponse> {
        const result = await answerQuery(model, query, chunk, context);
        if (result.success) {
            return result.data;
        }
        return emptyAnswer();
    }

    function chunkProgress(
        chunk: string,
        index: number,
        chunkResponse: AnswerResponse,
    ): boolean {
        if (progress) {
            // Notify progress
            progress(chunk, index, chunkResponse);
        }
        // By default, return false if FullAnswer found. This will stop any loops
        return !(chunkResponse.type === "FullAnswer");
    }

    function accumulateAnswer(
        answer: AnswerResponse,
        latestAnswer: AnswerResponse,
        answerType: AnswerRelevance,
    ): AnswerResponse {
        if (latestAnswer.type === answerType) {
            answer.answer += latestAnswer.answer ?? "";
            answer.type = latestAnswer.type;
        }
        return answer;
    }
}

function emptyAnswer(): AnswerResponse {
    return {
        type: "NoAnswer",
        answer: "",
    };
}

export type WebLookup = {
    query: string; // query to run...
    webPageUrl: string; // .. on the text of this web page
};

export type LookupOptions = {
    maxCharsPerChunk: number; // Max size of text chunk to send to the model
    maxTextLengthToSearch: number; // Maximum text on a web page to look at
    deepSearch?: boolean; // Search all matching web pages. Slow
    rewriteForReadability?: boolean; // Rewrite raw answers for readability
    rewriteModel?: ChatModel;
    rewriteFocus?: string | undefined; // What to focus on during rewrite
};

/**
 * Try to answer a query from the text downloaded from the provided web page url
 * @param model
 * @param lookup
 * @param maxCharsPerChunk
 * @returns
 */
export async function lookupAnswerOnWebPage(
    model: TypeChatLanguageModel,
    lookup: WebLookup,
    options: LookupOptions,
    concurrency: number = 2,
    context?: PromptSection[],
    progress?: ProcessProgress<WebLookup, AnswerResponse>,
): Promise<AnswerResponse> {
    const defaultAnswer = emptyAnswer();
    const htmlResponse = await getHtml(lookup.webPageUrl);
    if (!htmlResponse.success) {
        return defaultAnswer;
    }
    const html = htmlResponse.data;
    let text = htmlToText(html);
    if (text.length > options.maxTextLengthToSearch) {
        text = text.substring(0, options.maxTextLengthToSearch);
    }
    return await answerQueryFromLargeText(
        model,
        lookup.query,
        text,
        options.maxCharsPerChunk,
        concurrency,
        options.rewriteForReadability ?? true,
        options.rewriteFocus,
        context,
        (chunk, index, answer) => {
            if (progress) {
                return progress(lookup, index, answer);
            }
            return true;
        },
    );
}

export type WebLookupAnswer = {
    answer: AnswerResponse;
    // Urls of pages used to answer the question
    webPageUrls: string[];
};

/**
 * Find an answer for the given query from the text of web pages whose urls is provided
 * @param model
 * @param webPageUrls
 * @param query
 * @param options
 * @param concurrency
 * @param progress
 * @returns
 */
export async function lookupAnswersOnWebPages(
    model: TypeChatLanguageModel,
    query: string,
    webPageUrls: string[],
    options: LookupOptions,
    concurrency: number = 2,
    context?: PromptSection[],
    progress?: ProcessProgress<WebLookup, AnswerResponse>,
): Promise<WebLookupAnswer> {
    let partialAnswer: WebLookupAnswer = emptyWebLookupAnswer();
    for (const webPageUrl of webPageUrls) {
        let lookup: WebLookup = { query, webPageUrl };
        const answer = await lookupAnswerOnWebPage(
            model,
            lookup,
            options,
            concurrency,
            context,
            progress,
        );
        if (answer.type === "FullAnswer") {
            // We found a complete answer. Done
            return { webPageUrls: [webPageUrl], answer };
        }
        if (answer.type === "PartialAnswer") {
            partialAnswer.webPageUrls.push(webPageUrl);
            partialAnswer.answer.type = answer.type;
            partialAnswer.answer.answer += answer.answer ?? "";
            if (!options.deepSearch) {
                // Found partial answers on a page. And we are not doing a deep search, so
                // that is good enough
                break;
            }
        }
    }
    return partialAnswer;
}

/**
 * lookupAnswersOnWeb answers a question using information from the Internet
 * - Takes a model and a query..
 * - Searches the web using Bing
 * - Takes the top K matches, fetches the HTML for each one, extracts text
 * - Runs through the text chunk by chunk... passing each chunk to the LLM
 * - If a chunk answered the question (fully or partially), collects the answer
 * - Collects up all the sub-answers, then rewrites them into a more cogent response, also using the LLM.
 * @param model Language model to use
 * @param query The query for which we should get an answer
 * @param maxSearchResults maximum search results to get from Bing. This impacts how many web pages we look at
 * @param options
 * @param concurrency
 * @param context
 * @param progress
 * @returns
 */
export async function lookupAnswersOnWeb(
    model: TypeChatLanguageModel,
    query: string,
    maxSearchResults: number,
    options: LookupOptions,
    concurrency: number = 2,
    context?: PromptSection[],
    progress?: ProcessProgress<WebLookup, AnswerResponse>,
): Promise<WebLookupAnswer> {
    const searchClientResult = await bing.createBingSearch();
    if (!searchClientResult.success) {
        return emptyWebLookupAnswer();
    }
    const search = searchClientResult.data;
    const searchResults = await search.webSearch(query, {
        count: maxSearchResults,
    });
    if (!searchResults.success) {
        return emptyWebLookupAnswer();
    }
    const urls = searchResults.data.map((searchResult) => searchResult.url);
    const lookupAnswer = await lookupAnswersOnWebPages(
        model,
        query,
        urls,
        options,
        concurrency,
        context,
        progress,
    );
    return lookupAnswer;
}

function emptyWebLookupAnswer(): WebLookupAnswer {
    return {
        webPageUrls: [],
        answer: emptyAnswer(),
    };
}

export type EntityResponse = {
    // Use entities when could not extract entities
    type: "Success" | "NoEntities";
    entities?: Entity[];
};

/**
 * Extract entities from the given text
 * @param model
 * @param text
 * @returns
 */
export async function extractEntities(
    model: TypeChatLanguageModel,
    text: string,
): Promise<Entity[]> {
    const request = "Extract entities from included [TEXT SECTION]";
    const entitySchema = `
    export type EntityResponse = {
        // Use entities when could not extract entities
        type: "Success" | "NoEntities";
        entities?: Entity[];
    };    
    export interface Entity {
        // the name of the entity such as "Bach" or "frog"
        name: string;
        // the types of the entity such as "artist" or "animal"; an entity can have multiple types; entity types should be single words
        type: string[];
    }
`;
    const translator = createChatTranslator<EntityResponse>(
        model,
        entitySchema,
        "EntityResponse",
    );
    const result = await translator.translate(request, [
        textToProcessSection(text),
    ]);

    if (!result.success) {
        return [];
    }

    const entities =
        result.data.type === "NoEntities" ? undefined : result.data.entities;
    return entities ?? [];
}

export async function extractEntitiesFromLargeText(
    model: TypeChatLanguageModel,
    text: string,
    maxCharsPerChunk: number,
    concurrency: number,
): Promise<Entity[]> {
    const chunks = await getTextChunks(text, maxCharsPerChunk);
    const entityChunks = await mapAsync(chunks, concurrency, (chunk) =>
        extractEntities(model, chunk),
    );
    const entities: Entity[] = [];
    for (const entityChunk of entityChunks) {
        entities.push(...entityChunk);
    }
    return entities;
}

/**
 * Extract all text from the given html.
 * @param html raw html
 * @param nodeQuery A JQuery like list of node types to extract text from. By default, p, div and span
 * @returns text
 */
export function htmlToText(html: string, nodeQuery?: string): string {
    //nodeQuery ??= "*:not(iframe, script, style, noscript)"; // "body, p, div, span, li, tr, td, h1, h2, h3, h4, h5, h6, a";
    nodeQuery ??=
        "a, p, div, span, em, strong, li, tr, td, h1, h2, h3, h4, h5, h6, article, section, header, footer";
    const $ = cheerio.load(html);
    const query = $(nodeQuery);
    return query
        .contents()
        .filter(function () {
            return (
                this.nodeType === 3 ||
                (this.nodeType === 1 && this.name === "a")
            );
        })
        .map(function () {
            return $(this).text().trim();
        })
        .filter(function () {
            return this.length > 0;
        })
        .get()
        .join(" ");
}

/**
 * Fetches HTML from a Url, extracts text from it. Then sends the text to a language model for processing
 * along with instructions you supply. If the text is too long, does so in chunks
 * @param model
 * @param webPageUrl
 * @param instruction Instruction can be a string, or a call back that can emit the instruction on the fly
 * @param maxChunkSize
 * @param progress
 * @returns
 */
export async function processTextFromWebPage(
    model: TypeChatLanguageModel,
    webPageUrl: string,
    instruction: string | ((chunk: string) => string),
    maxChunkSize: number,
    progress?: Progress<string>,
): Promise<string | undefined> {
    const htmlResponse = await getHtml(webPageUrl);
    if (!htmlResponse.success) {
        return undefined;
    }

    const html = htmlResponse.data;
    const text = htmlToText(html);
    const summary = await getCompletionOnLargeText(
        text,
        maxChunkSize,
        model,
        instruction,
        progress,
    );
    if (summary.success) {
        return summary.data.join("\n");
    }
    return undefined;
}

/**
 * Generate notes for the given web page
 * @param model
 * @param webPageUrl
 * @param instruction
 * @param maxChunkSize
 * @param progress
 */
export async function generateNotesForWebPage(
    model: TypeChatLanguageModel,
    webPageUrl: string,
    maxChunkSize: number,
    progress?: Progress<string>,
): Promise<string | undefined> {
    return processTextFromWebPage(
        model,
        webPageUrl,
        notesInstruction,
        maxChunkSize,
        progress,
    );
}

const summarizeInstruction = "Summarize the given text";

/**
 * Summarize the given text
 * @param model model to use to generate notes
 * @param text
 * @param maxCharsPerChunk for long text, send no more than these many chars at a time
 * @param progress
 * @returns
 */
export function summarize(
    model: TypeChatLanguageModel,
    text: string,
    maxCharsPerChunk: number,
    progress?: Progress<string>,
): Promise<Result<string[]>> {
    return getCompletionOnLargeText(
        text,
        maxCharsPerChunk - notesInstruction.length,
        model,
        summarizeInstruction,
        progress,
    );
}

/**
 * Summarize a web page
 * @param model
 * @param webPageUrl
 * @param maxChunkSize
 * @param progress
 * @returns
 */
export async function summarizeWebPage(
    model: TypeChatLanguageModel,
    webPageUrl: string,
    maxChunkSize: number,
    progress?: Progress<string>,
): Promise<string | undefined> {
    return processTextFromWebPage(
        model,
        webPageUrl,
        summarizeInstruction,
        maxChunkSize,
        progress,
    );
}

/**
 * Useful for rewriting text to be more readable, concise, and non-redundant
 * @param model
 * @param text
 * @param question
 * @returns
 */
export async function rewriteText(
    model: TypeChatLanguageModel,
    text: string,
    question?: string,
    rewriteFocus?: string,
): Promise<string | undefined> {
    let prompt = question
        ? `The following text answers the QUESTION "${question}". Rewrite it to `
        : "Rewrite the following text to ";
    if (rewriteFocus) {
        prompt += rewriteFocus;
    } else {
        prompt +=
            "make it more readable, with better formatting (line breaks, bullet points etc).";
    }
    prompt +=
        "\n Remove all redundancy, duplication, contradiction, or anything that does not answer the question.";
    prompt += `\n"""\n${text}\n"""\n`;
    const result = await model.complete(prompt);
    if (result.success) {
        return result.data;
    }

    return undefined;
}

/**
 * Generate lists as per the given list definition
 * @param model model to use
 * @param listDefinition list definition
 * @param itemCount (optional) number of items to return
 * @returns A list OR an empty array if the list could not be generated
 */
export async function generateList(
    model: TypeChatLanguageModel,
    listDefinition: string,
    context: PromptSection[] | undefined,
    itemCount?: number,
): Promise<string[]> {
    type GenerateListResponse = ListResponse | NotHandled;
    type ListResponse = {
        type: "list";
        list: string[];
    };
    type NotHandled = {
        type: "notHandled";
        message: string;
    };
    const GenerateListResponseSchema = `export type GenerateListResponse = ListResponse | NotHandled;
export type ListResponse = {
    type: "list";
    list: string[];
};
// Use if cannot return a list
export type NotHandled = {
    type: "notHandled";
    message: string;
};
`;
    const request =
        itemCount && itemCount > 0
            ? `Return a list of ${itemCount} items according to the following list definition:\n###\n${listDefinition}\n###`
            : `Return a list of items according to the following list definition:\n###\n${listDefinition}\n###`;
    const translator = createChatTranslator<GenerateListResponse>(
        model,
        GenerateListResponseSchema,
        "GenerateListResponse",
    );
    const result = await translator.translate(request, context);
    const response = getData(result);
    return response.type === "list" ? response.list : [];
}

/**
 * Typical variations
 */
export type VariationType =
    | "variations"
    | "alternatives"
    | "synonyms"
    | "antonyms"
    | "similar"
    | "canonical"
    | "typical variations"
    | "common variations"
    | "likely"
    | "unlikely"
    | "most likely"
    | "most unlikely";

export interface VariationSettings {
    type: VariationType | string;
    count: number;
    /**
     * (Optional) Variations must be translatable to this schema
     */
    schema?: TypeSchema | undefined;
    /**
     * Hints on how to generate the variations
     */
    hints?: string | undefined;
    /**
     * Facets to vary
     */
    facets: string | undefined;
}

/**
 * Generate variations on a seed phrase
 * @param model
 * @param seedPhrase
 * @param settings
 * @returns A list of variations
 */
export async function generateVariations(
    model: TypeChatLanguageModel,
    seedPhrase: string,
    settings: VariationSettings,
): Promise<string[]> {
    // Process next phrase
    const preamble: PromptSection[] = [];
    let listDef;
    if (settings.schema) {
        preamble.push({
            role: MessageSourceRole.user,
            content: settings.schema.schemaText,
        });
        listDef = `Text phrases that are ${settings.type} for the following seed phrase AND can be translated to type "${settings.schema.typeName}" above:\n${seedPhrase}`;
    } else {
        listDef = `Text phrases that are ${settings.type} for the following seed phrase:\n${seedPhrase}`;
    }
    if (settings.facets) {
        listDef += "\nVary: " + settings.facets;
    }
    if (settings.hints) {
        preamble.push({
            role: MessageSourceRole.user,
            content: settings.hints,
        });
    }

    return await generateList(model, listDef, preamble, settings.count);
}

/**
 * Recursively generate variations on a seed phrase, using generated phrases as new seed phrases
 * @param model model to use
 * @param seedPhrase
 * @param settings
 * @param depth Number of levels of variation generation
 * @param progress
 * @returns A list of variations
 */
export async function generateVariationsRecursive(
    model: TypeChatLanguageModel,
    seedPhrase: string,
    settings: VariationSettings,
    depth: number = 1,
    progress?: Progress<string[]>,
): Promise<string[]> {
    if (depth <= 1) {
        return generateVariations(model, seedPhrase, settings);
    }

    // Breadth first recursion
    const uniqueVariations = new Set<string>();
    let pendingPhrases: string[] = [];
    let newPhrases: string[] = [];
    let currentDepth = 0;
    let phrase;
    newPhrases.push(seedPhrase);
    while (newPhrases.length > 0) {
        ++currentDepth;
        pendingPhrases.push(...newPhrases.reverse());
        newPhrases.length = 0;
        while ((phrase = pendingPhrases.pop()) !== undefined) {
            const variations = await generateVariations(
                model,
                phrase,
                settings,
            );
            for (const item of variations) {
                if (!uniqueVariations.has(item)) {
                    uniqueVariations.add(item);
                    if (currentDepth < depth) {
                        // If this is also first time we are seeing a variation, capture if for further expansion
                        newPhrases.push(item);
                    }
                }
            }
            if (progress) {
                progress(phrase, variations);
            }
        }
    }
    return [...uniqueVariations.values()];
}

export async function stringSimilarity(
    model: TextEmbeddingModel,
    x: string | undefined,
    y: string | undefined,
): Promise<number> {
    if (x && y) {
        if (x === y) {
            return 1.0;
        }
        const embeddings = await generateTextEmbeddings(model, [x, y]);
        return similarity(embeddings[0], embeddings[1], SimilarityType.Dot); // Embeddings are normalized
    } else if (x === undefined && y === undefined) {
        return 1.0;
    }

    return 0.0;
}
