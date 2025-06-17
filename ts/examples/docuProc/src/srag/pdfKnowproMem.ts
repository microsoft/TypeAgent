// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as cm from "conversation-memory";
import * as kp from "knowpro";
import * as knowLib from "knowledge-processor";
import {
    arg,
    argBool,
    argNum,
    CommandHandler,
    CommandMetadata,
    parseNamedArguments,
    ProgressBar,
    NamedArgs,
    StopWatch,
    InteractiveIo,
} from "interactive-app";
import { dateTime, ensureDir, getFileName } from "typeagent";

import { ChatModel, TextEmbeddingModel, openai } from "aiclient";
import {
    argToDate,
    SRAG_MEM_DIR,
    OUTPUT_DIR,
    parseFreeAndNamedArguments,
    keyValuesFromNamedArgs,
} from "../common.js";
import { AppPrinter } from "../printer.js";
import { KPPrinter } from "./kpPrinter.js";
import { importPdf } from "./importPdf.js";
import * as pi from "./pdfDocument.js";
import { argDestFile, argSourceFile } from "../common.js";

import fs from "fs";
import path from "path";
import chalk from "chalk";
import { Result } from "typechat";

export type Models = {
    chatModel: ChatModel;
    answerModel: ChatModel;
    embeddingModel: TextEmbeddingModel;
    embeddingModelSmall?: TextEmbeddingModel | undefined;
};

export type ChatContext = {
    storePath: string;
    statsPath: string;
    models: Models;
    maxCharsPerChunk: number;
    stats?: knowLib.IndexingStats | undefined;
    topicWindowSize: number;
    searchConcurrency: number;
    minScore: number;
    entityTopK: number;
    actionTopK: number;
    conversationName: string;
    conversationSettings: knowLib.conversation.ConversationSettings;
    printer: AppPrinter;
};

export function createKnowledgeModel() {
    const chatModelSettings = openai.apiSettingsFromEnv(openai.ModelType.Chat);
    chatModelSettings.retryPauseMs = 10000;
    return openai.createJsonChatModel(chatModelSettings, ["doc-memory"]);
}

export function createModels(): Models {
    const chatModelSettings = openai.apiSettingsFromEnv(openai.ModelType.Chat);
    chatModelSettings.retryPauseMs = 10000;
    const embeddingModelSettings = openai.apiSettingsFromEnv(
        openai.ModelType.Embedding,
    );
    embeddingModelSettings.retryPauseMs = 25 * 1000;

    const models: Models = {
        chatModel: createKnowledgeModel(),
        answerModel: openai.createChatModel(),
        embeddingModel: knowLib.createEmbeddingCache(
            openai.createEmbeddingModel(embeddingModelSettings),
            1024,
        ),
        /*
        embeddingModelSmall: knowLib.createEmbeddingCache(
            openai.createEmbeddingModel("3_SMALL", 1536),
            256,
        ),
        */
    };
    models.chatModel.completionSettings.seed = 123;
    models.answerModel.completionSettings.seed = 123;
    return models;
}

export async function createKnowProContext(
    completionCallback?: (req: any, resp: any) => void,
): Promise<ChatContext> {
    const storePath = `${OUTPUT_DIR}/testChat`;
    const statsPath = path.join(storePath, "stats");
    await ensureDir(storePath);
    await ensureDir(statsPath);

    const models: Models = createModels();
    models.chatModel.completionCallback = completionCallback;
    models.answerModel.completionCallback = completionCallback;

    const conversationName = "pdf-conversation";
    const conversationSettings =
        knowLib.conversation.createConversationSettings(models.embeddingModel);

    const context: ChatContext = {
        storePath,
        statsPath,
        models,
        maxCharsPerChunk: 4096,
        topicWindowSize: 8,
        searchConcurrency: 2,
        minScore: 0.9,
        entityTopK: 100,
        actionTopK: 16,
        conversationName: conversationName,
        conversationSettings: conversationSettings,
        printer: new AppPrinter(),
    };

    return context;
}

export type KnowProContext = {
    knowledgeModel: ChatModel;
    basePath: string;
    printer: KPPrinter;
    pdfIndex: pi.PdfKnowproIndex | undefined;
    conversation?: kp.IConversation | undefined;
    queryTranslator: kp.SearchQueryTranslator;
    answerGenerator: kp.AnswerGenerator;
};

export async function createKnowproCommands(
    chatContext: ChatContext,
    commands: Record<string, CommandHandler>,
): Promise<void> {
    const knowledgeModel = chatContext.models.chatModel;
    const context: KnowProContext = {
        knowledgeModel,
        pdfIndex: undefined,
        queryTranslator: kp.createSearchQueryTranslator(knowledgeModel),
        answerGenerator: new kp.AnswerGenerator(
            kp.createAnswerGeneratorSettings(knowledgeModel),
        ),
        basePath: `${SRAG_MEM_DIR}`,
        printer: new KPPrinter(),
    };

    const DefaultMaxToDisplay = 25;
    const MessageCountLarge = 1000;
    const MessageCountMedium = 500;

    await ensureDir(context.basePath);
    commands.kpPdfImport = pdfImport;
    commands.kpPdfSave = pdfSave;
    commands.kpPdfLoad = pdfLoad;
    commands.kpPdfBuildIndex = pdfBuildIndex;
    commands.kpSearchTerms = searchTerms;
    commands.kpSearch = search;
    commands.kpAnswer = answer;

    function adjustMaxToDisplay(maxToDisplay: number) {
        if (
            maxToDisplay !== undefined &&
            maxToDisplay === DefaultMaxToDisplay
        ) {
            // Scale topK depending on the size of the conversation
            const numMessages = context.conversation!.messages.length;
            if (numMessages >= MessageCountLarge) {
                maxToDisplay = maxToDisplay * 4;
            } else if (numMessages >= MessageCountMedium) {
                maxToDisplay = maxToDisplay * 2;
            }
        }
        return maxToDisplay;
    }

    function pdfImportDef(): CommandMetadata {
        return {
            description: "Import a single or multiple PDF files.",
            options: {
                fileName: {
                    description:
                        "File to import (or multiple files separated by commas)",
                    type: "string",
                },
                files: {
                    description: "File containing the list of files to import",
                    type: "string",
                },
                verbose: {
                    description: "More verbose output",
                    type: "boolean",
                    defaultValue: true,
                },
                chunkPdfs: {
                    description: "Chunk the PDFs",
                    type: "boolean",
                    defaultValue: true,
                },
                maxPages: {
                    description:
                        "Maximum number of pages to process, default is all pages.",
                    type: "integer",
                    defaultValue: -1,
                },
            },
        };
    }
    commands.kpPdfImport.metadata = pdfImportDef();
    async function pdfImport(args: string[]): Promise<void> {
        const namedArgs = parseNamedArguments(args, pdfImportDef());
        const files = namedArgs.fileName
            ? (namedArgs.fileName as string).trim().split(",")
            : namedArgs.files
              ? fs
                    .readFileSync(namedArgs.files as string, "utf-8")
                    .split("\n")
                    .map((line) => line.trim())
                    .filter((line) => line.length > 0 && line[0] !== "#")
              : [];
        if (!files.length) {
            context.printer.writeError(
                "[No files to import (use --? for help)]",
            );
            return;
        }

        const chunkPdfs =
            namedArgs.chunkPdfs === undefined
                ? true
                : namedArgs.chunkPdfs?.toString().toLowerCase() === "true";

        const maxPagesToProcess =
            namedArgs.maxPages === undefined
                ? -1
                : parseInt(namedArgs.maxPages as string);
        if (isNaN(maxPagesToProcess)) {
            context.printer.writeError("[Invalid maxPages value]");
            return;
        }

        // import files in to srag index
        context.pdfIndex = await importPdf(
            context.printer,
            files[0],
            undefined,
            namedArgs.verbose,
            chunkPdfs,
            maxPagesToProcess,
        );
        context.conversation = context.pdfIndex;
        context.printer.writeLine("Imported PDF files ...");
    }

    function pdfSaveDef(): CommandMetadata {
        return {
            description: "Save the pdf srag index",
            args: {
                filePath: argDestFile(),
            },
        };
    }

    commands.kpPdfSave.metadata = pdfSaveDef();
    async function pdfSave(args: string[] | NamedArgs): Promise<void> {
        const namedArgs = parseNamedArguments(args, pdfSaveDef());
        if (!context.pdfIndex) {
            context.printer.writeError("No image collection loaded");
            return;
        }
        context.printer.writeLine("Saving index");
        context.printer.writeLine(namedArgs.filePath);
        if (context.pdfIndex) {
            const dirName = path.dirname(namedArgs.filePath);
            await ensureDir(dirName);
            await context.pdfIndex.writeToFile(
                dirName,
                getFileName(namedArgs.filePath),
            );
        }
    }

    function pdfLoadDef(): CommandMetadata {
        return {
            description: "Load pdf srag index",
            options: {
                filePath: argSourceFile(),
                name: arg("Pdf SRAG Index Name"),
            },
        };
    }

    commands.kpPdfLoad.metadata = pdfLoadDef();
    async function pdfLoad(args: string[]): Promise<void> {
        const namedArgs = parseNamedArguments(args, pdfLoadDef());
        let pdfIndexFilePath = namedArgs.filePath;
        pdfIndexFilePath ??= namedArgs.name
            ? indexFilePathFromName(namedArgs.name)
            : undefined;
        if (!pdfIndexFilePath) {
            context.printer.writeError("No filepath or name provided");
            return;
        }
        context.printer.writeLine(`Loading index from fil ${pdfIndexFilePath}`);
        context.printer.writeLine(pdfIndexFilePath);
        const clock = new StopWatch();
        clock.start();
        context.pdfIndex = await pi.PdfKnowproIndex.readFromFile(
            path.dirname(pdfIndexFilePath),
            getFileName(pdfIndexFilePath),
        );
        clock.stop();
        if (!context.pdfIndex) {
            context.printer.writeLine("Pdf SRAG Index not found");
            return;
        }
        context.conversation = context.pdfIndex;
    }

    function pdfBuildIndexDef(): CommandMetadata {
        return {
            description: "Build Pdf SRAG index",
            options: {
                knowledge: argBool("Index knowledge", false),
                related: argBool("Index related terms", false),
                maxMessages: argNum("Maximum pages to index"),
            },
        };
    }

    commands.kpPdfBuildIndex.metadata = pdfBuildIndexDef();
    async function pdfBuildIndex(args: string[] | NamedArgs): Promise<void> {
        if (!context.pdfIndex) {
            context.printer.writeError("No Pdfs loaded");
            return;
        }
        const messageCount = context.pdfIndex.messages.length;
        if (messageCount === 0) {
            return;
        }

        const namedArgs = parseNamedArguments(args, pdfBuildIndexDef());
        // Build index
        context.printer.writeLine();
        context.printer.writeLine("Building index");
        const maxMessages = namedArgs.maxMessages ?? messageCount;

        let progress = new ProgressBar(context.printer, maxMessages);
        const indexResult = await context.pdfIndex?.buildIndex(
            createIndexingEventHandler(context.printer, progress, maxMessages),
        );
        if (indexResult !== undefined) {
        }
        context.printer.writeIndexingResults(indexResult);
    }

    const IndexFileSuffix = "_index.json";
    function indexFilePathFromName(indexName: string): string {
        return path.join(context.basePath, indexName + IndexFileSuffix);
    }

    function searchTermsDef(
        description?: string,
        kType?: kp.KnowledgeType,
    ): CommandMetadata {
        const meta: CommandMetadata = {
            description:
                description ??
                "Search current knowPro conversation by manually providing terms as arguments",
            options: {
                maxToDisplay: argNum(
                    "Maximum matches to display",
                    DefaultMaxToDisplay,
                ),
                displayAsc: argBool("Display results in ascending order", true),
                startMinute: argNum("Starting at minute."),
                endMinute: argNum("Ending minute."),
                startDate: arg("Starting at this date"),
                endDate: arg("Ending at this date"),
                andTerms: argBool("'And' all terms. Default is 'or", false),
                exact: argBool("Exact match only. No related terms", false),
                distinct: argBool("Show distinct results", true),
                orderBy: arg("Order by: score | timestamp | ordinal"),
            },
        };
        if (kType === undefined) {
            meta.options!.ktype = arg(
                "Knowledge type: entity | topic | action | tag",
            );
        }

        return meta;
    }

    commands.kpSearchTerms.metadata = searchTermsDef();
    async function searchTerms(args: string[]): Promise<void> {
        if (args.length === 0) {
            return;
        }
        const conversation = ensureConversationLoaded();
        if (!conversation) {
            return;
        }
        const commandDef = searchTermsDef();
        let [termArgs, namedArgs] = parseFreeAndNamedArguments(
            args,
            commandDef,
        );
        if (conversation.semanticRefIndex && conversation.semanticRefs) {
            context.printer.writeInColor(
                chalk.cyan,
                `Searching ${conversation.nameTag}...`,
            );

            const selectExpr: kp.SearchSelectExpr = {
                searchTermGroup: createSearchGroup(
                    termArgs,
                    namedArgs,
                    commandDef,
                    namedArgs.andTerms,
                ),
                when: whenFilterFromNamedArgs(namedArgs, commandDef),
            };
            context.printer.writeSelectExpr(selectExpr);
            const timer = new StopWatch();
            timer.start();
            const matches = await kp.searchConversationKnowledge(
                conversation,
                selectExpr.searchTermGroup,
                selectExpr.when,
                {
                    exactMatch: namedArgs.exact,
                },
            );
            timer.stop();

            if (matches && matches.size > 0) {
                if (namedArgs.orderBy) {
                    orderKnowledgeSearchResults(matches, namedArgs.orderBy);
                }
                context.printer.writeLine();
                context.printer.writeKnowledgeSearchResults(
                    conversation,
                    matches,
                    adjustMaxToDisplay(namedArgs.maxToDisplay),
                    namedArgs.distinct,
                );
            } else {
                context.printer.writeLine("No matches");
            }
            context.printer.writeTiming(timer);
        } else {
            context.printer.writeError("Conversation is not indexed");
        }
    }

    function searchDefBase(): CommandMetadata {
        return {
            description:
                "Search using natural language and old knowlege-processor search filters",
            args: {
                query: arg("Search query"),
            },
            options: {
                maxToDisplay: argNum(
                    "Maximum matches to display",
                    DefaultMaxToDisplay,
                ),
                exact: argBool("Exact match only. No related terms", false),
                ktype: arg("Knowledge type"),
                distinct: argBool("Show distinct results", false),
            },
        };
    }

    function searchDef(): CommandMetadata {
        const def = searchDefBase();
        def.description = "Search using natural language";
        def.options ??= {};
        def.options.showKnowledge = argBool("Show knowledge matches", true);
        def.options.showMessages = argBool("Show message matches", false);
        def.options.messageTopK = argNum("How many top K message matches", 25);
        def.options.charBudget = argNum("Maximum characters in budget");
        def.options.applyScope = argBool("Apply scopes", true);
        def.options.exactScope = argBool("Exact scope", false);
        def.options.debug = argBool("Show debug info", false);
        def.options.distinct = argBool("Show distinct results", true);
        def.options.maxToDisplay = argNum(
            "Maximum to display",
            DefaultMaxToDisplay,
        );
        def.options.thread = arg("Thread description");
        def.options.tag = arg("Tag to filter by");
        return def;
    }
    commands.kpSearch.metadata = searchDef();
    async function search(args: string[], io: InteractiveIo): Promise<void> {
        if (!ensureConversationLoaded()) {
            return;
        }
        const namedArgs = parseNamedArguments(args, searchDef());
        const [searchResults, debugContext] = await runAnswerSearch(namedArgs);
        if (!searchResults.success) {
            context.printer.writeError(searchResults.message);
            return;
        }
        if (namedArgs.debug) {
            context.printer.writeInColor(chalk.gray, () => {
                context.printer.writeLine();
                context.printer.writeDebugContext(debugContext);
            });
        }
        if (!hasConversationResults(searchResults.data)) {
            context.printer.writeLine();
            context.printer.writeLine("No matches");
            if (namedArgs.exactScope) {
                context.printer.writeInColor(
                    chalk.gray,
                    `--exactScope ${namedArgs.exactScope}`,
                );
            }
            return;
        }
        for (let i = 0; i < searchResults.data.length; ++i) {
            const searchQueryExpr = debugContext.searchQueryExpr![i];
            if (!namedArgs.debug) {
                // In debug mode, we already printed the entire debug context..
                for (const selectExpr of searchQueryExpr.selectExpressions) {
                    context.printer.writeSelectExpr(selectExpr, false);
                }
            }
            writeSearchResult(
                namedArgs,
                searchQueryExpr,
                searchResults.data[i],
            );
        }
    }

    async function runAnswerSearch(
        namedArgs: NamedArgs,
    ): Promise<[Result<kp.ConversationSearchResult[]>, AnswerDebugContext]> {
        const searchText = namedArgs.query;
        const debugContext: AnswerDebugContext = { searchText };

        const options: kp.LanguageSearchOptions = {
            ...createSearchOptions(namedArgs),
            compileOptions: {
                exactScope: namedArgs.exactScope,
                applyScope: namedArgs.applyScope,
            },
        };
        options.exactMatch = namedArgs.exact;
        if (namedArgs.fallback) {
            options.fallbackRagOptions = {
                maxMessageMatches: options.maxMessageMatches,
                maxCharsInBudget: options.maxCharsInBudget,
                thresholdScore: 0.7,
            };
        }
        const langFilter = createLangFilter(undefined, namedArgs);
        const searchResults = await getSearchResults(
            searchText,
            options,
            langFilter,
            debugContext,
        );
        return [searchResults, debugContext];
    }

    function answerDefNew(): CommandMetadata {
        const def = searchDef();
        def.description = "Get answers to natural language questions";
        def.options!.messages = argBool("Include messages", true);
        def.options!.fallback = argBool(
            "Fallback to text similarity matching",
            true,
        );
        def.options!.fastStop = argBool(
            "Ignore messages if knowledge produces answers",
            true,
        );
        return def;
    }
    commands.kpAnswer.metadata = answerDefNew();
    async function answer(args: string[]): Promise<void> {
        if (!ensureConversationLoaded()) {
            return;
        }
        const namedArgs = parseNamedArguments(args, answerDefNew());
        const searchText = namedArgs.query;
        const debugContext: kp.LanguageSearchDebugContext = {};

        const options: kp.LanguageSearchOptions = {
            ...createSearchOptions(namedArgs),
            compileOptions: {
                exactScope: namedArgs.exactScope,
                applyScope: namedArgs.applyScope,
            },
        };
        options.exactMatch = namedArgs.exact;
        if (namedArgs.fallback) {
            options.fallbackRagOptions = {
                maxMessageMatches: options.maxMessageMatches,
                maxCharsInBudget: options.maxCharsInBudget,
                thresholdScore: 0.8,
            };
        }

        const searchResults = await kp.searchConversationWithLanguage(
            context.conversation!,
            searchText,
            context.queryTranslator,
            options,
            undefined,
            debugContext,
        );
        if (!searchResults.success) {
            context.printer.writeError(searchResults.message);
            return;
        }
        if (namedArgs.debug) {
            context.printer.writeInColor(chalk.gray, () => {
                context.printer.writeLine();
                context.printer.writeDebugContext(debugContext);
            });
        }
        if (!hasConversationResults(searchResults.data)) {
            context.printer.writeLine();
            context.printer.writeLine("No matches");
            return;
        }
        for (const searchResult of searchResults.data) {
            if (!namedArgs.messages) {
                // Don't include raw message text... try answering only with knowledge
                searchResult.messageMatches = [];
            }
            context.answerGenerator.settings.fastStop = namedArgs.fastStop;
            const answerResult = await kp.generateAnswer(
                context.conversation!,
                context.answerGenerator,
                searchText,
                searchResult,
                (chunk, _, result) => {
                    if (namedArgs.debug) {
                        context.printer.writeLine();
                        context.printer.writeJsonInColor(chalk.gray, chunk);
                    }
                },
            );
            context.printer.writeLine();
            if (answerResult.success) {
                context.printer.writeAnswer(answerResult.data);
            } else {
                context.printer.writeError(answerResult.message);
            }
        }
    }

    function writeSearchResult(
        namedArgs: NamedArgs,
        searchQueryExpr: kp.SearchQueryExpr,
        searchResults: kp.ConversationSearchResult,
    ): void {
        context.printer.writeLine("####");
        context.printer.writeInColor(chalk.cyan, searchQueryExpr.rawQuery!);
        context.printer.writeLine("####");
        context.printer.writeConversationSearchResult(
            context.conversation!,
            searchResults,
            namedArgs.showKnowledge,
            namedArgs.showMessages,
            adjustMaxToDisplay(namedArgs.maxToDisplay),
            namedArgs.distinct,
        );
    }

    function createLangFilter(
        when: kp.WhenFilter | undefined,
        namedArgs: NamedArgs,
    ): kp.LanguageSearchFilter | undefined {
        if (namedArgs.ktype) {
            when ??= {};
            when.knowledgeType = namedArgs.ktype;
        }
        if (namedArgs.tag) {
            when ??= {};
            when.tags = [namedArgs.tag];
        }
        if (namedArgs.thread) {
            when ??= {};
            when.threadDescription = namedArgs.thread;
        }
        return when;
    }

    async function getSearchResults(
        searchText: string,
        options?: kp.LanguageSearchOptions,
        langFilter?: kp.LanguageSearchFilter,
        debugContext?: kp.LanguageSearchDebugContext,
    ) {
        const searchResults = getLangSearchResult(
            context.conversation!,
            context.queryTranslator,
            searchText,
            options,
            langFilter,
            debugContext,
        );
        return searchResults;
    }

    async function getLangSearchResult(
        conversation: kp.IConversation | cm.Memory,
        queryTranslator: kp.SearchQueryTranslator,
        searchText: string,
        options?: kp.LanguageSearchOptions,
        langFilter?: kp.LanguageSearchFilter,
        debugContext?: kp.LanguageSearchDebugContext,
    ) {
        const searchResults =
            conversation instanceof cm.Memory
                ? await conversation.searchWithLanguage(
                      searchText,
                      options,
                      langFilter,
                      debugContext,
                  )
                : await kp.searchConversationWithLanguage(
                      conversation,
                      searchText,
                      queryTranslator,
                      options,
                      langFilter,
                      debugContext,
                  );

        return searchResults;
    }

    /*async function evalSelectQueryExpr(
        searchQueryExpr: kp.SearchQueryExpr,
        selectExpr: kp.SearchSelectExpr,
        namedArgs: NamedArgs,
    ): Promise<boolean> {
        if (namedArgs.ktype) {
            selectExpr.when ??= {};
            selectExpr.when.knowledgeType = namedArgs.ktype;
        }
        context.printer.writeSelectExpr(selectExpr);
        const searchResults = await kp.searchConversation(
            context.conversation!,
            selectExpr.searchTermGroup,
            selectExpr.when,
            createSearchOptions(namedArgs),
            searchQueryExpr.rawQuery,
        );
        if (
            searchResults === undefined ||
            searchResults.messageMatches.length === 0
        ) {
            return false;
        }
        context.printer.writeLine("####");
        context.printer.writeInColor(chalk.cyan, searchQueryExpr.rawQuery!);
        context.printer.writeLine("####");
        context.printer.writeConversationSearchResult(
            context.conversation!,
            searchResults,
            namedArgs.showKnowledge,
            namedArgs.showMessages,
            namedArgs.maxToDisplay,
            namedArgs.distinct,
        );
        return true;
    }*/

    function createSearchOptions(namedArgs: NamedArgs): kp.SearchOptions {
        let options = kp.createSearchOptions();
        options.exactMatch = namedArgs.exact;
        options.maxKnowledgeMatches = namedArgs.knowledgeTopK;
        options.maxMessageMatches = namedArgs.messageTopK;
        options.maxCharsInBudget = namedArgs.charBudget;
        return options;
    }

    function ensureConversationLoaded(): kp.IConversation | undefined {
        if (context.conversation) {
            return context.conversation;
        }
        context.printer.writeError("No conversation loaded");
        return undefined;
    }

    function whenFilterFromNamedArgs(
        namedArgs: NamedArgs,
        commandDef: CommandMetadata,
    ): kp.WhenFilter {
        let filter: kp.WhenFilter = {
            knowledgeType: namedArgs.ktype,
        };
        const conv: kp.IConversation | undefined = context.conversation;
        const dateRange = kp.getTimeRangeForConversation(conv!);
        if (dateRange) {
            let startDate: Date | undefined;
            let endDate: Date | undefined;
            // Did they provide an explicit date range?
            if (namedArgs.startDate || namedArgs.endDate) {
                startDate = argToDate(namedArgs.startDate) ?? dateRange.start;
                endDate = argToDate(namedArgs.endDate) ?? dateRange.end;
            } else {
                // They may have provided a relative date range
                if (namedArgs.startMinute >= 0) {
                    startDate = dateTime.addMinutesToDate(
                        dateRange.start,
                        namedArgs.startMinute,
                    );
                }
                if (namedArgs.endMinute > 0) {
                    endDate = dateTime.addMinutesToDate(
                        dateRange.start,
                        namedArgs.endMinute,
                    );
                }
            }
            if (startDate) {
                filter.dateRange = {
                    start: startDate,
                    end: endDate,
                };
            }
        }
        return filter;
    }

    function orderKnowledgeSearchResults(
        results: Map<string, kp.SemanticRefSearchResult>,
        orderBy: string,
    ) {
        let orderType: kp.ResultSortType | undefined;
        switch (orderBy.toLowerCase()) {
            default:
                break;
            case "score":
                orderType = kp.ResultSortType.Score;
                break;
            case "timestamp":
                orderType = kp.ResultSortType.Timestamp;
                break;
            case "ordinal":
                orderType = kp.ResultSortType.Ordinal;
                break;
        }
        if (orderType !== undefined) {
            for (const kMatches of results.values()) {
                kMatches.semanticRefMatches = kp.sortKnowledgeResults(
                    context.conversation!,
                    kMatches.semanticRefMatches,
                    orderType,
                );
            }
        }
    }
}

function createSearchGroup(
    termArgs: string[],
    namedArgs: NamedArgs,
    commandDef: CommandMetadata,
    andTerms: boolean = false,
): kp.SearchTermGroup {
    const searchTerms = kp.createSearchTerms(termArgs);
    const propertyTerms = propertyTermsFromNamedArgs(namedArgs, commandDef);
    return {
        booleanOp: andTerms ? "and" : "or",
        terms: [...searchTerms, ...propertyTerms],
    };
}

function propertyTermsFromNamedArgs(
    namedArgs: NamedArgs,
    commandDef: CommandMetadata,
): kp.PropertySearchTerm[] {
    const keyValues = keyValuesFromNamedArgs(namedArgs, commandDef);
    return kp.createPropertySearchTerms(keyValues);
}

export function hasConversationResults(
    results: kp.ConversationSearchResult[],
): boolean {
    if (results.length === 0) {
        return false;
    }
    return results.some((r) => {
        return r.knowledgeMatches.size > 0 || r.messageMatches.length > 0;
    });
}

export interface AnswerDebugContext extends kp.LanguageSearchDebugContext {
    searchText: string;
}

export function createIndexingEventHandler(
    printer: KPPrinter,
    progress: ProgressBar,
    maxMessages: number,
): kp.IndexingEventHandlers {
    let startedKnowledge = false;
    let startedRelated = false;
    let startedMessages = false;
    return {
        onKnowledgeExtracted(upto, knowledge) {
            if (!startedKnowledge) {
                printer.writeLine("Indexing knowledge");
                startedKnowledge = true;
            }
            progress.advance();
            return progress.count < maxMessages;
        },
        onEmbeddingsCreated(sourceTexts, batch, batchStartAt) {
            if (!startedRelated) {
                progress.reset(sourceTexts.length);
                printer.writeLine(
                    `Indexing ${sourceTexts.length} related terms`,
                );
                startedRelated = true;
            }
            progress.advance(batch.length);
            return true;
        },
        onTextIndexed(textAndLocations, batch, batchStartAt) {
            if (!startedMessages) {
                progress.reset(maxMessages);
                printer.writeLine(`Indexing ${maxMessages} messages`);
                startedMessages = true;
            }
            progress.advance(batch.length);
            return true;
        },
    };
}
