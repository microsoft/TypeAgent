// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import dotenv from "dotenv";
dotenv.config({ path: new URL("../../../../.env", import.meta.url) });

import {
    ChatModel,
    hasEnvSettings,
    openai,
    TextEmbeddingModel,
} from "aiclient";

import path from "path";
import os from "node:os";
import { DeletionInfo, IMessage } from "../src/interfaces.js";

export class TestMessage implements IMessage {
    constructor(
        public textChunks: string[] = [],
        public tags: string[] = [],
        public timestamp?: string,
        public deletionInfo?: DeletionInfo,
    ) {}

    public getKnowledge() {
        return undefined;
    }
}

export function createMessage(messageText: string): TestMessage {
    const message = new TestMessage([messageText]);
    message.timestamp = createTimestamp();
    return message;
}

export function createTimestamp(): string {
    return new Date().toISOString();
}

export type TestModels = {
    chat: ChatModel;
    embeddings: TextEmbeddingModel;
};

export function testIf(
    name: string,
    runIf: () => boolean,
    fn: jest.ProvidesCallback,
    testTimeout?: number | undefined,
) {
    if (!runIf()) {
        return test.skip(name, () => {});
    }
    return test(name, fn, testTimeout);
}

export function shouldSkip() {
    return !hasTestKeys();
}

export function hasTestKeys() {
    const hasKeys: boolean =
        hasEnvSettings(process.env, openai.EnvVars.AZURE_OPENAI_API_KEY) &&
        hasEnvSettings(
            process.env,
            openai.EnvVars.AZURE_OPENAI_API_KEY_EMBEDDING,
        );
    return hasKeys;
}

export function skipTest(name: string) {
    return test.skip(name, () => {});
}

export function createTestModels(): TestModels {
    return {
        chat: openai.createChatModelDefault("knowproTest"),
        embeddings: openai.createEmbeddingModel(),
    };
}

export function getRootDataPath() {
    return path.join(os.tmpdir(), "/data/tests");
}
