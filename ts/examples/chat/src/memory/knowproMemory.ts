// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as kp from "knowpro";
import * as kpTest from "knowpro-test";
import {
    arg,
    argBool,
    argNum,
    CommandHandler,
    CommandMetadata,
    displayClosestCommands,
    InteractiveIo,
    NamedArgs,
    namedArgsToArgs,
    parseNamedArguments,
    parseTypedArguments,
    runConsole,
    StopWatch,
} from "interactive-app";
import {
    argToDate,
    parseFreeAndNamedArguments,
    keyValuesFromNamedArgs,
} from "../common.js";
import {
    collections,
    dateTime,
    ensureDir,
    isFilePath,
    readJsonFile,
} from "typeagent";
import chalk from "chalk";
import { KnowProPrinter } from "./knowproPrinter.js";
import { createKnowproDataFrameCommands } from "./knowproDataFrame.js";
import { createKnowproEmailCommands } from "./knowproEmail.js";
import { createKnowproConversationCommands } from "./knowproConversation.js";
import { createKnowproImageCommands } from "./knowproImage.js";
import { createKnowproPodcastCommands } from "./knowproPodcast.js";
import { createKnowproTestCommands } from "./knowproTest.js";
import { createKnowproDocMemoryCommands } from "./knowproDoc.js";
import { createKnowproWebsiteCommands } from "./knowproWebsite.js";
import { Result } from "typechat";
import { conversation as knowLib } from "knowledge-processor";
import { createKnowproKnowledgeCommands } from "./knowproKnowledge.js";

export async function runKnowproMemory(): Promise<void> {
    const storePath = "/data/testChat";
    await ensureDir(storePath);

    const commands: Record<string, CommandHandler> = {};
    await createKnowproCommands(commands);
    await runConsole({
        inputHandler,
        handlers: commands,
        addStandardHandlers: true,
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

export class KnowproContext extends kpTest.KnowproContext {
    public printer: KnowProPrinter;

    constructor() {
        super();
        this.printer = new KnowProPrinter();
    }
}

export async function createKnowproCommands(
    commands: Record<string, CommandHandler>,
): Promise<void> {
    const context: KnowproContext = new KnowproContext();
    const DefaultMaxToDisplay = 25;
    const DefaultKnowledgeTopK = 50;
    const MessageCountLarge = 1000;
    const MessageCountMedium = 500;

    const termParser = context.termParser;

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
    await createKnowproWebsiteCommands(context, commands);
    await createKnowproKnowledgeCommands(context, commands);
    /*
     * CREATE GENERAL COMMANDS that are common to all memory types
     * These include: (a) search (b) answer generation (c) enumeration
     */
    commands.kpSearchTerms = searchTerms;
    commands.kpSearch = search;
    commands.kpAnswer = answer;
    commands.kpSearchRag = searchRag;
    commands.kpAnswerRag = answerRag;
    commands.kpAnswerTerms = answerTerms;
    commands.kpEntities = entities;
    commands.kpTopics = topics;
    commands.kpMessages = showMessages;
    commands.kpAbstractMessage = abstract;
    commands.kpAlias = addAlias;
    commands.kpRelatedTerms = relatedTerms;

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
                orderBy: arg("Order by: score | timestamp | ordinal"),
                query: arg("Word-break this natural language query"),
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
        // First, check if the caller optionally supplied a ==query parameter...
        // If so, this word-breaks it. Else the parameters are just supplied as ordinary
        // command line params
        const [queryTerms, _] = getTermsFromQuery(args, commandDef);
        if (queryTerms && queryTerms.length > 0) {
            args = queryTerms;
        }
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
                    namedArgs.andTerms && namedArgs.andTerms === true
                        ? "and"
                        : "or",
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
            context.printer.writeTiming(chalk.gray, timer);
        } else {
            context.printer.writeError("Conversation is not indexed");
        }
    }

    function searchDef(base?: CommandMetadata): CommandMetadata {
        const def = kpTest.searchRequestDef();
        def.options ??= {};
        def.options.debug = argBool("Show debug info", false);
        def.options.distinct = argBool("Show distinct results", true);
        def.options.maxToDisplay = argNum(
            "Maximum to display",
            DefaultMaxToDisplay,
        );
        def.options.showKnowledge = argBool("Show knowledge matches", true);
        def.options.showMessages = argBool("Show message matches", false);
        return def;
    }
    commands.kpSearch.metadata = searchDef();
    async function search(args: string[], io: InteractiveIo): Promise<void> {
        if (!ensureConversationLoaded()) {
            return;
        }
        const namedArgs = parseNamedArguments(args, searchDef());
        let savedQuery: kp.querySchema.SearchQuery | undefined;
        if (isFilePath(namedArgs.query)) {
            const queryPath = namedArgs.query;
            const savedContext = await loadSavedDebugContext(queryPath);
            if (!savedContext) {
                return;
            }
            namedArgs.query = savedContext.searchText;
            savedQuery = savedContext.searchQuery;
            if (savedQuery) {
                context.printer.writeSearchQuery(savedQuery);
            }
        }

        const searchResponse = await kpTest.execSearchRequest(
            context,
            namedArgs,
            savedQuery,
        );
        const searchResults = searchResponse.searchResults;
        const debugContext = searchResponse.debugContext;
        if (!searchResults.success) {
            context.printer.writeError(searchResults.message);
            return;
        }
        // Log any new queries
        if (!savedQuery) {
            context.log.writeFile("kpSearch", {
                searchText: debugContext.searchText,
                searchQuery: debugContext.searchQuery,
            });
        }
        if (namedArgs.debug) {
            context.printer.writeInColor(chalk.gray, () => {
                context.printer.writeLine();
                context.printer.writeDebugContext(debugContext);
            });
        }
        if (!kp.hasConversationResults(searchResults.data)) {
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

    function answerDef(): CommandMetadata {
        const def = searchDef();
        return kpTest.getAnswerRequestDef(def, DefaultKnowledgeTopK);
    }
    commands.kpAnswer.metadata = answerDef();
    async function answer(args: string[]): Promise<void> {
        if (!ensureConversationLoaded()) {
            return;
        }
        const namedArgs = parseNamedArguments(args, answerDef());
        const searchResponse = await kpTest.execSearchRequest(
            context,
            namedArgs,
        );
        const searchResults = searchResponse.searchResults;
        const debugContext = searchResponse.debugContext;
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
        if (!kp.hasConversationResults(searchResults.data)) {
            context.printer.writeLine();
            context.printer.writeLine("No matches");
            return;
        }

        const options = createAnswerOptions(namedArgs);
        const getAnswerRequest = parseTypedArguments<kpTest.GetAnswerRequest>(
            args,
            kpTest.getAnswerRequestDef(),
        );
        getAnswerRequest.searchResponse = searchResponse;
        getAnswerRequest.knowledgeTopK = options.entitiesTopK;
        const answerResponse = await kpTest.execGetAnswerRequest(
            context,
            getAnswerRequest,
            (i: number, q: string, answer) => {
                writeAnswer(i, answer, debugContext);
                return;
            },
        );
        context.log.writeFile("kpAnswer", answerResponse);
        context.printer.writeLine();
    }

    function answerTermsDef(): CommandMetadata {
        const def = answerDef();
        def.description =
            "Generate an answer, but use local word breaking to produce search results";
        return def;
    }
    commands.kpAnswerTerms.metadata = answerTermsDef();
    async function answerTerms(args: string[]): Promise<void> {
        const conversation = ensureConversationLoaded();
        if (!conversation) {
            return;
        }
        const commandDef = answerTermsDef();
        const [queryTerms, query] = getTermsFromQuery(args, commandDef);
        if (queryTerms && queryTerms.length > 0) {
            args = queryTerms;
        }
        delete commandDef.args!.query;
        let [termArgs, namedArgs] = parseFreeAndNamedArguments(
            args,
            commandDef,
        );
        const selectExpr: kp.SearchSelectExpr = {
            searchTermGroup: createSearchGroup(
                termArgs,
                namedArgs,
                commandDef,
                namedArgs.andTerms && namedArgs.andTerms === true
                    ? "and"
                    : "or",
            ),
            when: whenFilterFromNamedArgs(namedArgs, commandDef),
        };
        const matches = await kp.searchConversation(
            conversation,
            selectExpr.searchTermGroup,
            selectExpr.when,
            {
                exactMatch: namedArgs.exact,
            },
        );
        if (!matches) {
            return;
        }
        const answer = await kp.generateAnswer(
            conversation,
            context.answerGenerator,
            query,
            matches,
            undefined,
            createAnswerOptions(namedArgs),
        );
        if (!answer.success) {
            context.printer.writeError(answer.message);
            return;
        }
        context.printer.writeAnswer(answer.data);
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
            const options = createAnswerOptions(namedArgs);
            options.chunking = false;
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
                options,
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
                const entityRefs = kp.filterCollection(
                    conversation.semanticRefs,
                    (sr) => sr.knowledgeType === "entity",
                );
                let concreteEntities = entityRefs.map(
                    (e) => e.knowledge as knowLib.ConcreteEntity,
                );
                concreteEntities = kp.mergeConcreteEntities(concreteEntities);
                concreteEntities.sort((x, y) => x.name.localeCompare(y.name));
                context.printer.writeNumbered(concreteEntities, (printer, ce) =>
                    printer.writeEntity(ce).writeLine(),
                );
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
                const topicRefs = kp.filterCollection(
                    conversation.semanticRefs,
                    (sr) => sr.knowledgeType === "topic",
                );
                let topics = topicRefs.map(
                    (t) => (t.knowledge as kp.Topic).text,
                );
                topics = kp.mergeTopics(topics);
                topics.sort();
                context.printer.writeList(topics, { type: "ol" });
            }
        }
    }

    function abstractDef(): CommandMetadata {
        return {
            description: "Return an abstract of the message",
            args: {
                ordinal: argNum("Message ordinal number"),
            },
            options: {
                showMessage: argBool("Show the message", false),
            },
        };
    }
    commands.kpAbstractMessage.metadata = abstractDef();
    async function abstract(args: string[]) {
        if (!ensureConversationLoaded()) {
            return;
        }
        const semanticRefs = context.conversation?.semanticRefs;
        if (!semanticRefs) {
            context.printer.writeError("No semantic refs");
            return;
        }
        const namedArgs = parseNamedArguments(args, abstractDef());
        const ordinal = namedArgs.ordinal;
        const message = context.conversation?.messages.get(ordinal);
        if (!message) {
            context.printer.writeError(`No message with ordinal ${ordinal}`);
            return;
        }
        const semanticRefsInMessage = new collections.MultiMap<
            kp.KnowledgeType,
            kp.ScoredSemanticRefOrdinal
        >();
        // This is not optimal. Demo only
        for (const sr of semanticRefs) {
            if (sr.range.start.messageOrdinal === ordinal) {
                semanticRefsInMessage.add(sr.knowledgeType, {
                    score: 1.0,
                    semanticRefOrdinal: sr.semanticRefOrdinal,
                });
            }
        }
        context.printer.writeHeading("Message Abstract");
        let topicMatches = semanticRefsInMessage.get("topic");
        if (topicMatches && topicMatches.length > 0) {
            const topics = kp.getDistinctTopicMatches(
                semanticRefs,
                topicMatches,
            );
            context.printer.writeInColor(chalk.cyan, "TOPICS");
            for (const topic of topics) {
                context.printer.write("- ");
                context.printer.writeTopic(topic.knowledge as kp.Topic);
            }
            context.printer.writeLine();
        }

        let entityMatches = semanticRefsInMessage.get("entity");
        if (entityMatches && entityMatches.length > 0) {
            const entities = kp.getDistinctEntityMatches(
                semanticRefs,
                entityMatches,
            );
            context.printer.writeInColor(chalk.cyan, "ENTITIES");
            for (const entity of entities) {
                context.printer.writeEntity(
                    entity.knowledge as knowLib.ConcreteEntity,
                );
                context.printer.writeLine();
            }
        }
        if (namedArgs.showMessage) {
            context.printer.writeMessage(message);
        }
    }

    function addAliasDef(): CommandMetadata {
        return {
            description: "Add an alias",
            args: {
                term: arg("Value for which to add an alias"),
            },
            options: {
                relatedTerm: arg("Alias to add"),
                weight: argNum("Relationship weight", 0.9),
            },
        };
    }
    commands.kpAlias.metadata = addAliasDef();
    async function addAlias(args: string[]) {
        if (!ensureConversationLoaded()) {
            return;
        }
        const namedArgs = parseNamedArguments(args, addAliasDef());
        const aliases =
            context.conversation!.secondaryIndexes?.termToRelatedTermsIndex
                ?.aliases;
        if (!aliases) {
            context.printer.writeLine(
                "No aliases available on this conversation",
            );
            return;
        }
        if (aliases instanceof kp.TermToRelatedTermsMap) {
            if (namedArgs.relatedTerm) {
                const relatedTerm: kp.Term = { text: namedArgs.relatedTerm };
                aliases.addRelatedTerm(namedArgs.term, relatedTerm);
            }
        }
        const relatedTerms = aliases.lookupTerm(namedArgs.term);
        if (relatedTerms && relatedTerms.length > 0) {
            context.printer.writeList(relatedTerms.map((rt) => rt.text));
        }
    }

    function relatedTermsDef(): CommandMetadata {
        return {
            description: "Return related term matches from current index",
            args: {
                term: arg("Term to search for"),
            },
        };
    }
    commands.kpRelatedTerms.metadata = relatedTermsDef();
    async function relatedTerms(args: string[]) {
        if (!ensureConversationLoaded()) {
            return;
        }
        const namedArgs = parseNamedArguments(args, relatedTermsDef());
        const relatedTerms =
            context.conversation!.secondaryIndexes?.termToRelatedTermsIndex
                ?.fuzzyIndex;
        if (!relatedTerms) {
            context.printer.writeLine(
                "No related terms available on this conversation",
            );
            return;
        }
        let searchTerm: kp.SearchTerm = { term: { text: namedArgs.term } };
        searchTerm.relatedTerms = await relatedTerms.lookupTerm(
            searchTerm.term.text,
        );
        context.printer.writeJson(searchTerm);
    }

    /*---------- 
      End COMMANDS
    ------------*/

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

    function writeAnswer(
        queryIndex: number,
        answerResult: Result<kp.AnswerResponse>,
        debugContext: kpTest.AnswerDebugContext,
    ) {
        context.printer.writeLine();
        if (answerResult.success) {
            context.printer.writeAnswer(
                answerResult.data,
                debugContext.usedSimilarityFallback![queryIndex],
            );
        } else {
            context.printer.writeError(answerResult.message);
        }
    }

    function createSearchGroup(
        termArgs: string[],
        namedArgs: NamedArgs,
        commandDef: CommandMetadata,
        op: "and" | "or" | "or_max",
    ): kp.SearchTermGroup {
        const searchTerms = kp.createSearchTerms(termArgs);
        const propertyTerms = propertyTermsFromNamedArgs(namedArgs, commandDef);
        return {
            booleanOp: op,
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

    function getTermsFromQuery(
        args: string[],
        commandDef: CommandMetadata,
        printTerms = true,
        deleteQuery = true,
    ): [string[] | undefined, string] {
        const namedArgs = parseNamedArguments(args, commandDef);
        if (!namedArgs.query) {
            return [undefined, ""];
        }
        const rawTerms = termParser.getTerms(namedArgs.query);
        if (rawTerms) {
            if (printTerms) {
                context.printer.writeLine();
                context.printer.writeListInColor(chalk.cyan, rawTerms, {
                    type: "csv",
                });
                context.printer.writeLine();
            }
            const query = namedArgs.query;
            if (deleteQuery) {
                delete namedArgs.query;
            }
            args = [...rawTerms];
            args.push(...namedArgsToArgs(namedArgs));
            return [args, query];
        }
        return [undefined, ""];
    }

    async function loadSavedDebugContext(
        filePath: string,
    ): Promise<kpTest.AnswerDebugContext | undefined> {
        // Load a saved or logged query
        const savedContext =
            await loadObject<kpTest.AnswerDebugContext>(filePath);
        return savedContext;
    }

    async function loadObject<T>(filePath: string) {
        const obj = await readJsonFile<T>(filePath);
        if (obj === undefined) {
            context.printer.writeError(`${filePath} not found`);
        }
        return obj;
    }
}
