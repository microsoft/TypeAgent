// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import registerDebug from "debug";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const debug = registerDebug("typeagent:dispatcher:reasoning:subagent");

/**
 * Public description of a subagent, safe to surface to the reasoning model.
 */
export interface SubagentInfo {
    id: string;
    name: string;
    instructions?: string | undefined;
    status: "ready" | "connecting" | "stopped";
    createdAt: string;
    /** Name of the isolated conversation this subagent runs in. */
    conversationName: string;
}

interface SubagentEntry {
    info: SubagentInfo;
    client: Client;
    transport: StdioClientTransport;
    /** Whether create-time instructions have already been sent to the subagent. */
    instructionsSent: boolean;
}

export interface CreateSubagentOptions {
    /** Short name/role for the subagent (used in the conversation name). */
    name: string;
    /**
     * Persistent role/context prepended to the subagent's first task so its
     * dispatcher reasoning knows how to behave.
     */
    instructions?: string | undefined;
}

/**
 * Default agent-server WebSocket URL. Mirrors
 * `@typeagent/agent-server-protocol`'s AGENT_SERVER_DEFAULT_URL without taking
 * a dependency on it just for the constant.
 */
const DEFAULT_AGENT_SERVER_URL = "ws://localhost:8999";

/** Time to wait for a new subagent to connect to the agent server. */
const CONNECT_TIMEOUT_MS = 20_000;

/** Maximum number of concurrently live subagents per session. */
const MAX_SUBAGENTS = 100;

/**
 * Resolve the agent-server URL a spawned command-executor should connect to.
 * The standalone agent server publishes its own listen URL into
 * `AGENT_SERVER_URL` at startup (see agentServer/server), so an in-process
 * reasoning loop picks up the right port here.
 */
export function resolveAgentServerUrl(): string {
    return process.env.AGENT_SERVER_URL?.trim() || DEFAULT_AGENT_SERVER_URL;
}

/**
 * Resolve the path to the command-executor server entry (`dist/server.js`).
 * Compiled location of this module:
 *   packages/dispatcher/dispatcher/dist/reasoning/subagentManager.js
 * Go up 5 levels to reach `ts/`, then into the commandExecutor package.
 */
function getCommandExecutorEntry(): string {
    const thisFile = fileURLToPath(import.meta.url);
    const repoRoot = path.resolve(path.dirname(thisFile), "../../../../..");
    return path.join(
        repoRoot,
        "packages",
        "commandExecutor",
        "dist",
        "server.js",
    );
}

/** Build the child environment: inherit ours, then set the subagent overrides. */
function buildChildEnv(
    agentServerUrl: string,
    conversationName: string,
): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
        if (typeof value === "string") {
            env[key] = value;
        }
    }
    env.AGENT_SERVER_URL = agentServerUrl;
    env.AGENT_SERVER_CONVERSATION = conversationName;
    return env;
}

/** Flatten a CallToolResult's content blocks into plain text. */
function extractToolText(result: unknown): string {
    const content = (result as { content?: unknown })?.content;
    if (!Array.isArray(content)) {
        return "";
    }
    return content
        .filter(
            (block): block is { type: "text"; text: string } =>
                (block as { type?: unknown })?.type === "text" &&
                typeof (block as { text?: unknown })?.text === "string",
        )
        .map((block) => block.text)
        .join("\n");
}

/**
 * Manages the lifecycle of reasoning subagents. Each subagent is a spawned
 * command-executor process (its own action-execution instance) running in an
 * isolated conversation, driven over MCP stdio. The reasoning loop creates,
 * invokes, lists, and stops subagents through this manager.
 *
 * One instance is owned per dispatcher session (see CommandHandlerContext) and
 * disposed when the session closes.
 */
export class SubagentManager {
    private readonly subagents = new Map<string, SubagentEntry>();
    private counter = 0;
    private readonly agentServerUrl: string;
    private disposed = false;

    constructor(agentServerUrl: string = resolveAgentServerUrl()) {
        this.agentServerUrl = agentServerUrl;
    }

    /**
     * Spawn a new command-executor process for a subagent, wait until it is
     * connected to the agent server, and register it. Throws (and cleans up the
     * process) if it cannot connect within the timeout.
     */
    async createSubagent(
        options: CreateSubagentOptions,
    ): Promise<SubagentInfo> {
        if (this.disposed) {
            throw new Error("SubagentManager has been disposed");
        }
        if (this.subagents.size >= MAX_SUBAGENTS) {
            throw new Error(
                `Cannot create more than ${MAX_SUBAGENTS} subagents`,
            );
        }
        const name = options.name.trim();
        if (name.length === 0) {
            throw new Error("Subagent name must not be empty");
        }
        const entryPath = getCommandExecutorEntry();
        if (!fs.existsSync(entryPath)) {
            throw new Error(
                `command-executor server not found at ${entryPath}. ` +
                    `Build it first: pnpm run build commandExecutor`,
            );
        }

        const id = `subagent-${++this.counter}`;
        const conversationName = `subagent/${name}-${id}`;
        const transport = new StdioClientTransport({
            command: process.execPath,
            args: [entryPath],
            env: buildChildEnv(this.agentServerUrl, conversationName),
            stderr: "inherit",
        });
        const client = new Client({
            name: "typeagent-subagent-manager",
            version: "1.0.0",
        });

        try {
            await client.connect(transport);
        } catch (error) {
            await closeQuietly(client);
            throw new Error(
                `Failed to start subagent '${name}': ${errorText(error)}`,
            );
        }

        if (this.disposed) {
            await closeQuietly(client);
            throw new Error("SubagentManager was disposed during connect");
        }

        const info: SubagentInfo = {
            id,
            name,
            instructions: options.instructions,
            status: "connecting",
            createdAt: new Date().toISOString(),
            conversationName,
        };
        const entry: SubagentEntry = {
            info,
            client,
            transport,
            instructionsSent: false,
        };
        this.subagents.set(id, entry);

        try {
            await this.waitForConnection(client);
        } catch (error) {
            this.subagents.delete(id);
            await closeQuietly(client);
            throw new Error(
                `Subagent '${name}' could not connect to the agent server at ` +
                    `${this.agentServerUrl}: ${errorText(error)}`,
            );
        }

        if (this.disposed) {
            this.subagents.delete(id);
            await closeQuietly(client);
            throw new Error("SubagentManager was disposed during connection");
        }

        info.status = "ready";
        debug(`created ${id} (${name}) conversation=${conversationName}`);
        return { ...info };
    }

    /**
     * Send a task to a subagent and return its textual result. Create-time
     * instructions are prepended on the first invocation so the subagent has
     * its role; later turns rely on the subagent's own conversation memory.
     */
    async invokeSubagent(id: string, task: string): Promise<string> {
        const entry = this.getEntry(id);
        const request =
            !entry.instructionsSent && entry.info.instructions
                ? `${entry.info.instructions}\n\n${task}`
                : task;
        debug(`invoke ${id}: ${task}`);
        const result = await entry.client.callTool({
            name: "execute_command",
            arguments: { request },
        });
        entry.instructionsSent = true;
        const text = extractToolText(result);
        if ((result as { isError?: boolean })?.isError) {
            throw new Error(text || `Subagent '${id}' returned an error`);
        }
        return text;
    }

    /** List all live subagents (public info only). */
    listSubagents(): SubagentInfo[] {
        return [...this.subagents.values()].map((entry) => ({ ...entry.info }));
    }

    /** Stop and remove a subagent, tearing down its command-executor process. */
    async stopSubagent(id: string): Promise<void> {
        const entry = this.getEntry(id);
        this.subagents.delete(id);
        entry.info.status = "stopped";
        await closeQuietly(entry.client);
        debug(`stopped ${id}`);
    }

    /** Stop every subagent. Called when the reasoning session closes. */
    async dispose(): Promise<void> {
        this.disposed = true;
        const entries = [...this.subagents.values()];
        this.subagents.clear();
        await Promise.allSettled(
            entries.map((entry) => closeQuietly(entry.client)),
        );
    }

    private getEntry(id: string): SubagentEntry {
        const entry = this.subagents.get(id);
        if (entry === undefined) {
            throw new Error(`Unknown subagent id '${id}'`);
        }
        return entry;
    }

    /**
     * Poll the command-executor's `connection_status` tool until it reports a
     * live agent-server connection, or the timeout elapses.
     */
    private async waitForConnection(client: Client): Promise<void> {
        const deadline = Date.now() + CONNECT_TIMEOUT_MS;
        for (;;) {
            const result = await client.callTool({
                name: "connection_status",
                arguments: {},
            });
            const connected =
                (
                    result as {
                        structuredContent?: { connected?: unknown };
                    }
                )?.structuredContent?.connected === true;
            if (connected) {
                return;
            }
            if (Date.now() >= deadline) {
                throw new Error("timed out waiting for connection");
            }
            await delay(500);
        }
    }
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function closeQuietly(client: Client): Promise<void> {
    try {
        await client.close();
    } catch (error) {
        debug(`error closing subagent client: ${errorText(error)}`);
    }
}

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * Anything that can hold a per-session SubagentManager. CommandHandlerContext
 * satisfies this structurally, so this helper avoids importing the context type
 * (which would create an import cycle).
 */
export interface SubagentManagerHost {
    subagentManager?: SubagentManager | undefined;
}

/** Get the host's SubagentManager, creating it on first use. */
export function getOrCreateSubagentManager(
    host: SubagentManagerHost,
): SubagentManager {
    if (host.subagentManager === undefined) {
        host.subagentManager = new SubagentManager();
    }
    return host.subagentManager;
}
