// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "path";
import * as knowLib from "knowledge-processor";
import { conversation } from "knowledge-processor";
import { ChatModel } from "aiclient";
import { sqlite } from "memory-providers";
import { ReservedConversationNames } from "./chatMemory.js";
import { ensureDir } from "typeagent";

export async function createEmailMemory(
    chatModel: ChatModel,
    storePath: string,
    settings: conversation.ConversationSettings,
    useSqlite: boolean = false,
    createNew: boolean = false,
) {
    const emailStorePath = path.join(
        storePath,
        ReservedConversationNames.outlook,
    );
    await ensureDir(emailStorePath);
    const storage = useSqlite
        ? await sqlite.createStorageDb(emailStorePath, "outlook.db", createNew)
        : undefined;

    return await knowLib.email.createEmailMemory(
        chatModel,
        ReservedConversationNames.outlook,
        storePath,
        settings,
        storage,
    );
}
