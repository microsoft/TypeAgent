// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { conversation } from "knowledge-processor";
import {
    ConversationMessage,
    ConversationMessageMeta,
    createConversationMemory,
} from "conversation-memory";

import type { CommandHandlerContext } from "./commandHandlerContext.js";
import type {
    ActionResult,
    ActionResultActivityContext,
    Entity,
} from "@typeagent/agent-sdk";
import { ExecutableAction, getFullActionName } from "agent-cache";
import { CachedImageWithDetails } from "common-utils";
import { getAppAgentName } from "../internal.js";

export async function initializeMemory(
    context: CommandHandlerContext,
    sessionDirPath: string | undefined,
) {
    if (sessionDirPath === undefined) {
        context.conversationManager = undefined;
        context.conversationMemory = undefined;
        return;
    }
    context.conversationManager = await conversation.createConversationManager(
        {},
        "conversation",
        sessionDirPath,
        false,
    );
    context.conversationMemory = await createConversationMemory(
        {
            dirPath: sessionDirPath,
            baseFileName: "conversationMemory",
        },
        false,
    );
}

function toConcreteEntity(
    appAgentName: string,
    entities: Entity[],
): conversation.ConcreteEntity[] {
    return entities.map((e) => {
        const concreteEntity: conversation.ConcreteEntity = {
            name: e.name,
            type: e.type,
        };
        if (e.uniqueId) {
            concreteEntity.facets = [
                {
                    name: `agent:${appAgentName}.uniqueId`,
                    value: e.uniqueId,
                },
            ];
        }
        return concreteEntity;
    });
}

export function addRequestToMemory(
    context: CommandHandlerContext,
    request: string,
    cachedAttachments?: CachedImageWithDetails[],
): void {
    context.chatHistory.addUserEntry(
        request,
        context.requestId,
        cachedAttachments,
    );

    if (context.conversationManager) {
        context.conversationManager.queueAddMessage({
            text: request,
            timestamp: new Date(),
        });
    }
    if (context.conversationMemory) {
        context.conversationMemory.queueAddMessage(
            new ConversationMessage(
                request,
                new ConversationMessageMeta("user", ["assistant"]),
            ),
        );
    }
}

export function addResultToMemory(
    context: CommandHandlerContext,
    message: string,
    schemaName: string,
    entities?: Entity[],
    additionalInstructions?: string[],
    activityContext?: ActionResultActivityContext,
) {
    context.chatHistory.addAssistantEntry(
        message,
        context.requestId,
        schemaName,
        entities,
        additionalInstructions,
        activityContext,
    );

    if (context.conversationManager && entities) {
        const newEntities = entities.filter(
            (e) => !conversation.isMemorizedEntity(e.type),
        );
        if (newEntities.length > 0) {
            context.conversationManager.queueAddMessage(
                {
                    text: message,
                    knowledge: newEntities,
                    timestamp: new Date(),
                },
                false,
            );
        }
    }

    if (context.conversationMemory) {
        const concreteEntity = entities
            ? toConcreteEntity(getAppAgentName(schemaName), entities)
            : undefined;
        context.conversationMemory.queueAddMessage(
            new ConversationMessage(
                message,
                new ConversationMessageMeta("assistant", ["user"]),
                undefined,
                concreteEntity
                    ? {
                          entities: concreteEntity,
                          actions: [],
                          inverseActions: [],
                          topics: [],
                      }
                    : undefined,
            ),
        );
    }
}

export function addActionResultToMemory(
    context: CommandHandlerContext,
    executableAction: ExecutableAction,
    schemaName: string,
    result: ActionResult,
): void {
    if (result.error !== undefined) {
        addResultToMemory(
            context,
            `Action ${getFullActionName(executableAction)} failed: ${result.error}`,
            schemaName,
        );
    } else {
        const combinedEntities = [...result.entities];
        if (result.resultEntity) {
            combinedEntities.push(result.resultEntity);
        }

        addResultToMemory(
            context,
            result.literalText
                ? result.literalText
                : `Action ${getFullActionName(executableAction)} completed.`,
            schemaName,
            combinedEntities,
            result.additionalInstructions,
            result.activityContext,
        );
    }
}
