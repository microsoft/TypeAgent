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
    arg,
    argBool,
    argNum,
    parseNamedArguments,
    runConsole,
} from "interactive-app";
import {
    asyncArray,
    collections,
    dateTime,
    getFileName,
    isDirectoryPath,
    readAllText,
} from "typeagent";
import chalk, { ChalkInstance } from "chalk";
import { ChatMemoryPrinter } from "./chatMemoryPrinter.js";
import { importMsgFiles, timestampBlocks } from "./importer.js";
import path from "path";
import fs from "fs";
import {
    argChunkSize,
    argClean,
    argConcurrency,
    argDestFile,
    argMinScore,
    argPause,
    argSourceFile,
    argSourceFileOrFolder,
    getMessagesAndCount,
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
    actionTopK: number;
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

export async function createChatMemoryContext(
    completionCallback?: (req: any, resp: any) => void,
): Promise<ChatContext> {
    const storePath = "/data/testChat";
    const chatModel = openai.createChatModelDefault("chatMemory");
    chatModel.completionCallback = completionCallback;
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
    const conversationManager =
        await knowLib.conversation.createConversationManager(
            conversationName,
            conversationPath,
            false,
            conversation,
            chatModel,
        );
    const entityTopK = 16;
    const actionTopK = 16;
    const context: ChatContext = {
        storePath,
        chatModel,
        embeddingModel,
        maxCharsPerChunk: 4096,
        topicWindowSize: 8,
        searchConcurrency: 2,
        minScore: 0.9,
        conversationName,
        conversationManager,
        conversationSettings,
        conversation,
        entityTopK,
        actionTopK,
        searcher: configureSearchProcessor(
            conversationManager,
            entityTopK,
            actionTopK,
        ),
        emailMemory: await knowLib.email.createEmailMemory(
            chatModel,
            ReservedConversationNames.outlook,
            storePath,
            conversationSettings,
        ),
    };
    context.searchMemory = await createSearchMemory(context);
    return context;
}

function createConversationSettings(
    embeddingModel?: TextEmbeddingModel,
): conversation.ConversationSettings {
    return conversation.createConversationSettings(embeddingModel);
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

export function configureSearchProcessor(
    cm: conversation.ConversationManager,
    entityTopK: number,
    actionTopK: number,
) {
    const answers = cm.searchProcessor.answers;
    answers.settings.topK.entitiesTopK = entityTopK;
    answers.settings.topK.actionsTopK = actionTopK;
    return cm.searchProcessor;
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
    memory.searchProcessor.answers.settings.topK.entitiesTopK =
        context.entityTopK;
    return memory;
}

export async function loadConversation(
    context: ChatContext,
    name: string,
    rootPath?: string,
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
                context.chatModel,
            );
    } else {
        context.conversation = reservedCm.conversation;
        context.conversationName = name;
        context.conversationManager = reservedCm;
        context.searcher = reservedCm.searchProcessor;
        exists = true;
    }
    context.searcher = configureSearchProcessor(
        context.conversationManager,
        context.entityTopK,
        context.actionTopK,
    );
    if (name !== "search") {
        context.searchMemory = await createSearchMemory(context);
    }
    return exists;
}

export async function runChatMemory(): Promise<void> {
    let context = await createChatMemoryContext(printStats);
    let showTokenStats = true;
    let printer: ChatMemoryPrinter;
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
        searchV2Debug,
        makeTestSet,
        runTestSet,
        tokenLog,
    };
    addStandardHandlers(handlers);
    await runConsole({
        onStart,
        inputHandler,
        handlers,
    });

    function onStart(io: InteractiveIo): void {
        printer = new ChatMemoryPrinter(io);
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

    function printStats(req: any, response: any): void {
        if (showTokenStats) {
            printer.writeCompletionStats(response.usage);
            printer.writeLine();
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
                message: arg("Raw message text to add"),
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
                concurrency: argConcurrency(1),
                clean: argClean(),
                chunkSize: argChunkSize(context.maxCharsPerChunk),
            },
        };
    }
    handlers.importEmail.metadata = importEmailDef();
    async function importEmail(args: string[], io: InteractiveIo) {
        const namedArgs = parseNamedArguments(args, importEmailDef());
        let sourcePath: string = namedArgs.sourcePath;
        let isDir = isDirectoryPath(sourcePath);
        let isJson = sourcePath.endsWith("json");
        if (isDir && !isJson) {
            printer.writeInColor(chalk.cyan, "Converting message files");
            await importMsgFiles(sourcePath, io);
            sourcePath = path.join(sourcePath, "json");
        }
        if (isDir) {
            printer.writeInColor(chalk.cyan, "Adding emails to memory");
            if (namedArgs.clean) {
                await context.emailMemory.clear(true);
            }
            const emails = await knowLib.email.loadEmailFolder(
                sourcePath,
                namedArgs.concurrency,
            );
            let i = 0;
            for (const emailBatch of collections.slices(
                emails,
                namedArgs.concurrency,
            )) {
                ++i;
                printer.writeBatchProgress(
                    emailBatch,
                    undefined,
                    emails.length,
                );
                emailBatch.value.forEach((e) =>
                    printer.writeLine(
                        `${e.sourcePath}\n${knowLib.email.emailToString(e).length} chars`,
                    ),
                );
                await knowLib.email.addEmailToConversation(
                    context.emailMemory,
                    emailBatch.value,
                    namedArgs.chunkSize,
                );
            }
        } else if (isJson) {
            if (
                !(await knowLib.email.addEmailFileToConversation(
                    context.emailMemory,
                    sourcePath,
                    namedArgs.chunkSize,
                ))
            ) {
                printer.writeLine(`Could not load ${sourcePath}`);
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
                name: arg("Conversation name"),
                actions: argBool("Use actions in search", true),
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
                if (await loadConversation(context, name, storePath)) {
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
            description:
                "Extract knowledge from the messages in the current conversation",
            options: {
                maxTurns: argNum("Number of turns to run"),
                concurrency: argConcurrency(2),
                pause: argPause(),
            },
        };
    }
    handlers.knowledge.metadata = knowledgeDef();
    async function knowledge(args: string[], io: InteractiveIo) {
        const namedArgs = parseNamedArguments(args, knowledgeDef());
        const extractor = conversation.createKnowledgeExtractor(
            context.chatModel,
            {
                maxContextLength: context.maxCharsPerChunk,
                mergeActionKnowledge: false,
            },
        );

        let [messages, msgCount] = await getMessagesAndCount(
            context.conversationManager,
            namedArgs.maxTurns,
        );
        await asyncArray.forEachBatch(
            messages,
            namedArgs.concurrency,
            (batch) => {
                printer.writeBatchProgress(batch, "Messages", msgCount);
                return batch.value.map((message) =>
                    extractor.extract(message.value),
                );
            },
            (batch, knowledgeResults) => {
                for (let k = 0; k < knowledgeResults.length; ++k) {
                    const knowledge = knowledgeResults[k];
                    if (knowledge) {
                        printer.writeListInColor(
                            chalk.cyan,
                            batch.value[k].value,
                        );
                        printer.writeKnowledge(knowledge);
                        printer.writeLine();
                    }
                }
            },
        );
    }

    function buildIndexDef(): CommandMetadata {
        return {
            description: "Index all messages in the current conversation",
            options: {
                mergeWindow: argNum("Topic merge window size", 8),
                maxTurns: argNum("Number of turns to run", 10),
                concurrency: argConcurrency(2),
                pause: argPause(),
                actions: argBool("Index actions", true),
            },
        };
    }
    handlers.buildIndex.metadata = buildIndexDef();
    async function buildIndex(
        args: string[],
        io: InteractiveIo,
    ): Promise<void> {
        const namedArgs = parseNamedArguments(args, buildIndexDef());
        const cm = context.conversationManager;
        await cm.clear(false);

        let [messages, msgCount] = await getMessagesAndCount(
            cm,
            namedArgs.maxTurns,
        );
        let messageIndex = await context.conversation.getMessageIndex();
        cm.topicMerger.settings.mergeWindowSize = namedArgs.mergeWindow;

        let count = 0;
        const concurrency = namedArgs.concurrency;
        for await (const slice of asyncArray.readBatches(
            messages,
            concurrency,
        )) {
            printer.writeBatchProgress(slice, "Indexing messages", msgCount);
            await asyncArray.mapAsync(slice.value, concurrency, (m) =>
                messageIndex.put(m.value, m.blockId),
            );
            printer.writeBatchProgress(slice, "Extracting knowledge", msgCount);
            const knowledgeResults = await conversation.extractKnowledge(
                cm.knowledgeExtractor,
                slice.value,
                concurrency,
            );
            for (const knowledgeResult of knowledgeResults) {
                ++count;
                printer.writeProgress(count, msgCount);
                if (!knowledgeResult) {
                    continue;
                }
                const [message, knowledge] = knowledgeResult;
                await writeKnowledgeResult(message, knowledge);
                const knowledgeIds =
                    await cm.conversation.addKnowledgeForMessage(
                        message,
                        knowledge,
                    );
                if (knowledgeIds.topicIds && knowledgeIds.topicIds.length > 0) {
                    const mergedTopic = await cm.topicMerger.next(
                        knowledge.topics!,
                        knowledgeIds.topicIds,
                        undefined,
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
                await cm.conversation.addKnowledgeToIndex(
                    knowledge,
                    knowledgeIds,
                );
                printer.writeLine();
            }
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
                query: arg("value to search for"),
                exact: argBool("Exact match?"),
                count: argNum("Num matches", 3),
                minScore: argMinScore(0),
                showSource: argBool("Show the sources of this topic"),
                level: argNum("Topics at this level", 1),
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

        const sourceIndex =
            namedArgs.level > 1
                ? await context.conversation.getTopicsIndex(namedArgs.level - 1)
                : undefined;
        for await (const topic of index.entries()) {
            await writeExtractedTopic(topic, namedArgs.showSource, sourceIndex);
        }
    }

    function entitiesDef(): CommandMetadata {
        return {
            description: "Search for entities",
            options: {
                name: arg("Names to search for"),
                type: arg("Type to search for"),
                facet: arg("Facet to search for"),
                exact: argBool("Exact match?"),
                count: argNum("Num matches", 1),
                facetCount: argNum("Num facet matches", 10),
                minScore: argNum("Min score", 0),
                showMessages: argBool(),
            },
        };
    }
    handlers.entities.metadata = entitiesDef();
    async function entities(args: string[], io: InteractiveIo) {
        const namedArgs = parseNamedArguments(args, entitiesDef());
        let query = namedArgs.name ?? namedArgs.type ?? namedArgs.facet;
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
                subject: arg(
                    "Subject to search for",
                    conversation.NoEntityName,
                ),
                object: arg("Object to search for"),
                indirectObject: arg("Indirect object to search for"),
                verb: arg(
                    "Verb to search for. Compound verbs are comma separated",
                ),
                tense: arg("Verb tense: past | present | future", "past"),
                count: argNum("Num action matches", 1),
                verbCount: argNum("Num verb matches", 1),
                nameCount: argNum("Num name matches", 3),
                showMessages: argBool("display messages", false),
            },
        };
    }
    handlers.actions.metadata = actionsDef();
    async function actions(args: string[], io: InteractiveIo) {
        const index = await context.conversation.getActionIndex();
        if (args.length === 0) {
            const actions = (await asyncArray.toArray(index.entries())).map(
                (a) => a.value,
            );
            const merged = conversation.mergeActions(actions);
            printer.writeActionGroups(merged);
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
                const allVerbs = await index.getAllVerbs();
                printer.writeList(allVerbs, { type: "ul" });
                return;
            }
        }
        // Full search
        const filter: conversation.ActionFilter = {
            filterType: "Action",
            subjectEntityName: namedArgs.subject,
            objectEntityName: namedArgs.object,
            indirectObjectEntityName: namedArgs.indirectObject,
        };
        if (verbs && verbs.length > 0) {
            filter.verbFilter = {
                verbs,
                verbTense,
            };
        }
        const searchOptions = conversation.createActionSearchOptions(true);
        searchOptions.verbSearchOptions!.maxMatches = namedArgs.verbCount;
        searchOptions.maxMatches = namedArgs.nameCount;
        const matches = await index.search(filter, searchOptions);
        if (matches.actions) {
            for (let i = 0; i < matches.actions.length; ++i) {
                printer.writeLine(
                    `${i + 1}, ${conversation.actionToString(matches.actions[i])}`,
                );
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
                query: arg("Search query"),
            },
            options: {
                maxMatches: argNum("Maximum fuzzy matches", 2),
                minScore: argNum("Minimum similarity score", 0.8),
                fallback: argBool("Fallback to message search", true),
                eval: argBool("Evaluate search query", true),
                debug: argBool("Show debug info", false),
                save: argBool("Save the search", false),
                v2: argBool("Run V2 match", false),
                chunk: argBool("Use chunking", true),
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
            progress: (value) => printer.writeJson(value),
        };
        if (namedArgs.fallback) {
            searchOptions.fallbackSearch = { maxMatches: 10 };
        }
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

    function searchV2DebugDef(): CommandMetadata {
        return {
            description: "Search by terms V2",
            args: {
                query: arg("Query to run"),
            },
        };
    }
    handlers.searchV2Debug.metadata = searchV2DebugDef();
    async function searchV2Debug(args: string[]): Promise<void> {
        const namedArgs = parseNamedArguments(args, searchV2DebugDef());
        const result = await context.searcher.actions.translateSearchTermsV2(
            namedArgs.query,
        );
        if (!result.success) {
            printer.writeError(result.message);
            return;
        }
        printer.writeJson(result.data, true);
        if (result.data.actionName === "getAnswer") {
            const searchResponse = await context.conversation.searchTermsV2(
                result.data.parameters.filters,
            );
            printer.writeSearchResponse(searchResponse);
        }
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

    function tokenLogDef(): CommandMetadata {
        return {
            description: "Enable token logging",
            options: {
                enable: argBool(),
            },
        };
    }
    handlers.tokenLog.metadata = tokenLogDef();
    async function tokenLog(args: string[]) {
        const namedArgs = parseNamedArguments(args, tokenLogDef());
        showTokenStats =
            namedArgs.enable !== undefined ? namedArgs.enable : showTokenStats;
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
            maxMessages: 10,
            progress: (value) => printer.writeJson(value),
        };
        if (namedArgs.fallback) {
            searchOptions.fallbackSearch = { maxMatches: 10 };
        }
        if (!namedArgs.eval) {
            await searchNoEval(query, searchOptions);
            return;
        }

        searcher.answers.settings.chunking.enable = true; //namedArgs.chunk === true;

        const timestampQ = new Date();
        let result:
            | conversation.SearchTermsActionResponse
            | conversation.SearchTermsActionResponseV2
            | undefined;
        if (namedArgs.v2) {
            result = await searcher.searchTermsV2(
                query,
                undefined,
                searchOptions,
            );
        } else {
            result = await searcher.searchTerms(
                query,
                undefined,
                searchOptions,
            );
        }
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
        result:
            | conversation.SearchTermsActionResponse
            | conversation.SearchTermsActionResponseV2,
        debug: boolean,
    ) {
        if (result.response && result.response.answer) {
            writeResultStats(result.response);
            if (result.response.answer.answer) {
                const answer = result.response.answer.answer;
                printer.writeInColor(chalk.green, answer);
            } else if (result.response.answer.whyNoAnswer) {
                const answer = result.response.answer.whyNoAnswer;
                printer.writeInColor(chalk.red, answer);
            }
            printer.writeLine();
            if (debug) {
                printer.writeSearchResponse(result.response);
            }
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
            printer.writeSearchResponse(rr.response);
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
        const urlGet = context.conversation.messages.getUrl;
        if (rr && rr.messageIds && urlGet !== undefined) {
            const links = rr.messageIds.map((id) => urlGet(id).toString());
            printer.writeList(links, { type: "ul" });
        }
    }

    function writeResultStats(
        response: conversation.SearchResponse | undefined,
    ): void {
        if (response !== undefined) {
            const allTopics = response.getTopics();
            if (allTopics && allTopics.length > 0) {
                printer.writeLine(`Topic Hit Count: ${allTopics.length}`);
            } else {
                const topicIds = new Set(response.allTopicIds());
                printer.writeLine(`Topic Hit Count: ${topicIds.size}`);
            }
            const allEntities = response.getEntities();
            if (allEntities && allEntities.length > 0) {
                printer.writeLine(`Entity Hit Count: ${allEntities.length}`);
            } else {
                const entityIds = new Set(response.allEntityIds());
                printer.writeLine(
                    `Entity to Message Hit Count: ${entityIds.size}`,
                );
            }
            const allActions = response.getActions();
            //const allActions = [...response.allActionIds()];
            if (allActions && allActions.length > 0) {
                printer.writeLine(`Action Hit Count: ${allActions.length}`);
            } else {
                const actionIds = new Set(response.allActionIds());
                printer.writeLine(
                    `Action to Message Hit Count: ${actionIds.size}`,
                );
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

    async function writeExtractedTopic(
        topic: knowLib.TextBlock,
        showSource: boolean,
        sourceIndex?: conversation.TopicIndex | undefined,
    ) {
        printer.writeBullet(topic.value);
        if (showSource) {
            if (sourceIndex) {
                const textBlocks = await loadTopics(
                    sourceIndex,
                    topic.sourceIds,
                );
                printer.writeListInColor(chalk.greenBright, textBlocks);
            } else {
                const textBlocks = await loadMessages(topic.sourceIds);
                printer.writeTemporalBlocks(chalk.greenBright, textBlocks);
            }
        }
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

    async function loadMessages(
        ids?: string[],
    ): Promise<(dateTime.Timestamped<knowLib.TextBlock> | undefined)[]> {
        if (ids && ids.length > 0) {
            return await context.conversation.messages.getMultiple(ids);
        }
        return [];
    }

    async function loadTopics(
        topicLevel: conversation.TopicIndex | number,
        ids?: string[],
    ) {
        if (ids && ids.length > 0) {
            const index =
                typeof topicLevel === "number"
                    ? await context.conversation.getTopicsIndex(topicLevel - 1)
                    : topicLevel;
            return index.getMultipleText(ids);
        }
        return [];
    }

    function writeProgress(value: string, i: number, total: number) {
        printer.writeLine(`${i + 1}/${total} ${value}`);
    }
}
