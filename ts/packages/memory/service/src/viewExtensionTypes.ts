// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    ChatModel,
    DecisionModel,
    DecisionRequest,
    DecisionResponse,
} from "@typeagent/aiclient";
import type { PromptSection } from "typechat";
import type {
    ViewBuildSnapshot,
    ViewCitation,
    ViewSection,
    ViewSupportReport,
    ViewDefinitionInput,
} from "./viewTypes.js";

export type ViewJsonValue =
    | null
    | boolean
    | number
    | string
    | ViewJsonValue[]
    | { [key: string]: ViewJsonValue };

export type ViewPayloadSchema =
    | { type: "string"; maxLength: number }
    | { type: "number" | "boolean" | "null" }
    | { type: "array"; items: ViewPayloadSchema; maxItems: number }
    | { type: "union"; variants: ViewPayloadSchema[] }
    | {
          type: "object";
          properties: Record<string, ViewPayloadSchema>;
          required: string[];
      };

export interface ViewProviderIdentity {
    providerId: string;
    version: string;
    implementationDigest: string;
    inputContract: string;
    outputContract: string;
    schemaDigest: string;
    recipeDigest: string;
}

export interface ViewExtensionCapabilities {
    apiVersion: 1;
    sourceManifestVersion: 1;
    templateVersion: 1;
    providers: Array<{
        identity: ViewProviderIdentity;
        label: string;
        definitions: ViewExtensionProvider["descriptor"]["definitions"];
    }>;
}

export interface ViewExtensionDefinition extends ViewProviderIdentity {
    definitionId: string;
    targetKey: string;
    eligibilityVersion: string;
    policyDigest: string;
    parameters: ViewJsonValue;
}

export interface ViewSourceManifest {
    schemaVersion: 1;
    corpusId: string;
    members: Array<{
        sourceId: string;
        revisionId: string;
        contentHash: string;
    }>;
}

export interface ViewEligibilityReceipt {
    schemaVersion: 1;
    provider: ViewProviderIdentity;
    definitionId: string;
    targetKey: string;
    criteriaVersion: string;
    policyDigest: string;
    inputFingerprint: string;
    mode: "static" | "decision";
    disposition: "eligible" | "ineligible" | "deferred" | "failed";
    reason: string;
}

export interface ViewPresentation {
    schemaVersion: 1;
    templateId: "document-v1" | "grouped-cards-v1" | "table-v1" | "sources-v1";
    templateVersion: 1;
    layouts: Array<{
        id: string;
        label: string;
        groups: Array<{ id: string; label: string; blockIds: string[] }>;
    }>;
}

export interface ExtensionViewContent {
    kind: "extension";
    construction: "extension-v1";
    provider: ViewProviderIdentity;
    title: string;
    summary?: string;
    sections: ViewSection[];
    citations: ViewCitation[];
    evidence: Array<{
        blockId: string;
        support: ViewCitation[];
        opposition: ViewCitation[];
    }>;
    payload: ViewJsonValue;
    presentation: ViewPresentation;
    inputUse: Array<{
        sourceId: string;
        revisionId: string;
        disposition: "represented" | "unused";
        reason: string;
    }>;
    fidelity: ViewSupportReport;
    agentEdition?: never;
}

export interface ViewProviderContext {
    readonly signal: AbortSignal;
    readonly deadline: number;
    checkpoint(stage: string, state?: ViewJsonValue): Promise<void>;
    recordCandidate?(stage: string, value: ViewJsonValue): Promise<void>;
    readonly resume?: {
        candidates: ViewProviderCandidate[];
        checkpoints: ViewProviderCheckpoint[];
    };
    complete(
        stage: string,
        prompt: string | PromptSection[],
        schema?: Parameters<ChatModel["complete"]>[2],
    ): Promise<string>;
    decide?(stage: string, request: DecisionRequest): Promise<DecisionResponse>;
}

export interface ViewProviderCandidate {
    id: string;
    stage: string;
    fingerprint: string;
    createdAt: string;
    value: ViewJsonValue;
}

export interface ViewProviderCheckpoint {
    stage: string;
    at: string;
    state?: ViewJsonValue;
}

export interface ViewProviderDiscoveryInput {
    corpusId: string;
    sources: Array<{
        sourceId: string;
        revisionId: string;
        contentHash: string;
        title: string;
        sourceType: import("./types.js").SourceType;
        metadata?: ViewJsonValue;
    }>;
}

export interface ViewExtensionProvider {
    descriptor: {
        apiVersion: 1;
        identity: ViewProviderIdentity;
        label: string;
        outputSchema: ViewPayloadSchema;
        definitions: Array<{
            id: string;
            eligibilityVersion: string;
            mode: "static" | "decision";
        }>;
        limits: {
            maxSources: number;
            maxInputChars: number;
            maxOutputChars: number;
            maxModelCalls: number;
            timeoutMs: number;
        };
    };
    model?: ChatModel;
    decisionModel?: DecisionModel;
    discover?(
        input: ViewProviderDiscoveryInput,
    ): Promise<ViewDefinitionInput[]>;
    authorize(
        input: ViewBuildSnapshot,
        operation: "build" | "model" | "accept" | "read" | "publish" | "source",
    ): Promise<boolean>;
    evaluateEligibility(
        input: ViewBuildSnapshot,
        context: ViewProviderContext,
    ): Promise<Pick<ViewEligibilityReceipt, "disposition" | "reason">>;
    prepare(input: ViewBuildSnapshot): Promise<ViewJsonValue>;
    generate(
        input: ViewBuildSnapshot,
        prepared: ViewJsonValue,
        context: ViewProviderContext,
    ): Promise<ExtensionViewContent>;
}
