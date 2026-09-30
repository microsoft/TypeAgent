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
import {
    compareActionCandidateIdentity,
    type ActionCandidateFilter,
    type ActionCandidateRanker,
    type ActionCandidateResult,
} from "../translation/actionCandidateRanker.js";
import { createActionContract } from "./contract.js";
import { getAppAgentName } from "../translation/agentTranslators.js";
import registerDebug from "debug";
import { getStructuredActionUnsupportedReason } from "./executionFailure.js";

const debugError = registerDebug(
    "typeagent:dispatcher:structuredActionDiscovery:error",
);
const rankedCandidateLimit = 5;

// Host-only policy. Never deserialize this from a discovery/RPC request.
// Reuse scope only for the same authorized logical caller/conversation binding,
// including reconnects. Replace it whenever that binding or permissions change.
export type StructuredActionAccess = () => {
    scope: object;
    canDiscoverSchema(schemaName: string): boolean;
    // Discovery-only facades deny execution without hiding contracts.
    // Omitted for existing/direct callers, which retain execution access.
    canExecute?: boolean;
    isActive?(): boolean;
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

function createDiscoverableActionContract(
    identity: { schemaName: string; actionName: string },
    definition: Parameters<typeof createActionContract>[1],
    config: Parameters<typeof createActionContract>[2],
): ActionContract {
    const contract = createActionContract(identity, definition, config);
    const unsupportedReason = getStructuredActionUnsupportedReason(identity);
    if (unsupportedReason === undefined) return contract;

    const unsupportedDescription = `Structured execution is unsupported: ${unsupportedReason}`;
    return {
        ...contract,
        description:
            contract.description.length === 0
                ? unsupportedDescription
                : `${contract.description}\n\n${unsupportedDescription}`,
    };
}

export class StructuredActionDiscovery {
    private readonly anonymousScope = {};

    public constructor(
        private readonly context: DiscoveryContext,
        private readonly access?: StructuredActionAccess,
        private readonly candidateRanker: ActionCandidateRanker = context.agents,
    ) {}

    public bindScope() {
        const policy = this.access?.();
        if (
            policy?.isActive?.() === false ||
            (this.access !== undefined && policy === undefined)
        ) {
            throw new Error("Structured action access has been revoked");
        }
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
        await this.context.agents.waitUntilReady();
        const { envelope, policy } = this.bindScope();
        const canUseCandidate: ActionCandidateFilter = (schemaName) =>
            policy?.canDiscoverSchema(schemaName) !== false &&
            this.context.agents.isSchemaActive(schemaName) &&
            this.context.agents.isActionActive(schemaName);

        let candidates: ActionCandidateResult[] | undefined;
        try {
            candidates = await this.candidateRanker.rankActionCandidates(
                request.query.trim(),
                rankedCandidateLimit,
                canUseCandidate,
            );
        } catch (error) {
            debugError("Action candidate ranking failed: %O", error);
        }

        const actions =
            candidates === undefined
                ? this.findLiteralMatches(request.query, canUseCandidate)
                : this.hydrateRankedCandidates(candidates, canUseCandidate);
        return {
            ...envelope,
            actions,
        };
    }

    private hydrateRankedCandidates(
        candidates: ActionCandidateResult[],
        canUseCandidate: ActionCandidateFilter,
    ): ActionContract[] {
        return candidates
            .filter(({ schemaName, actionName }) =>
                canUseCandidate(schemaName, actionName),
            )
            .sort(
                (a, b) =>
                    b.score - a.score || compareActionCandidateIdentity(a, b),
            )
            .flatMap(({ schemaName, actionName }) => {
                const config =
                    this.context.agents.tryGetActionConfig(schemaName);
                if (config === undefined) {
                    return [];
                }
                const definition = this.context.agents
                    .getActionSchemaFileForConfig(config)
                    .parsedActionSchema.actionSchemas.get(actionName);
                if (definition === undefined) {
                    return [];
                }
                return [
                    createDiscoverableActionContract(
                        { schemaName, actionName },
                        definition,
                        config,
                    ),
                ];
            });
    }

    private findLiteralMatches(
        request: string,
        canUseCandidate: ActionCandidateFilter,
    ): ActionContract[] {
        const query = request.trim().toLowerCase();
        const matches: ActionContract[] = [];
        for (const config of this.context.agents.getActionConfigs()) {
            if (!canUseCandidate(config.schemaName, "")) {
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
                    createDiscoverableActionContract(
                        { schemaName: config.schemaName, actionName },
                        definition,
                        config,
                    ),
                );
            }
        }
        return matches.sort(compareActionCandidateIdentity);
    }

    /** Resolve one exact identity for execution without semantic selection. */
    public resolveActionContract(identity: {
        schemaName: string;
        actionName: string;
    }):
        | {
              status: "found";
              envelope: StructuredActionEnvelope;
              contract: ActionContract;
          }
        | {
              status: "unavailable";
              envelope: StructuredActionEnvelope;
              message: string;
          } {
        validateString(identity.schemaName, "schemaName");
        validateString(identity.actionName, "actionName");
        const { envelope, policy } = this.bindScope();
        if (policy?.canDiscoverSchema(identity.schemaName) === false) {
            return {
                status: "unavailable",
                envelope,
                message: "Action is unavailable",
            };
        }
        const config = this.context.agents.tryGetActionConfig(
            identity.schemaName,
        );
        if (config === undefined) {
            return {
                status: "unavailable",
                envelope,
                message: "Action is unavailable",
            };
        }
        if (
            !this.context.agents.isSchemaActive(identity.schemaName) ||
            !this.context.agents.isActionActive(identity.schemaName)
        ) {
            return {
                status: "unavailable",
                envelope,
                message: "Action is disabled or inactive",
            };
        }
        const unsupportedReason =
            getStructuredActionUnsupportedReason(identity);
        if (unsupportedReason !== undefined) {
            return {
                status: "unavailable",
                envelope,
                message: unsupportedReason,
            };
        }
        const agentName = getAppAgentName(identity.schemaName);
        if (this.context.agents.hasUnknownReadiness(agentName)) {
            return {
                status: "unavailable",
                envelope,
                message: `Readiness for '${agentName}' has not been checked`,
            };
        }
        const readiness = this.context.agents.getReadiness(agentName);
        if (readiness.state !== "ready") {
            return {
                status: "unavailable",
                envelope,
                message:
                    readiness.message ??
                    `Agent '${agentName}' is ${readiness.state}`,
            };
        }
        const definition = this.context.agents
            .getActionSchemaFileForConfig(config)
            .parsedActionSchema.actionSchemas.get(identity.actionName);
        if (definition === undefined) {
            return {
                status: "unavailable",
                envelope,
                message: "Action is unavailable",
            };
        }
        return {
            status: "found",
            envelope,
            contract: createActionContract(identity, definition, config),
        };
    }
}
