// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { CallToolResult, Tool } from "@modelcontextprotocol/client";
import type { ActionContext, SessionContext } from "@typeagent/agent-sdk";
import { SessionMcpCredentialStore } from "../src/mcp/mcpCredentialStore.js";
import type { McpAuditEvent, McpAuditSink } from "../src/mcp/mcpAudit.js";
import { defaultMcpPolicy } from "../src/mcp/mcpPolicy.js";
import type {
    McpConnectionLike,
    McpRefreshScheduler,
} from "../src/mcp/mcpServerProvider.js";
import { createMcpServerAppAgentProvider } from "../src/mcp/mcpServerProvider.js";
import type { NormalizedMcpServerConfig } from "../src/mcp/mcpServerConfig.js";
import { getMcpToolIdentity } from "../src/mcp/mcpToolCatalog.js";

function tool(name: string, update: Partial<Tool> = {}): Tool {
    return {
        name,
        inputSchema: { type: "object", properties: {} },
        ...update,
    };
}

function config(id: string): NormalizedMcpServerConfig {
    return {
        id,
        name: id,
        scope: "user",
        trust: "trusted",
        enabled: true,
        provenance: { source: "test" },
        transport: { kind: "stdio", command: "node", args: ["server.js"] },
    };
}

class ManualScheduler implements McpRefreshScheduler {
    private callbacks = new Map<number, () => void>();
    private nextId = 0;

    setTimeout(callback: () => void): number {
        const id = ++this.nextId;
        this.callbacks.set(id, callback);
        return id;
    }

    clearTimeout(handle: unknown): void {
        this.callbacks.delete(handle as number);
    }

    runAll(): void {
        const callbacks = [...this.callbacks.values()];
        this.callbacks.clear();
        for (const callback of callbacks) {
            callback();
        }
    }

    get size(): number {
        return this.callbacks.size;
    }
}

class FakeConnection implements McpConnectionLike {
    readonly protocolEra = "legacy";
    readonly protocolVersion = "2025-11-25";
    closed = false;
    calls: { name: string; args: unknown }[] = [];

    constructor(
        public tools: Tool[],
        readonly supportsToolListChanged: boolean,
        private readonly result: CallToolResult = {
            content: [{ type: "text", text: "ok" }],
        },
    ) {}

    async listTools(): Promise<Tool[]> {
        return this.tools;
    }

    async callTool(
        name: string,
        args: Record<string, unknown> | undefined,
    ): Promise<CallToolResult> {
        this.calls.push({ name, args });
        return this.result;
    }

    async close(): Promise<void> {
        this.closed = true;
    }
}

function session(
    id: string,
    reload: () => Promise<void> = async () => {},
    popup: () => Promise<number> = async () => 0,
): SessionContext {
    return {
        sessionContextId: id,
        reloadAgentSchema: reload,
        popupQuestion: popup,
    } as unknown as SessionContext;
}

function actionContext(context: SessionContext): ActionContext {
    return { sessionContext: context } as ActionContext;
}

async function settle(): Promise<void> {
    await new Promise<void>((resolve) => setImmediate(resolve));
}

function schemaContent(manifest: {
    schema?: { schemaFile: string | { content: string } };
}): string {
    const schemaFile = manifest.schema?.schemaFile;
    if (schemaFile === undefined || typeof schemaFile === "string") {
        throw new Error("Expected an inline schema file");
    }
    return schemaFile.content;
}

describe("MCP server provider milestone 5", () => {
    it("returns failed ActionResults for argument and output validation", async () => {
        const typed = tool("typed", {
            inputSchema: {
                type: "object",
                required: ["count"],
                properties: { count: { type: "integer" } },
            },
            outputSchema: {
                type: "object",
                required: ["ok"],
                properties: { ok: { type: "boolean" } },
            },
        });
        const connection = new FakeConnection([typed], false, {
            content: [],
            structuredContent: { ok: "no" },
        });
        const provider = createMcpServerAppAgentProvider(
            "server",
            config("server-id"),
            { name: "test", version: "1" },
            {
                credentialStore: new SessionMcpCredentialStore(),
                policy: defaultMcpPolicy,
                audit: { async write() {} },
                connectionFactory: async () => connection,
            },
        );
        const agent = await provider.loadAppAgent("server");
        const context = actionContext(session("one"));

        const badInput = await agent.executeAction!(
            {
                schemaName: "server",
                actionName: "typed",
                parameters: { count: "wrong" },
            },
            context,
        );
        expect(badInput?.error).toContain("rejected its arguments");
        expect(connection.calls).toHaveLength(0);

        const badOutput = await agent.executeAction!(
            {
                schemaName: "server",
                actionName: "typed",
                parameters: { count: 1 },
            },
            context,
        );
        expect(badOutput?.error).toContain("does not match outputSchema");
        expect(connection.calls).toHaveLength(1);
        await provider.unloadAppAgent("server");
    });

    it("isolates approvals and audit identities for same-named tools on different servers", async () => {
        const audits: McpAuditEvent[] = [];
        const audit: McpAuditSink = {
            async write(event) {
                audits.push(event);
            },
        };
        const mutating = tool("change", {
            annotations: { readOnlyHint: false },
        });
        const makeProvider = (id: string) =>
            createMcpServerAppAgentProvider(
                id,
                config(id),
                { name: "test", version: "1" },
                {
                    credentialStore: new SessionMcpCredentialStore(),
                    policy: defaultMcpPolicy,
                    audit,
                    connectionFactory: async () =>
                        new FakeConnection([mutating], false),
                },
            );
        const a = makeProvider("a");
        const b = makeProvider("b");
        const agentA = await a.loadAppAgent("a");
        const agentB = await b.loadAppAgent("b");
        let prompts = 0;
        const context = actionContext(
            session(
                "shared",
                async () => {},
                async () => {
                    prompts++;
                    return 1;
                },
            ),
        );
        const action = {
            schemaName: "mcp",
            actionName: "change",
            parameters: {},
        };

        await agentA.executeAction!(action, context);
        await agentA.executeAction!(action, context);
        await agentB.executeAction!(action, context);

        expect(prompts).toBe(2);
        expect(
            audits
                .filter((event) => event.operation === "tool-invocation")
                .map((event) => event.toolId),
        ).toEqual([
            getMcpToolIdentity("a", "change"),
            getMcpToolIdentity("a", "change"),
            getMcpToolIdentity("b", "change"),
        ]);
        await a.unloadAppAgent("a");
        await b.unloadAppAgent("b");
    });

    it("refreshes atomically, coalesces bursts, fans out reload, and audits no-op/rollback", async () => {
        const scheduler = new ManualScheduler();
        const audits: McpAuditEvent[] = [];
        const connection = new FakeConnection([tool("first")], true);
        let notify:
            | ((error: Error | null, tools: Tool[] | null) => void)
            | undefined;
        const provider = createMcpServerAppAgentProvider(
            "server",
            config("server-id"),
            { name: "test", version: "1" },
            {
                credentialStore: new SessionMcpCredentialStore(),
                policy: defaultMcpPolicy,
                audit: {
                    async write(event) {
                        audits.push(event);
                    },
                },
                refreshScheduler: scheduler,
                connectionFactory: async (_info, _transport, options) => {
                    notify = options.toolsChanged;
                    return connection;
                },
            },
        );
        const agent = await provider.loadAppAgent("server");
        let reloadA = 0;
        let reloadB = 0;
        await agent.updateAgentContext!(
            true,
            session("a", async () => {
                reloadA++;
            }),
            "server",
        );
        await agent.updateAgentContext!(
            true,
            session("b", async () => {
                reloadB++;
                throw new Error("closing");
            }),
            "server",
        );
        const initialManifest = await provider.getAppAgentManifest("server");
        expect(Object.isFrozen(initialManifest)).toBe(true);
        expect(schemaContent(initialManifest)).toContain("first");

        notify!(null, [tool("second")]);
        notify!(null, [tool("third")]);
        expect(scheduler.size).toBe(1);
        scheduler.runAll();
        await settle();

        const refreshed = await provider.getAppAgentManifest("server");
        expect(schemaContent(refreshed)).toContain("third");
        expect(schemaContent(refreshed)).not.toContain("first");
        expect(schemaContent(initialManifest)).toContain("first");
        expect(reloadA).toBe(1);
        expect(reloadB).toBe(1);

        notify!(null, [tool("third")]);
        scheduler.runAll();
        await settle();
        expect(reloadA).toBe(1);

        notify!(new Error("list failed"), null);
        scheduler.runAll();
        await settle();
        notify!(null, []);
        scheduler.runAll();
        await settle();
        const retained = await provider.getAppAgentManifest("server");
        expect(schemaContent(retained)).toContain("third");
        expect(
            audits
                .filter((event) => event.operation === "catalog-refresh")
                .map((event) => [event.status, event.decision]),
        ).toEqual([
            ["success", "updated"],
            ["success", "no-op"],
            ["failure", "rollback"],
            ["failure", "rollback"],
        ]);
        await provider.unloadAppAgent("server");
    });

    it("does not activate list changes when unadvertised and ignores late notifications after unload", async () => {
        const scheduler = new ManualScheduler();
        const connection = new FakeConnection([tool("stable")], false);
        let notify:
            | ((error: Error | null, tools: Tool[] | null) => void)
            | undefined;
        const provider = createMcpServerAppAgentProvider(
            "server",
            config("server-id"),
            { name: "test", version: "1" },
            {
                credentialStore: new SessionMcpCredentialStore(),
                policy: defaultMcpPolicy,
                audit: { async write() {} },
                refreshScheduler: scheduler,
                connectionFactory: async (_info, _transport, options) => {
                    if (connection.supportsToolListChanged) {
                        notify = options.toolsChanged;
                    }
                    return connection;
                },
            },
        );
        await provider.loadAppAgent("server");
        expect(notify).toBeUndefined();
        await provider.unloadAppAgent("server");
        expect(connection.closed).toBe(true);

        const advertised = new FakeConnection([tool("stable")], true);
        const provider2 = createMcpServerAppAgentProvider(
            "server2",
            config("server-2"),
            { name: "test", version: "1" },
            {
                credentialStore: new SessionMcpCredentialStore(),
                policy: defaultMcpPolicy,
                audit: { async write() {} },
                refreshScheduler: scheduler,
                connectionFactory: async (_info, _transport, options) => {
                    notify = options.toolsChanged;
                    return advertised;
                },
            },
        );
        await provider2.loadAppAgent("server2");
        await provider2.unloadAppAgent("server2");
        notify!(null, [tool("late")]);
        expect(scheduler.size).toBe(0);
    });

    it("coalesces a notification during refresh into one follow-up pass", async () => {
        const scheduler = new ManualScheduler();
        const connection = new FakeConnection([tool("first")], true);
        let notify:
            | ((error: Error | null, tools: Tool[] | null) => void)
            | undefined;
        let releaseAudit!: () => void;
        const auditGate = new Promise<void>((resolve) => {
            releaseAudit = resolve;
        });
        let enteredAudit!: () => void;
        const auditEntered = new Promise<void>((resolve) => {
            enteredAudit = resolve;
        });
        let gateFirstRefresh = true;
        const provider = createMcpServerAppAgentProvider(
            "server",
            config("server-id"),
            { name: "test", version: "1" },
            {
                credentialStore: new SessionMcpCredentialStore(),
                policy: defaultMcpPolicy,
                audit: {
                    async write(event) {
                        if (
                            gateFirstRefresh &&
                            event.operation === "catalog-refresh" &&
                            event.decision === "updated"
                        ) {
                            gateFirstRefresh = false;
                            enteredAudit();
                            await auditGate;
                        }
                    },
                },
                refreshScheduler: scheduler,
                connectionFactory: async (_info, _transport, options) => {
                    notify = options.toolsChanged;
                    return connection;
                },
            },
        );
        const agent = await provider.loadAppAgent("server");
        let reloads = 0;
        await agent.updateAgentContext!(
            true,
            session("one", async () => {
                reloads++;
            }),
            "server",
        );

        notify!(null, [tool("second")]);
        scheduler.runAll();
        await auditEntered;
        notify!(null, [tool("third")]);
        expect(scheduler.size).toBe(0);
        releaseAudit();
        await settle();
        expect(scheduler.size).toBe(1);
        scheduler.runAll();
        await settle();

        expect(
            schemaContent(await provider.getAppAgentManifest("server")),
        ).toContain("third");
        expect(reloads).toBe(2);
        await provider.unloadAppAgent("server");
    });
});
