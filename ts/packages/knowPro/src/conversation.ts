// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { PromptSection } from "typechat";
import { IConversation, DateRange } from "./interfaces.js";
import {
    tryCreateEmbeddingModel,
    getEmbeddingSize,
    TextEmbeddingModel,
    embeddingIdentityKey,
    embeddingModelForRole,
    resolveEmbeddingModel,
} from "@typeagent/aiclient";
import {
    TextEmbeddingIndexSettings,
    createTextEmbeddingIndexSettings,
} from "./fuzzyIndex.js";
import { MessageTextIndexSettings } from "./messageIndex.js";
import { RelatedTermIndexSettings } from "./relatedTermsIndex.js";
import { SemanticRefIndexSettings } from "./conversationIndex.js";

export interface ConversationSettings {
    preparedIndexing?: import("./preparedIndexing.js").PreparedIndexingSettings;
    relatedTermIndexSettings: RelatedTermIndexSettings;
    threadSettings: TextEmbeddingIndexSettings;
    messageTextIndexSettings: MessageTextIndexSettings;
    semanticRefIndexSettings: SemanticRefIndexSettings;
}

export async function prepareConversationEmbeddings(
    settings: ConversationSettings,
): Promise<import("./serialization.js").PersistedEmbeddingIdentities> {
    const identities: import("./serialization.js").PersistedEmbeddingIdentities =
        {};
    let complete = true;
    const lanes = {
        relatedTerms: settings.relatedTermIndexSettings.embeddingIndexSettings,
        message: settings.messageTextIndexSettings.embeddingIndexSettings,
        thread: settings.threadSettings,
    };
    const resolutions = new Map<
        TextEmbeddingModel,
        Promise<TextEmbeddingModel>
    >();
    for (const [lane, indexSettings] of Object.entries(lanes)) {
        if (!indexSettings?.embeddingModel) continue;
        const original = indexSettings.embeddingModel;
        let resolution = resolutions.get(original);
        if (!resolution) {
            resolution = resolveEmbeddingModel(original);
            resolutions.set(original, resolution);
        }
        const model = await resolution;
        indexSettings.embeddingModel = model;
        let dimensions: number | undefined;
        for (const role of ["query", "document"] as const) {
            const identity = embeddingModelForRole(
                model,
                role,
            ).embeddingIdentity;
            if (!identity) {
                complete = false;
                continue;
            }
            embeddingIdentityKey(identity);
            if (dimensions !== undefined && dimensions !== identity.dimensions)
                throw new Error("Embedding model role dimensions disagree");
            dimensions = identity.dimensions;
            indexSettings.embeddingSize = identity.dimensions;
            identities[`${lane}.${role}`] = identity;
        }
    }
    const dimensions = new Set(
        Object.values(lanes).flatMap((lane) =>
            lane?.embeddingModel ? [lane.embeddingSize] : [],
        ),
    );
    if (dimensions.size > 1)
        throw new Error(
            "Conversation embedding lanes must use the same dimensions for the shared vector file.",
        );
    return complete ? identities : {};
}

let embeddingUnavailableAnnounced = false;

export function createConversationSettings(
    embeddingModel?: TextEmbeddingModel | undefined,
    embeddingSize?: number,
): ConversationSettings {
    // May be undefined when no embedding provider is configured (e.g. Copilot
    // self-host without a local embedder). Embedding-backed indexes then no-op
    // and search degrades to exact/alias/edit-distance matching.
    embeddingModel ??= tryCreateEmbeddingModel();
    embeddingSize ??=
        embeddingModel?.embeddingIdentity?.dimensions ?? getEmbeddingSize();
    if (embeddingModel === undefined && !embeddingUnavailableAnnounced) {
        embeddingUnavailableAnnounced = true;
        console.warn(
            "knowPro: no embedding provider configured. Semantic (embedding) search over messages and semantic related-term expansion are disabled; exact, alias, and edit-distance matching remain available.",
        );
    }
    const minCosineSimilarity = 0.85;
    return {
        relatedTermIndexSettings: {
            embeddingIndexSettings: createTextEmbeddingIndexSettings(
                embeddingModel,
                embeddingSize,
                minCosineSimilarity,
                50,
            ),
        },
        threadSettings: createTextEmbeddingIndexSettings(
            embeddingModel,
            embeddingSize,
            minCosineSimilarity,
        ),
        messageTextIndexSettings: {
            embeddingIndexSettings: createTextEmbeddingIndexSettings(
                embeddingModel,
                embeddingSize,
                0.7,
            ),
        },
        semanticRefIndexSettings: {
            batchSize: 4,
            autoExtractKnowledge: true,
        },
    };
}

/**
 * Returns the time range for a conversation: the timestamps of the first and last messages
 * If messages have no timestamps (which are optional), returns undefined
 * @param conversation
 * @returns {DateRange}
 */
export function getTimeRangeForConversation(
    conversation: IConversation,
): DateRange | undefined {
    const messages = conversation.messages;
    if (messages.length > 0) {
        const start = messages.get(0).timestamp;
        const end = messages.get(messages.length - 1).timestamp;
        if (start !== undefined) {
            return {
                start: new Date(start),
                end: end ? new Date(end) : undefined,
            };
        }
    }
    return undefined;
}

export function getTimeRangePromptSectionForConversation(
    conversation: IConversation,
): PromptSection[] {
    const timeRange = getTimeRangeForConversation(conversation);
    if (timeRange) {
        return [
            {
                role: "system",
                content: `ONLY IF user request explicitly asks for time ranges, THEN use the CONVERSATION TIME RANGE: "${timeRange.start} to ${timeRange.end}"`,
            },
        ];
    }
    return [];
}
