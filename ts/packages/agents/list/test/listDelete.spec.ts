// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    Storage,
    TokenCachePersistence,
} from "@typeagent/agent-sdk";
import { instantiate } from "../src/listActionHandler.js";

class MemoryStorage implements Storage {
    private readonly data = new Map<string, string>();

    constructor(lists: { name: string; items: string[] }[]) {
        this.data.set("lists.json", JSON.stringify(lists));
    }

    async read(storagePath: string): Promise<Uint8Array>;
    async read(
        storagePath: string,
        options: "utf8" | "base64",
    ): Promise<string>;
    async read(storagePath: string, options?: "utf8" | "base64") {
        const value = this.data.get(storagePath);
        if (value === undefined) {
            throw new Error(`File not found: ${storagePath}`);
        }
        return options === undefined ? new TextEncoder().encode(value) : value;
    }

    async write(storagePath: string, data: string | Uint8Array) {
        this.data.set(
            storagePath,
            typeof data === "string" ? data : new TextDecoder().decode(data),
        );
    }

    async list() {
        return Array.from(this.data.keys());
    }

    async exists(storagePath: string) {
        return this.data.has(storagePath);
    }

    async delete(storagePath: string) {
        this.data.delete(storagePath);
    }

    async getTokenCachePersistence(): Promise<TokenCachePersistence> {
        return {
            load: async () => null,
            save: async () => {},
            delete: async () => true,
        };
    }

    getLists() {
        return JSON.parse(this.data.get("lists.json") ?? "[]");
    }
}

async function createAgent() {
    const agent = instantiate();
    const agentContext = await agent.initializeAgentContext!();
    const storage = new MemoryStorage([{ name: "grocery", items: ["milk"] }]);
    const sessionContext = {
        agentContext,
        sessionStorage: storage,
    } as any;
    await agent.updateAgentContext!(true, sessionContext, "list");
    const actionContext = {
        sessionContext,
    } as ActionContext<any>;
    const result = await agent.executeAction!(
        {
            schemaName: "list",
            actionName: "deleteList",
            parameters: { listName: "grocery" },
        },
        actionContext,
    );
    return { agent, actionContext, result: result as any, storage };
}

describe("deleteList confirmation", () => {
    test("does not delete the list before confirmation", async () => {
        const { result, storage } = await createAgent();

        expect(result?.pendingChoice).toMatchObject({
            type: "yesNo",
            message: "Delete list 'grocery'? This cannot be undone.",
        });
        expect(storage.getLists()).toEqual([
            { name: "grocery", items: ["milk"] },
        ]);
    });

    test("keeps the list when deletion is declined", async () => {
        const { agent, actionContext, result, storage } = await createAgent();

        const choiceResult = (await agent.handleChoice!(
            result!.pendingChoice!.choiceId,
            false,
            actionContext,
        )) as any;

        expect(choiceResult?.historyText).toBe("Kept list: grocery");
        expect(storage.getLists()).toEqual([
            { name: "grocery", items: ["milk"] },
        ]);
    });

    test("deletes and saves the list after confirmation", async () => {
        const { agent, actionContext, result, storage } = await createAgent();

        const choiceResult = (await agent.handleChoice!(
            result!.pendingChoice!.choiceId,
            true,
            actionContext,
        )) as any;

        expect(choiceResult?.historyText).toBe("Deleted list: grocery");
        expect(storage.getLists()).toEqual([]);
        await expect(
            agent.handleChoice!(
                result!.pendingChoice!.choiceId,
                true,
                actionContext,
            ),
        ).rejects.toThrow("Choice not found or expired");
    });
});
