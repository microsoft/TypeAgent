// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ClientIO, DispatcherOptions } from "agent-dispatcher";

const closeDispatcher = jest.fn(async () => {});
const createDispatcher = jest.fn(async () => ({
    clientCount: 0,
    join() {
        throw new Error("Structured action resume state is unavailable");
    },
    prewarmReasoning() {},
    close: closeDispatcher,
}));
jest.unstable_mockModule("../src/sharedDispatcher.js", () => ({
    createSharedDispatcher: createDispatcher,
}));
const { createConversationManager } = await import(
    "../src/conversationManager.js"
);

const tempDirs: string[] = [];
afterEach(async () => {
    jest.useRealTimers();
    jest.clearAllMocks();
    for (const directory of tempDirs.splice(0)) {
        await rm(directory, { recursive: true, force: true });
    }
});

async function fixture() {
    const directory = await mkdtemp(path.join(os.tmpdir(), "structured-join-"));
    tempDirs.push(directory);
    return createConversationManager(
        "test",
        {} as DispatcherOptions,
        directory,
        100,
        true,
    );
}

describe("structured join manager lifecycle", () => {
    test("a rejected resume restores idle cleanup on an already loaded dispatcher", async () => {
        const manager = await fixture();
        try {
            const conversation = await manager.createConversation("default");
            await manager.prewarmMostRecentConversation();
            jest.useFakeTimers();
            await expect(
                manager.joinConversation(
                    conversation.conversationId,
                    {} as ClientIO,
                    () => {},
                    {
                        conversationId: conversation.conversationId,
                        structuredActions: { resumeToken: "a".repeat(43) },
                    },
                ),
            ).rejects.toThrow("resume state is unavailable");
            expect(closeDispatcher).not.toHaveBeenCalled();
            await jest.advanceTimersByTimeAsync(100);
            expect(closeDispatcher).toHaveBeenCalledTimes(1);
        } finally {
            await manager.close();
        }
    });

    test("lost resume state does not initialize a replacement dispatcher", async () => {
        const manager = await fixture();
        try {
            const conversation = await manager.createConversation("target");
            await expect(
                manager.joinConversation(
                    conversation.conversationId,
                    {} as ClientIO,
                    () => {},
                    {
                        conversationId: conversation.conversationId,
                        structuredActions: { resumeToken: "a".repeat(43) },
                    },
                ),
            ).rejects.toThrow("resume state is unavailable");
            expect(createDispatcher).not.toHaveBeenCalled();
        } finally {
            await manager.close();
        }
    });
});
