// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ActionEffect } from "@typeagent/agent-sdk";

export const structuredActionProtocolVersion = 1;

export type ActionIdentity = {
    schemaName: string;
    actionName: string;
};

export type ActionSearchRequest = {
    query: string;
};

export type StructuredActionEnvelope = {
    protocolVersion: typeof structuredActionProtocolVersion;
    // Server-issued reuse boundary, not a bearer token or authorization grant.
    scopeId: string;
};

export type ActionExecutionPolicy = {
    effects: ActionEffect;
    confirmation: "required" | "not-required";
};

export type ActionOutputContract = {
    envelope: "ActionResult";
    optional: true;
    resultValue: { type: "unknown"; optional: true };
    resultEntity: { type: "Entity"; optional: true };
    entities: { type: "Entity[]"; optional: true };
};

export type ActionInteractionContract = {
    // Agent hooks may request interactions even for read-only actions.
    mode: "may-require-interaction";
    kinds: ("question" | "choice" | "form" | "action-proposal")[];
};

export type ActionContract = ActionIdentity & {
    description: string;
    input: {
        format: "typescript";
        typeName: string;
        schemaText: string;
    };
    policy: ActionExecutionPolicy;
    output: ActionOutputContract;
    interactions: ActionInteractionContract;
};

export type ActionSearchResult = StructuredActionEnvelope & {
    actions: ActionContract[];
};
