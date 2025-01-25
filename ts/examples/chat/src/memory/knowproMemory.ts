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
import { ChatPrinter } from "../chatPrinter.js";
import {
    addFileNameSuffixToPath,
    argDestFile,
    argSourceFile,
} from "./common.js";
import { ensureDir, readJsonFile, writeJsonFile } from "typeagent";
import path from "path";
import chalk from "chalk";

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

    commands.kpPodcastImport = podcastImport;
    commands.kpPodcastSave = podcastSave;
    commands.kpPodcastLoad = podcastLoad;
    commands.kpSearchTerms = searchTerms;
    commands.kpSearchEntities = searchEntities;

    /*----------------
     * COMMANDS
     *---------------*/

    function podcastImportDef(): CommandMetadata {
        return {
            description: "Create knowPro index",
            args: {
                filePath: arg("File path to transcript file"),
            },
            options: {
                index: argBool("Build index", true),
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

        const messageCount = context.podcast.messages.length;
        if (messageCount === 0 || !namedArgs.index) {
            return;
        }
        if (!namedArgs.index) {
            return;
        }

        // Build index
        context.printer.writeLine();
        context.printer.writeLine("Building index");
        const maxMessages = namedArgs.maxMessages ?? messageCount;
        let progress = new ProgressBar(context.printer, maxMessages);
        const indexResult = await context.podcast.buildIndex((text, result) => {
            progress.advance();
            if (!result.success) {
                context.printer.writeError(`${result.message}\n${text}`);
            }
            return progress.count < maxMessages;
        });
        progress.complete();
        context.printer.writeLine(`Indexed ${maxMessages} items`);
        context.printer.writeIndexingResults(indexResult);
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

        const data =
            await readJsonFile<kp.IConversationData<kp.PodcastMessage>>(
                podcastFilePath,
            );
        if (!data) {
            context.printer.writeError("Could not load podcast data");
            return;
        }
        context.podcast = new kp.Podcast(
            data.nameTag,
            data.messages,
            data.tags,
            data.semanticRefs,
            new kp.ConversationIndex(data.semanticIndexData),
        );
        context.conversation = context.podcast;
        context.printer.writePodcastInfo(context.podcast);
    }

    commands.kpSearchTerms.metadata =
        "Search current knowPro conversation by terms";
    async function searchTerms(args: string[]): Promise<void> {
        if (args.length === 0) {
            return;
        }
        const conversation = ensureConversationLoaded();
        if (!conversation) {
            return;
        }
        const terms = parseQueryTerms(args); // Todo: De dupe
        if (conversation.semanticRefIndex && conversation.semanticRefs) {
            context.printer.writeInColor(
                chalk.cyan,
                `Searching ${conversation.nameTag}...`,
            );

            const matches = kp.searchTermsInIndex(
                conversation.semanticRefIndex,
                terms,
                undefined,
            );
            if (!matches.hasMatches) {
                context.printer.writeLine("No matches");
                return;
            }

            context.printer.writeListInColor(chalk.green, matches.termMatches, {
                title: "Matched terms",
                type: "ol",
            });
            for (const match of matches.semanticRefMatches) {
                context.printer.writeSemanticRef(
                    conversation.semanticRefs[match.semanticRefIndex],
                    match.score,
                );
            }
        } else {
            context.printer.writeError("Conversation is not indexed");
        }
    }

    function entitiesDef(): CommandMetadata {
        return {
            description: "Display entities in current conversation",
        };
    }
    commands.kpSearchEntities.metadata = entitiesDef();
    async function searchEntities(args: string[]): Promise<void> {
        const conversation = ensureConversationLoaded();
        if (!conversation) {
            return;
        }
        if (args.length > 0) {
        } else {
            //
            // Display all entities
            //
            const matches = filterSemanticRefsByType(
                conversation.semanticRefs,
                "entity",
            );
            context.printer.writeSemanticRefs(matches);
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

class KnowProPrinter extends ChatPrinter {
    constructor() {
        super();
    }

    public writeEntity(
        entity: knowLib.conversation.ConcreteEntity | undefined,
    ) {
        if (entity) {
            this.writeLine(entity.name.toUpperCase());
            this.writeList(entity.type, { type: "csv" });
            if (entity.facets) {
                const facetList = entity.facets.map((f) =>
                    knowLib.conversation.facetToString(f),
                );
                this.writeList(facetList, { type: "ul" });
            }
        }
        return this;
    }

    public writeSemanticRef(ref: kp.SemanticRef, score?: number | undefined) {
        if (score) {
            this.writeInColor(chalk.greenBright, `[${score}]`);
        }
        switch (ref.knowledgeType) {
            default:
                this.writeLine(ref.knowledgeType);
                break;
            case "entity":
                this.writeEntity(
                    ref.knowledge as knowLib.conversation.ConcreteEntity,
                );
                break;
        }
        return this;
    }

    public writeSemanticRefs(refs: kp.SemanticRef[] | undefined) {
        if (refs && refs.length > 0) {
            for (const ref of refs) {
                this.writeSemanticRef(ref);
                this.writeLine();
            }
        }
        return this;
    }

    public writeConversationInfo(conversation: kp.IConversation) {
        this.writeTitle(conversation.nameTag);
        this.writeLine(`${conversation.messages.length} messages`);
        return this;
    }

    public writePodcastInfo(podcast: kp.Podcast) {
        this.writeConversationInfo(podcast);
        this.writeList(getPodcastParticipants(podcast), {
            type: "csv",
            title: "Participants",
        });
    }

    public writeIndexingResults(results: kp.IndexingResult, verbose = false) {
        if (results.failedMessages.length > 0) {
            this.writeError(
                `Errors for ${results.failedMessages.length} messages`,
            );
            if (verbose) {
                for (const failedMessage of results.failedMessages) {
                    this.writeInColor(
                        chalk.cyan,
                        failedMessage.message.textChunks[0],
                    );
                    this.writeError(failedMessage.error);
                }
            }
        }
    }
}

export function filterSemanticRefsByType(
    semanticRefs: kp.SemanticRef[] | undefined,
    type: string,
): kp.SemanticRef[] {
    const matches: kp.SemanticRef[] = [];
    if (semanticRefs) {
        for (const ref of semanticRefs) {
            if (ref.knowledgeType === type) {
                matches.push(ref);
            }
        }
    }
    return matches;
}

export function getPodcastParticipants(podcast: kp.Podcast) {
    const participants = new Set<string>();
    for (let message of podcast.messages) {
        const meta = message.metadata;
        if (meta.speaker) {
            participants.add(meta.speaker);
        }
        meta.listeners.forEach((l) => participants.add(l));
    }
    return [...participants.values()];
}

export function parseQueryTerms(args: string[]): kp.QueryTerm[] {
    const queryTerms: kp.QueryTerm[] = [];
    for (const arg of args) {
        let allTermStrings = knowLib.split(arg, ";", {
            trim: true,
            removeEmpty: true,
        });
        if (allTermStrings.length > 0) {
            allTermStrings = allTermStrings.map((t) => t.toLowerCase());
            const queryTerm: kp.QueryTerm = {
                term: { text: allTermStrings[0] },
            };
            if (allTermStrings.length > 0) {
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
