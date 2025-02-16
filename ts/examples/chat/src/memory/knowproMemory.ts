// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as kp from "knowpro";
import * as knowLib from "knowledge-processor";
import {
    arg,
    argBool,
    argNum,
    CommandHandler,
    CommandMetadata,
    NamedArgs,
    parseNamedArguments,
    ProgressBar,
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
import { dateTime, ensureDir, readJsonFile, writeJsonFile } from "typeagent";
import path from "path";
import chalk from "chalk";
import { KnowProPrinter } from "./knowproPrinter.js";

type KnowProContext = {
    knowledgeModel: ChatModel;
    basePath: string;
    printer: KnowProPrinter;
    podcast?: kp.Podcast | undefined;
    images?: kp.ImageCollection | undefined;
    conversation?: kp.IConversation | undefined;
};

export async function createKnowproCommands(
    chatContext: ChatContext,
    commands: Record<string, CommandHandler>,
): Promise<void> {
    const context: KnowProContext = {
        knowledgeModel: chatContext.models.chatModel,
        basePath: "/data/testChat/knowpro",
        printer: new KnowProPrinter(),
    };
    await ensureDir(context.basePath);

    commands.kpPodcastMessages = showMessages;
    commands.kpPodcastImport = podcastImport;
    commands.kpPodcastTimestamp = podcastTimestamp;
    commands.kpPodcastSave = podcastSave;
    commands.kpPodcastLoad = podcastLoad;
    commands.kpSearchTerms = searchTerms;
    commands.kpEntities = entities;
    commands.kpPodcastBuildIndex = podcastBuildIndex;

    commands.kpImages = showImages;
    commands.kpImageImport = imageImport;    
    commands.kpImageCollectionSave = imagesSave;
    commands.kpImageCollectionLoad = imagesLoad;
    commands.kpImageCollectionBuildIndex = imagesBuildIndex;


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
        messages.forEach((m) => context.printer.writeMessage(m));
    }

    function podcastImportDef(): CommandMetadata {
        return {
            description: "Create knowPro index",
            args: {
                filePath: arg("File path to transcript file"),
            },
            options: {
                knowLedge: argBool("Index knowledge", true),
                related: argBool("Index related terms", true),
                indexFilePath: arg("Output path for index file"),
                maxMessages: argNum("Maximum messages to index"),
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
        context.podcast = await kp.importPodcast(namedArgs.filePath);
        context.conversation = context.podcast;
        context.printer.writeLine("Imported podcast:");
        context.printer.writePodcastInfo(context.podcast);

        if (!namedArgs.index) {
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

    function podcastTimestampDef(): CommandMetadata {
        return {
            description: "Set timestamps",
            args: {
                startAt: arg("Start date and time"),
            },
            options: {
                length: argNum("Length of the podcast in minutes", 60),
            },
        };
    }
    commands.kpPodcastTimestamp.metadata = podcastTimestampDef();
    async function podcastTimestamp(args: string[]) {
        const conversation = ensureConversationLoaded();
        if (!conversation) {
            return;
        }
        const namedArgs = parseNamedArguments(args, podcastTimestampDef());
        const startAt = argToDate(namedArgs.startAt)!;
        const endAt = dateTime.addMinutesToDate(startAt, namedArgs.length);
        kp.timestampMessages(conversation.messages, startAt, endAt);
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
        const cData = context.podcast.serialize();
        await ensureDir(path.dirname(namedArgs.filePath));
        await writeJsonFile(namedArgs.filePath, cData);
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
        if (!fs.existsSync(podcastFilePath)) {
            context.printer.writeError(`${podcastFilePath} not found`);
            return;
        }

        const data = await readJsonFile<kp.PodcastData>(podcastFilePath);
        if (!data) {
            context.printer.writeError("Could not load podcast data");
            return;
        }
        context.podcast = new kp.Podcast(
            data.nameTag,
            data.messages,
            data.tags,
            data.semanticRefs,
        );
        context.podcast.deserialize(data);
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
        messages.forEach((m) => context.printer.writeMessage(m));
    }

    function imageImportDef(): CommandMetadata {
        return {
            description: "Create knowPro image index",
            args: {
                filePath: arg("File path to an image file or folder"),
            },
            options: {
                knowLedge: argBool("Index knowledge", true),
                related: argBool("Index related terms", true),
                indexFilePath: arg("Output path for index file"),
                maxMessages: argNum("Maximum images to index"),
            },
        };
    }
    commands.kpImageImport.metadata = imageImportDef();
    async function imageImport(args: string[]): Promise<void> {
        const namedArgs = parseNamedArguments(args, imageImportDef());
        if (!fs.existsSync(namedArgs.filePath)) {
            context.printer.writeError(`${namedArgs.filePath} not found`);
            return;
        }
        context.images = await kp.importImageCollection(namedArgs.filePath);
        context.conversation = context.images;
        context.printer.writeLine("Imported images:");
        context.printer.writeImageCollectionInfo(context.images);

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
    
    commands.kpPodcastSave.metadata = imagesSaveDef();
    async function imagesSave(args: string[] | NamedArgs): Promise<void> {
        const namedArgs = parseNamedArguments(args, imagesSaveDef());
        if (!context.podcast) {
            context.printer.writeError("No image collection loaded");
            return;
        }
        context.printer.writeLine("Saving index");
        context.printer.writeLine(namedArgs.filePath);
        const cData = context.images?.serialize();
        await ensureDir(path.dirname(namedArgs.filePath));
        await writeJsonFile(namedArgs.filePath, cData);
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

    commands.kpPodcastLoad.metadata = imagesLoadDef();
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
        if (!fs.existsSync(imagesFilePath)) {
            context.printer.writeError(`${imagesFilePath} not found`);
            return;
        }

        const data = await readJsonFile<kp.ImageCollectionData>(imagesFilePath);
        if (!data) {
            context.printer.writeError("Could not load image collection data");
            return;
        }
        context.images = new kp.ImageCollection(
            data.nameTag,
            data.messages,
            data.tags,
            data.semanticRefs,
        );
        context.images.deserialize(data);
        context.conversation = context.podcast;
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
                description ?? "Search current knowPro conversation by terms",
            options: {
                maxToDisplay: argNum("Maximum matches to display", 25),
                displayAsc: argBool("Display results in ascending order", true),
                startMinute: argNum("Starting at minute."),
                endMinute: argNum("Ending minute."),
                exact: argBool("Only display exact matches", false),
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
        const terms = parseQueryTerms(termArgs);
        if (conversation.semanticRefIndex && conversation.semanticRefs) {
            context.printer.writeInColor(
                chalk.cyan,
                `Searching ${conversation.nameTag}...`,
            );

            const matches = await kp.searchConversation(
                conversation,
                terms,
                propertyTermsFromNamedArgs(namedArgs, commandDef),
                filterFromNamedArgs(namedArgs, commandDef),
                undefined,
                namedArgs.exact ? 1 : undefined,
            );
            if (matches === undefined || matches.size === 0) {
                context.printer.writeLine("No matches");
                return;
            }
            context.printer.writeLine();
            context.printer.writeSearchResults(
                conversation,
                matches,
                namedArgs.maxToDisplay,
            );
        } else {
            ``;
            context.printer.writeError("Conversation is not indexed");
        }
    }

    function propertyTermsFromNamedArgs(
        namedArgs: NamedArgs,
        commandDef: CommandMetadata,
    ): kp.PropertySearchTerm[] {
        return createPropertyTerms(namedArgs, commandDef, undefined, (name) => {
            if (name.startsWith("@")) {
                return name.substring(1);
            }
            return name;
        });
    }

    function propertyScopeTermsFromNamedArgs(
        namedArgs: NamedArgs,
        commandDef: CommandMetadata,
    ): kp.PropertySearchTerm[] {
        return createPropertyTerms(
            namedArgs,
            commandDef,
            (name) => name.startsWith("@"),
            (name) => name.substring(1),
        );
    }

    function createPropertyTerms(
        namedArgs: NamedArgs,
        commandDef: CommandMetadata,
        nameFilter?: (name: string) => boolean,
        nameModifier?: (name: string) => string,
    ): kp.PropertySearchTerm[] {
        const keyValues = keyValuesFromNamedArgs(namedArgs, commandDef);
        const propertyNames = nameFilter
            ? Object.keys(keyValues).filter(nameFilter)
            : Object.keys(keyValues);
        return propertyNames.map((propertyName) =>
            kp.propertySearchTermFromKeyValue(
                nameModifier ? nameModifier(propertyName) : propertyName,
                keyValues[propertyName],
            ),
        );
    }

    function filterFromNamedArgs(
        namedArgs: NamedArgs,
        commandDef: CommandMetadata,
    ) {
        let filter: kp.SearchFilter = {
            type: namedArgs.ktype,
        };
        const dateRange = kp.getTimeRangeForConversation(context.podcast!);
        if (dateRange && namedArgs.startMinute >= 0) {
            filter.dateRange = {
                start: dateTime.addMinutesToDate(
                    dateRange.start,
                    namedArgs.startMinute,
                ),
            };
            if (namedArgs.endMinute) {
                filter.dateRange.end = dateTime.addMinutesToDate(
                    dateRange.start,
                    namedArgs.endMinute,
                );
            }
        }
        const propertyScope = propertyScopeTermsFromNamedArgs(
            namedArgs,
            commandDef,
        );
        if (propertyScope.length > 0) {
            filter.propertyScope = propertyScope;
        }
        return filter;
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
                knowLedge: argBool("Index knowledge", false),
                related: argBool("Index related terms", false),
                maxMessages: argNum("Maximum messages to index"),
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
        if (!context.podcast.semanticRefIndex) {
            context.printer.writeError("Podcast not indexed");
            return;
        }
        const messageCount = context.podcast.messages.length;
        if (messageCount === 0) {
            return;
        }

        const namedArgs = parseNamedArguments(args, podcastBuildIndexDef());
        // Build index
        context.printer.writeLine();
        context.printer.writeLine("Building index");
        if (namedArgs.knowledge) {
            context.printer.writeLine("Building knowledge index");
            const maxMessages = namedArgs.maxMessages ?? messageCount;
            let progress = new ProgressBar(context.printer, maxMessages);
            const indexResult = await context.podcast.buildIndex(
                (text, result) => {
                    progress.advance();
                    if (!result.success) {
                        context.printer.writeError(
                            `${result.message}\n${text}`,
                        );
                    }
                    return progress.count < maxMessages;
                },
            );
            progress.complete();
            context.printer.writeLine(`Indexed ${maxMessages} items`);
            context.printer.writeIndexingResults(indexResult);
        }
        if (namedArgs.related) {
            context.printer.writeLine("Building semantic index");
            const progress = new ProgressBar(
                context.printer,
                context.podcast.semanticRefIndex.size,
            );
            await context.podcast.buildRelatedTermsIndex(16, (terms, batch) => {
                progress.advance(batch.value.length);
                return true;
            });
            progress.complete();
            context.printer.writeLine(
                `Semantic Indexed ${context.podcast.semanticRefIndex.size} terms`,
            );
        }
    }

    function imageCollectionBuildIndexDef(): CommandMetadata {
        return {
            description: "Build image collection index",
            options: {
                knowLedge: argBool("Index knowledge", false),
                related: argBool("Index related terms", false),
                maxMessages: argNum("Maximum messages to index"),
            },
        };
    }
    commands.kpImageCollectionBuildIndex.metadata = imageCollectionBuildIndexDef();
    async function imagesBuildIndex(
        args: string[] | NamedArgs,
    ): Promise<void> {
        if (!context.images) {
            context.printer.writeError("No image collection loaded");
            return;
        }
        if (!context.images.semanticRefIndex) {
            context.printer.writeError("Image collection is not indexed");
            return;
        }
        const messageCount = context.images.messages.length;
        if (messageCount === 0) {
            return;
        }

        const namedArgs = parseNamedArguments(args, imageCollectionBuildIndexDef());
        // Build index
        context.printer.writeLine();
        context.printer.writeLine("Building index");
        if (namedArgs.knowledge) {
            context.printer.writeLine("Building knowledge index");
            const maxMessages = namedArgs.maxMessages ?? messageCount;
            let progress = new ProgressBar(context.printer, maxMessages);
            const indexResult = await context.images?.buildIndex(
                (text, result) => {
                    progress.advance();
                    if (!result.success) {
                        context.printer.writeError(
                            `${result.message}\n${text}`,
                        );
                    }
                    return progress.count < maxMessages;
                },
            );
            progress.complete();
            context.printer.writeLine(`Indexed ${maxMessages} items`);
            context.printer.writeIndexingResults(indexResult);
        }
        if (namedArgs.related) {
            context.printer.writeLine("Building semantic index");
            const progress = new ProgressBar(
                context.printer,
                context.images?.semanticRefIndex.size,
            );
            await context.images?.buildRelatedTermsIndex(16, (terms, batch) => {
                progress.advance(batch.value.length);
                return true;
            });
            progress.complete();
            context.printer.writeLine(
                `Semantic Indexed ${context.images?.semanticRefIndex.size} terms`,
            );
        }
    }

    /*---------- 
      End COMMANDS
    ------------*/

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

export function parseQueryTerms(args: string[]): kp.SearchTerm[] {
    const queryTerms: kp.SearchTerm[] = [];
    for (const arg of args) {
        let allTermStrings = knowLib.split(arg, ";", {
            trim: true,
            removeEmpty: true,
        });
        if (allTermStrings.length > 0) {
            allTermStrings = allTermStrings.map((t) => t.toLowerCase());
            const queryTerm: kp.SearchTerm = {
                term: { text: allTermStrings[0] },
            };
            if (allTermStrings.length > 1) {
                queryTerm.relatedTerms = [];
                for (let i = 1; i < allTermStrings.length; ++i) {
                    queryTerm.relatedTerms.push({ text: allTermStrings[i] });
                }
            }
            queryTerms.push(queryTerm);
        }
    }
    return queryTerms;
}
