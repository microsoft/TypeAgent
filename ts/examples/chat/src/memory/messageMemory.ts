// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { conversation } from "knowledge-processor";
import { Models } from "./chatMemory.js";
import { sqlite } from "memory-providers";

export async function createMessageMemory(
    models: Models,
    memoryName: string,
    storePath: string,
    settings: conversation.ConversationSettings,
    useSqlite: boolean = false,
    createNew: boolean = false,
) {
    const storageProvider = useSqlite
        ? await sqlite.createStorageDb(storePath, memoryName + ".db", createNew)
        : undefined;
    const memory = await conversation.createConversation(
        settings,
        storePath,
        undefined,
        undefined,
        storageProvider,
    );
    const cm = await conversation.createConversationManager(
        {
            model: models.chatModel,
            answerModel: models.chatModel,
        },
        memoryName,
        storePath,
        false,
        memory,
    );
    return cm;
}
