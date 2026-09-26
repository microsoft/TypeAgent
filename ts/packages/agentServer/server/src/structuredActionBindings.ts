// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomBytes } from "node:crypto";
import type { StructuredActionAccess } from "agent-dispatcher/internal";
import type { DispatcherConnectOptions } from "@typeagent/agent-server-protocol";

export const MAX_STRUCTURED_ACTION_BINDINGS = 100;
export const STRUCTURED_ACTION_BINDING_IDLE_MS = 30 * 60 * 1000;

type Binding = {
    conversationId: string;
    scope: object;
    connectionId: string | undefined;
    lastUsed: number;
};

export type StructuredActionLease = {
    resumeToken: string;
    access: StructuredActionAccess;
    release(): void;
};

export function validateStructuredActionJoin(
    options: DispatcherConnectOptions | undefined,
    conversationId?: string,
): void {
    if (options?.structuredActions === undefined) {
        return;
    }
    const structured = options.structuredActions;
    if (
        structured === null ||
        typeof structured !== "object" ||
        Array.isArray(structured) ||
        Object.keys(structured).some((key) => key !== "resumeToken")
    ) {
        throw new Error("Invalid structured action join options");
    }
    if (
        typeof options.conversationId !== "string" ||
        options.conversationId.trim().length === 0 ||
        (conversationId !== undefined &&
            options.conversationId !== conversationId)
    ) {
        throw new Error(
            "Structured actions require the explicit target conversationId",
        );
    }
    if (
        structured.resumeToken !== undefined &&
        (typeof structured.resumeToken !== "string" ||
            !/^[A-Za-z0-9_-]{43}$/.test(structured.resumeToken))
    ) {
        throw new Error("Invalid structured action resume capability");
    }
}

/**
 * Resume ownership within the existing local-server transport trust boundary.
 * Tokens never enter the dispatcher scope or any persisted/broadcast metadata.
 */
export class StructuredActionBindings {
    private readonly bindings = new Map<string, Binding>();
    private session: object;
    private closed = false;

    public constructor(
        private readonly getSession: () => object,
        private readonly now: () => number = Date.now,
    ) {
        this.session = getSession();
    }

    private prune(): void {
        const session = this.getSession();
        if (session !== this.session) {
            this.bindings.clear();
            this.session = session;
        }
        const cutoff = this.now() - STRUCTURED_ACTION_BINDING_IDLE_MS;
        for (const [token, binding] of this.bindings) {
            if (binding.lastUsed <= cutoff) {
                this.bindings.delete(token);
            }
        }
    }

    public acquire(
        conversationId: string,
        connectionId: string,
        resumeToken?: string,
    ): StructuredActionLease {
        if (this.closed) {
            throw new Error("Structured action binding is closed");
        }
        this.prune();
        let token: string;
        let binding: Binding;
        if (resumeToken !== undefined) {
            const existing = this.bindings.get(resumeToken);
            if (
                existing === undefined ||
                existing.conversationId !== conversationId
            ) {
                throw new Error(
                    "Structured action resume state is unavailable; do not replay an interrupted action",
                );
            }
            token = resumeToken;
            binding = existing;
        } else {
            if (this.bindings.size >= MAX_STRUCTURED_ACTION_BINDINGS) {
                throw new Error("Structured action binding capacity reached");
            }
            token = randomBytes(32).toString("base64url");
            binding = {
                conversationId,
                scope: {},
                connectionId,
                lastUsed: this.now(),
            };
            this.bindings.set(token, binding);
        }
        // No await between resolving a token and revoking the previous lease.
        binding.connectionId = connectionId;
        binding.lastUsed = this.now();
        const deniedScope = {};
        let released = false;
        const isCurrent = () => {
            this.prune();
            return (
                !this.closed &&
                !released &&
                this.bindings.get(token) === binding &&
                binding.connectionId === connectionId
            );
        };
        return {
            resumeToken: token,
            access: () => {
                const current = isCurrent();
                if (current) {
                    binding.lastUsed = this.now();
                }
                return {
                    scope: current ? binding.scope : deniedScope,
                    canDiscoverSchema: () => isCurrent(),
                    isActive: isCurrent,
                };
            },
            release: () => {
                released = true;
                if (binding.connectionId === connectionId) {
                    binding.connectionId = undefined;
                }
            },
        };
    }

    public close(): void {
        this.closed = true;
        this.bindings.clear();
    }
}
