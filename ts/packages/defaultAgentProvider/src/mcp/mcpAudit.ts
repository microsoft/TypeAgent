// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { filterSecretsFromObject } from "@typeagent/common-utils";
import fs from "node:fs";
import path from "node:path";

export type McpAuditOperation =
    | "install"
    | "update"
    | "uninstall"
    | "trust"
    | "enable"
    | "disable"
    | "connect"
    | "auth"
    | "tool-invocation"
    | "tool-result"
    | "catalog-refresh";

export interface McpAuditEvent {
    timestamp: string;
    operation: McpAuditOperation;
    configId: string;
    configName: string;
    tool?: string;
    toolId?: string;
    sessionId?: string;
    agent?: string;
    transport?: string;
    source?: string;
    decision?: string;
    status?: "success" | "failure";
    durationMs?: number;
    arguments?: unknown;
    error?: string;
    previousCount?: number;
    toolCount?: number;
    skippedCount?: number;
    sensitiveValues?: string[];
}

export interface McpAuditSink {
    write(event: McpAuditEvent): Promise<void>;
}

export function sanitizeMcpAuditEvent(
    event: McpAuditEvent,
    knownSecrets: Iterable<string> = [],
): McpAuditEvent {
    const secrets = [...knownSecrets, ...(event.sensitiveValues ?? [])];
    const sanitized = filterSecretsFromObject(event, {
        values: secrets,
    });
    delete sanitized.sensitiveValues;
    if (sanitized.arguments !== undefined) {
        const redactSensitiveKeys = (value: unknown): unknown => {
            if (Array.isArray(value)) return value.map(redactSensitiveKeys);
            if (value === null || typeof value !== "object") return value;
            return Object.fromEntries(
                Object.entries(value as Record<string, unknown>).map(
                    ([key, child]) => [
                        key,
                        /authorization|cookie|password|secret|token|api[-_]?key/i.test(
                            key,
                        )
                            ? "******"
                            : redactSensitiveKeys(child),
                    ],
                ),
            );
        };
        sanitized.arguments = redactSensitiveKeys(
            filterSecretsFromObject(sanitized.arguments, {
                values: secrets,
            }),
        );
    }
    return sanitized;
}

export class JsonlMcpAuditSink implements McpAuditSink {
    private readonly filePath: string;

    public constructor(
        instanceDir: string,
        private readonly maxBytes = 2 * 1024 * 1024,
    ) {
        this.filePath = path.join(instanceDir, "mcp-audit.jsonl");
    }

    async write(event: McpAuditEvent): Promise<void> {
        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
        const line = `${JSON.stringify(sanitizeMcpAuditEvent(event))}\n`;
        if (
            fs.existsSync(this.filePath) &&
            fs.statSync(this.filePath).size + Buffer.byteLength(line) >
                this.maxBytes
        ) {
            const existing = fs.readFileSync(this.filePath, "utf8");
            const midpoint = Math.floor(existing.length / 2);
            const newline = existing.indexOf("\n", midpoint);
            fs.writeFileSync(
                this.filePath,
                newline === -1 ? "" : existing.slice(newline + 1),
            );
        }
        fs.appendFileSync(this.filePath, line);
    }
}

export const nullMcpAuditSink: McpAuditSink = {
    async write() {},
};
