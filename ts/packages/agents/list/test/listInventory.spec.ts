// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    ActionContext,
    SessionContext,
    Storage,
} from "@typeagent/agent-sdk";
import { instantiate } from "../src/listActionHandler.js";

async function createInventoryAgent(
    lists: { name: string; items: string[] }[],
) {
    const data = JSON.stringify(lists);
    async function read(path: string): Promise<Uint8Array>;
    async function read(
        path: string,
        options: "utf8" | "base64",
    ): Promise<string>;
    async function read(path: string, options?: "utf8" | "base64") {
        if (path !== "lists.json") throw new Error(`Unexpected read: ${path}`);
        return options === undefined
            ? new TextEncoder().encode(data)
            : options === "base64"
              ? Buffer.from(data).toString("base64")
              : data;
    }
    const unexpected = async () => {
        throw new Error("Inventory must not modify storage");
    };
    const storage: Storage = {
        read,
        write: unexpected,
        exists: async (path) => path === "lists.json",
        list: async () => ["lists.json"],
        delete: unexpected,
        getTokenCachePersistence: unexpected,
    };
    const agent = instantiate();
    const sessionContext = {
        agentContext: await agent.initializeAgentContext!(),
        sessionStorage: storage,
    } as SessionContext;
    await agent.updateAgentContext!(true, sessionContext, "list");
    return {
        readInventory: () =>
            agent.executeAction!(
                { schemaName: "list", actionName: "listLists", parameters: {} },
                { sessionContext } as ActionContext<unknown>,
            ),
    };
}

describe("list inventory action results", () => {
    test.each([
        { label: "empty", names: [] },
        { label: "one list", names: ["mixed-demo-pricing"] },
        {
            label: "multiple lists",
            names: ["mixed-demo-pricing", "mixed-demo-payment"],
        },
    ])("$label supplies a result for dependent actions", async ({ names }) => {
        const { readInventory } = await createInventoryAgent(
            names.map((name) => ({ name, items: ["keep unchanged"] })),
        );
        const result = await readInventory();
        if (result === undefined || result.error !== undefined) {
            throw new Error(`Inventory failed: ${JSON.stringify(result)}`);
        }
        expect(result?.resultEntity).toEqual({
            name: "list inventory",
            type: ["listInventory"],
            facets: [{ name: "lists", value: names }],
        });
        expect(result?.resultValue).toEqual({ lists: names });
        expect(result?.entities).toEqual(
            names.map((name) => ({ name, type: ["list"] })),
        );
        expect(result?.displayContent).toMatchObject({
            type: "structured",
            rawData: { lists: names },
        });
        const heading =
            names.length === 0
                ? "Lists"
                : `Lists — ${names.length} list${names.length === 1 ? "" : "s"}`;
        expect(result?.historyText).toBe(
            names.length === 0
                ? `${heading}\n\nThere are no lists yet.`
                : `${heading}\n\n${names.map((name) => `- ${name}`).join("\n")}`,
        );
        expect(await readInventory()).toEqual(result);
    });
});
