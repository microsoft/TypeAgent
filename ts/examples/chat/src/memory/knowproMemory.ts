// Copyright (c) Microsoft Corporation
// Licensed under the MIT License.

import * as kp from "knowpro";
import {
    arg,
    CommandHandler,
    CommandMetadata,
    parseNamedArguments,
} from "interactive-app";
import { ChatContext } from "./chatMemory.js";
import { ChatModel } from "aiclient";
import fs from "fs";
import { ChatPrinter } from "../chatPrinter.js";

type KnowProContext = {
    knowledgeModel: ChatModel;
    conversation?: kp.ConversationIndex | undefined;
    basePath: string;
    printer: KnowProPrinter;
    podcast?: kp.Podcast | undefined;
};

export async function createKnowproCommands(
    chatContext: ChatContext,
    commands: Record<string, CommandHandler>,
): Promise<void> {
    const context: KnowProContext = {
        knowledgeModel: chatContext.models.chatModel,
        basePath: "/data/testChat",
        printer: new KnowProPrinter(),
    };
    commands.kpImportPodcast = importPodcast;
    commands.kpLoadIndex = loadIndex;
    commands.kpSaveIndex = saveIndex;
    commands.kpSearch = searchIndex;

    function importPodcastDef(): CommandMetadata {
        return {
            description: "Create knowPro index",
            args: {
                filePath: arg("File path to transcript file"),
            },
        };
    }

    commands.kpImportPodcast.metadata = importPodcastDef();
    async function importPodcast(args: string[]): Promise<void> {
        const namedArgs = parseNamedArguments(args, importPodcastDef());
        if (!fs.existsSync(namedArgs.filePath)) {
            context.printer.writeError(`${namedArgs.filePath} not found`);
            return;
        }
        context.printer.writeLine("Imported podcast:");
        context.podcast = await kp.importPodcastFromFile(namedArgs.filePath);
        context.printer.writePodcastInfo(context.podcast);
    }

    commands.kpLoadIndex.metadata = "Load knowPro index";
    async function loadIndex(args: string[]): Promise<void> {}

    commands.kpSaveIndex.metadata = "Save knowPro index";
    async function saveIndex(args: string[]): Promise<void> {}

    commands.kpSearch.metadata = "Search knowPro index";
    async function searchIndex(): Promise<void> {}
}

class KnowProPrinter extends ChatPrinter {
    constructor() {
        super();
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

function getPodcastParticipants(podcast: kp.Podcast) {
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
