// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ConversationMessage } from "@typeagent/conversation-memory";
import { captureDirect, captureQueued } from "../src/shared/memory-client.js";
import { withMemoryLock } from "../src/shared/lock.js";
import { resolveMemoryPaths } from "../src/shared/workspace.js";
import type { MemoryStore } from "../src/shared/memory-client.js";

function fakeStore(failExtract: boolean): MemoryStore & {
    messages: ConversationMessage[];
} {
    const messages: ConversationMessage[] = [];
    return {
        messages,
        queueAddMessage(message, callback, extractKnowledge = true) {
            if (failExtract && extractKnowledge) {
                callback?.("extract failed");
                return;
            }
            messages.push(message);
            callback?.();
        },
        async waitForPendingTasks() {
            return undefined;
        },
        async addMessage(message, extractKnowledge = true) {
            if (failExtract && extractKnowledge) {
                return { success: false, message: "extract failed" };
            }
            messages.push(message);
            return { success: true };
        },
        async getAnswerFromLanguage() {
            return { success: true, data: [] };
        },
    };
}

describe("capture fallback", () => {
    it("stores turn text when knowledge extraction fails", async () => {
        const store = fakeStore(true);
        await captureQueued(store, new ConversationMessage("use pnpm"));
        expect(store.messages).toHaveLength(1);
        expect(store.messages[0]?.textChunks[0]).toBe("use pnpm");
    });

    it("stores an explicit fact when extraction fails", async () => {
        const store = fakeStore(true);
        await captureDirect(store, new ConversationMessage("use pnpm"));
        expect(store.messages).toHaveLength(1);
    });
});

describe("workspace scope", () => {
    it("keeps one directory for a workspace when TYPEAGENT_MEMORY_DIR is set", () => {
        const override = path.join(os.tmpdir(), "memory-override");
        const paths = resolveMemoryPaths(path.join(os.tmpdir(), "repo"), {
            TYPEAGENT_MEMORY_DIR: override,
        });
        expect(paths.dirPath).toBe(path.resolve(override));
        expect(paths.baseFileName).toBe("conversationMemory");
    });

    it("serializes writers with the memory lock", async () => {
        const dir = await mkdtemp(path.join(os.tmpdir(), "memory-lock-"));
        const order: string[] = [];
        let release: () => void = () => undefined;
        const hold = new Promise<void>((resolve) => {
            release = resolve;
        });
        let started: () => void = () => undefined;
        const holding = new Promise<void>((resolve) => {
            started = resolve;
        });
        const first = withMemoryLock(dir, async () => {
            order.push("a-start");
            started();
            await hold;
            order.push("a-end");
        });
        await holding;
        const second = withMemoryLock(dir, async () => {
            order.push("b-start");
            order.push("b-end");
        });
        release();
        await Promise.all([first, second]);
        expect(order).toEqual(["a-start", "a-end", "b-start", "b-end"]);
    });

    it("aborts and rejects when the lock is compromised", async () => {
        const dir = await mkdtemp(path.join(os.tmpdir(), "memory-lock-"));
        let aborted = false;
        const run = withMemoryLock(dir, async (signal) => {
            // Simulate another process breaking the lock.
            await rm(`${dir}.lock`, { recursive: true, force: true });
            await new Promise<void>((resolve) =>
                signal.addEventListener("abort", () => resolve(), {
                    once: true,
                }),
            );
            aborted = true;
        });
        await expect(run).rejects.toBeDefined();
        expect(aborted).toBe(true);
    }, 30_000);
});
