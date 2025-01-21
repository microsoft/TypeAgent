// Copyright (c) Microsoft Corporation
// Licensed under the MIT License.

import * as kp from "knowpro";
import { CommandHandler } from "interactive-app";
import { ChatContext } from "./chatMemory.js";
import { ChatModel } from "aiclient";

export type KnowProContext = {
    knowledgeModel: ChatModel;
    conversation?: kp.ConversationIndex | undefined;
};

export async function createKnowproCommands(
    chatContext: ChatContext,
    commands: Record<string, CommandHandler>,
): Promise<void> {
    const context: KnowProContext = {
        knowledgeModel: chatContext.models.chatModel,
    };
    commands.kpCreateIndex = createIndex;
    commands.kpLoadIndex = loadIndex;
    commands.kpSaveIndex = saveIndex;
    commands.kpSearch = searchIndex;

    commands.kpCreateIndex.metadata = "Create knowPro index";
    async function createIndex(args: string[]): Promise<void> {
        context.conversation = new kp.ConversationIndex();
    }

    commands.kpLoadIndex.metadata = "Load knowPro index";
    async function loadIndex(args: string[]): Promise<void> {}

    commands.kpSaveIndex.metadata = "Save knowPro index";
    async function saveIndex(args: string[]): Promise<void> {}

    commands.kpSearch.metadata = "Search knowPro index";
    async function searchIndex(): Promise<void> {}
}
