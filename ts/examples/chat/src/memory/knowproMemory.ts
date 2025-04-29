// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as kp from "knowpro";
import * as knowLib from "knowledge-processor";
import {
    arg,
    argBool,
    argNum,
    askYesNo,
    CommandHandler,
    CommandMetadata,
    InteractiveIo,
    NamedArgs,
    parseNamedArguments,
    ProgressBar,
    StopWatch,
} from "interactive-app";
import { ChatContext } from "./chatMemory.js";
import { ChatModel } from "aiclient";
import fs from "fs";
import {
    addFileNameSuffixToPath,
    argDestFile,
    argSourceFile,
    argToDate,
    parseFreeAndNamedArguments,
    keyValuesFromNamedArgs,
} from "./common.js";
import { dateTime, ensureDir, getFileName } from "typeagent";
import path from "path";
import chalk from "chalk";
import { KnowProPrinter } from "./knowproPrinter.js";
import * as cm from "conversation-memory";
import * as im from "image-memory";
import {
    createIndexingEventHandler,
    matchFilterToConversation,
} from "./knowproCommon.js";
import { createKnowproDataFrameCommands } from "./knowproDataFrame.js";

export type KnowProContext = {
    knowledgeModel: ChatModel;
    knowledgeActions: knowLib.conversation.KnowledgeActionTranslator;
    basePath: string;
    printer: KnowProPrinter;
    podcast?: cm.Podcast | undefined;
    images?: im.ImageCollection | undefined;
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
        knowledgeActions:
            knowLib.conversation.createKnowledgeActionTranslator(
                knowledgeModel,
            ),
        queryTranslator: kp.createSearchQueryTranslator(knowledgeModel),
        answerGenerator: new kp.AnswerGenerator(
            kp.createAnswerGeneratorSettings(knowledgeModel),
        ),
        basePath: "/data/testChat/knowpro",
        printer: new KnowProPrinter(),
    };
    await ensureDir(context.basePath);
    await createKnowproDataFrameCommands(commands, context.printer);

    commands.kpPodcastMessages = showMessages;
    commands.kpPodcastImport = podcastImport;
    commands.kpPodcastSave = podcastSave;
    commands.kpPodcastLoad = podcastLoad;
    commands.kpSearchTerms = searchTerms;
    commands.kpSearchV1 = searchV1;
    commands.kpSearch = search;
    commands.kpAnswer = answer;
    commands.kpPodcastRag = podcastRag;
    commands.kpEntities = entities;
    commands.kpPodcastBuildIndex = podcastBuildIndex;
    commands.kpPodcastBuildMessageIndex = podcastBuildMessageIndex;

    commands.kpImages = showImages;
    commands.kpImagesImport = imagesImport;
    commands.kpImagesSave = imagesSave;
    commands.kpImagesLoad = imagesLoad;
    commands.kpImagesBuildIndex = imagesBuildIndex;

    /*----------------
     * COMMANDS
     *---------------*/

    ////////////////// Podcast Commands //////////////////
    function showMessagesDef(): CommandMetadata {
        return {
            description: "Show all messages",
            options: {
                maxMessages: argNum("Maximum messages to display"),
            },
        };
    }
    commands.kpPodcastMessages.metadata = "Show all messages";
    async function showMessages(args: string[]) {
        const conversation = ensureConversationLoaded();
        if (!conversation) {
            return;
        }
        const namedArgs = parseNamedArguments(args, showMessagesDef());
        const messages =
            namedArgs.maxMessages > 0
                ? conversation.messages.slice(0, namedArgs.maxMessages)
                : conversation.messages;
        context.printer.writeMessages(messages);
    }

    function podcastImportDef(): CommandMetadata {
        return {
            description: "Create knowPro index",
            args: {
                filePath: arg("File path to transcript file"),
                startAt: arg("Start date and time"),
            },
            options: {
                indexFilePath: arg("Output path for index file"),
                maxMessages: argNum("Maximum messages to index"),
                batchSize: argNum("Indexing batch size", 4),
                length: argNum("Length of the podcast in minutes", 60),
                buildIndex: argBool("Index the imported podcast", true),
            },
        };
    }
    commands.kpPodcastImport.metadata = podcastImportDef();
    async function podcastImport(args: string[]): Promise<void> {
        const namedArgs = parseNamedArguments(args, podcastImportDef());
        if (!fs.existsSync(namedArgs.filePath)) {
            context.printer.writeError(`${namedArgs.filePath} not found`);
            return;
        }
        const startAt = argToDate(namedArgs.startAt)!;

        context.podcast = await cm.importPodcast(
            namedArgs.filePath,
            getFileName(namedArgs.filePath),
            startAt,
            namedArgs.length,
        );

        context.conversation = context.podcast;
        context.printer.conversation = context.conversation;
        context.printer.writeLine("Imported podcast:");
        context.printer.writePodcastInfo(context.podcast);
        if (!namedArgs.buildIndex) {
            return;
        }
        // Build index
        await podcastBuildIndex(namedArgs);

        // Save the index
        namedArgs.filePath = sourcePathToIndexPath(
            namedArgs.filePath,
            namedArgs.indexFilePath,
        );
        await podcastSave(namedArgs);
    }

    function podcastSaveDef(): CommandMetadata {
        return {
            description: "Save Podcast",
            args: {
                filePath: argDestFile(),
            },
        };
    }
    commands.kpPodcastSave.metadata = podcastSaveDef();
    async function podcastSave(args: string[] | NamedArgs): Promise<void> {
        const namedArgs = parseNamedArguments(args, podcastSaveDef());
        if (!context.podcast) {
            context.printer.writeError("No podcast loaded");
            return;
        }
        context.printer.writeLine("Saving index");
        context.printer.writeLine(namedArgs.filePath);
        const dirName = path.dirname(namedArgs.filePath);
        await ensureDir(dirName);

        const clock = new StopWatch();
        clock.start();
        await context.podcast.writeToFile(
            dirName,
            getFileName(namedArgs.filePath),
        );
        clock.stop();
        context.printer.writeTiming(chalk.gray, clock, "Write to file");
    }

    function podcastLoadDef(): CommandMetadata {
        return {
            description: "Load knowPro podcast",
            options: {
                filePath: argSourceFile(),
                name: arg("Podcast name"),
            },
        };
    }
    commands.kpPodcastLoad.metadata = podcastLoadDef();
    async function podcastLoad(args: string[]): Promise<void> {
        const namedArgs = parseNamedArguments(args, podcastLoadDef());
        let podcastFilePath = namedArgs.filePath;
        podcastFilePath ??= namedArgs.name
            ? podcastNameToFilePath(namedArgs.name)
            : undefined;
        if (!podcastFilePath) {
            context.printer.writeError("No filepath or name provided");
            return;
        }
        const clock = new StopWatch();
        clock.start();
        const podcast = await cm.Podcast.readFromFile(
            path.dirname(podcastFilePath),
            getFileName(podcastFilePath),
        );
        clock.stop();
        context.printer.writeTiming(chalk.gray, clock, "Read file");
        if (!podcast) {
            context.printer.writeLine("Podcast file not found");
            return;
        }
        context.podcast = podcast;
        context.conversation = context.podcast;
        context.printer.conversation = context.conversation;
        context.printer.writePodcastInfo(context.podcast);
    }

    ////////////////// Image Commands //////////////////
    function showImagesDef(): CommandMetadata {
        return {
            description: "Show all images",
            options: {
                maxMessages: argNum("Maximum images to display"),
            },
        };
    }
    commands.kpImages.metadata = "Show all images";
    async function showImages(args: string[]) {
        const conversation = ensureConversationLoaded();
        if (!conversation) {
            return;
        }
        const namedArgs = parseNamedArguments(args, showImagesDef());
        const messages =
            namedArgs.maxMessages > 0
                ? conversation.messages.slice(0, namedArgs.maxMessages)
                : conversation.messages;
        context.printer.writeMessages(messages);
    }

    function imageImportDef(): CommandMetadata {
        return {
            description: "Create knowPro image index",
            args: {
                filePath: arg("File path to an image file or folder"),
            },
            options: {
                knowledge: argBool("Index knowledge", true),
                related: argBool("Index related terms", true),
                indexFilePath: arg("Output path for index file"),
                maxMessages: argNum("Maximum images to index"),
                cachePath: arg("Path to image knowledge response cache."),
            },
        };
    }
    commands.kpImagesImport.metadata = imageImportDef();
    async function imagesImport(args: string[]): Promise<void> {
        const namedArgs = parseNamedArguments(args, imageImportDef());
        if (!fs.existsSync(namedArgs.filePath)) {
            context.printer.writeError(`${namedArgs.filePath} not found`);
            return;
        }

        let progress = new ProgressBar(context.printer, 165);
        context.images = await im.importImages(
            namedArgs.filePath,
            namedArgs.cachePath,
            true,
            (text, _index, max) => {
                progress.total = max;
                progress.advance();
                return progress.count < max;
            },
        );
        context.conversation = context.images;
        context.printer.conversation = context.conversation;
        progress.complete();

        context.printer.writeLine("Imported images:");
        context.printer.writeImageCollectionInfo(context.images!);

        if (!namedArgs.index) {
            return;
        }

        // Build the image collection index
        await imagesBuildIndex(namedArgs);

        // Save the image collection index
        namedArgs.filePath = sourcePathToIndexPath(
            namedArgs.filePath,
            namedArgs.indexFilePath,
        );
        await imagesSave(namedArgs);
    }

    function imagesSaveDef(): CommandMetadata {
        return {
            description: "Save Image Collection",
            args: {
                filePath: argDestFile(),
            },
        };
    }

    commands.kpImagesSave.metadata = imagesSaveDef();
    async function imagesSave(args: string[] | NamedArgs): Promise<void> {
        const namedArgs = parseNamedArguments(args, imagesSaveDef());
        if (!context.images) {
            context.printer.writeError("No image collection loaded");
            return;
        }
        context.printer.writeLine("Saving index");
        context.printer.writeLine(namedArgs.filePath);
        if (context.images) {
            const dirName = path.dirname(namedArgs.filePath);
            await ensureDir(dirName);
            await context.images.writeToFile(
                dirName,
                getFileName(namedArgs.filePath),
            );
        }
    }

    function imagesLoadDef(): CommandMetadata {
        return {
            description: "Load knowPro image collection",
            options: {
                filePath: argSourceFile(),
                name: arg("Image Collection Name"),
            },
        };
    }

    commands.kpImagesLoad.metadata = imagesLoadDef();
    async function imagesLoad(args: string[]): Promise<void> {
        const namedArgs = parseNamedArguments(args, imagesLoadDef());
        let imagesFilePath = namedArgs.filePath;
        imagesFilePath ??= namedArgs.name
            ? podcastNameToFilePath(namedArgs.name)
            : undefined;
        if (!imagesFilePath) {
            context.printer.writeError("No filepath or name provided");
            return;
        }
        context.images = await im.ImageCollection.readFromFile(
            path.dirname(imagesFilePath),
            getFileName(imagesFilePath),
        );
        if (!context.images) {
            context.printer.writeLine("ImageCollection not found");
            return;
        }
        context.conversation = context.images;
        context.printer.conversation = context.conversation;
        context.printer.writeImageCollectionInfo(context.images);
    }

    ////////////////// Miscellaneous Commands //////////////////
    function searchTermsDef(
        description?: string,
        kType?: kp.KnowledgeType,
    ): CommandMetadata {
        const meta: CommandMetadata = {
            description:
                description ??
                "Search current knowPro conversation by manually providing terms as arguments",
            options: {
                maxToDisplay: argNum("Maximum matches to display", 25),
                displayAsc: argBool("Display results in ascending order", true),
                startMinute: argNum("Starting at minute."),
                endMinute: argNum("Ending minute."),
                startDate: arg("Starting at this date"),
                endDate: arg("Ending at this date"),
                andTerms: argBool("'And' all terms. Default is 'or", false),
                exact: argBool("Exact match only. No related terms", false),
                usePropertyIndex: argBool(
                    "Use property index while searching",
                    true,
                ),
                useTimestampIndex: argBool(
                    "Use timestamp index while searching",
                    true,
                ),
                distinct: argBool("Show distinct results", false),
            },
        };
        if (kType === undefined) {
            meta.options!.ktype = arg("Knowledge type");
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
                    usePropertyIndex: namedArgs.usePropertyIndex,
                    useTimestampIndex: namedArgs.useTimestampIndex,
                },
            );
            timer.stop();
            if (matches && matches.size > 0) {
                context.printer.writeLine();
                context.printer.writeKnowledgeSearchResults(
                    conversation,
                    matches,
                    namedArgs.maxToDisplay,
                    namedArgs.distinct,
                );
            } else {
                context.printer.writeLine("No matches");
            }
            context.printer.writeTiming(chalk.gray, timer);
        } else {
            context.printer.writeError("Conversation is not indexed");
        }
    }

    function searchDef(): CommandMetadata {
        return {
            description:
                "Search using natural language and old knowlege-processor search filters",
            args: {
                query: arg("Search query"),
            },
            options: {
                maxToDisplay: argNum("Maximum matches to display", 25),
                exact: argBool("Exact match only. No related terms", false),
                ktype: arg("Knowledge type"),
                distinct: argBool("Show distinct results", false),
            },
        };
    }
    commands.kpSearch.metadata = searchDef();
    async function searchV1(args: string[]): Promise<void> {
        if (!ensureConversationLoaded()) {
            return;
        }
        const namedArgs = parseNamedArguments(args, searchDef());
        const query = namedArgs.query;
        const result = await context.knowledgeActions.translateSearchTermsV2(
            query,
            kp.getTimeRangePromptSectionForConversation(context.conversation!),
        );
        if (!result.success) {
            context.printer.writeError(result.message);
            return;
        }
        let searchAction = result.data;
        if (searchAction.actionName !== "getAnswer") {
            return;
        }
        context.printer.writeSearchFilter(searchAction);
        if (searchAction.parameters.filters.length > 0) {
            const filter = searchAction.parameters.filters[0];
            const searchResults = await matchFilterToConversation(
                context.conversation!,
                filter,
                namedArgs.ktype,
                {
                    exactMatch: namedArgs.exact,
                },
            );
            if (searchResults) {
                context.printer.writeKnowledgeSearchResults(
                    context.conversation!,
                    searchResults,
                    namedArgs.maxToDisplay,
                    namedArgs.distinct,
                );
            } else {
                context.printer.writeLine("No matches");
            }
        }
    }

    function searchDefNew(): CommandMetadata {
        const def = searchDef();
        def.description = "Search using natural language";
        def.options ??= {};
        def.options.showKnowledge = argBool("Show knowledge matches", true);
        def.options.showMessages = argBool("Show message matches", false);
        def.options.knowledgeTopK = argNum(
            "How many top K knowledge matches",
            50,
        );
        def.options.messageTopK = argNum("How many top K message matches", 25);
        def.options.charBudget = argNum("Maximum characters in budget", 8192);
        def.options.exactScope = argBool("(Future) Exact scope", false);
        def.options.debug = argBool("Show debug info", false);
        return def;
    }
    commands.kpSearch.metadata = searchDefNew();
    async function search(args: string[], io: InteractiveIo): Promise<void> {
        if (!ensureConversationLoaded()) {
            return;
        }
        const namedArgs = parseNamedArguments(args, searchDefNew());
        const textQuery = namedArgs.query;
        const result = await kp.searchQueryFromLanguage(
            context.conversation!,
            context.queryTranslator,
            textQuery,
        );
        if (!result.success) {
            context.printer.writeError(result.message);
            return;
        }
        let exactScope = namedArgs.exactScope;
        let retried = !exactScope;
        const searchQuery = result.data;
        context.printer.writeJson(searchQuery, true);
        while (true) {
            const searchQueryExpressions = kp.compileSearchQuery(
                context.conversation!,
                searchQuery,
                exactScope,
            );
            let countSelectMatches = 0;
            for (const searchQueryExpr of searchQueryExpressions) {
                for (const selectExpr of searchQueryExpr.selectExpressions) {
                    if (
                        await evalSelectQueryExpr(
                            searchQueryExpr,
                            selectExpr,
                            namedArgs,
                        )
                    ) {
                        countSelectMatches++;
                    }
                }
            }
            if (countSelectMatches === 0) {
                context.printer.writeLine("No matches");
            }
            if (countSelectMatches > 0 || retried) {
                break;
            }
            retried = await askYesNo(
                io,
                chalk.cyan("Using exact scope. Try fuzzy instead?"),
            );
            if (retried) {
                exactScope = false;
            } else {
                break;
            }
        }
    }

    function answerDefNew(): CommandMetadata {
        const def = searchDefNew();
        def.description = "Get answers to natural language questions";
        def.options!.messages = argBool("Include messages", false);
        return def;
    }
    commands.kpAnswer.metadata = answerDefNew();
    async function answer(args: string[]): Promise<void> {
        if (!ensureConversationLoaded()) {
            return;
        }
        const namedArgs = parseNamedArguments(args, answerDefNew());
        const searchText = namedArgs.query;
        const debugContext: kp.NaturalLanguageSearchContext = {};

        const options = kp.createDefaultSearchOptions();
        options.exactMatch = namedArgs.exact;

        const searchResults = await kp.searchConversationWithNaturalLanguage(
            context.conversation!,
            searchText,
            context.queryTranslator,
            options,
            debugContext,
        );
        if (!searchResults.success) {
            context.printer.writeError(searchResults.message);
            return;
        }
        for (const searchResult of searchResults.data) {
            const answerContext = kp.answerContextFromSearchResult(
                context.conversation!,
                searchResult,
            );
            if (!namedArgs.messages) {
                answerContext.messages = undefined;
            }
            if (namedArgs.debug) {
                context.printer.writeInColor(chalk.gray, () => {
                    context.printer.writeLine();
                    context.printer.writeNaturalLanguageContext(debugContext);
                    context.printer.writeAnswerContext(answerContext);
                });
            }
            const answerResult = await context.answerGenerator.generateAnswer(
                searchText,
                answerContext,
            );
            context.printer.writeLine();
            if (answerResult.success) {
                context.printer.writeAnswer(answerResult.data);
            } else {
                context.printer.writeError(answerResult.message);
            }
        }
    }

    async function evalSelectQueryExpr(
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
            {
                exactMatch: namedArgs.exact,
                maxKnowledgeMatches: namedArgs.knowledgeTopK,
                maxMessageMatches: namedArgs.messageTopK,
                maxMessageCharsInBudget: namedArgs.charBudget,
                usePropertyIndex: true,
                useTimestampIndex: true,
            },
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
    }

    function ragDef(): CommandMetadata {
        return {
            description: "Classic rag",
            args: {
                query: arg("Search query"),
            },
            options: {
                maxToDisplay: argNum("Maximum matches to display", 25),
                minScore: argNum("Min threshold score"),
            },
        };
    }
    commands.kpPodcastRag.metadata = ragDef();
    async function podcastRag(args: string[]): Promise<void> {
        if (!ensureConversationLoaded()) {
            return;
        }
        const messageIndex =
            context.conversation?.secondaryIndexes?.messageIndex;
        if (!messageIndex) {
            context.printer.writeError(
                "No message text index. Run kpPodcastBuildMessageIndex",
            );
            return;
        }
        const namedArgs = parseNamedArguments(args, ragDef());
        const matches = await messageIndex.lookupMessages(
            namedArgs.query,
            undefined,
            namedArgs.minScore,
        );
        if (matches.length > 0) {
            context.printer.writeScoredMessages(
                matches,
                context.conversation?.messages!,
                namedArgs.maxToDisplay,
            );
        } else {
            context.printer.writeLine("No matches");
        }
    }

    function entitiesDef(): CommandMetadata {
        return searchTermsDef(
            "Search entities in current conversation",
            "entity",
        );
    }
    commands.kpEntities.metadata = entitiesDef();
    async function entities(args: string[]): Promise<void> {
        const conversation = ensureConversationLoaded();
        if (!conversation) {
            return;
        }
        if (args.length > 0) {
            args.push("--ktype");
            args.push("entity");
            await searchTerms(args);
        } else {
            if (conversation.semanticRefs !== undefined) {
                const entities = conversation.semanticRefs?.filter(
                    (sr) => sr.knowledgeType === "entity",
                );
                context.printer.writeSemanticRefs(entities);
            }
        }
    }

    function podcastBuildIndexDef(): CommandMetadata {
        return {
            description: "Build index",
            options: {
                maxMessages: argNum("Maximum messages to index"),
                batchSize: argNum("Indexing batch size", 8),
            },
        };
    }
    commands.kpPodcastBuildIndex.metadata = podcastBuildIndexDef();
    async function podcastBuildIndex(
        args: string[] | NamedArgs,
    ): Promise<void> {
        if (!context.podcast) {
            context.printer.writeError("No podcast loaded");
            return;
        }
        const messageCount = context.podcast.messages.length;
        if (messageCount === 0) {
            return;
        }

        const namedArgs = parseNamedArguments(args, podcastBuildIndexDef());
        // Build index
        context.printer.writeLine();
        const maxMessages = namedArgs.maxMessages ?? messageCount;
        let originalMessages = context.podcast.messages;
        try {
            if (maxMessages < messageCount) {
                context.podcast.messages = context.podcast.messages.slice(
                    0,
                    maxMessages,
                );
            }
            context.printer.writeLine(`Building Index`);
            let progress = new ProgressBar(context.printer, maxMessages);
            const eventHandler = createIndexingEventHandler(
                context.printer,
                progress,
                maxMessages,
            );
            // Build full index?
            const clock = new StopWatch();
            clock.start();

            context.podcast.settings.semanticRefIndexSettings.batchSize =
                namedArgs.batchSize;
            const indexResult = await context.podcast.buildIndex(eventHandler);

            clock.stop();
            progress.complete();
            context.printer.writeTiming(chalk.gray, clock);
            context.printer.writeIndexingResults(indexResult);
        } finally {
            context.podcast.messages = originalMessages;
        }
    }

    function podcastBuildMessageIndexDef(): CommandMetadata {
        return {
            description: "Build fuzzy message index for the podcast",
            options: {
                maxMessages: argNum("Maximum messages to index"),
                batchSize: argNum("Batch size", 4),
            },
        };
    }
    commands.kpPodcastBuildMessageIndex.metadata =
        podcastBuildMessageIndexDef();
    async function podcastBuildMessageIndex(args: string[]): Promise<void> {
        if (!ensureConversationLoaded()) {
            return;
        }
        const namedArgs = parseNamedArguments(
            args,
            podcastBuildMessageIndexDef(),
        );
        context.printer.writeLine(`Indexing messages`);

        const podcast = context.podcast!;
        const settings: kp.MessageTextIndexSettings = {
            ...context.podcast!.settings.messageTextIndexSettings,
        };
        settings.embeddingIndexSettings.batchSize = namedArgs.batchSize;
        let progress = new ProgressBar(context.printer, namedArgs.maxMessages);
        podcast.secondaryIndexes.messageIndex = new kp.MessageTextIndex(
            settings,
        );
        const result = await kp.buildMessageIndex(
            podcast,
            settings,
            createIndexingEventHandler(
                context.printer,
                progress,
                namedArgs.maxMessages,
            ),
        );
        progress.complete();
        context.printer.writeListIndexingResult(result);
    }

    //-------------------------
    // Index Image Building
    //--------------------------
    function imageCollectionBuildIndexDef(): CommandMetadata {
        return {
            description: "Build image collection index",
            options: {
                knowledge: argBool("Index knowledge", false),
                related: argBool("Index related terms", false),
                maxMessages: argNum("Maximum messages to index"),
            },
        };
    }

    commands.kpImagesBuildIndex.metadata = imageCollectionBuildIndexDef();
    async function imagesBuildIndex(args: string[] | NamedArgs): Promise<void> {
        if (!context.images) {
            context.printer.writeError("No image collection loaded");
            return;
        }
        const messageCount = context.images.messages.length;
        if (messageCount === 0) {
            return;
        }

        const namedArgs = parseNamedArguments(
            args,
            imageCollectionBuildIndexDef(),
        );
        // Build index
        context.printer.writeLine();
        context.printer.writeLine("Building index");
        const maxMessages = namedArgs.maxMessages ?? messageCount;
        let progress = new ProgressBar(context.printer, maxMessages);
        const indexResult = await context.images?.buildIndex(
            createIndexingEventHandler(context.printer, progress, maxMessages),
        );
        progress.complete();
        context.printer.writeIndexingResults(indexResult);
    }

    /*---------- 
      End COMMANDS
    ------------*/

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

    function whenFilterFromNamedArgs(
        namedArgs: NamedArgs,
        commandDef: CommandMetadata,
    ): kp.WhenFilter {
        let filter: kp.WhenFilter = {
            knowledgeType: namedArgs.ktype,
        };
        const conv: kp.IConversation | undefined =
            context.podcast ?? context.images;
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

    function ensureConversationLoaded(): kp.IConversation | undefined {
        if (context.conversation) {
            return context.conversation;
        }
        context.printer.writeError("No conversation loaded");
        return undefined;
    }

    const IndexFileSuffix = "_index.json";
    function sourcePathToIndexPath(
        sourcePath: string,
        indexFilePath?: string,
    ): string {
        return (
            indexFilePath ??
            addFileNameSuffixToPath(sourcePath, IndexFileSuffix)
        );
    }

    function podcastNameToFilePath(podcastName: string): string {
        return path.join(context.basePath, podcastName + IndexFileSuffix);
    }
}
