// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    arg,
    argBool,
    CommandHandler,
    CommandMetadata,
    InteractiveIo,
    parseNamedArguments,
    StopWatch,
} from "interactive-app";
import { KnowProPrinter } from "./knowproPrinter.js";
import * as cm from "conversation-memory";
import path from "path";

import { KnowProContext } from "./knowproMemory.js";
import { ensureDir } from "typeagent";
import chalk from "chalk";

export type KnowProChatContext = {
    printer: KnowProPrinter;
    chat?: cm.ConversationMemory | undefined;
    basePath: string;
    defaultName: string;
};

export async function createKnowproChatCommands(
    kpContext: KnowProContext,
    commands: Record<string, CommandHandler>,
) {
    const context: KnowProChatContext = {
        printer: kpContext.printer,
        basePath: path.join(kpContext.basePath, "chat"),
        defaultName: "default",
    };

    await ensureDir(context.basePath);

    commands.kpChatLoad = chatLoad;
    commands.kpChat = chat;

    async function chat(args: string[], io: InteractiveIo) {
        const chat = await ensureLoaded();
        const msgText = args.join("\n\n");
        await chat.addMessage(new cm.ConversationMessage(msgText));
    }

    function loadChatDef(): CommandMetadata {
        return {
            description: "Load or Create a conversation memory",
            options: {
                name: arg("Chat name", context.defaultName),
                createNew: argBool("Create new", false),
            },
        };
    }
    commands.kpChatLoad.metadata = loadChatDef();
    async function chatLoad(args: string[]) {
        const namedArgs = parseNamedArguments(args, loadChatDef());

        const clock = new StopWatch();
        clock.start();
        context.chat = await cm.createConversationMemory(
            {
                dirPath: context.basePath,
                baseFileName: namedArgs.name,
            },
            namedArgs.createNew,
        );
        clock.stop();
        context.printer.writeTiming(chalk.gray, clock);
        kpContext.conversation = context.chat;
    }

    async function ensureLoaded() {
        if (!context.chat) {
            context.chat = await loadChat(context.defaultName, false);
        }
        return context.chat;
    }

    async function loadChat(
        name: string,
        createNew: boolean,
    ): Promise<cm.ConversationMemory> {
        return cm.createConversationMemory(
            {
                dirPath: context.basePath,
                baseFileName: name,
            },
            createNew,
        );
    }
    return;
}
