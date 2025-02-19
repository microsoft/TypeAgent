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
import { dateTime, ensureDir, readJsonFile, writeJsonFile } from "typeagent";
import path from "path";
import chalk from "chalk";
import { KnowProPrinter } from "./knowproPrinter.js";

type KnowProContext = {
    knowledgeModel: ChatModel;
    basePath: string;
    printer: KnowProPrinter;
    podcast?: kp.Podcast | undefined;
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

    /*----------------
     * COMMANDS
     *---------------*/
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

            const timer = new StopWatch();
            timer.start();
            const matches = await kp.searchConversation(
                conversation,
                createSearchGroup(
                    termArgs,
                    namedArgs,
                    commandDef,
                    namedArgs.andTerms,
                ),
                whenFilterFromNamedArgs(namedArgs, commandDef),
                {
                    exactMatch: namedArgs.exact,
                    usePropertyIndex: namedArgs.usePropertyIndex,
                    useTimestampIndex: namedArgs.useTimestampIndex,
                },
            );
            timer.stop();
            if (matches && matches.size > 0) {
                context.printer.writeLine();
                context.printer.writeSearchResults(
                    conversation,
                    matches,
                    namedArgs.maxToDisplay,
                );
            } else {
                context.printer.writeLine("No matches");
            }
            context.printer.writeTiming(chalk.gray, timer);
        } else {
            context.printer.writeError("Conversation is not indexed");
        }
    }

    function createSearchGroup(
        termArgs: string[],
        namedArgs: NamedArgs,
        commandDef: CommandMetadata,
        andTerms: boolean = false,
    ): kp.SearchTermGroup {
        const searchTerms = parseQueryTerms(termArgs);
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
        return createPropertyTerms(namedArgs, commandDef);
    }

    function createPropertyTerms(
        namedArgs: NamedArgs,
        commandDef: CommandMetadata,
        nameFilter?: (name: string) => boolean,
    ): kp.PropertySearchTerm[] {
        const keyValues = keyValuesFromNamedArgs(namedArgs, commandDef);
        const propertyNames = nameFilter
            ? Object.keys(keyValues).filter(nameFilter)
            : Object.keys(keyValues);
        const propertySearchTerms: kp.PropertySearchTerm[] = [];
        for (const propertyName of propertyNames) {
            const allValues = splitTermValues(keyValues[propertyName]);
            for (const value of allValues) {
                propertySearchTerms.push(
                    kp.propertySearchTermFromKeyValue(propertyName, value),
                );
            }
        }
        return propertySearchTerms;
    }

    function whenFilterFromNamedArgs(
        namedArgs: NamedArgs,
        commandDef: CommandMetadata,
    ): kp.WhenFilter {
        let filter: kp.WhenFilter = {
            knowledgeType: namedArgs.ktype,
        };
        const dateRange = kp.getTimeRangeForConversation(context.podcast!);
        if (dateRange && namedArgs.startMinute >= 0) {
            filter.inDateRange = {
                start: dateTime.addMinutesToDate(
                    dateRange.start,
                    namedArgs.startMinute,
                ),
            };
            if (namedArgs.endMinute) {
                filter.inDateRange.end = dateTime.addMinutesToDate(
                    dateRange.start,
                    namedArgs.endMinute,
                );
            }
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
                knowledge: argBool("Index knowledge", false),
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
        context.printer.writeLine(
            `Build knowledge: ${namedArgs.knowledge}\nBuild related terms: ${namedArgs.related}\n`,
        );
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
            context.printer.writeLine("Building related terms index");
            const progress = new ProgressBar(
                context.printer,
                context.podcast.semanticRefIndex.size,
            );
            await context.podcast.buildRelatedTermsIndex(16, (batch) => {
                progress.advance(batch.length);
                return true;
            });
            progress.complete();
            context.printer.writeLine(
                `Indexed ${context.podcast.semanticRefIndex.size} terms`,
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
        let allTermStrings = splitTermValues(arg);
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

function splitTermValues(term: string): string[] {
    let allTermStrings = knowLib.split(term, ";", {
        trim: true,
        removeEmpty: true,
    });
    return allTermStrings;
}
