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
    StopWatch,
} from "interactive-app";
import { KnowledgeProcessorContext } from "./knowledgeProcessorMemory.js";
import { ChatModel } from "aiclient";
import {
    argToDate,
    parseFreeAndNamedArguments,
    keyValuesFromNamedArgs,
} from "./common.js";
import { dateTime, ensureDir } from "typeagent";
import chalk from "chalk";
import { KnowProPrinter } from "./knowproPrinter.js";
import * as cm from "conversation-memory";
import {
    hasConversationResults,
    matchFilterToConversation,
} from "./knowproCommon.js";
import { createKnowproDataFrameCommands } from "./knowproDataFrame.js";
import { createKnowproEmailCommands } from "./knowproEmail.js";
import { createKnowproConversationCommands } from "./knowproConversation.js";
import { createKnowproImageCommands } from "./knowproImage.js";
import { createKnowproPodcastCommands } from "./knowproPodcast.js";

export type KnowproContext = {
    knowledgeModel: ChatModel;
    knowledgeActions: knowLib.conversation.KnowledgeActionTranslator;
    basePath: string;
    printer: KnowProPrinter;
    conversation?: kp.IConversation | undefined;
    queryTranslator: kp.SearchQueryTranslator;
    answerGenerator: kp.AnswerGenerator;
};

export async function createKnowproCommands(
    chatContext: KnowledgeProcessorContext,
    commands: Record<string, CommandHandler>,
): Promise<void> {
    const knowledgeModel = chatContext.models.chatModel;
    const context: KnowproContext = {
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
    /*
     * CREATE COMMANDS FOR DIFFERENT MEMORY TYPES
     */
    await createKnowproPodcastCommands(context, commands);
    await createKnowproImageCommands(context, commands);
    await createKnowproEmailCommands(context, commands);
    await createKnowproConversationCommands(context, commands);
    await createKnowproDataFrameCommands(context, commands);
    /*
     * CREATE GENERAL MEMORY COMMANDS
     */
    commands.kpSearchTerms = searchTerms;
    commands.kpSearchV1 = searchV1;
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
            description: "Show all messages",
            options: {
                maxMessages: argNum("Maximum messages to display"),
            },
        };
    }
    commands.kpMessages.metadata = "Show all messages";
    async function showMessages(args: string[]) {
        const conversation = ensureConversationLoaded();
        if (!conversation) {
            return;
        }
        const namedArgs = parseNamedArguments(args, showMessagesDef());
        const messages =
            namedArgs.maxMessages > 0
                ? conversation.messages.getSlice(0, namedArgs.maxMessages)
                : conversation.messages;
        context.printer.writeMessages(messages);
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
                maxToDisplay: argNum("Maximum matches to display", 100),
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
            100,
        );
        def.options.messageTopK = argNum("How many top K message matches", 25);
        def.options.charBudget = argNum("Maximum characters in budget");
        def.options.applyScope = argBool("Apply scopes", true);
        def.options.exactScope = argBool("Exact scope", false);
        def.options.debug = argBool("Show debug info", false);
        def.options.distinct = argBool("Show distinct results", true);
        def.options.maxToDisplay = argNum("Maximum to display", 100);
        def.options.thread = arg("Thread description");
        return def;
    }
    commands.kpSearch.metadata = searchDefNew();
    async function search(args: string[], io: InteractiveIo): Promise<void> {
        if (!ensureConversationLoaded()) {
            return;
        }
        const namedArgs = parseNamedArguments(args, searchDefNew());
        const textQuery = namedArgs.query;
        const result =
            context.conversation instanceof cm.Memory
                ? await context.conversation.searchQueryFromLanguage(textQuery)
                : await kp.searchQueryFromLanguage(
                      context.conversation!,
                      context.queryTranslator,
                      textQuery,
                  );
        if (!result.success) {
            context.printer.writeError(result.message);
            return;
        }
        let exactScope = namedArgs.exactScope;
        let compileOptions = kp.createLanguageQueryCompileOptions();
        compileOptions.exactScope = exactScope;
        let retried = !exactScope;
        const searchQuery = result.data;
        context.printer.writeJson(searchQuery, true);
        while (true) {
            const searchQueryExpressions = kp.compileSearchQuery(
                context.conversation!,
                searchQuery,
                {
                    exactScope,
                    applyScope: namedArgs.applyScope,
                },
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
                thresholdScore: 0.7,
            };
        }

        const searchResults =
            context.conversation instanceof cm.Memory
                ? await context.conversation.searchWithLanguage(
                      searchText,
                      options,
                      undefined,
                      debugContext,
                  )
                : await kp.searchConversationWithLanguage(
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
                context.printer.writeNaturalLanguageContext(debugContext);
            });
        }
        if (!hasConversationResults(searchResults.data)) {
            context.printer.writeLine();
            context.printer.writeLine("No matches");
            context.printer.writeInColor(
                chalk.gray,
                `--fallback ${namedArgs.fallback}`,
            );
            return;
        }
        for (let i = 0; i < searchResults.data.length; ++i) {
            const searchResult = searchResults.data[i];
            if (!namedArgs.messages) {
                // Don't include raw message text... try answering only with knowledge
                searchResult.messageMatches = [];
            }
            context.answerGenerator.settings.fastStop = namedArgs.fastStop;
            const answerResult = await kp.generateAnswer(
                context.conversation!,
                context.answerGenerator,
                searchResult.rawSearchQuery ?? searchText,
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
                context.printer.writeAnswer(
                    answerResult.data,
                    debugContext.usedSimilarityFallback![i],
                );
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
        if (namedArgs.thread) {
            selectExpr.when ??= {};
            selectExpr.when.threadDescription = namedArgs.thread;
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
            (searchResults.knowledgeMatches.size === 0 &&
                searchResults.messageMatches.length === 0)
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

    function searchRagDef(): CommandMetadata {
        return {
            description: "Text similarity search",
            args: {
                query: arg("Search query"),
            },
            options: {
                maxToDisplay: argNum("Maximum matches to display", 25),
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
                namedArgs.maxToDisplay,
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
    commands.topics.metadata = topicsDef();
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
}
