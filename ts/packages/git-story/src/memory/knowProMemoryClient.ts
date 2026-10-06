// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ConversationMemory,
    ConversationMessage,
    createConversationMemory,
} from "@typeagent/conversation-memory";
import type { IMemoryClient, MemoryRecord } from "./memoryClient.js";

// Files are written as <directory>/commit-stories_data.json etc.
const MEMORY_FILE = "commit-stories";
// Record ids are stored as message tags, e.g. "id:abc123/s1/1".
const ID_TAG_PREFIX = "id:";

// KnowPro backend: one conversation message per record, record id kept as a tag.
export class KnowProMemoryClient implements IMemoryClient {
    private constructor(
        private readonly memory: ConversationMemory,
        private readonly ids: Set<string>,
    ) {}

    // Open the existing conversation, or create it on the first write.
    // Load stored record ids so repeated adds are skipped.
    public static async open(directory: string): Promise<KnowProMemoryClient> {
        const memory = await createConversationMemory(
            { dirPath: directory, baseFileName: MEMORY_FILE },
            false,
        );
        const ids = new Set<string>();
        for (const message of memory.messages) {
            for (const tag of message.tags) {
                if (typeof tag === "string" && tag.startsWith(ID_TAG_PREFIX)) {
                    ids.add(tag.slice(ID_TAG_PREFIX.length));
                }
            }
        }
        return new KnowProMemoryClient(memory, ids);
    }

    // Append records whose id is not stored yet; no knowledge extraction.
    public async add(records: MemoryRecord[]): Promise<void> {
        for (const record of records) {
            if (this.ids.has(record.id)) {
                continue;
            }
            const message = new ConversationMessage(
                record.text,
                undefined,
                [`${ID_TAG_PREFIX}${record.id}`, ...record.tags],
                undefined,
                record.timestamp,
            );
            const result = await this.memory.addMessage(message, false);
            if (!result.success) {
                throw new Error(result.message);
            }
            this.ids.add(record.id);
        }
    }
}
