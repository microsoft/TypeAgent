// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomUUID } from "node:crypto";
import { getActionDescription } from "@typeagent/action-schema";
import {
    structuredActionProtocolVersion,
    type ActionContract,
    type ActionSearchRequest,
    type ActionSearchResult,
    type StructuredActionEnvelope,
} from "@typeagent/dispatcher-types";
import type { AppAgentManager } from "../context/appAgentManager.js";
import { createActionContract } from "./contract.js";

// Host-only policy. Never deserialize this from a discovery/RPC request.
// Reuse scope only for the same authorized logical caller/conversation binding,
// including reconnects. Replace it whenever that binding or permissions change.
export type StructuredActionAccess = () => {
    scope: object;
    canDiscoverSchema(schemaName: string): boolean;
};

type DiscoveryContext = {
    agents: AppAgentManager;
    session: object;
};

const sessionScopes = new WeakMap<object, WeakMap<object, string>>();

function validateString(value: unknown, name: string): asserts value is string {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error(`${name} must be a nonempty string`);
    }
}

function validateSearch(request: ActionSearchRequest): void {
    if (
        request === null ||
        typeof request !== "object" ||
        Array.isArray(request)
    ) {
        throw new Error("Action search request must be an object");
    }
    validateString(request.query, "query");
}

export class StructuredActionDiscovery {
    private readonly anonymousScope = {};

    public constructor(
        private readonly context: DiscoveryContext,
        private readonly access?: StructuredActionAccess,
    ) {}

    private bindScope() {
        const policy = this.access?.();
        const permissionScope = policy?.scope ?? this.anonymousScope;
        let scopes = sessionScopes.get(this.context.session);
        if (scopes === undefined) {
            scopes = new WeakMap();
            sessionScopes.set(this.context.session, scopes);
        }
        let scopeId = scopes.get(permissionScope);
        if (scopeId === undefined) {
            scopeId = randomUUID();
            scopes.set(permissionScope, scopeId);
        }
        const envelope: StructuredActionEnvelope = {
            protocolVersion: structuredActionProtocolVersion,
            scopeId,
        };
        return { envelope, policy };
    }

    public async searchActions(
        request: ActionSearchRequest,
    ): Promise<ActionSearchResult> {
        validateSearch(request);
        const { envelope, policy } = this.bindScope();
        const query = request.query.trim().toLowerCase();
        const matches: ActionContract[] = [];
        for (const config of this.context.agents.getActionConfigs()) {
            if (
                policy?.canDiscoverSchema(config.schemaName) === false ||
                !this.context.agents.isSchemaActive(config.schemaName) ||
                !this.context.agents.isActionActive(config.schemaName)
            ) {
                continue;
            }
            const schema =
                this.context.agents.getActionSchemaFileForConfig(config);
            for (const [actionName, definition] of schema.parsedActionSchema
                .actionSchemas) {
                const description = getActionDescription(definition) ?? "";
                if (
                    !`${config.schemaName} ${actionName} ${description}`
                        .toLowerCase()
                        .includes(query)
                ) {
                    continue;
                }
                matches.push(
                    createActionContract(
                        { schemaName: config.schemaName, actionName },
                        definition,
                        config,
                    ),
                );
            }
        }
        matches.sort((a, b) => {
            const schemaOrder =
                a.schemaName < b.schemaName
                    ? -1
                    : a.schemaName > b.schemaName
                      ? 1
                      : 0;
            return (
                schemaOrder ||
                (a.actionName < b.actionName
                    ? -1
                    : a.actionName > b.actionName
                      ? 1
                      : 0)
            );
        });
        return {
            ...envelope,
            actions: matches,
        };
    }
}
