// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { afterEach, describe, expect, test } from "@jest/globals";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { DispatcherOptions } from "agent-dispatcher";
import { createConversationManager } from "../src/conversationManager.js";

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-server-test-"));
    tempDirs.push(dir);
    return dir;
}

afterEach(async () => {
    await Promise.all(
        tempDirs
            .splice(0)
            .map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
});

describe("ConversationManager createConversation", () => {
    test("appends max numeric suffix plus one on name collision", async () => {
        const manager = await createConversationManager(
            "test-host",
            {} as DispatcherOptions,
            await createTempDir(),
        );

        await manager.createConversation("Project");
        await manager.createConversation("Project (2)");
        await manager.createConversation("project (5)");

        const created = await manager.createConversation("Project", {
            nameCollisionBehavior: "appendNumber",
        });

        expect(created.name).toBe("Project (6)");
        await manager.close();
    });

    test("keeps default error behavior on name collision", async () => {
        const manager = await createConversationManager(
            "test-host",
            {} as DispatcherOptions,
            await createTempDir(),
        );

        await manager.createConversation("Project");

        await expect(manager.createConversation("project")).rejects.toThrow(
            /already exists/i,
        );
        await manager.close();
    });

    test("increments from requested numeric suffix when appending", async () => {
        const manager = await createConversationManager(
            "test-host",
            {} as DispatcherOptions,
            await createTempDir(),
        );

        await manager.createConversation("Project");
        await manager.createConversation("Project (2)");

        const created = await manager.createConversation("Project (2)", {
            nameCollisionBehavior: "appendNumber",
        });

        expect(created.name).toBe("Project (3)");
        await manager.close();
    });

    test("treats trimmed names as collisions by default", async () => {
        const manager = await createConversationManager(
            "test-host",
            {} as DispatcherOptions,
            await createTempDir(),
        );

        await manager.createConversation("Project");

        await expect(manager.createConversation("  Project  ")).rejects.toThrow(
            /already exists/i,
        );
        await manager.close();
    });
});

describe("ConversationManager renameConversation", () => {
    test("appends max numeric suffix plus one on name collision", async () => {
        const manager = await createConversationManager(
            "test-host",
            {} as DispatcherOptions,
            await createTempDir(),
        );

        const target = await manager.createConversation("Draft");
        await manager.createConversation("Project");
        await manager.createConversation("Project (2)");
        await manager.createConversation("project (5)");

        await manager.renameConversation(target.conversationId, "Project", {
            nameCollisionBehavior: "appendNumber",
        });

        expect(
            manager
                .listConversations()
                .find((c) => c.conversationId === target.conversationId)?.name,
        ).toBe("Project (6)");
        await manager.close();
    });

    test("keeps default error behavior on name collision", async () => {
        const manager = await createConversationManager(
            "test-host",
            {} as DispatcherOptions,
            await createTempDir(),
        );

        const target = await manager.createConversation("Draft");
        await manager.createConversation("Project");

        await expect(
            manager.renameConversation(target.conversationId, "project"),
        ).rejects.toThrow(/already exists/i);
        await manager.close();
    });

    test("allows self-rename with appendNumber without adding suffix", async () => {
        const manager = await createConversationManager(
            "test-host",
            {} as DispatcherOptions,
            await createTempDir(),
        );

        const target = await manager.createConversation("Project");

        await manager.renameConversation(target.conversationId, "Project", {
            nameCollisionBehavior: "appendNumber",
        });

        expect(
            manager
                .listConversations()
                .find((c) => c.conversationId === target.conversationId)?.name,
        ).toBe("Project");
        await manager.close();
    });
});
