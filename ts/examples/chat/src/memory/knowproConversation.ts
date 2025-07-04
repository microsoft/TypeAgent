// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    arg,
    argBool,
    argNum,
    CommandHandler,
    CommandMetadata,
    InteractiveIo,
    parseNamedArguments,
    StopWatch,
} from "interactive-app";
import { KnowProPrinter } from "./knowproPrinter.js";
import * as kp from "knowpro";
import * as cm from "conversation-memory";
import path from "path";

import { KnowproContext } from "./knowproMemory.js";
import { ensureDir, getFileName } from "typeagent";
import chalk from "chalk";

export type KnowproConversationContext = {
    printer: KnowProPrinter;
    conversationMemory?: cm.ConversationMemory | undefined;
    basePath: string;
    defaultName: string;
};

export async function createKnowproConversationCommands(
    kpContext: KnowproContext,
    commands: Record<string, CommandHandler>,
) {
    const context: KnowproConversationContext = {
        printer: kpContext.printer,
        basePath: path.join(kpContext.basePath, "chat"),
        defaultName: "default",
    };

    await ensureDir(context.basePath);

    commands.kpCmLoad = cmLoad;
    commands.kpCmRemember = cmRemember;
    commands.kpCmRecall = cmRecall;
    commands.kpCmHistory = cmHistory;

    function cmRememberDef(): CommandMetadata {
        return {
            description: "Add to conversation memory",
            args: {
                text: arg("Memory in natural language"),
            },
            options: {
                tag: arg("Tag associated with this memory"),
                sender: arg("Message sender"),
            },
        };
    }
    commands.kpCmRemember.metadata = cmRememberDef();
    async function cmRemember(args: string[], io: InteractiveIo) {
        const namedArgs = parseNamedArguments(args, cmRememberDef());
        const memory = await ensureLoaded();
        const msgText = namedArgs.text;

        context.printer.writeLine("Remembering");

        const messageMeta = namedArgs.sender
            ? new cm.ConversationMessageMeta(namedArgs.sender)
            : undefined;
        const tags = namedArgs.tag ? [namedArgs.tag] : undefined;

        const message = new cm.ConversationMessage(msgText, messageMeta, tags);

        const result = await memory.addMessage(message);

        if (!result.success) {
            context.printer.writeError(result.message);
            return;
        }
        context.printer.writeLine("Done");
    }

    function cmRecallDef(): CommandMetadata {
        return {
            description: "Recall information from conversation memory",
            args: {
                query: arg("Recall with this natural language query"),
            },
            options: {
                tag: arg("Tag to filter memory by"),
            },
        };
    }
    commands.kpCmRecall.metadata = cmRecallDef();
    async function cmRecall(args: string[]) {
        const namedArgs = parseNamedArguments(args, cmRecallDef());
        const memory = await ensureLoaded();
        const filter: kp.LanguageSearchFilter | undefined = namedArgs.tag
            ? { tags: [namedArgs.tag] }
            : undefined;
        const answerResult = await memory.getAnswerFromLanguage(
            namedArgs.query,
            undefined,
            filter,
        );
        if (!answerResult.success) {
            context.printer.writeError(answerResult.message);
            return;
        }
        for (const [searchResult, answerResponse] of answerResult.data) {
            context.printer.writeInColor(
                chalk.cyan,
                searchResult.rawSearchQuery!,
            );
            context.printer.writeAnswer(answerResponse);
        }
    }

    function loadCmDef(): CommandMetadata {
        return {
            description: "Load or Create a conversation memory",
            options: {
                name: arg("Conversation name", context.defaultName),
                createNew: argBool("Create new", false),
                filePath: arg("Index path"),
            },
        };
    }
    commands.kpCmLoad.metadata = loadCmDef();
    async function cmLoad(args: string[]) {
        const namedArgs = parseNamedArguments(args, loadCmDef());

        let name = namedArgs.name;
        let dirPath: string | undefined;
        const filePath = namedArgs.filePath;
        if (filePath) {
            name = getFileName(filePath);
            dirPath = path.dirname(filePath);
        }
        const clock = new StopWatch();
        clock.start();
        context.conversationMemory = await loadOrCreateConversation(
            name,
            namedArgs.createNew,
            dirPath,
        );
        clock.stop();
        context.printer.writeTiming(chalk.gray, clock);
        context.printer.writeConversationInfo(context.conversationMemory);
        kpContext.conversation = context.conversationMemory;
    }

    function cmHistoryDef(): CommandMetadata {
        return {
            description: "Show chat history",
            options: {
                numMessages: argNum("# of latest messages to display", 10),
            },
        };
    }
    commands.kpCmHistory.metadata = cmHistoryDef();
    async function cmHistory(args: string[]) {
        const namedArgs = parseNamedArguments(args, cmHistoryDef());
        const memory = await ensureLoaded();
        const messages = memory.messages;
        const numMessages = Math.min(namedArgs.numMessages, messages.length);
        // Print oldest messages first
        for (let i = 0; i < numMessages; ++i) {
            const message = await messages.get(i);
            context.printer.writeMessage(message);
            context.printer.writeLine();
        }
    }

    async function ensureLoaded(): Promise<cm.ConversationMemory> {
        if (!context.conversationMemory) {
            context.conversationMemory = await loadOrCreateConversation(
                context.defaultName,
                false,
            );
        }
        return context.conversationMemory;
    }

    async function loadOrCreateConversation(
        name: string,
        createNew: boolean,
        dirPath?: string,
    ): Promise<cm.ConversationMemory> {
        return cm.createConversationMemory(
            {
                dirPath: dirPath ?? context.basePath,
                baseFileName: name,
            },
            createNew,
        );
    }
    return;
}
