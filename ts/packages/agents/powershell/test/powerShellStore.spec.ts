// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Storage, TokenCachePersistence } from "@typeagent/agent-sdk";
import { PowerShellStore } from "../src/store/powerShellStore.mjs";
import {
    createEditedScriptSource,
    type ScriptRecipe,
} from "../src/types/scriptRecipe.js";

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
        return (
            this.data.has(storagePath) ||
            [...this.data.keys()].some((key) =>
                key.startsWith(`${storagePath}/`),
            )
        );
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
    it("preserves older flows without silently recording or approving their version", async () => {
        const storage = new MockStorage();
        const original = new PowerShellStore(storage);
        await original.initialize();
        await original.saveFlow(createRecipe());
        await storage.delete("revisions/showPorts.json");
        const reloaded = new PowerShellStore(storage);
        await reloaded.initialize();
        expect(reloaded.listFlows()).toHaveLength(1);
        const snapshot = await reloaded.getExecutionSnapshot("showPorts");
        expect(snapshot?.revisionStatus).toBe("unverified");
        expect(await storage.exists("revisions/showPorts.json")).toBe(false);
        await snapshot!.acceptRevision();
        expect(
            (await reloaded.getExecutionSnapshot("showPorts"))?.revisionStatus,
        ).toBe("verified");
    });

    it.each(["script", "default", "module", "timeout"])(
        "detects an external %s edit across restarts",
        async (kind) => {
            const storage = new MockStorage();
            const store = new PowerShellStore(storage);
            await store.initialize();
            await store.saveFlow(createRecipe());
            if (kind === "script") {
                await storage.write(
                    "scripts/showPorts.ps1",
                    "Write-Output 'changed'",
                );
            } else {
                const flow = await store.getFlow("showPorts");
                if (kind === "default")
                    flow!.parameters = [
                        {
                            name: "Name",
                            type: "string",
                            required: false,
                            description: "",
                            default: "changed",
                        },
                    ];
                if (kind === "module") flow!.requiredModules = ["Changed"];
                if (kind === "timeout") flow!.sandbox.maxExecutionTime = 60;
                await storage.write(
                    "flows/showPorts.flow.json",
                    JSON.stringify(flow),
                );
            }
            const reloaded = new PowerShellStore(storage);
            await reloaded.initialize();
            expect(
                (await reloaded.getExecutionSnapshot("showPorts"))
                    ?.revisionStatus,
            ).toBe("changed");
        },
    );

    it("does not baseline a version replaced while being reviewed", async () => {
        const storage = new MockStorage();
        const store = new PowerShellStore(storage);
        await store.initialize();
        await store.saveFlow(createRecipe());
        await storage.delete("revisions/showPorts.json");
        const snapshot = await store.getExecutionSnapshot("showPorts");
        await storage.write(
            "scripts/showPorts.ps1",
            "Write-Output 'replacement'",
        );
        await expect(snapshot!.acceptRevision()).rejects.toThrow(
            "changed while approval was pending",
        );
        expect(await storage.exists("revisions/showPorts.json")).toBe(false);
    });

    it("rejects changed pending code before promotion", async () => {
        const storage = new MockStorage();
        const store = new PowerShellStore(storage);
        await store.initialize();
        const id = await store.savePending(createRecipe());
        const replacement = createRecipe();
        replacement.script.body = "Write-Output 'replacement'";
        await storage.write(
            `pending/${id}.recipe.json`,
            JSON.stringify(replacement),
        );
        await expect(store.promotePending(`${id}.recipe.json`)).rejects.toThrow(
            "Pending recipe changed",
        );
        expect(store.listFlows()).toHaveLength(0);
    });

    it("rejects redirected index paths without replacing the index", async () => {
        const storage = new MockStorage();
        const index = JSON.stringify({
            version: 1,
            flows: {
                showPorts: {
                    actionName: "showPorts",
                    flowPath: "../outside.json",
                    scriptPath: "../outside.ps1",
                },
            },
            deletedSamples: [],
        });
        await storage.write("index.json", index);
        await expect(new PowerShellStore(storage).initialize()).rejects.toThrow(
            "Invalid PowerShell storage destination",
        );
        expect(await storage.read("index.json", "utf8")).toBe(index);
    });

    it.each([
        "../profile",
        "..\\profile",
        "C:\\profile",
        "",
        "__proto__",
        "CON",
        "name:stream",
    ])(
        "rejects unsafe candidate names before writing scripts: %s",
        async (name) => {
            const storage = new MockStorage();
            const store = new PowerShellStore(storage);
            await store.initialize();
            await expect(store.saveFlow(createRecipe(name))).rejects.toThrow(
                "Invalid PowerShell flow name",
            );
            await expect(store.savePending(createRecipe(name))).rejects.toThrow(
                "Invalid PowerShell flow name",
            );
            expect(await storage.list("scripts")).toEqual([]);
            expect(await storage.list("flows")).toEqual([]);
            expect(await storage.list("pending")).toEqual([]);
        },
    );

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
            store.updateFlowScript("showPorts", "Write-Output 'changed'", []),
        ).rejects.toThrow("flow definition write failed");
        await expect(store.getScript("showPorts")).resolves.toBe(
            "Get-NetTCPConnection -State Listen",
        );
        await expect(store.getFlow("showPorts")).resolves.toMatchObject({
            requiredModules: ["NetTCPIP"],
        });
    });

    it("stores imported provenance in the index and flow definition", async () => {
        const store = new PowerShellStore(new MockStorage());
        await store.initialize();
        const recipe = createRecipe();
        recipe.source = {
            type: "imported",
            timestamp: "2026-09-25T00:00:00.000Z",
        };

        await store.saveFlow(recipe, "imported");

        expect(store.listFlows()).toEqual([
            expect.objectContaining({ source: "imported" }),
        ]);
        await expect(store.getFlow("showPorts")).resolves.toMatchObject({
            source: {
                type: "imported",
                timestamp: "2026-09-25T00:00:00.000Z",
            },
        });
    });

    it("records edits while retaining the original provenance", async () => {
        const store = new PowerShellStore(new MockStorage());
        await store.initialize();
        await store.saveFlow(createRecipe(), "reasoning");
        const original = await store.getFlow("showPorts");
        const editedSource = createEditedScriptSource(original?.source);

        await store.updateFlowScript(
            "showPorts",
            "Write-Output 'edited'",
            [],
            editedSource,
        );

        expect(store.listFlows()).toEqual([
            expect.objectContaining({ source: "edited" }),
        ]);
        await expect(store.getFlow("showPorts")).resolves.toMatchObject({
            source: {
                type: "edited",
                originalType: "reasoning",
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

    it("binds learned routes to the individual flow definition", async () => {
        const store = new PowerShellStore(new MockStorage());
        await store.initialize();
        await store.saveFlow(createRecipe("showPorts"), "reasoning");
        await store.saveFlow(createRecipe("showOtherPorts"), "reasoning");

        const before = await store.getActionCacheBinding();
        await store.addGrammarPatterns("showOtherPorts", [
            {
                pattern: "display other listeners",
                isAlias: true,
                examples: [],
            },
        ]);
        const afterAlias = await store.getActionCacheBinding();
        expect(afterAlias.actionFingerprints.showPorts).toBe(
            before.actionFingerprints.showPorts,
        );
        expect(afterAlias.actionFingerprints.showOtherPorts).toBe(
            before.actionFingerprints.showOtherPorts,
        );

        await store.updateFlowScript(
            "showOtherPorts",
            "Get-NetTCPConnection -State Established",
        );
        const afterScript = await store.getActionCacheBinding();
        expect(afterScript.actionFingerprints.showPorts).toBe(
            before.actionFingerprints.showPorts,
        );
        expect(afterScript.actionFingerprints.showOtherPorts).not.toBe(
            before.actionFingerprints.showOtherPorts,
        );
    });

    it("exposes flow lifecycle and outcome actions in the dynamic schema", async () => {
        const store = new PowerShellStore(new MockStorage());
        await store.initialize();

        const schema = store.generateDynamicSchemaText();
        expect(schema).toContain("createAndExecutePowerShellFlow");
        expect(schema).toContain("addPowerShellFlowPatterns");
        expect(schema).not.toContain("addAndExecutePowerShellFlowPatterns");
        expect(schema).toContain("reportPowerShellCapabilityOutcome");
        expect(schema).toContain("repairAndExecutePowerShellFlow");
    });
});
