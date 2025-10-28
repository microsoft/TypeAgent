// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { MockLLMResponses } from "./mockLLMResponses";
import { MockEmbeddings } from "./mockEmbeddings";
import {
    MockKnowledgeStore,
    type Entity,
    type Relationship,
    type Topic,
    type Message,
} from "./mockKnowledgeStore";

export { MockLLMResponses, MockEmbeddings, MockKnowledgeStore };
export type { Entity, Relationship, Topic, Message };

export function setupTestMocks() {
    MockEmbeddings.clearCache();

    const knowledgeStore = new MockKnowledgeStore();

    return {
        llm: MockLLMResponses,
        embeddings: MockEmbeddings,
        knowledgeStore,
        websiteCollection: knowledgeStore.createMockWebsiteCollection(),
    };
}

export function resetAllMocks() {
    MockEmbeddings.clearCache();
}
