// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as knowLib from "knowledge-processor";
import { conversation } from "knowledge-processor";
import { ChatModel, TextEmbeddingModel, openai } from "aiclient";
import {
    CommandHandler,
    CommandMetadata,
    InteractiveIo,
    addStandardHandlers,
    parseNamedArguments,
    runConsole,
} from "interactive-app";
import {
    SemanticIndex,
    asyncArray,
    collections,
    dateTime,
    getFileName,
    isDirectoryPath,
    readAllText,
} from "typeagent";
import chalk, { ChalkInstance } from "chalk";
import { PlayPrinter } from "./chatMemoryPrinter.js";
import { timestampBlocks } from "./importer.js";
import path from "path";
import fs from "fs";
import {
    argClean,
    argConcurrency,
    argDestFile,
    argMinScore,
    argPause,
    argSourceFile,
    argSourceFileOrFolder,
} from "./common.js";

export type ChatContext = {
    storePath: string;
    chatModel: ChatModel;
    embeddingModel: TextEmbeddingModel;
    maxCharsPerChunk: number;
    topicWindowSize: number;
    searchConcurrency: number;
    minScore: number;
    entityTopK: number;
    conversationName: string;
    conversationSettings: knowLib.conversation.ConversationSettings;
    conversation: knowLib.conversation.Conversation;
    conversationManager: knowLib.conversation.ConversationManager;
    searcher: knowLib.conversation.ConversationSearchProcessor;
    searchMemory?: knowLib.conversation.ConversationManager;
    emailMemory: knowLib.conversation.ConversationManager;
};

enum ReservedConversationNames {
    transcript = "transcript",
    outlook = "outlook",
    play = "play",
    search = "search",
}

function isReservedConversation(context: ChatContext): boolean {
    return (
        context.conversationName === ReservedConversationNames.transcript ||
        context.conversationName === ReservedConversationNames.play ||
        context.conversationName === ReservedConversationNames.search ||
        context.conversationName === ReservedConversationNames.outlook
    );
}

function getReservedConversation(
    context: ChatContext,
    name: string,
): conversation.ConversationManager | undefined {
    switch (name) {
        default:
            break;
        case ReservedConversationNames.outlook:
            return context.emailMemory;
    }
    return undefined;
}

export async function createChatMemoryContext(): Promise<ChatContext> {
    const storePath = "/data/testChat";
    const chatModel = openai.createStandardAzureChatModel("GPT_4");
    const embeddingModel = knowLib.createEmbeddingCache(
        openai.createEmbeddingModel(),
        64,
    );
    const conversationName = ReservedConversationNames.transcript;
    const conversationSettings = createConversationSettings(embeddingModel);

    const conversationPath = path.join(storePath, conversationName);
    const conversation = await createConversation(
        conversationPath,
        conversationSettings,
    );
    const emailStorePath = path.join(
        storePath,
        ReservedConversationNames.outlook,
    );
    const emailConversation = await createConversation(
        emailStorePath,
        conversationSettings,
    );
    const context: ChatContext = {
        storePath,
        chatModel,
        embeddingModel,
        maxCharsPerChunk: 2048,
        topicWindowSize: 8,
        searchConcurrency: 2,
        minScore: 0.9,
        conversationName,
        conversationManager:
            await knowLib.conversation.createConversationManager(
                conversationName,
                conversationPath,
                false,
                conversation,
            ),
        conversationSettings,
        conversation,
        entityTopK: 16,
        searcher: createSearchProcessor(conversation, chatModel, true, 16),
        emailMemory: await knowLib.conversation.createConversationManager(
            ReservedConversationNames.outlook,
            emailStorePath,
            false,
            emailConversation,
        ),
    };
    context.searchMemory = await createSearchMemory(context);
    return context;
}

function createConversationSettings(
    embeddingModel?: TextEmbeddingModel,
): conversation.ConversationSettings {
    return {
        indexSettings: {
            caseSensitive: false,
            concurrency: 2,
            embeddingModel,
            semanticIndex: true,
        },
    };
}

export function createConversation(
    rootPath: string,
    settings: knowLib.conversation.ConversationSettings,
): Promise<conversation.Conversation> {
    return conversation.createConversation(settings, rootPath, {
        cacheNames: true,
        useWeakRefs: true,
    });
}

export function createSearchProcessor(
    c: conversation.Conversation,
    model: ChatModel,
    includeActions: boolean,
    entityTopK: number,
) {
    const searcher = conversation.createSearchProcessor(
        c,
        model,
        model,
        includeActions
            ? conversation.KnowledgeSearchMode.WithActions
            : conversation.KnowledgeSearchMode.Default,
    );
    searcher.answers.settings.topKEntities = entityTopK;
    return searcher;
}

export async function createSearchMemory(
    context: ChatContext,
): Promise<conversation.ConversationManager> {
    const conversationName = "search";
    const memory = await conversation.createConversationManager(
        conversationName,
        context.storePath,
        true,
    );
    memory.searchProcessor.answers.settings.topKEntities = context.entityTopK;
    return memory;
}

export async function loadConversation(
    context: ChatContext,
    name: string,
    rootPath?: string,
    includeActions = true,
): Promise<boolean> {
    const reservedCm = getReservedConversation(context, name);
    let exists: boolean = false;
    if (reservedCm === undefined) {
        rootPath ??= context.storePath;
        const conversationPath = path.join(rootPath, name);
        exists = fs.existsSync(conversationPath);

        context.conversation = await createConversation(
            conversationPath,
            createConversationSettings(context.embeddingModel),
        );
        context.conversationName = name;
        context.conversationManager =
            await conversation.createConversationManager(
                name,
                conversationPath,
                false,
                context.conversation,
            );
    } else {
        context.conversation = reservedCm.conversation;
        context.conversationName = name;
        context.conversationManager = reservedCm;
        exists = true;
    }
    context.searcher = conversation.createSearchProcessor(
        context.conversation,
        context.chatModel,
        context.chatModel,
        includeActions
            ? conversation.KnowledgeSearchMode.WithActions
            : conversation.KnowledgeSearchMode.Default,
    );
    if (name !== "search") {
        context.searchMemory = await createSearchMemory(context);
    }
    return exists;
}

export async function runChatMemory(): Promise<void> {
    let context = await createChatMemoryContext();
    let printer: PlayPrinter;
    const handlers: Record<string, CommandHandler> = {
        importPlay,
        importTranscript,
        importMessage,
        importEmail,
        load,
        history,
        replay,
        knowledge,
        buildIndex,
        topics,
        entities,
        actions,
        searchQuery,
        search,
        makeTestSet,
        runTestSet,
    };
    addStandardHandlers(handlers);

    await runConsole({
        onStart,
        inputHandler,
        handlers,
    });

    function onStart(io: InteractiveIo): void {
        printer = new PlayPrinter(io);
    }

    async function inputHandler(
        line: string,
        io: InteractiveIo,
    ): Promise<void> {
        if (context.searchMemory) {
            const results = await context.searchMemory.search(
                line,
                undefined,
                undefined,
                undefined,
                (q) => printer.writeJson(q),
            );
            if (results) {
                await writeSearchTermsResult(results, true);
            } else {
                printer.writeLine("No matches");
            }
        } else {
            printer.writeLine("No search history");
        }
    }

    //--------------------
    //
    // COMMANDS
    //
    //--------------------

    handlers.history.metadata = "Display search history.";
    async function history(args: string[], io: InteractiveIo): Promise<void> {
        if (context.searchMemory) {
            await writeHistory(context.searchMemory.conversation);
        } else {
            printer.writeLine("No search history");
        }
    }

    handlers.importTranscript.metadata = importChatDef();
    async function importTranscript(
        args: string[],
        io: InteractiveIo,
    ): Promise<void> {
        const namedArgs = parseNamedArguments(args, importChatDef());
        const chatPath = namedArgs.chatPath ?? "/data/testChat/transcript.txt";
        const addToCurrent = namedArgs.addToCurrent;
        if (!addToCurrent) {
            await loadConversation(context, path.parse(chatPath).name);
        }
        printer.writeLine(`Importing ${chatPath}`);

        const chatText = await readAllText(chatPath);
        // Split full transcript text into paragraphs
        const blocks = knowLib.conversation.splitTranscriptIntoBlocks(chatText);
        const lengthMinutes = namedArgs.lengthMinutes ?? 60;
        let lengthMs = lengthMinutes * 60 * 60;
        const baseLineMs = lengthMs / blocks.length; // Average, these many minutes per block
        const chatDate = new Date(2023, 4, 1, 9);
        if (!addToCurrent) {
            await context.conversation.messages.clear();
        }
        for (let tBlock of timestampBlocks(
            blocks,
            chatDate,
            baseLineMs,
            baseLineMs + 2,
        )) {
            printer.writeTimestamp(tBlock.timestamp);
            printer.writeLine(tBlock.value.value);
            await context.conversation.messages.put(
                tBlock.value,
                tBlock.timestamp,
            );
        }
    }

    function importChatDef(): CommandMetadata {
        return {
            description:
                "Imports conversation from a file with synthetic timestamps",
            options: {
                chatPath: {
                    description: "file path",
                    type: "path",
                },
                addToCurrent: {
                    description: "Add to current conversation",
                    type: "boolean",
                    defaultValue: false,
                },
                lengthMinutes: {
                    description: "Length of the conversation in minutes",
                    type: "number",
                },
            },
        };
    }
    handlers.importPlay.metadata = importChatDef();
    async function importPlay(
        args: string[],
        io: InteractiveIo,
    ): Promise<void> {
        const namedArgs = parseNamedArguments(args, importChatDef());
        const playPath = namedArgs.chatPath ?? "/data/testChat/play.txt";
        printer.writeLine(`Importing ${playPath}`);
        await loadConversation(context, path.parse(playPath).name);

        const playText = await readAllText(playPath);
        // Split full play text into paragraphs
        const blocks = knowLib.splitIntoBlocks(
            playText,
            knowLib.TextBlockType.Paragraph,
        );
        const baseLineMs = 1000 * 60 * 10; // 10 minutes
        await context.conversation.messages.clear();
        for (let tBlock of timestampBlocks(
            blocks,
            new Date(1900, 0),
            baseLineMs,
            15 * baseLineMs,
        )) {
            printer.writeTimestamp(tBlock.timestamp);
            printer.writeLine(tBlock.value.value);
            await context.conversation.messages.put(
                tBlock.value,
                tBlock.timestamp,
            );
        }
    }

    function importMessageDef(): CommandMetadata {
        return {
            description: "Imports a text message into the current conversation",
            options: {
                message: {
                    description: "Raw message text to add",
                    type: "string",
                },
                sourcePath: argSourceFile(),
            },
        };
    }
    handlers.importMessage.metadata = importMessageDef();
    async function importMessage(
        args: string[],
        io: InteractiveIo,
    ): Promise<void> {
        // Temporary: safeguard here to prevent demo issues
        if (isReservedConversation(context)) {
            printer.writeError(
                `Directly updating the TEST ${context.conversationName} conversation is not allowed!`,
            );
            return;
        }
        const namedArgs = parseNamedArguments(args, importMessageDef());
        let messageText: string | undefined;
        if (namedArgs.message) {
            messageText = namedArgs.message;
        } else if (namedArgs.filePath) {
            if (!fs.existsSync(namedArgs.filePath)) {
                printer.writeError(`${namedArgs.filePath} not found.`);
                return;
            }
            messageText = await readAllText(namedArgs.filePath);
        }
        if (messageText) {
            context.conversationManager.addMessage(messageText);
        }
    }

    function importEmailDef(): CommandMetadata {
        return {
            description: "Import emails in a folder",
            args: {
                sourcePath: argSourceFileOrFolder(),
            },
            options: {
                concurrency: argConcurrency(2),
                clean: argClean(),
            },
        };
    }
    handlers.importEmail.metadata = importEmailDef();
    async function importEmail(args: string[]) {
        const namedArgs = parseNamedArguments(args, importEmailDef());
        let sourcePath: string = namedArgs.sourcePath;
        if (!sourcePath.endsWith("json")) {
            sourcePath = path.join(sourcePath, "json");
        }
        if (isDirectoryPath(sourcePath)) {
            if (namedArgs.clean) {
                await context.emailMemory.clear();
            }
            const emails = await knowLib.email.loadEmailFolder(
                sourcePath,
                namedArgs.concurrency,
            );
            for (const email of emails) {
                if (email.sourcePath) {
                    printer.writeLine(email.sourcePath);
                }
                await knowLib.email.addEmailToConversation(
                    context.emailMemory,
                    email,
                );
            }
        }
    }

    handlers.replay.metadata = "Replay the chat";
    async function replay(args: string[], io: InteractiveIo) {
        await writeHistory(context.conversation);
    }

    function loadDef(): CommandMetadata {
        return {
            description: "Load the named conversation memory",
            options: {
                name: {
                    description: "Conversation name",
                },
                actions: {
                    description: "Use actions in search",
                    type: "boolean",
                    defaultValue: true,
                },
                rootPath: {
                    description: "Root path for the conversation",
                    type: "string",
                },
            },
        };
    }
    handlers.load.metadata = loadDef();
    async function load(args: string[], io: InteractiveIo) {
        if (args.length > 0) {
            const namedArgs = parseNamedArguments(args, loadDef());
            let name = namedArgs.name;
            let storePath = namedArgs.rootPath;
            if (!name && storePath) {
                name = getFileName(namedArgs.rootPath);
                storePath = path.dirname(storePath);
            }
            if (name) {
                if (
                    await loadConversation(
                        context,
                        name,
                        storePath,
                        namedArgs.actions,
                    )
                ) {
                    printer.writeLine(`Loaded ${name}`);
                } else {
                    printer.writeLine(
                        `Created ${chalk.green("NEW")} conversation: ${name}`,
                    );
                }
                return;
            }
        }
        printer.writeLine(context.conversationName);
    }

    function knowledgeDef(): CommandMetadata {
        return {
            description: "Extract knowledge",
            options: {
                actions: {
                    description: "Extract actions",
                    type: "boolean",
                    defaultValue: true,
                },
                maxTurns: {
                    type: "number",
                    defaultValue: 10,
                    description: "Number of turns to run",
                },
                concurrency: argConcurrency(4),
                pause: argPause(),
            },
        };
    }

    handlers.knowledge.metadata = knowledgeDef();
    async function knowledge(args: string[], io: InteractiveIo) {
        const namedArgs = parseNamedArguments(args, knowledgeDef());
        let count = 0;
        const extractor = conversation.createKnowledgeExtractor(
            context.chatModel,
            {
                windowSize: 8,
                maxContextLength: context.maxCharsPerChunk,
                includeActions: namedArgs.actions,
                mergeActionKnowledge: false,
            },
        );
        let messages: knowLib.SourceTextBlock[] = await asyncArray.toArray(
            context.conversation.messages.entries(),
        );
        messages = messages.slice(0, namedArgs.maxTurns);
        const concurrency = namedArgs.concurrency;
        for (let slice of collections.slices(messages, concurrency)) {
            printer.writeInColor(
                chalk.gray,
                `Extracting ${slice.startAt + 1} to ${slice.startAt + slice.value.length}`,
            );
            let knowledgeResults = await Promise.all(
                slice.value.map((message) => extractor.extract(message.value)),
            );
            for (let k = 0; k < knowledgeResults.length; ++k) {
                ++count;
                const knowledge = knowledgeResults[k];
                if (!knowledge) {
                    continue;
                }
                printer.writeInColor(
                    chalk.green,
                    `[${count} / ${messages.length}]`,
                );
                printer.writeListInColor(chalk.cyan, slice.value[k].value);
                printer.writeTopics(knowledge.topics);
                printer.writeEntities(knowledge.entities);
                printer.writeActions(knowledge.actions);
                printer.writeLine();
            }
        }
    }

    function buildIndexDef(): CommandMetadata {
        return {
            description: "Index knowledge",
            options: {
                concurrency: argConcurrency(4),
                mergeWindow: {
                    type: "number",
                    defaultValue: 8,
                },
                maxTurns: {
                    type: "number",
                    defaultValue: 10,
                    description: "Number of turns to run",
                },
                pause: argPause(),
                messages: {
                    type: "boolean",
                    defaultValue: true,
                    description: "Index messages",
                },
                actions: {
                    type: "boolean",
                    defaultValue: true,
                    description: "Index actions",
                },
            },
        };
    }
    handlers.buildIndex.metadata = buildIndexDef();
    async function buildIndex(
        args: string[],
        io: InteractiveIo,
    ): Promise<void> {
        const namedArgs = parseNamedArguments(args, buildIndexDef());

        let messages: knowLib.SourceTextBlock[] = await asyncArray.toArray(
            context.conversation.messages.entries(),
        );
        messages = messages.slice(0, namedArgs.maxTurns);

        let messageIndex: SemanticIndex<any> | undefined;
        let topicMerger: conversation.TopicMerger | undefined;
        let knowledgeExtractor: conversation.KnowledgeExtractor | undefined;
        if (namedArgs.messages) {
            await context.conversation.removeMessageIndex();
            messageIndex = await context.conversation.getMessageIndex();
        }
        await context.conversation.removeKnowledge();
        topicMerger = await conversation.createConversationTopicMerger(
            context.chatModel,
            context.conversation,
            1,
            namedArgs.mergeWindow,
        );
        knowledgeExtractor = conversation.createKnowledgeExtractor(
            context.chatModel,
            {
                windowSize: 8,
                maxContextLength: context.maxCharsPerChunk,
                includeActions: namedArgs.actions,
                mergeActionKnowledge: true,
            },
        );
        context.conversationSettings.indexActions = true; //namedArgs.actions;
        let count = 0;
        const concurrency = namedArgs.concurrency;
        try {
            for (let i = 0; i < messages.length; i += concurrency) {
                const slice = messages.slice(i, i + concurrency);
                if (slice.length === 0) {
                    break;
                }
                if (messageIndex) {
                    printer.writeInColor(
                        chalk.gray,
                        `[Indexing messages ${i + 1} to ${i + slice.length}]`,
                    );
                    await asyncArray.mapAsync(slice, concurrency, (m) =>
                        messageIndex.put(m.value, m.blockId),
                    );
                }
                if (knowledgeExtractor) {
                    printer.writeInColor(
                        chalk.gray,
                        `[Extracting knowledge ${i + 1} to ${i + slice.length}]`,
                    );
                    const knowledgeResults = await asyncArray.mapAsync(
                        slice,
                        namedArgs.concurrency,
                        (message) =>
                            conversation.extractKnowledgeFromBlock(
                                knowledgeExtractor,
                                message,
                            ),
                    );
                    for (const knowledgeResult of knowledgeResults) {
                        ++count;
                        printer.writeLine(
                            chalk.green(`[${count} / ${messages.length}]`),
                        );
                        if (knowledgeResult) {
                            const [message, knowledge] = knowledgeResult;
                            await writeKnowledgeResult(message, knowledge);
                            const knowledgeIds =
                                await context.conversation.addKnowledgeForMessage(
                                    message,
                                    knowledge,
                                );
                            if (topicMerger) {
                                const mergedTopic = await topicMerger.next(
                                    true,
                                    true,
                                );
                                if (mergedTopic) {
                                    printer.writeTitle("Merged Topic:");
                                    printer.writeTemporalBlock(
                                        chalk.blueBright,
                                        mergedTopic,
                                    );
                                }
                            }
                            await context.conversation.addKnowledgeToIndex(
                                knowledge,
                                knowledgeIds,
                            );
                            printer.writeLine();
                        }
                    }
                }
            }
        } catch (error) {
            printer.writeError(`${error}`);
        }
    }

    async function writeKnowledgeResult(
        message: knowLib.SourceTextBlock,
        knowledge: conversation.ExtractedKnowledge,
    ) {
        printer.writeInColor(chalk.cyan, message.value);
        await writeExtractedTopics(knowledge.topics, false);
        printer.writeExtractedEntities(knowledge.entities);
        printer.writeExtractedActions(knowledge.actions);
    }

    function topicsDef(): CommandMetadata {
        return {
            description: "Search for or display topics",
            options: {
                query: {
                    description: "value to search for",
                },
                exact: {
                    description: "Exact match?",
                    defaultValue: false,
                    type: "boolean",
                },
                count: {
                    description: "Num matches",
                    defaultValue: 3,
                    type: "number",
                },
                minScore: {
                    description: "Min score",
                    defaultValue: 0,
                    type: "number",
                },
                showMessages: {
                    description: "Search messages",
                    type: "boolean",
                    defaultValue: false,
                },
                level: {
                    description: "Topics at this level",
                    type: "number",
                    defaultValue: 1,
                },
            },
        };
    }
    handlers.topics.metadata = topicsDef();
    async function topics(args: string[], io: InteractiveIo) {
        const namedArgs = parseNamedArguments(args, topicsDef());
        const index = await context.conversation.getTopicsIndex(
            namedArgs.level,
        );
        const query = namedArgs.query;
        if (query) {
            if (namedArgs.showMessages) {
                await searchMessagesByTopic(
                    index,
                    query,
                    namedArgs.exact,
                    namedArgs.count,
                    namedArgs.minScore,
                );
            } else {
                await searchTopics(
                    index,
                    query,
                    namedArgs.exact,
                    namedArgs.count,
                    namedArgs.minScore,
                );
            }
            return;
        }

        for await (const topic of index.entries()) {
            await writeExtractedTopic(topic);
        }
    }

    function entitiesDef(): CommandMetadata {
        return {
            description: "Search for entities",
            options: {
                name: {
                    description: "Names to search for",
                },
                type: {
                    description: "Type to search for",
                },
                facet: {
                    description: "Facet to search for",
                },
                exact: {
                    description: "Exact match?",
                    defaultValue: false,
                    type: "boolean",
                },
                count: {
                    description: "Num matches",
                    defaultValue: 1,
                    type: "number",
                },
                facetCount: {
                    description: "Num facet matches",
                    defaultValue: 10,
                    type: "number",
                },
                minScore: {
                    description: "Min score",
                    defaultValue: 0,
                    type: "number",
                },
                showMessages: {
                    defaultValue: false,
                    type: "boolean",
                },
            },
        };
    }
    handlers.entities.metadata = entitiesDef();
    async function entities(args: string[], io: InteractiveIo) {
        const namedArgs = parseNamedArguments(args, entitiesDef());
        let query = namedArgs.name ?? namedArgs.type;
        if (query) {
            const isMultipart =
                namedArgs.facet || (namedArgs.name && namedArgs.type);
            if (namedArgs.exact || !isMultipart) {
                await searchEntities(
                    query,
                    namedArgs.name !== undefined,
                    namedArgs.exact,
                    namedArgs.count,
                    namedArgs.minScore,
                    namedArgs.showMessages,
                );
            } else {
                // Multipart query
                await searchEntities_Multi(
                    namedArgs.name,
                    namedArgs.type,
                    namedArgs.facet,
                    namedArgs.count,
                    namedArgs.facetCount,
                    namedArgs.minScore,
                    namedArgs.showMessages,
                );
            }
            return;
        }

        const index = await context.conversation.getEntityIndex();
        for await (const entity of index.entities()) {
            await writeExtractedEntity(entity);
            printer.writeLine();
        }
    }

    function actionsDef(): CommandMetadata {
        return {
            description: "Search for actions",
            options: {
                subject: {
                    description: "Action to search for",
                    defaultValue: conversation.NoEntityName,
                },
                object: {
                    description: "Object to search for",
                },
                verb: {
                    description:
                        "Verb to search for. Compound verbs are comma separated",
                },
                tense: {
                    description: "Verb tense: past | present | future",
                    defaultValue: "past",
                },
                count: {
                    description: "Num action matches",
                    defaultValue: 1,
                    type: "number",
                },
                verbCount: {
                    description: "Num verb matches",
                    defaultValue: 1,
                    type: "number",
                },
                nameCount: {
                    description: "Num name matches",
                    defaultValue: 2,
                    type: "number",
                },
                showMessages: {
                    defaultValue: false,
                    type: "boolean",
                },
            },
        };
    }
    handlers.actions.metadata = actionsDef();
    async function actions(args: string[], io: InteractiveIo) {
        const index = await context.conversation.getActionIndex();
        if (args.length === 0) {
            // Just dump all actions
            for await (const action of index.entries()) {
                writeExtractedAction(action);
            }
            return;
        }

        const namedArgs = parseNamedArguments(args, actionsDef());
        const verb: string = namedArgs.verb;
        const verbTense = namedArgs.tense;
        let verbs: string[] | undefined;
        if (verb) {
            verbs = knowLib.split(verb, ",", {
                removeEmpty: true,
                trim: true,
            });
            if (verbs.length === 0) {
                verbs = undefined;
            } else if (verbs[0] === "*") {
                const allVerbs = [...index.verbIndex.text()].sort();
                printer.writeList(allVerbs, { type: "ul" });
                return;
            }
        }
        // Full search
        const filter: conversation.ActionFilter = {
            filterType: "Action",
            subjectEntityName: namedArgs.subject,
            objectEntityName: namedArgs.object,
        };
        if (verbs && verbs.length > 0) {
            filter.verbFilter = {
                verbs,
                verbTense,
            };
        }
        const matches = await index.search(filter, {
            maxMatches: namedArgs.count,
            verbSearchOptions: {
                maxMatches: namedArgs.verbCount,
            },
            nameSearchOptions: {
                maxMatches: namedArgs.nameCount,
            },
            loadActions: true,
        });
        if (matches.actions) {
            for (const action of matches.actions) {
                printer.writeLine(conversation.actionToString(action));
            }
            if (namedArgs.showMessages && matches.actionIds) {
                const messages = await loadMessages(
                    await index.getSourceIds(matches.actionIds),
                );
                printer.writeTemporalBlocks(chalk.cyan, messages);
            }
        }
    }

    function searchDef(): CommandMetadata {
        return {
            description: "Natural language search on conversation",
            args: {
                query: {
                    description: "Search query",
                },
            },
            options: {
                maxMatches: {
                    description: "Maximum fuzzy matches",
                    type: "number",
                    defaultValue: 2,
                },
                minScore: {
                    description: "Minimum similarity score",
                    type: "number",
                    defaultValue: 0.8,
                },
                fallback: {
                    description: "Fallback to message search",
                    type: "boolean",
                    defaultValue: true,
                },
                action: {
                    description: "Include actions",
                    type: "boolean",
                },
                eval: {
                    description: "Evaluate search query",
                    type: "boolean",
                    defaultValue: true,
                },
                debug: {
                    description: "Show debug info",
                    type: "boolean",
                    defaultValue: true,
                },
                save: {
                    description: "Save the search",
                    type: "boolean",
                    defaultValue: true,
                },
            },
        };
    }
    handlers.searchQuery.metadata = searchDef();
    async function searchQuery(
        args: string[],
        io: InteractiveIo,
    ): Promise<void> {
        const timestampQ = new Date();
        const namedArgs = parseNamedArguments(args, searchDef());
        const maxMatches = namedArgs.maxMatches;
        const minScore = namedArgs.minScore;
        let query = namedArgs.query.trim();
        if (!query || query.length === 0) {
            return;
        }
        const searchOptions: conversation.SearchProcessingOptions = {
            maxMatches,
            minScore,
            maxMessages: 15,
            combinationSetOp: knowLib.sets.SetOp.IntersectUnion,
            progress: (value) => printer.writeJson(value),
        };
        if (namedArgs.fallback) {
            searchOptions.fallbackSearch = { maxMatches: 10 };
        }
        if (namedArgs.action === undefined) {
            namedArgs.action =
                context.searcher.searchMode !==
                conversation.KnowledgeSearchMode.Default;
        }
        searchOptions.includeActions = namedArgs.action;
        if (!namedArgs.eval) {
            await searchNoEval(query, searchOptions);
            return;
        }

        const result = await context.searcher.search(query, searchOptions);
        if (!result) {
            printer.writeError("No result");
            return;
        }
        if (result.response) {
            if (result.action.actionName === "webLookup") {
                if (result.response.answer) {
                    printer.writeInColor(
                        chalk.green,
                        result.response.answer.answer!,
                    );
                }
                return;
            }

            const timestampA = new Date();
            const entityIndex = await context.conversation.getEntityIndex();
            const topicIndex = await context.conversation.getTopicsIndex(
                result.response.topicLevel,
            );
            printer.writeLine();
            await writeSearchResults(
                topicIndex,
                entityIndex,
                query,
                result,
                namedArgs.debug,
            );
            if (result.response.answer && namedArgs.save) {
                const answer =
                    result.response.answer.answer ??
                    result.response.answer.whyNoAnswer;
                if (answer) {
                    recordQuestionAnswer(query, timestampQ, answer, timestampA);
                }
            }
        }
    }

    handlers.search.metadata = searchDef();
    async function search(args: string[], io: InteractiveIo): Promise<void> {
        await searchConversation(context.searcher, true, args);
    }

    async function searchNoEval(
        query: string,
        searchOptions: conversation.SearchProcessingOptions,
    ) {
        const searchResult = await context.searcher.actions.translateSearch(
            query,
            await context.searcher.buildContext(searchOptions),
        );
        printer.writeJson(searchResult);
    }

    function makeTestSetDef(): CommandMetadata {
        return {
            description: "Make a test set from the query batch file",
            args: {
                filePath: argSourceFile(),
            },
            options: {
                destPath: argDestFile(),
                concurrency: argConcurrency(2),
            },
        };
    }
    handlers.makeTestSet.metadata = makeTestSetDef();
    async function makeTestSet(args: string[]): Promise<void> {
        const namedArgs = parseNamedArguments(args, makeTestSetDef());
        await conversation.testData.searchBatchFile(
            context.conversationManager,
            namedArgs.filePath,
            namedArgs.destPath,
            namedArgs.concurrency,
            writeProgress,
        );
    }

    function runTestSetDef(): CommandMetadata {
        return {
            description: "Run a test set",
            args: {
                filePath: argSourceFile(),
            },
            options: {
                concurrency: argConcurrency(2),
                minScore: argMinScore(0.8),
            },
        };
    }
    handlers.runTestSet.metadata = runTestSetDef();
    async function runTestSet(args: string[]): Promise<void> {
        const namedArgs = parseNamedArguments(args, runTestSetDef());
        const comparisons = await conversation.testData.compareQueryBatchFile(
            context.conversationManager,
            context.embeddingModel,
            namedArgs.filePath,
            namedArgs.concurrency,
            writeProgress,
        );
        printer.writeLine();
        // Sort in order of least similar
        comparisons.sort((x, y) => x.similarity - y.similarity);
        for (const c of comparisons) {
            const hasIssue = c.similarity < namedArgs.minScore;
            const color = hasIssue ? chalk.redBright : chalk.green;
            printer.writeInColor(
                color,
                `[${c.similarity}]\n${c.baseLine.query}`,
            );
            if (hasIssue) {
                printer.writeLine("#Answer#");
                await writeSearchResponse(c.baseLine.answer, chalk.green);
                await writeSearchResponse(c.answer, chalk.redBright);
            }
            printer.writeLine();
        }
    }

    //--------------------
    // END COMMANDS
    //--------------------

    async function writeHistory(conversation: conversation.Conversation) {
        for await (const message of conversation.messages.entries()) {
            printer.writeSourceBlock(message);
            printer.writeLine();
        }
    }

    async function searchConversation(
        searcher: conversation.ConversationSearchProcessor,
        recordAnswer: boolean,
        args: string[],
    ): Promise<void> {
        const timestampQ = new Date();
        const namedArgs = parseNamedArguments(args, searchDef());
        const maxMatches = namedArgs.maxMatches;
        const minScore = namedArgs.minScore;
        let query = namedArgs.query.trim();
        if (!query || query.length === 0) {
            return;
        }
        const searchOptions: conversation.SearchProcessingOptions = {
            maxMatches,
            minScore,
            maxMessages: 15,
            combinationSetOp: knowLib.sets.SetOp.IntersectUnion,
            progress: (value) => printer.writeJson(value),
        };
        if (namedArgs.fallback) {
            searchOptions.fallbackSearch = { maxMatches: 10 };
        }
        if (namedArgs.action === undefined) {
            namedArgs.action =
                searcher.searchMode !==
                conversation.KnowledgeSearchMode.Default;
        }
        searchOptions.includeActions = namedArgs.action;
        if (!namedArgs.eval) {
            await searchNoEval(query, searchOptions);
            return;
        }

        const result = await searcher.searchTerms(
            query,
            undefined,
            searchOptions,
        );
        if (!result) {
            printer.writeError("No result");
            return;
        }
        await writeSearchTermsResult(result, namedArgs.debug);
        if (result.response && result.response.answer) {
            if (namedArgs.save && recordAnswer) {
                let answer = result.response.answer.answer;
                if (!answer) {
                    answer = result.response.answer.whyNoAnswer;
                }
                if (answer) {
                    recordQuestionAnswer(query, timestampQ, answer, new Date());
                }
            }
        }
    }

    async function writeSearchTermsResult(
        result: conversation.SearchTermsActionResponse,
        stats: boolean,
    ) {
        if (result.response && result.response.answer) {
            if (stats) {
                writeResultStats(result.response);
            }
            if (result.response.answer.answer) {
                const answer = result.response.answer.answer;
                printer.writeInColor(chalk.green, answer);
            } else if (result.response.answer.whyNoAnswer) {
                const answer = result.response.answer.whyNoAnswer;
                printer.writeInColor(chalk.red, answer);
            }
            printer.writeLine();
        }
    }

    async function writeSearchResponse(
        answerResponse: conversation.AnswerResponse | undefined,
        color: ChalkInstance,
    ) {
        if (answerResponse) {
            if (answerResponse.answer) {
                printer.writeInColor(color, answerResponse.answer);
            } else if (answerResponse.whyNoAnswer) {
                printer.writeInColor(color, answerResponse.whyNoAnswer);
            }
        }
    }

    function recordQuestionAnswer(
        question: string,
        timestampQ: Date,
        answer: string,
        timestampA: Date,
    ) {
        // Don't record questions about the search history
        if (
            context.searchMemory &&
            context.searchMemory.conversationName !== context.conversationName
        ) {
            try {
                context.searchMemory.queueAddMessage(
                    `USER:\n${question}`,
                    undefined,
                    timestampQ,
                );
                context.searchMemory.queueAddMessage(
                    `ASSISTANT:\n${answer}`,
                    undefined,
                    timestampA,
                );
            } catch (e) {
                printer.writeError(`Error updating history\n${e}`);
            }
        }
    }

    async function writeSearchResults(
        topicIndex: conversation.TopicIndex,
        entityIndex: conversation.EntityIndex,
        query: string,
        rr: conversation.SearchActionResponse,
        debugInfo: boolean,
        showLinks: boolean = false,
    ) {
        writeResultStats(rr.response);
        if (rr.response) {
            const action: conversation.SearchAction = rr.action;
            switch (action.actionName) {
                case "unknown":
                    printer.writeError("unknown action");
                    break;

                case "getAnswer":
                    const answer = rr.response.answer;
                    if (answer) {
                        if (
                            answer &&
                            answer.type === "Answered" &&
                            answer.answer
                        ) {
                            printer.writeInColor(chalk.green, answer.answer);
                            if (debugInfo && showLinks) {
                                writeResultLinks(rr.response);
                            }
                            return;
                        }

                        printer.writeError(answer.whyNoAnswer ?? "No answer");
                    }
                    if (debugInfo) {
                        writeDebugInfo(topicIndex, entityIndex, rr);
                    }
                    break;
            }
        } else {
            printer.writeLine("No search response");
        }
    }

    async function writeDebugInfo(
        topicIndex: conversation.TopicIndex,
        entityIndex: conversation.EntityIndex,
        rr: conversation.SearchActionResponse,
    ) {
        printer.writeTitle("DEBUG INFORMATION");
        if (rr.response) {
            if (rr.response.topics) {
                await writeTopicResults(topicIndex, rr.response, false, false);
            }
            if (rr.response.entities) {
                await writeEntityResults(
                    entityIndex,
                    rr.response,
                    false,
                    false,
                );
            }
            if (rr.response.messages) {
                printer.writeTitle("Messages");
                printer.writeTemporalBlocks(
                    chalk.blueBright,
                    rr.response.messages,
                );
            }
        }
    }

    function writeResultLinks(rr: conversation.SearchResponse): void {
        if (rr && rr.messageIds) {
            const links = rr.messageIds.map((id) =>
                context.conversation.messages.getUrl(id).toString(),
            );
            printer.writeList(links, { type: "ul" });
        }
    }

    function writeResultStats(
        response: conversation.SearchResponse | undefined,
    ): void {
        if (response !== undefined) {
            const allTopics = response.mergeAllTopics();
            if (allTopics && allTopics.length > 0) {
                printer.writeLine(`Topic Hit Count: ${allTopics.length}`);
            } else {
                const topicIds = new Set(response.allTopicIds());
                printer.writeLine(`Topic Hit Count: ${topicIds.size}`);
            }
            const allEntities = response.mergeAllEntities(16);
            if (allEntities && allEntities.length > 0) {
                printer.writeLine(`Entity Hit Count: ${allEntities.length}`);
            } else {
                const entityIds = new Set(response.allEntityIds());
                printer.writeLine(
                    `Entity to Message Hit Count: ${entityIds.size}`,
                );
            }
            const allActions = knowLib.sets.uniqueFrom(response.allActionIds());
            //const allActions = [...response.allActionIds()];
            if (allActions && allActions.length > 0) {
                printer.writeLine(`Action Hit Count: ${allActions.length}`);
            }
            if (response.messages) {
                printer.writeLine(
                    `Message Hit Count: ${response.messages ? response.messages.length : 0}`,
                );
            }
        }
    }

    async function searchTopics(
        index: knowLib.conversation.TopicIndex,
        query: string,
        exact: boolean,
        count: number,
        minScore: number,
    ): Promise<void> {
        const matches = await knowLib.searchIndexText(
            index.textIndex,
            query,
            exact,
            count,
            minScore,
        );
        for (const match of matches) {
            printer.writeInColor(chalk.green, `[${match.score}]`);
            const text = await index.textIndex.getText(match.item);
            printer.writeInColor(chalk.cyan, text!);
        }
    }

    async function searchMessagesByTopic(
        index: knowLib.conversation.TopicIndex,
        query: string,
        exact: boolean,
        count: number,
        minScore: number,
    ): Promise<void> {
        const matches = await knowLib.searchIndex(
            index.textIndex,
            query,
            exact,
            count,
            minScore,
        );
        for (const match of matches) {
            printer.writeInColor(chalk.green, `[${match.score}]`);
            const messages = await loadMessages(match.item);
            printer.writeTemporalBlocks(chalk.greenBright, messages);
        }
    }

    async function searchEntities(
        query: string,
        name: boolean,
        exact: boolean,
        count: number,
        minScore: number,
        showMessages?: boolean,
    ) {
        const index = await context.conversation.getEntityIndex();
        const matches = await knowLib.searchIndex(
            name ? index.nameIndex : index.typeIndex,
            query,
            exact,
            count,
            minScore,
        );
        for (const match of matches) {
            printer.writeInColor(chalk.green, `[${match.score}]`);
            await writeEntitiesById(index, match.item, showMessages);
        }
    }

    async function searchEntities_Multi(
        name: string | undefined,
        type: string | undefined,
        facet: string | undefined,
        count: number,
        faceCount: number,
        minScore: number,
        showMessages?: boolean,
    ) {
        const index = await context.conversation.getEntityIndex();
        let nameMatches: string[] | undefined;
        let typeMatches: string[] | undefined;
        let facetMatches: string[] | undefined;
        if (name) {
            nameMatches = await index.nameIndex.getNearest(
                name,
                count,
                minScore,
            );
        }
        if (type) {
            typeMatches = await index.typeIndex.getNearest(
                type,
                count,
                minScore,
            );
        }
        if (facet) {
            facetMatches = await index.facetIndex.getNearest(
                facet,
                faceCount,
                minScore,
            );
        }
        const matches = [
            ...knowLib.sets.intersectMultiple(
                nameMatches,
                typeMatches,
                facetMatches,
            ),
        ];
        await writeEntitiesById(index, matches, showMessages);
    }

    async function writeExtractedTopics(
        topics?: knowLib.TextBlock[],
        showSources?: boolean,
    ) {
        if (topics && topics.length > 0) {
            if (showSources) {
                printer.writeBlocks(
                    chalk.cyan,
                    await knowLib.getTextBlockSources(
                        context.conversation.messages,
                        topics,
                    ),
                );
            }
            const list = topics.map((t) => t.value);
            writeList("Topics", list);
        }
    }

    async function writeExtractedTopic(topic: knowLib.TextBlock) {
        const messages = await loadMessages(topic.sourceIds);
        printer.writeTemporalBlocks(chalk.greenBright, messages);
        printer.writeLine(topic.value);
        printer.writeLine();
    }

    function writeExtractedAction(
        action: knowLib.conversation.ExtractedAction,
    ) {
        printer.writeLine(conversation.actionToString(action.value));
    }

    async function writeExtractedEntity(
        entity: conversation.ExtractedEntity,
        showTopics?: boolean,
        showMessages?: boolean,
    ) {
        if (showMessages) {
            const messages = await loadMessages(entity.sourceIds);
            printer.writeTemporalBlocks(chalk.greenBright, messages);
        }
        printer.writeCompositeEntity(
            conversation.toCompositeEntity(entity.value),
        );
        if (showTopics) {
            for (const id of entity.sourceIds) {
                const k = await context.conversation.knowledge.get(id);
                if (k) {
                    printer.writeBlocks(chalk.cyan, k.topics);
                }
            }
        }
    }

    async function writeEntitiesById(
        index: knowLib.conversation.EntityIndex,
        entityIds: string[],
        showMessages?: boolean,
    ): Promise<void> {
        if (!entityIds || entityIds.length === 0) {
            return;
        }
        if (showMessages) {
            const messages = await loadMessages(
                await index.getSourceIds(entityIds),
            );
            printer.writeTemporalBlocks(chalk.cyan, messages);
        } else {
            const entities = await asyncArray.mapAsync(
                entityIds,
                context.searchConcurrency,
                (id) => index.get(id),
            );
            const composite = conversation.mergeEntities(
                knowLib.sets.removeUndefined(entities.map((e) => e?.value)),
            );
            for (const value of composite.values()) {
                printer.writeCompositeEntity(value.value);
                printer.writeLine();
            }
        }
    }

    function writeList(title: string, list?: string[]): void {
        if (list && list.length > 0) {
            if (title.length > 0) {
                printer.writeUnderline(title);
            }
            printer.writeList(list, { type: "ul" });
        }
    }

    async function writeTopicResults(
        topicIndex: knowLib.conversation.TopicIndex,
        response: conversation.SearchResponse,
        logMode: boolean,
        showMessages: boolean,
    ) {
        if (!logMode) {
            const topics = [...response.allTopics()].sort();
            if (topics.length > 0) {
                printer.writeListInColor(chalk.blueBright, topics, {
                    type: "ul",
                });
            }
            return;
        }

        const results = response.topics;
        printer.writeTitle("Topics");
        const topicIds = [];
        for (let i = 0; i < results.length; ++i) {
            const result = results[i];
            if (result.temporalSequence) {
                for (const entry of result.temporalSequence) {
                    const topics = await topicIndex.getMultiple(entry.value);
                    printer.writeLine();
                    printer.writeTimestamp(entry.timestamp);
                    await writeExtractedTopics(topics, showMessages);
                    topicIds.push(...entry.value);
                }
            } else if (result.topicIds) {
                const topics = await topicIndex.getMultiple(result.topicIds);
                await writeExtractedTopics(topics, false);
                topicIds.push(...result.topicIds);
            }
            if (showMessages && topicIds.length > 0) {
                const messages = await loadMessages(
                    await topicIndex.getSourceIds(topicIds),
                );
                printer.writeTemporalBlocks(chalk.cyan, messages);
            }
        }
        printer.writeLine();
    }

    async function writeEntityResults(
        entityIndex: knowLib.conversation.EntityIndex,
        response: conversation.SearchResponse,
        logMode: boolean,
        showMessages: boolean,
    ) {
        if (!logMode) {
            const entities = response.mergeAllEntities(3);
            if (entities.length > 0) {
                printer.writeListInColor(
                    chalk.green,
                    entities.map((e) => conversation.entityToString(e)),
                    { type: "ul" },
                );
            }
            return;
        }

        const results = response.entities;
        printer.writeTitle("Entities");
        const entityIds = [];
        for (let i = 0; i < results.length; ++i) {
            const result = results[i];
            if (result.temporalSequence) {
                for (const entry of result.temporalSequence) {
                    const entities = await entityIndex.getMultiple(entry.value);
                    printer.writeLine();
                    printer.writeTimestamp(entry.timestamp);
                    printer.writeExtractedEntities(entities);
                    entityIds.push(...entry.value);
                }
            } else if (result.entityIds) {
                const entities = await entityIndex.getMultiple(
                    result.entityIds,
                );
                printer.writeExtractedEntities(entities);
                entityIds.push(...result.entityIds);
            }
            if (showMessages && entityIds.length > 0) {
                const messages = await loadMessages(
                    await entityIndex.getSourceIds(entityIds),
                );
                printer.writeTemporalBlocks(chalk.cyan, messages);
            }
        }
        printer.writeLine();
    }

    async function loadMessages(
        ids?: string[],
    ): Promise<(dateTime.Timestamped<knowLib.TextBlock> | undefined)[]> {
        if (ids && ids.length > 0) {
            return await context.conversation.messages.getMultiple(ids);
        }
        return [];
    }

    function writeProgress(value: string, i: number, total: number) {
        printer.writeLine(`${i + 1}/${total} ${value}`);
    }
}
