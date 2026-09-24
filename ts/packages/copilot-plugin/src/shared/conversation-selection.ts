// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
    AgentServerConnection,
    ClientIO,
} from "@typeagent/agent-server-client";
import { getConfigDir, getConversationId } from "./plugin-config.js";

function bindingPath(url: string): string {
    const server = new URL(url).href;
    const key = createHash("sha256").update(server).digest("hex");
    return join(getConfigDir(), "conversation-bindings", `${key}.json`);
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

/** Public context only, shared by hook/MCP processes using this config and server. */
export async function readSelectedConversationId(
    url: string,
): Promise<string | undefined> {
    const configured = getConversationId();
    return configured === undefined
        ? readBinding(bindingPath(url))
        : requireId(configured);
}

export async function selectConversationId(
    connection: AgentServerConnection,
    clientIO: ClientIO,
    url: string,
): Promise<string> {
    const selected = await readSelectedConversationId(url);
    if (selected !== undefined) return selected;

    const joined = await connection.joinConversation(clientIO, {
        filter: true,
        clientType: "shell",
    });
    await connection.leaveConversation(joined.conversationId);
    const conversationId = requireId(joined.conversationId);
    const path = bindingPath(url);
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
    const winner = await readSelectedConversationId(url);
    if (winner === undefined) {
        throw new Error(
            "TypeAgent conversation binding disappeared during selection.",
        );
    }
    return winner;
}
