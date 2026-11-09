// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Entity } from "@typeagent/agent-sdk";
import { conversation } from "@typeagent/knowledge-processor";
import {
    ConversationMemory,
    ConversationMessage,
    ConversationMessageMeta,
} from "@typeagent/conversation-memory";
import type { MemoryEvent } from "@typeagent/memory-service";
import type { CommandHandlerContext } from "./commandHandlerContext.js";
import type { ConversationDurableMemory } from "./conversationDurableMemory.js";
import { createConversationSettings } from "@typeagent/knowpro";

const projections = new WeakMap<
    ConversationDurableMemory,
    { signature: string; memory: Promise<ConversationMemory> }
>();

export function toConcreteEntity(
    appAgentName: string,
    entities: Entity[],
): conversation.ConcreteEntity[] {
    return entities.map((entity) => ({
        name: entity.name,
        type: entity.type,
        ...(entity.uniqueId
            ? {
                  facets: [
                      { name: "typeagent.appAgentName", value: appAgentName },
                      { name: "typeagent.uniqueId", value: entity.uniqueId },
                  ],
              }
            : {}),
    }));
}

export async function getConversationEntityMemory(
    context: Pick<
        CommandHandlerContext,
        "conversationDurableMemory" | "conversationMemory"
    >,
): Promise<ConversationMemory | undefined> {
    const durable = context.conversationDurableMemory;
    if (durable === undefined) {
        return context.conversationMemory;
    }
    const events = await durable.inspectConversation();
    const signature = JSON.stringify(events.map((event) => event.eventId));
    let projection = projections.get(durable);
    if (projection?.signature !== signature) {
        projection = { signature, memory: buildEntityProjection(events) };
        projections.set(durable, projection);
    }
    try {
        return await projection.memory;
    } catch (error) {
        if (projections.get(durable) === projection) {
            projections.delete(durable);
        }
        throw error;
    }
}

async function buildEntityProjection(
    events: MemoryEvent[],
): Promise<ConversationMemory> {
    const memory = new ConversationMemory("", [], [], {
        languageModel: {
            completionSettings: {},
            complete: async () => {
                throw new Error(
                    "Action entity projections support structured KnowPro queries only.",
                );
            },
        },
        embeddingModel: undefined,
        embeddingSize: 0,
        conversationSettings: createConversationSettings(undefined, 0),
    });
    for (const event of events) {
        const entities = event.metadata?.actionEntities;
        const appAgentName = event.metadata?.actionAppAgentName;
        if (entities === undefined) {
            continue;
        }
        if (
            typeof appAgentName !== "string" ||
            !Array.isArray(entities) ||
            !entities.every(isEntity)
        ) {
            throw new Error(
                `Invalid action entity metadata for event ${event.eventId}.`,
            );
        }
        const result = await memory.addMessage(
            new ConversationMessage(
                entities.map((entity) => entity.name).join(", "),
                new ConversationMessageMeta(event.sender),
                [event.eventId],
                {
                    entities: toConcreteEntity(appAgentName, entities),
                    actions: [],
                    inverseActions: [],
                    topics: [],
                },
                event.eventTime,
            ),
            false,
        );
        if (!result.success) {
            throw new Error(result.message);
        }
    }
    return memory;
}

function isEntity(value: unknown): value is Entity {
    return (
        typeof value === "object" &&
        value !== null &&
        "name" in value &&
        typeof value.name === "string" &&
        "type" in value &&
        Array.isArray(value.type) &&
        value.type.every((type: unknown) => typeof type === "string") &&
        (!("uniqueId" in value) ||
            value.uniqueId === undefined ||
            typeof value.uniqueId === "string")
    );
}
