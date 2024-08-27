// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    Entity,
    ImpressionInterpreter,
    getEntityId,
} from "@typeagent/agent-sdk";
import { PromptSection } from "typechat";
type PromptRole = "user" | "assistant" | "system";

export interface ChatHistoryEntry {
    text: string;
    entities: Entity[];
    role: PromptRole;
    id: string | undefined;
    interpreter?: ImpressionInterpreter;
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
        interpreter?: ImpressionInterpreter,
    ): void;
    getEntry(id: string): ChatHistoryEntry | undefined;
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
                sections.push({ role: entry.role, content: entry.text });
            }
            return sections;
        },
        addEntry(
            text: string,
            entities: Entity[],
            role: PromptRole = "user",
            id?: string,
            interpreter?: ImpressionInterpreter,
        ): void {
            this.entries.push({ text, entities, role, id });
            const index = this.entries.length - 1;
            if (id) {
                if (role === "user") {
                    userIdMap.set(id, index);
                } else {
                    assistantIdMap.set(id, index);
                }
            }
            for (const entity of entities) {
                const ientity = entity as Entity;
                ientity.interpreter = interpreter;
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
                    // Multiple entities may have the same name ('ibuprofen') but different
                    // entity instances. E.g. {ibuprofen, taken in 2021} {ibuprofen,  taken in 2019}
                    let entityId = getEntityId(entity);
                    if (entityId) {
                        // Scope ids by their type...
                        // An entityId need be unique only for a type, not in the global namespace
                        entityId = `${entity.type}.${entityId}`;
                    }
                    if (!entityId) {
                        // If entity has no unique id, make one the entity using it name
                        entityId = entity.name;
                        if (entity.value) {
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
