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

        context.printer.writeLine();
        context.printer.writeLine("Building index");
        const maxMessages = namedArgs.maxMessages ?? messageCount;
        let progress = new ProgressBar(context.printer, maxMessages);
        const indexResult = await context.podcast.buildIndex(() => {
            progress.advance();
            return progress.count < maxMessages;
        });
        progress.complete();
        if (!indexResult.success) {
            context.printer.writeError(indexResult.message);
            return;
        }
        context.printer.writeLine(`Imported ${maxMessages} items`);
        if (namedArgs.index) {
            namedArgs.filePath = sourcePathToIndexPath(
                namedArgs.filePath,
                namedArgs.indexFilePath,
            );
            await podcastSave(namedArgs);
        }
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
    }

    commands.kpSearchTerms.metadata =
        "Search current knowPro conversation by terms";
    async function searchTerms(args: string[]): Promise<void> {
        if (args.length === 0) {
            return;
        }
        const conversation = context.conversation;
        if (!conversation) {
            context.printer.writeError("No conversation loaded");
            return;
        }
        const terms = args; // Todo: De dupe
        if (conversation.semanticRefIndex && conversation.semanticRefs) {
            context.printer.writeInColor(
                chalk.cyan,
                `Searching ${conversation.nameTag}...`,
            );
            const matches = kp.lookupTermsInIndex(
                terms,
                conversation.semanticRefIndex,
            );
            for (const [term, scoredRefs] of matches) {
                if (scoredRefs && scoredRefs.length > 0) {
                    context.printer.writeInColor(chalk.cyan, term);
                    for (const scoredRef of scoredRefs) {
                        context.printer.writeSemanticRef(
                            conversation.semanticRefs[
                                scoredRef.semanticRefIndex
                            ],
                            scoredRef.score,
                        );
                    }
                }
            }
        } else {
            context.printer.writeError("Conversation is not indexed");
        }
    }

    /*---------- 
      End COMMANDS
    ------------*/

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
    }

    public writeConversationInfo(conversation: kp.IConversation) {
        this.writeTitle(conversation.nameTag);
        this.writeLine(`${conversation.messages.length} messages`);
    }

    public writePodcastInfo(podcast: kp.Podcast) {
        this.writeConversationInfo(podcast);
        this.writeList(getPodcastParticipants(podcast), {
            type: "csv",
            title: "Participants",
        });
    }
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
