// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "path";
import os from "node:os";
import { ensureDir } from "typeagent";
import { DeletionInfo, IMessage } from "knowpro";

export async function ensureTestDir() {
    return ensureDir(getRootDataPath());
}

export function testFilePath(fileName: string): string {
    return path.join(getRootDataPath(), fileName);
}

export function getRootDataPath() {
    return path.join(os.tmpdir(), "/data/tests/knowpro/storage");
}

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

export function createMessages(count: number): TestMessage[] {
    const messages: TestMessage[] = [];
    for (let i = 0; i < count; ++i) {
        messages.push(createMessage(`Message ${i}`));
    }
    return messages;
}

export function messageText(message: IMessage): string {
    return message.textChunks[0];
}

export function createTimestamp(): string {
    return new Date().toISOString();
}
