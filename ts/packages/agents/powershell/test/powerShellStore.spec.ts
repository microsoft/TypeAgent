// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Storage, TokenCachePersistence } from "@typeagent/agent-sdk";
import { PowerShellStore } from "../src/store/powerShellStore.mjs";
import type { ScriptRecipe } from "../src/types/scriptRecipe.js";

class MockStorage implements Storage {
    private data = new Map<string, string>();

    async read(storagePath: string): Promise<Uint8Array>;
    async read(
        storagePath: string,
        options: "utf8" | "base64",
    ): Promise<string>;
    async read(
        storagePath: string,
        options?: "utf8" | "base64",
    ): Promise<Uint8Array | string> {
        const value = this.data.get(storagePath);
        if (value === undefined) {
            throw new Error(`File not found: ${storagePath}`);
        }
        return options ? value : new TextEncoder().encode(value);
    }

    async write(storagePath: string, data: string | Uint8Array): Promise<void> {
        this.data.set(
            storagePath,
            typeof data === "string" ? data : new TextDecoder().decode(data),
        );
    }

    async list(storagePath: string): Promise<string[]> {
        const prefix = `${storagePath}/`;
        return [...this.data.keys()]
            .filter((key) => key.startsWith(prefix))
            .map((key) => key.substring(prefix.length));
    }

    async exists(storagePath: string): Promise<boolean> {
        return this.data.has(storagePath);
    }

    async delete(storagePath: string): Promise<void> {
        this.data.delete(storagePath);
    }

    async getTokenCachePersistence(): Promise<TokenCachePersistence> {
        return {
            load: async () => null,
            save: async () => {},
            delete: async () => true,
        };
    }
}

function createRecipe(actionName = "showPorts"): ScriptRecipe {
    return {
        version: 1,
        actionName,
        description: "Show listening ports",
        displayName: "Show Ports",
        parameters: [],
        script: {
            language: "powershell",
            body: "Get-NetTCPConnection -State Listen",
            expectedOutputFormat: "text",
        },
        grammarPatterns: [
            {
                pattern: "show listening ports",
                isAlias: false,
                examples: [],
            },
        ],
        sandbox: {
            allowedCmdlets: ["Get-NetTCPConnection"],
            allowedPaths: [],
            allowedModules: ["NetTCPIP"],
            maxExecutionTime: 30,
            networkAccess: false,
        },
    };
}

describe("PowerShellStore capability lifecycle", () => {
    it("does not overwrite an existing flow", async () => {
        const store = new PowerShellStore(new MockStorage());
        await store.initialize();
        await store.saveFlow(createRecipe(), "reasoning");

        await expect(
            store.saveFlow(createRecipe(), "reasoning"),
        ).rejects.toThrow("Flow already exists: showPorts");
    });

    it("promotes a pending recipe and removes the draft", async () => {
        const store = new PowerShellStore(new MockStorage());
        await store.initialize();
        const pendingId = await store.savePending(createRecipe());

        await expect(
            store.promotePending(`${pendingId}.recipe.json`),
        ).resolves.toBe("showPorts");
        await expect(store.listPending()).resolves.toEqual([]);
        expect(store.hasFlow("showPorts")).toBe(true);
    });

    it("adds new grammar patterns without duplicating existing ones", async () => {
        const store = new PowerShellStore(new MockStorage());
        await store.initialize();
        await store.saveFlow(createRecipe(), "reasoning");

        await expect(
            store.addGrammarPatterns("showPorts", [
                {
                    pattern: "show listening ports",
                    isAlias: true,
                    examples: [],
                },
                {
                    pattern: "show processes using ports",
                    isAlias: true,
                    examples: [],
                },
            ]),
        ).resolves.toBe(1);

        const flow = await store.getFlow("showPorts");
        expect(flow?.grammarPatterns.map((pattern) => pattern.pattern)).toEqual(
            ["show listening ports", "show processes using ports"],
        );
    });

    it("exposes transactional and outcome actions in the dynamic schema", async () => {
        const store = new PowerShellStore(new MockStorage());
        await store.initialize();

        const schema = store.generateDynamicSchemaText();
        expect(schema).toContain("createAndExecutePowerShellFlow");
        expect(schema).toContain("addPowerShellFlowPatterns");
        expect(schema).toContain("reportPowerShellCapabilityOutcome");
    });
});
