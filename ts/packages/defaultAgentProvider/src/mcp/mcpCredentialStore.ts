// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { CredentialRef } from "./mcpServerConfig.js";

export interface McpCredentialStore {
    get(ref: CredentialRef): Promise<string | undefined>;
    set(
        name: string,
        value: string,
        options?: { durable?: boolean },
    ): Promise<CredentialRef>;
    delete(ref: CredentialRef): Promise<void>;
}

export class SessionMcpCredentialStore implements McpCredentialStore {
    private readonly values = new Map<string, string>();

    public constructor(
        private readonly environment: Record<
            string,
            string | undefined
        > = process.env,
    ) {}

    async get(ref: CredentialRef): Promise<string | undefined> {
        if (ref.kind === "env") {
            return this.environment[ref.name];
        }
        return this.values.get(ref.name);
    }

    async set(
        name: string,
        value: string,
        options?: { durable?: boolean },
    ): Promise<CredentialRef> {
        if (options?.durable) {
            throw new Error(
                "Durable MCP secret storage is not configured. Inject a secure McpCredentialStore or omit --persist.",
            );
        }
        this.values.set(name, value);
        return { kind: "secure", name };
    }

    async delete(ref: CredentialRef): Promise<void> {
        if (ref.kind !== "env") {
            this.values.delete(ref.name);
        }
    }
}

export async function requireCredential(
    store: McpCredentialStore,
    ref: CredentialRef,
    configName: string,
): Promise<string> {
    const value = await store.get(ref);
    if (value === undefined) {
        throw new Error(
            `MCP server '${configName}' is missing credential '${ref.name}'. Set it with '@package mcp credentials set ${configName} ${ref.name}'.`,
        );
    }
    return value;
}
