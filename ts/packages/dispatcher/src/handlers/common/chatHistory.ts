// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Entity } from "@typeagent/agent-sdk";
import { CachedImageWithDetails } from "common-utils";
import { PromptSection } from "typechat";
import { extractRelevantExifTags } from "../../../../commonUtils/dist/image.js";
type PromptRole = "user" | "assistant" | "system";

export interface ChatHistoryEntry {
    text: string;
    entities: Entity[];
    role: PromptRole;
    id: string | undefined;
    additionalInstructions?: string[] | undefined;
    attachments?: CachedImageWithDetails[] | undefined;
}

export interface ChatHistory {
    entries: ChatHistoryEntry[];
    getTopKEntities(k: number): Entity[];
    getEntitiesByName(name: string): Entity[] | undefined;
    getEntitiesByType(type: string): Entity[] | undefined;
    addEntry(
        text: string,
        entities: Entity[],
        role: PromptRole,
        id?: string,
        attachments?: CachedImageWithDetails[],
        additionalInstructions?: string[],
    ): void;
    getEntry(id: string): ChatHistoryEntry | undefined;
    getCurrentInstructions(): string[] | undefined;
    getPromptSections(): PromptSection[];
}

export function createChatHistory(): ChatHistory {
    const nameMap: Map<string, Entity[]> = new Map();
    const typeMap: Map<string, Entity[]> = new Map();
    const userIdMap: Map<string, number> = new Map();
    const assistantIdMap: Map<string, number> = new Map();
    return {
        entries: [],
        getPromptSections(maxChars = 2000) {
            const sections: PromptSection[] = [];
            // Find the last N that can fit the character quota
            let totalLength = 0;
            let i: number = this.entries.length - 1;
            // Get the range of sections that could be pushed on, NEWEST first
            while (i >= 0) {
                const nextLength = this.entries[i].text.length;
                if (nextLength + totalLength > maxChars) {
                    ++i;
                    break;
                }
                totalLength += nextLength;
                --i;
            }
            if (i < 0) {
                i = 0;
            }
            for (; i < this.entries.length; ++i) {
                const entry = this.entries[i];

                if (entry.text.length > 0) {
                    sections.push({ role: entry.role, content: entry.text });
                }

                if (entry.attachments && entry.attachments.length > 0) {
                    for (const attachment of entry.attachments) {
                        sections.push({
                            role: entry.role,
                            content: [
                                {
                                    type: "text",
                                    text: attachment.storageLocation,
                                },
                            ],
                        });
                        sections.push({
                            role: entry.role,
                            content: [
                                {
                                    type: "text",
                                    text: `EXIF Tags: ${extractRelevantExifTags(attachment.exifTags)}`,
                                },
                            ],
                        });
                        sections.push({
                            role: entry.role,
                            content: [
                                {
                                    type: "image_url",
                                    image_url: {
                                        url: attachment.image,
                                        detail: "high",
                                    },
                                },
                            ],
                        });
                    }
                }
            }
            return sections;
        },
        getCurrentInstructions(): string[] | undefined {
            const instructions: string[] = [];
            if (this.entries.length === 0) {
                return undefined;
            }
            let i = this.entries.length - 1;
            if (this.entries[i].role === "user") {
                i--;
            }
            while (i >= 0) {
                if (this.entries[i].role === "user") {
                    break;
                }
                const entry = this.entries[i];
                if (entry.additionalInstructions) {
                    instructions.push(...entry.additionalInstructions);
                }
                i--;
            }
            return instructions.length > 0 ? instructions : undefined;
        },
        addEntry(
            text: string,
            entities: Entity[],
            role: PromptRole = "user",
            id?: string,
            attachments?: CachedImageWithDetails[],
            additionalInstructions?: string[],
        ): void {
            this.entries.push({
                text,
                entities,
                role,
                id,
                attachments,
                additionalInstructions,
            });
            const index = this.entries.length - 1;
            if (id) {
                if (role === "user") {
                    userIdMap.set(id, index);
                } else {
                    assistantIdMap.set(id, index);
                }
            }
            for (const entity of entities) {
                if (!nameMap.has(entity.name)) {
                    nameMap.set(entity.name, []);
                }
                nameMap.get(entity.name)?.push(entity);

                for (const type of entity.type) {
                    if (!typeMap.has(type)) {
                        typeMap.set(type, []);
                    }
                    typeMap.get(type)?.push(entity);
                }
            }
        },

        getEntitiesByName(name: string): Entity[] | undefined {
            return nameMap.get(name);
        },
        getEntitiesByType(type: string): Entity[] | undefined {
            return typeMap.get(type);
        },
        getTopKEntities(k: number): Entity[] {
            const uniqueEntities = new Map<string, Entity>();
            let valueCount = 0;
            // loop over entries from last to first
            for (let i = this.entries.length - 1; i >= 0; i--) {
                const entry = this.entries[i];
                for (const entity of entry.entities) {
                    // Multiple entities may have the same name ('Design meeting') but different
                    // entity instances. E.g. {Design meeting, on 9/12} vs {Design meeting, on 9/19}
                    // Use a unique id provided by the agent to distinguish between name
                    let entityId = entity.uniqueId;
                    if (entityId) {
                        // Scope ids by their type...
                        // An entityId need be unique only for a type, not in the global namespace
                        entityId = `${entity.type}.${entityId}`;
                    }
                    if (!entityId) {
                        // If entity has no unique id, make one the entity using it name
                        entityId = entity.name;
                        if (entity.additionalEntityText) {
                            entityId += `v${valueCount++}`;
                        }
                    }
                    if (!uniqueEntities.has(entityId)) {
                        uniqueEntities.set(entityId, entity);
                        if (uniqueEntities.size === k) {
                            return [...uniqueEntities.values()];
                        }
                    }
                }
            }
            // return unique entities across all entries
            return [...uniqueEntities.values()];
        },
        getEntry(id: string, role = "user"): ChatHistoryEntry | undefined {
            if (role === "assistant") {
                const index = assistantIdMap.get(id);
                return index !== undefined ? this.entries[index] : undefined;
            } else {
                const index = userIdMap.get(id);
                return index !== undefined ? this.entries[index] : undefined;
            }
        },
    };
}
