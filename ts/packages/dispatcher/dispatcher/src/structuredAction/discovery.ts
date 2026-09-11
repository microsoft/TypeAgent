// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomUUID } from "node:crypto";
import { getActionDescription } from "@typeagent/action-schema";
import {
    structuredActionProtocolVersion,
    type ActionAvailability,
    type ActionContractResult,
    type ActionIdentity,
    type ActionSearchRequest,
    type ActionSearchResult,
    type ActionSummary,
    type StructuredActionEnvelope,
} from "@typeagent/dispatcher-types";
import type { AppAgentManager } from "../context/appAgentManager.js";
import { getAppAgentName } from "../translation/agentTranslators.js";
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
    if (request.query !== undefined && typeof request.query !== "string") {
        throw new Error("query must be a string");
    }
    for (const key of ["agentName", "schemaName"] as const) {
        if (request[key] !== undefined) {
            validateString(request[key], key);
        }
    }
    if (
        request.offset !== undefined &&
        (!Number.isSafeInteger(request.offset) || request.offset < 0)
    ) {
        throw new Error("offset must be a nonnegative safe integer");
    }
    if (
        request.limit !== undefined &&
        (!Number.isSafeInteger(request.limit) ||
            request.limit < 1 ||
            request.limit > 200)
    ) {
        throw new Error("limit must be an integer between 1 and 200");
    }
}

function getAvailability(
    agents: AppAgentManager,
    schemaName: string,
): ActionAvailability {
    const agentName = getAppAgentName(schemaName);
    const readiness = agents.getReadinessSnapshot(agentName);
    const availability: ActionAvailability = {
        state: "available",
        schemaEnabled: agents.isSchemaEnabled(schemaName),
        actionEnabled: agents.isActionEnabled(schemaName),
        schemaActive: agents.isSchemaActive(schemaName),
        actionActive: agents.isActionActive(schemaName),
        readiness,
        authorization: "checked-at-execution",
    };
    const loadError = agents.getLoadError(agentName);
    if (agents.isSchemaLoading(schemaName)) {
        availability.state = "loading";
    } else if (loadError !== undefined) {
        availability.state = "error";
        availability.message = loadError.message;
    } else if (!availability.schemaEnabled || !availability.actionEnabled) {
        availability.state = "disabled";
    } else if (!availability.schemaActive || !availability.actionActive) {
        availability.state = "inactive";
    } else if (readiness.report === undefined) {
        availability.state = "unknown";
    } else if (readiness.report.state !== "ready") {
        availability.state = readiness.report.state;
    }
    if (
        availability.message === undefined &&
        readiness.report?.message !== undefined
    ) {
        availability.message = readiness.report.message;
    }
    return availability;
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
        request: ActionSearchRequest = {},
    ): Promise<ActionSearchResult> {
        validateSearch(request);
        const { envelope, policy } = this.bindScope();
        const query = request.query?.trim().toLowerCase();
        const matches: ActionSummary[] = [];
        for (const config of this.context.agents.getActionConfigs()) {
            if (
                (request.schemaName !== undefined &&
                    request.schemaName !== config.schemaName) ||
                (request.agentName !== undefined &&
                    request.agentName !== getAppAgentName(config.schemaName)) ||
                policy?.canDiscoverSchema(config.schemaName) === false
            ) {
                continue;
            }
            const schema =
                this.context.agents.getActionSchemaFileForConfig(config);
            const availability = getAvailability(
                this.context.agents,
                config.schemaName,
            );
            for (const [actionName, definition] of schema.parsedActionSchema
                .actionSchemas) {
                const description = getActionDescription(definition) ?? "";
                if (
                    query &&
                    !`${config.schemaName} ${actionName} ${description}`
                        .toLowerCase()
                        .includes(query)
                ) {
                    continue;
                }
                matches.push({
                    schemaName: config.schemaName,
                    actionName,
                    description,
                    availability,
                });
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
        const offset = request.offset ?? 0;
        const end = offset + (request.limit ?? 50);
        return {
            ...envelope,
            actions: matches.slice(offset, end),
            total: matches.length,
            ...(end < matches.length ? { nextOffset: end } : {}),
        };
    }

    public async getActionContract(
        identity: ActionIdentity,
    ): Promise<ActionContractResult> {
        if (
            identity === null ||
            typeof identity !== "object" ||
            Array.isArray(identity)
        ) {
            throw new Error("Action identity must be an object");
        }
        validateString(identity.schemaName, "schemaName");
        validateString(identity.actionName, "actionName");
        const { envelope, policy } = this.bindScope();
        // Check visibility before looking up or parsing the schema.
        if (policy?.canDiscoverSchema(identity.schemaName) === false) {
            return { ...envelope, status: "not-found" };
        }
        const config = this.context.agents.tryGetActionConfig(
            identity.schemaName,
        );
        if (config === undefined) {
            return { ...envelope, status: "not-found" };
        }
        const schema = this.context.agents.getActionSchemaFileForConfig(config);
        const definition = schema.parsedActionSchema.actionSchemas.get(
            identity.actionName,
        );
        if (definition === undefined) {
            return { ...envelope, status: "not-found" };
        }
        return {
            ...envelope,
            status: "found",
            contract: createActionContract(
                {
                    schemaName: identity.schemaName,
                    actionName: identity.actionName,
                },
                definition,
                config,
                getAvailability(this.context.agents, identity.schemaName),
            ),
        };
    }
}
