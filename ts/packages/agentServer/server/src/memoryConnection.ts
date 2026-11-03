// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    McpMemoryServiceClient,
    type MemoryMcpTransportConfig,
} from "@typeagent/memory-client";
import type { MemoryService } from "@typeagent/memory-service";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { createDurableMemoryService } from "./durableMemoryService.js";

function stringRecord(value: unknown): value is Record<string, string> {
    return (
        value === undefined ||
        (!!value &&
            typeof value === "object" &&
            !Array.isArray(value) &&
            Object.entries(value).length <= 256 &&
            Object.entries(value).every(
                ([key, item]) =>
                    key.length <= 256 &&
                    typeof item === "string" &&
                    item.length <= 8192,
            ))
    );
}

function validateStdioConnection(input: Record<string, unknown>): void {
    if (
        typeof input.command !== "string" ||
        !input.command.trim() ||
        input.command.length > 8192 ||
        !Array.isArray(input.args) ||
        input.args.length > 256 ||
        input.args.some(
            (arg) => typeof arg !== "string" || arg.length > 8192,
        ) ||
        (input.cwd !== undefined &&
            (typeof input.cwd !== "string" || !input.cwd.trim())) ||
        !stringRecord(input.env)
    )
        throw new Error("Invalid configured stdio memory connection");
}

function validateHttpConnection(input: Record<string, unknown>): void {
    if (
        typeof input.url !== "string" ||
        input.url.length > 8192 ||
        !stringRecord(input.headers) ||
        (input.timeoutMs !== undefined &&
            (!Number.isSafeInteger(input.timeoutMs) ||
                (input.timeoutMs as number) < 1))
    )
        throw new Error("Invalid configured HTTP memory connection");
    const url = new URL(input.url);
    if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.hash
    )
        throw new Error(
            "Configured memory HTTP URL must not embed credentials",
        );
}

export function parseMemoryConnectionConfig(
    value: unknown,
): MemoryMcpTransportConfig {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("Invalid configured memory connection");
    const input = value as Record<string, unknown>;
    const allowed =
        input.kind === "stdio"
            ? ["kind", "command", "args", "cwd", "env"]
            : ["kind", "url", "headers", "timeoutMs"];
    if (Object.keys(input).some((key) => !allowed.includes(key)))
        throw new Error("Unsupported configured memory connection fields");
    if (input.kind === "stdio") validateStdioConnection(input);
    else if (input.kind === "http") validateHttpConnection(input);
    else throw new Error("Unsupported configured memory connection transport");
    return structuredClone(input) as MemoryMcpTransportConfig;
}

export async function createConfiguredMemoryService(
    rootDirectory: string,
    configFile = process.env.TYPEAGENT_MEMORY_CONNECTION_CONFIG,
): Promise<MemoryService> {
    if (!configFile) return createDurableMemoryService(rootDirectory);
    if ((await stat(configFile)).size > 65536)
        throw new Error("Configured memory connection exceeds its byte limit");
    let value: unknown;
    try {
        value = JSON.parse(await readFile(configFile, "utf8"));
    } catch {
        throw new Error("Invalid configured memory connection JSON");
    }
    const config = parseMemoryConnectionConfig(value);
    if (config.kind === "stdio") {
        const base = path.dirname(path.resolve(configFile));
        config.cwd = path.resolve(base, config.cwd ?? ".");
    }
    // Explicit remote selection never creates or falls back to the instance store.
    return McpMemoryServiceClient.create(config);
}
