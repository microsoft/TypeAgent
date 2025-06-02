// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as kp from "knowpro";
import {
    addStandardHandlers,
    arg,
    argBool,
    argNum,
    CommandHandler,
    CommandMetadata,
    displayClosestCommands,
    InteractiveIo,
    NamedArgs,
    parseNamedArguments,
    runConsole,
    StopWatch,
} from "interactive-app";
import { ChatModel, openai } from "aiclient";
import {
    argToDate,
    parseFreeAndNamedArguments,
    keyValuesFromNamedArgs,
} from "../common.js";
import { dateTime, ensureDir } from "typeagent";
import chalk from "chalk";
import { KnowProPrinter } from "./knowproPrinter.js";
import {
    getLangSearchResult,
    hasConversationResults,
} from "./knowproCommon.js";
import { createKnowproDataFrameCommands } from "./knowproDataFrame.js";
import { createKnowproEmailCommands } from "./knowproEmail.js";
import { createKnowproConversationCommands } from "./knowproConversation.js";
import { createKnowproImageCommands } from "./knowproImage.js";
import { createKnowproPodcastCommands } from "./knowproPodcast.js";
import { createKnowproTestCommands } from "./knowproTest.js";
import { createKnowproDocMemoryCommands } from "./knowproDoc.js";
import { Result } from "typechat";

export async function runKnowproMemory(): Promise<void> {
    const storePath = "/data/testChat";
    await ensureDir(storePath);

    const commands: Record<string, CommandHandler> = {};
    await createKnowproCommands(commands);
    addStandardHandlers(commands);
    await runConsole({
        inputHandler,
        handlers: commands,
    });

    async function inputHandler(
        line: string,
        io: InteractiveIo,
    ): Promise<void> {
        if (line.length > 0) {
            const args = line.split(" ");
            if (args.length > 0) {
                const cmdName = args[0];
                io.writer.writeLine(`Did you mean @${cmdName}?`);
                io.writer.writeLine("Commands must be prefixed with @");
                io.writer.writeLine();
                if (displayClosestCommands(cmdName, commands, io)) {
                    return;
                }
            }
        }
        io.writer.writeLine("Enter @help for a list of commands");
    }
}

export type KnowproContext = {
    knowledgeModel: ChatModel;
    basePath: string;
    printer: KnowProPrinter;
    conversation?: kp.IConversation | undefined;
    queryTranslator: kp.SearchQueryTranslator;
    answerGenerator: kp.AnswerGenerator;
};

export function createKnowledgeModel() {
    const chatModelSettings = openai.apiSettingsFromEnv(openai.ModelType.Chat);
    chatModelSettings.retryPauseMs = 10000;
    return openai.createJsonChatModel(chatModelSettings, ["knowproMemory"]);
}

export async function createKnowproCommands(
    commands: Record<string, CommandHandler>,
): Promise<void> {
    const knowledgeModel = createKnowledgeModel();
    const context: KnowproContext = {
        knowledgeModel,
        queryTranslator: kp.createSearchQueryTranslator(knowledgeModel),
        answerGenerator: new kp.AnswerGenerator(
            kp.createAnswerGeneratorSettings(knowledgeModel),
        ),
        basePath: "/data/testChat/knowpro",
        printer: new KnowProPrinter(),
    };

    const DefaultMaxToDisplay = 25;
    const DefaultKnowledgeTopK = 50;
    const MessageCountLarge = 1000;
    const MessageCountMedium = 500;

    await ensureDir(context.basePath);
    /*
     * CREATE COMMANDS FOR DIFFERENT MEMORY TYPES
     */
    await createKnowproPodcastCommands(context, commands);
    await createKnowproImageCommands(context, commands);
    await createKnowproEmailCommands(context, commands);
    await createKnowproConversationCommands(context, commands);
    await createKnowproDataFrameCommands(context, commands);
    await createKnowproTestCommands(context, commands);
    await createKnowproDocMemoryCommands(context, commands);
    /*
     * CREATE GENERAL MEMORY COMMANDS
     */
    commands.kpSearchTerms = searchTerms;
    commands.kpSearch = search;
    commands.kpAnswer = answer;
    commands.kpSearchRag = searchRag;
    commands.kpAnswerRag = answerRag;
    commands.kpEntities = entities;
    commands.kpTopics = topics;
    commands.kpMessages = showMessages;

    /*----------------
     * COMMANDS
     * These are common to all memory/conversation types
     *---------------*/

    function showMessagesDef(): CommandMetadata {
        return {
            description: "Show messages in the loaded conversation",
            options: {
                startAt: argNum("Ordinal to start at"),
                count: argNum("Number of messages to display"),
            },
        };
    }
    commands.kpMessages.metadata = showMessagesDef();
    async function showMessages(args: string[]) {
        const conversation = ensureConversationLoaded();
        if (!conversation) {
            return;
        }
        const namedArgs = parseNamedArguments(args, showMessagesDef());
        const startAt =
            namedArgs.startAt && namedArgs.startAt > 0 ? namedArgs.startAt : 0;
        const count =
            namedArgs.count && namedArgs.count > 0
                ? namedArgs.count
                : conversation.messages.length;
        const messages = conversation.messages.getSlice(
            startAt,
            startAt + count,
        );
        context.printer.writeMessages(messages, startAt);
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
                },
            );
            timer.stop();
            if (matches && matches.size > 0) {
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
            context.printer.writeTiming(chalk.gray, timer);
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
        const [searchResults, searchContext] = await runAnswerSearch(namedArgs);
        if (!searchResults.success) {
            context.printer.writeError(searchResults.message);
            return;
        }
        if (namedArgs.debug) {
            context.printer.writeInColor(chalk.gray, () => {
                context.printer.writeLine();
                context.printer.writeNaturalLanguageContext(searchContext);
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
            writeSearchResult(
                namedArgs,
                searchContext.searchQueryExpr![i],
                searchResults.data[i],
            );
        }
    }

    function answerDef(): CommandMetadata {
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
        def.options!.knowledgeTopK = argNum(
            "How many top K knowledge matches",
            DefaultKnowledgeTopK,
        );
        def.options!.choices = arg("Answer choices, separated by ';'");
        return def;
    }
    commands.kpAnswer.metadata = answerDef();
    async function answer(args: string[]): Promise<void> {
        if (!ensureConversationLoaded()) {
            return;
        }
        const namedArgs = parseNamedArguments(args, answerDef());
        const [searchResults, debugContext] = await runAnswerSearch(namedArgs);
        if (!searchResults.success) {
            context.printer.writeError(searchResults.message);
            return;
        }
        if (namedArgs.debug) {
            context.printer.writeInColor(chalk.gray, () => {
                context.printer.writeLine();
                context.printer.writeNaturalLanguageContext(debugContext);
            });
        }
        if (!hasConversationResults(searchResults.data)) {
            context.printer.writeLine();
            context.printer.writeLine("No matches");
            return;
        }
        const choices = namedArgs.choices?.split(";");
        for (let i = 0; i < searchResults.data.length; ++i) {
            const searchResult = searchResults.data[i];
            if (!namedArgs.messages) {
                // Don't include raw message text... try answering only with knowledge
                searchResult.messageMatches = [];
            }
            context.answerGenerator.settings.fastStop = namedArgs.fastStop;
            let question =
                searchResult.rawSearchQuery ?? debugContext.searchText;
            if (choices && choices.length > 0) {
                question = kp.createMultipleChoiceQuestion(question, choices);
            }
            const answerResult = await kp.generateAnswer(
                context.conversation!,
                context.answerGenerator,
                question,
                searchResult,
                (chunk, _, result) => {
                    if (namedArgs.debug) {
                        context.printer.writeLine();
                        context.printer.writeJsonInColor(chalk.gray, chunk);
                    }
                },
                createAnswerOptions(namedArgs),
            );
            context.printer.writeLine();
            if (answerResult.success) {
                context.printer.writeAnswer(
                    answerResult.data,
                    debugContext.usedSimilarityFallback![i],
                );
            } else {
                context.printer.writeError(answerResult.message);
            }
        }
    }

    function searchRagDef(): CommandMetadata {
        return {
            description: "Text similarity search",
            args: {
                query: arg("Search query"),
            },
            options: {
                maxToDisplay: argNum(
                    "Maximum matches to display",
                    DefaultMaxToDisplay,
                ),
                minScore: argNum("Min threshold score", 0.7),
                charBudget: argNum("Character budget", 1024 * 16),
            },
        };
    }
    commands.kpSearchRag.metadata = searchRagDef();
    async function searchRag(args: string[]): Promise<void> {
        if (!ensureConversationLoaded()) {
            return;
        }
        const namedArgs = parseNamedArguments(args, searchRagDef());
        const matches = await kp.searchConversationRag(
            context.conversation!,
            namedArgs.query,
            {
                thresholdScore: namedArgs.minScore,
                maxCharsInBudget: namedArgs.charBudget,
            },
        );
        if (matches !== undefined) {
            context.printer.writeConversationSearchResult(
                context.conversation!,
                matches,
                false,
                true,
                adjustMaxToDisplay(namedArgs.maxToDisplay),
                true,
            );
        } else {
            context.printer.writeLine("No matches");
        }
    }

    function answerRagDef(): CommandMetadata {
        const def = searchRagDef();
        def.description = "Answer using classic RAG";
        return def;
    }
    commands.kpAnswerRag.metadata = answerRagDef();
    async function answerRag(args: string[]): Promise<void> {
        if (!ensureConversationLoaded()) {
            return;
        }
        const namedArgs = parseNamedArguments(args, answerRagDef());
        const searchResult = await kp.searchConversationRag(
            context.conversation!,
            namedArgs.query,
            {
                thresholdScore: namedArgs.minScore,
                maxCharsInBudget: namedArgs.charBudget,
            },
        );
        if (searchResult !== undefined) {
            const answerResult = await kp.generateAnswer(
                context.conversation!,
                context.answerGenerator,
                searchResult.rawSearchQuery ?? namedArgs.query,
                searchResult,
                (chunk, _, result) => {
                    if (namedArgs.debug) {
                        context.printer.writeLine();
                        context.printer.writeJsonInColor(chalk.gray, chunk);
                    }
                },
                createAnswerOptions(namedArgs),
            );
            context.printer.writeLine();
            if (answerResult.success) {
                context.printer.writeAnswer(answerResult.data, true);
            } else {
                context.printer.writeError(answerResult.message);
            }
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
                const entities = kp.filterCollection(
                    conversation.semanticRefs,
                    (sr) => sr.knowledgeType === "entity",
                );
                context.printer.writeSemanticRefs(entities);
            }
        }
    }

    function topicsDef(): CommandMetadata {
        return searchTermsDef(
            "Search topics only in current conversation",
            "topic",
        );
    }
    commands.kpTopics.metadata = topicsDef();
    async function topics(args: string[]): Promise<void> {
        const conversation = ensureConversationLoaded();
        if (!conversation) {
            return;
        }
        if (args.length > 0) {
            args.push("--ktype");
            args.push("topic");
            await searchTerms(args);
        } else {
            if (conversation.semanticRefs !== undefined) {
                const entities = kp.filterCollection(
                    conversation.semanticRefs,
                    (sr) => sr.knowledgeType === "topic",
                );
                context.printer.writeSemanticRefs(entities);
            }
        }
    }

    /*---------- 
      End COMMANDS
    ------------*/

    /**
     * Run a search whose results are then used to generate answers
     * @param namedArgs
     * @returns
     */
    async function runAnswerSearch(
        namedArgs: NamedArgs,
    ): Promise<[Result<kp.ConversationSearchResult[]>, AnswerSearchContext]> {
        const searchText = namedArgs.query;
        const debugContext: AnswerSearchContext = { searchText };

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

    function writeSearchResult(
        namedArgs: NamedArgs,
        searchQueryExpr: kp.SearchQueryExpr,
        searchResults: kp.ConversationSearchResult,
    ): void {
        for (const selectExpr of searchQueryExpr.selectExpressions) {
            context.printer.writeSelectExpr(selectExpr, namedArgs.debug);
        }

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
        const conversation: kp.IConversation | undefined = context.conversation;
        if (!conversation) {
            throw new Error("No conversation loaded");
        }
        const dateRange = kp.getTimeRangeForConversation(conversation!);
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

    function createSearchOptions(namedArgs: NamedArgs): kp.SearchOptions {
        let options = kp.createSearchOptions();
        options.exactMatch = namedArgs.exact;
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

    function createAnswerOptions(
        namedArgs: NamedArgs,
    ): kp.AnswerContextOptions {
        let topK = namedArgs.knowledgeTopK;
        if (topK === undefined) {
            return {};
        }
        const options: kp.AnswerContextOptions = {
            entitiesTopK: topK,
            topicsTopK: topK,
        };
        options.entitiesTopK = adjustKnowledgeTopK(options.entitiesTopK);
        return options;
    }

    function adjustKnowledgeTopK(topK?: number | undefined) {
        if (topK !== undefined && topK === DefaultKnowledgeTopK) {
            // Scale topK depending on the size of the conversation
            const numMessages = context.conversation!.messages.length;
            if (numMessages >= MessageCountLarge) {
                topK = topK * 4;
            } else if (numMessages >= MessageCountMedium) {
                topK = topK * 2;
            }
        }
        return topK;
    }

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
}

export interface AnswerSearchContext extends kp.LanguageSearchDebugContext {
    searchText: string;
}
