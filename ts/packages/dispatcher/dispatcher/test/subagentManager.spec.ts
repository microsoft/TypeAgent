// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    SubagentManager,
    SubagentManagerHost,
    SubagentInfo,
    resolveAgentServerUrl,
    getOrCreateSubagentManager,
} from "../src/reasoning/subagentManager.js";
import {
    handleCreateSubagent,
    handleInvokeSubagent,
    handleListSubagents,
    handleStopSubagent,
} from "../src/reasoning/subagentTools.js";

describe("resolveAgentServerUrl", () => {
    const saved = process.env.AGENT_SERVER_URL;
    afterEach(() => {
        if (saved === undefined) {
            delete process.env.AGENT_SERVER_URL;
        } else {
            process.env.AGENT_SERVER_URL = saved;
        }
    });

    it("returns the default url when the env var is unset", () => {
        delete process.env.AGENT_SERVER_URL;
        expect(resolveAgentServerUrl()).toBe("ws://localhost:8999");
    });

    it("returns the env var when set", () => {
        process.env.AGENT_SERVER_URL = "ws://localhost:12345";
        expect(resolveAgentServerUrl()).toBe("ws://localhost:12345");
    });

    it("trims and falls back on blank env var", () => {
        process.env.AGENT_SERVER_URL = "   ";
        expect(resolveAgentServerUrl()).toBe("ws://localhost:8999");
    });
});

describe("SubagentManager registry/lifecycle", () => {
    it("starts with no subagents", () => {
        const manager = new SubagentManager("ws://localhost:8999");
        expect(manager.listSubagents()).toEqual([]);
    });

    it("rejects invoke for an unknown id", async () => {
        const manager = new SubagentManager("ws://localhost:8999");
        await expect(manager.invokeSubagent("nope", "do it")).rejects.toThrow(
            /Unknown subagent id 'nope'/,
        );
    });

    it("rejects stop for an unknown id", async () => {
        const manager = new SubagentManager("ws://localhost:8999");
        await expect(manager.stopSubagent("nope")).rejects.toThrow(
            /Unknown subagent id 'nope'/,
        );
    });

    it("rejects creating a subagent with an empty name", async () => {
        const manager = new SubagentManager("ws://localhost:8999");
        await expect(manager.createSubagent({ name: "   " })).rejects.toThrow(
            /name must not be empty/,
        );
    });

    it("rejects creating a subagent after dispose", async () => {
        const manager = new SubagentManager("ws://localhost:8999");
        await manager.dispose();
        await expect(
            manager.createSubagent({ name: "worker" }),
        ).rejects.toThrow(/disposed/);
    });

    it("dispose on an empty manager is a no-op", async () => {
        const manager = new SubagentManager("ws://localhost:8999");
        await expect(manager.dispose()).resolves.toBeUndefined();
        expect(manager.listSubagents()).toEqual([]);
    });
});

describe("getOrCreateSubagentManager", () => {
    it("creates once and reuses the same instance", () => {
        const host: SubagentManagerHost = {};
        const first = getOrCreateSubagentManager(host);
        const second = getOrCreateSubagentManager(host);
        expect(first).toBe(second);
        expect(host.subagentManager).toBe(first);
    });

    it("returns an existing manager without replacing it", () => {
        const existing = new SubagentManager("ws://localhost:8999");
        const host: SubagentManagerHost = { subagentManager: existing };
        expect(getOrCreateSubagentManager(host)).toBe(existing);
    });
});

/** Minimal fake standing in for SubagentManager in the tool-handler tests. */
class FakeManager {
    public created: Array<{ name: string; instructions?: string }> = [];
    public invoked: Array<{ id: string; task: string }> = [];
    public stopped: string[] = [];
    constructor(private readonly list: SubagentInfo[] = []) {}

    async createSubagent(options: {
        name: string;
        instructions?: string;
    }): Promise<SubagentInfo> {
        this.created.push(options);
        const info: SubagentInfo = {
            id: "subagent-1",
            name: options.name,
            instructions: options.instructions,
            status: "ready",
            createdAt: "2024-01-01T00:00:00.000Z",
            conversationName: `subagent/${options.name}-subagent-1`,
        };
        this.list.push(info);
        return info;
    }

    async invokeSubagent(id: string, task: string): Promise<string> {
        this.invoked.push({ id, task });
        return `result for ${id}`;
    }

    listSubagents(): SubagentInfo[] {
        return this.list;
    }

    async stopSubagent(id: string): Promise<void> {
        this.stopped.push(id);
    }
}

function hostWith(fake: FakeManager): SubagentManagerHost {
    return { subagentManager: fake as unknown as SubagentManager };
}

describe("subagent tool handlers", () => {
    it("handleListSubagents reports none when empty", () => {
        expect(handleListSubagents({})).toBe("No subagents have been created.");
    });

    it("handleListSubagents serializes existing subagents", () => {
        const fake = new FakeManager([
            {
                id: "subagent-1",
                name: "worker",
                status: "ready",
                createdAt: "2024-01-01T00:00:00.000Z",
                conversationName: "subagent/worker-subagent-1",
            },
        ]);
        const text = handleListSubagents(hostWith(fake));
        const parsed = JSON.parse(text);
        expect(parsed).toEqual([
            {
                id: "subagent-1",
                name: "worker",
                status: "ready",
                createdAt: "2024-01-01T00:00:00.000Z",
            },
        ]);
    });

    it("handleCreateSubagent delegates and returns the id", async () => {
        const fake = new FakeManager();
        const message = await handleCreateSubagent(hostWith(fake), {
            name: "worker",
            instructions: "be helpful",
        });
        expect(fake.created).toEqual([
            { name: "worker", instructions: "be helpful" },
        ]);
        expect(message).toContain("subagent-1");
        expect(message).toContain("worker");
    });

    it("handleInvokeSubagent delegates and returns the result", async () => {
        const fake = new FakeManager();
        const result = await handleInvokeSubagent(hostWith(fake), {
            id: "subagent-1",
            task: "do the thing",
        });
        expect(fake.invoked).toEqual([
            { id: "subagent-1", task: "do the thing" },
        ]);
        expect(result).toBe("result for subagent-1");
    });

    it("handleStopSubagent delegates", async () => {
        const fake = new FakeManager();
        const message = await handleStopSubagent(hostWith(fake), {
            id: "subagent-1",
        });
        expect(fake.stopped).toEqual(["subagent-1"]);
        expect(message).toContain("subagent-1");
    });

    it("handleStopSubagent throws when no manager exists", async () => {
        await expect(
            handleStopSubagent({}, { id: "subagent-1" }),
        ).rejects.toThrow(/Unknown subagent id 'subagent-1'/);
    });
});
