// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Storage, TokenCachePersistence } from "@typeagent/agent-sdk";
import { PowerShellStore } from "../src/store/powerShellStore.mjs";
import {
    createEditedScriptSource,
    type ScriptRecipe,
} from "../src/types/scriptRecipe.js";
import {
    canonicalPowerShellJson,
    createPowerShellRevision,
    validatePowerShellIdentifier,
} from "@typeagent/agent-flows/powershell/integrity";

class MockStorage implements Storage {
    private data = new Map<string, string | Uint8Array>();
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

    setRawScriptBytes(path: string, bytes: Uint8Array): void {
        this.data.set(path, bytes);
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
        const bytes =
            typeof value === "string" ? new TextEncoder().encode(value) : value;
        return options ? new TextDecoder().decode(bytes) : bytes;
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
    it("preserves UTF-8 BOM content and rejects invalid byte sequences", async () => {
        const storage = new MockStorage();
        const store = new PowerShellStore(storage);
        await store.initialize();
        const recipe = createRecipe();
        recipe.script.body = "\ufeffWrite-Output 'candidate'";
        await store.saveFlow(recipe);
        expect(await store.getScript("showPorts")).toBe(recipe.script.body);
        storage.setRawScriptBytes(
            "scripts/showPorts.ps1",
            new Uint8Array([0xc3, 0x28]),
        );
        await expect(store.getScript("showPorts")).rejects.toThrow(
            "Cannot read exact UTF-8 PowerShell script",
        );
    });

    it.each(["manual", "reasoning", "seed", "imported"] as const)(
        "stores %s data as a candidate without execution approval",
        async (source) => {
            const storage = new MockStorage();
            const store = new PowerShellStore(storage);
            await store.initialize();
            const recipe = createRecipe();
            Object.assign(recipe, { approved: true, hash: "model-supplied" });
            await store.saveFlow(recipe, source);
            const revision = JSON.parse(
                await storage.read("revisions/showPorts.json", "utf8"),
            );
            expect(revision.scriptHash).toMatch(/^[a-f0-9]{64}$/);
            expect(revision).not.toHaveProperty("approved");
            expect(revision).not.toHaveProperty("hash");
        },
    );

    it("rejects a changed script reference before following it", async () => {
        const storage = new MockStorage();
        const store = new PowerShellStore(storage);
        await store.initialize();
        await store.saveFlow(createRecipe());
        const flow = JSON.parse(
            await storage.read("flows/showPorts.flow.json", "utf8"),
        );
        flow.scriptRef = "../outside.ps1";
        await storage.write("flows/showPorts.flow.json", JSON.stringify(flow));
        await expect(store.getFlow("showPorts")).rejects.toThrow(
            "Invalid flow metadata",
        );
    });

    it.each([
        "../escape",
        "..\\escape",
        "C:\\escape",
        "flow:stream",
        "__proto__",
        "constructor",
        "NUL",
        "bad/name",
    ])(
        "rejects unsafe identifier %s before any persistence or lookup",
        async (name) => {
            const storage = new MockStorage();
            const store = new PowerShellStore(storage);
            await store.initialize();
            expect(() => validatePowerShellIdentifier(name)).toThrow(
                "Invalid PowerShell flow identifier",
            );
            await expect(store.saveFlow(createRecipe(name))).rejects.toThrow(
                "Invalid PowerShell flow identifier",
            );
            await expect(store.savePending(createRecipe(name))).rejects.toThrow(
                "Invalid PowerShell flow identifier",
            );
            await expect(store.getFlow(name)).rejects.toThrow(
                "Invalid PowerShell flow identifier",
            );
            await expect(store.deleteFlow(name)).rejects.toThrow(
                "Invalid PowerShell flow identifier",
            );
            await expect(storage.list("flows")).resolves.toEqual([]);
            await expect(storage.list("scripts")).resolves.toEqual([]);
        },
    );

    it("rejects malicious indexes before following stored paths", async () => {
        const storage = new MockStorage();
        await storage.write(
            "index.json",
            JSON.stringify({
                version: 1,
                flows: {
                    showPorts: {
                        actionName: "showPorts",
                        flowPath: "../outside.json",
                        scriptPath: "scripts/showPorts.ps1",
                    },
                },
                deletedSamples: [],
            }),
        );
        await expect(new PowerShellStore(storage).initialize()).rejects.toThrow(
            "Invalid PowerShell storage destination",
        );
    });

    it("does not rebaseline same-command edits during load or registration", async () => {
        const storage = new MockStorage();
        const store = new PowerShellStore(storage);
        await store.initialize();
        await store.saveFlow(createRecipe());
        const recorded = await storage.read("revisions/showPorts.json", "utf8");
        await storage.write(
            "scripts/showPorts.ps1",
            "Get-NetTCPConnection -State Established",
        );
        await expect(store.getScript("showPorts")).rejects.toThrow(
            "integrity check failed",
        );
        await expect(
            store.updateFlowScript("showPorts", "Write-Output 1", [
                "Write-Output",
            ]),
        ).rejects.toThrow("integrity check failed");
        await expect(new PowerShellStore(storage).initialize()).rejects.toThrow(
            "integrity check failed",
        );
        expect(await storage.read("revisions/showPorts.json", "utf8")).toBe(
            recorded,
        );
    });

    it("detects changed defaults and preserves old data without a host revision", async () => {
        const storage = new MockStorage();
        const store = new PowerShellStore(storage);
        await store.initialize();
        const recipe = createRecipe();
        recipe.parameters = [
            {
                name: "Value",
                type: "string",
                required: false,
                description: "",
                default: "original",
            },
        ];
        await store.saveFlow(recipe);
        const flow = JSON.parse(
            await storage.read("flows/showPorts.flow.json", "utf8"),
        );
        flow.parameters[0].default = "changed";
        await storage.write("flows/showPorts.flow.json", JSON.stringify(flow));
        await expect(store.getFlow("showPorts")).rejects.toThrow(
            "integrity check failed",
        );
        await storage.delete("revisions/showPorts.json");
        await expect(new PowerShellStore(storage).initialize()).rejects.toThrow(
            "Missing host revision",
        );
        expect(await storage.exists("scripts/showPorts.ps1")).toBe(true);
    });

    it("keeps usage accounting out of execution revisions", async () => {
        const store = new PowerShellStore(new MockStorage());
        await store.initialize();
        await store.saveFlow(createRecipe());
        const before = await store.getExecutionSnapshot("showPorts");
        await store.recordUsage("showPorts");
        const after = await store.getExecutionSnapshot("showPorts");
        expect(after?.revision).toEqual(before?.revision);
        await expect(before?.assertCurrent()).resolves.toBeUndefined();
    });

    it("invalidates outstanding snapshots after a controlled edit", async () => {
        const store = new PowerShellStore(new MockStorage());
        await store.initialize();
        await store.saveFlow(createRecipe());
        const before = await store.getExecutionSnapshot("showPorts");
        await store.updateFlowScript("showPorts", "Write-Output 'changed'", [
            "Write-Output",
        ]);
        await expect(before?.assertCurrent()).rejects.toThrow(
            "changed while approval was pending",
        );
        expect(before?.script).toBe("Get-NetTCPConnection -State Listen");
        expect(
            (await store.getExecutionSnapshot("showPorts"))?.revision,
        ).not.toEqual(before?.revision);
    });

    it("rejects pending traversal and tampered promotion", async () => {
        const storage = new MockStorage();
        const store = new PowerShellStore(storage);
        await store.initialize();
        await expect(
            store.getPending("../outside.recipe.json"),
        ).rejects.toThrow("Invalid PowerShell flow identifier");
        await expect(
            store.deletePending("C:\\outside.recipe.json"),
        ).rejects.toThrow("Invalid PowerShell flow identifier");
        const id = await store.savePending(createRecipe());
        const changed = createRecipe();
        changed.script.body += " ";
        await storage.write(
            `pending/${id}.recipe.json`,
            JSON.stringify(changed),
        );
        await expect(store.promotePending(`${id}.recipe.json`)).rejects.toThrow(
            "integrity check failed",
        );
        expect(store.hasFlow("showPorts")).toBe(false);
    });

    it("uses deterministic SHA-256 without trimming or normalizing scripts", () => {
        expect(canonicalPowerShellJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
        const recipe = createRecipe();
        const metadata = {
            ...recipe,
            expectedOutputFormat: recipe.script.expectedOutputFormat,
        };
        const revision = createPowerShellRevision(
            "Write-Output 1\r\n",
            metadata,
        );
        expect(revision.scriptHash).toMatch(/^[0-9a-f]{64}$/);
        expect(
            createPowerShellRevision("Write-Output 1\n", metadata),
        ).not.toEqual(revision);
        expect(
            createPowerShellRevision("Write-Output 1\r\n ", metadata),
        ).not.toEqual(revision);
        expect(() => createPowerShellRevision("\ud800", metadata)).toThrow(
            "not valid Unicode",
        );
    });

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
            ["Write-Output"],
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
            ["Get-NetTCPConnection"],
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
