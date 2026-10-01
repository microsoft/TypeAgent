// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type {
    AgentServerConnection,
    ClientIO,
} from "@typeagent/agent-server-client";
import { getConversationId } from "./plugin-config.js";

const processBindings = new Map<string, string>();

function bindingKey(url: string, sessionId: string | undefined): string {
    const server = new URL(url).href;
    return createHash("sha256")
        .update(JSON.stringify([server, sessionId]))
        .digest("hex");
}

function bindingLocation(url: string, sessionId: string | undefined) {
    // Copilot supplies CLAUDE_PLUGIN_DATA to hooks but not to MCP children.
    const directory =
        process.env.TYPEAGENT_PLUGIN_DATA ??
        join(homedir(), ".typeagent-copilot");
    if (sessionId !== undefined && !sessionId.trim()) {
        throw new Error("TypeAgent conversation session ID must not be empty.");
    }
    return join(
        directory,
        "conversation-bindings",
        "sessions",
        `${bindingKey(url, sessionId)}.json`,
    );
}

function hasCode(error: unknown, code: string): boolean {
    return (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === code
    );
}

function requireId(value: unknown): string {
    if (typeof value !== "string" || !value.trim()) {
        throw new Error("TypeAgent conversationId must be a non-empty string.");
    }
    return value;
}

async function readBinding(path: string): Promise<string | undefined> {
    let text: string;
    try {
        text = await readFile(path, "utf8");
    } catch (error) {
        if (hasCode(error, "ENOENT")) return undefined;
        throw error;
    }
    const value: unknown = JSON.parse(text);
    if (
        typeof value !== "object" ||
        value === null ||
        !("conversationId" in value)
    ) {
        throw new Error(`Invalid TypeAgent conversation binding: ${path}`);
    }
    return requireId(value.conversationId);
}

/** Public context only; automatic selections belong to a host session, not a server. */
export async function readSelectedConversationId(
    url: string,
    sessionId: string | undefined = process.env.COPILOT_AGENT_SESSION_ID,
): Promise<string | undefined> {
    const configured = getConversationId();
    if (configured !== undefined) return requireId(configured);
    const path = bindingLocation(url, sessionId);
    return sessionId === undefined
        ? processBindings.get(path)
        : readBinding(path);
}

export async function selectConversationId(
    connection: AgentServerConnection,
    clientIO: ClientIO,
    url: string,
    sessionId: string | undefined = process.env.COPILOT_AGENT_SESSION_ID,
): Promise<string> {
    const selected = await readSelectedConversationId(url, sessionId);
    if (selected !== undefined) return selected;

    const joined = await connection.joinConversation(clientIO, {
        filter: true,
        clientType: "shell",
    });
    await connection.leaveConversation(joined.conversationId);
    const conversationId = requireId(joined.conversationId);
    const path = bindingLocation(url, sessionId);
    if (sessionId === undefined) {
        // Unknown hosts share NL/structured context only inside this process.
        const winner = processBindings.get(path) ?? conversationId;
        processBindings.set(path, winner);
        return winner;
    }
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify({ conversationId }), {
        flag: "wx",
        mode: 0o600,
    });
    try {
        // Publish complete content without replacing another process's winner.
        try {
            await link(temporary, path);
        } catch (error) {
            if (!hasCode(error, "EEXIST")) throw error;
        }
    } finally {
        await unlink(temporary);
    }
    const winner = await readSelectedConversationId(url, sessionId);
    if (winner === undefined) {
        throw new Error(
            "TypeAgent conversation binding disappeared during selection.",
        );
    }
    return winner;
}
