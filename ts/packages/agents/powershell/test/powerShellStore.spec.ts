// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Storage, TokenCachePersistence } from "@typeagent/agent-sdk";
import { PowerShellStore } from "../src/store/powerShellStore.mjs";
import type { ScriptRecipe } from "../src/types/scriptRecipe.js";

class MockStorage implements Storage {
    private data = new Map<string, string>();
    private writeFailure:
        | {
              path: string;
              remainingWrites: number;
              error: Error;
              beforeFailure?: () => Promise<void>;
          }
        | undefined;

    failWriteAfter(
        path: string,
        remainingWrites: number,
        error: Error,
        beforeFailure?: () => Promise<void>,
    ): void {
        this.writeFailure = {
            path,
            remainingWrites,
            error,
            ...(beforeFailure ? { beforeFailure } : {}),
        };
    }

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
        if (this.writeFailure?.path === storagePath) {
            if (this.writeFailure.remainingWrites === 0) {
                const { error, beforeFailure } = this.writeFailure;
                this.writeFailure = undefined;
                await beforeFailure?.();
                throw error;
            }
            this.writeFailure.remainingWrites--;
        }
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

    it("removes partial flow state when save fails", async () => {
        const storage = new MockStorage();
        const store = new PowerShellStore(storage);
        await store.initialize();
        storage.failWriteAfter(
            "scripts/showPorts.ps1",
            0,
            new Error("script write failed"),
        );

        await expect(
            store.saveFlow(createRecipe(), "reasoning"),
        ).rejects.toThrow("script write failed");
        expect(store.hasFlow("showPorts")).toBe(false);
        await expect(storage.exists("flows/showPorts.flow.json")).resolves.toBe(
            false,
        );
        await expect(storage.exists("scripts/showPorts.ps1")).resolves.toBe(
            false,
        );
    });

    it("preserves unrelated flows when a concurrent save fails", async () => {
        const storage = new MockStorage();
        const store = new PowerShellStore(storage);
        await store.initialize();
        storage.failWriteAfter(
            "scripts/failingFlow.ps1",
            0,
            new Error("script write failed"),
            async () => {
                await store.saveFlow(
                    createRecipe("concurrentFlow"),
                    "reasoning",
                );
            },
        );

        await expect(
            store.saveFlow(createRecipe("failingFlow"), "reasoning"),
        ).rejects.toThrow("script write failed");
        expect(store.hasFlow("failingFlow")).toBe(false);
        expect(store.hasFlow("concurrentFlow")).toBe(true);
        await expect(store.getScript("concurrentFlow")).resolves.toBe(
            "Get-NetTCPConnection -State Listen",
        );
    });

    it("restores flow state when an update fails", async () => {
        const storage = new MockStorage();
        const store = new PowerShellStore(storage);
        await store.initialize();
        await store.saveFlow(createRecipe(), "reasoning");
        storage.failWriteAfter(
            "flows/showPorts.flow.json",
            0,
            new Error("flow definition write failed"),
        );

        await expect(
            store.updateFlowScript("showPorts", "Write-Output 'changed'", [
                "Write-Output",
            ]),
        ).rejects.toThrow("flow definition write failed");
        await expect(store.getScript("showPorts")).resolves.toBe(
            "Get-NetTCPConnection -State Listen",
        );
        await expect(store.getFlow("showPorts")).resolves.toMatchObject({
            sandbox: {
                allowedCmdlets: ["Get-NetTCPConnection"],
                allowedModules: ["NetTCPIP"],
            },
        });
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
        expect(schema).toContain("repairAndExecutePowerShellFlow");
    });
});
