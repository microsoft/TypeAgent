// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { CatalogEntry, CatalogState } from "@typeagent/skill-catalog";
import type { ProcedureArtifactGenerator } from "@typeagent/procedure-artifacts";
import type {
    GetSkillRequest,
    ListSkillsRequest,
    ProcedureArtifactPreview,
    ProcedureArtifactPromotion,
    ProcedureArtifactRequest,
    ReadSkillFileRequest,
    ReadSkillFileResponse,
    SelectSkillRevisionRequest,
} from "./protocol.js";

export type RunbookSkillAction =
    | "validate"
    | "changeState"
    | "activate"
    | "disable"
    | "archive"
    | "rollback";

export type RunbookSkillLifecycle = {
    entry: CatalogEntry;
    allowedTransitions: readonly CatalogState[];
    allowedActions: readonly RunbookSkillAction[];
};

export type RunbookSkillMutation = SelectSkillRevisionRequest & {
    expectedState: CatalogState;
    expectedActive: boolean;
    action: RunbookSkillAction;
    state?: CatalogState;
};

export type RunbookBindingReference = {
    kind: "mcp" | "macro" | "flow";
    id: string;
    version: string;
    fingerprint: string;
    arguments?: Record<string, unknown>;
};
export type RunbookBindingCheck = RunbookBindingReference & {
    serverConfigId?: string;
};
export type RunbookBindingSymbolicInput = { $input: string };
// Reuse canonical edition inputs through the protocol's existing artifact dependency.
type RunbookProcedure = Parameters<
    ProcedureArtifactGenerator["createSkillPackage"]
>[0];
export type RunbookBindingInput = NonNullable<
    RunbookProcedure["document"]["agentEdition"]
>["inputs"][number];
export type RunbookBindingCheckRequest = {
    bindings: RunbookBindingCheck[];
    inputs?: readonly RunbookBindingInput[];
    inputSchema?: Record<string, unknown>;
};

export type RunbookBindingTarget = RunbookBindingReference & {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
    serverConfigId?: string;
    annotations?: Record<string, unknown>;
    safety: {
        requiresConfirmation: true;
        readOnly?: boolean;
        destructive?: boolean;
    };
    permission: {
        status: "runtime-check-required";
        trust?: string;
        enabled?: boolean;
        requiresLivePermissions?: boolean;
        configuredDecision?: "allow" | "deny" | "unset";
        promptWithoutSessionGrant?: boolean;
    };
};

export type RunbookCatalogPageRequest = { limit?: number; offset?: number };
export type RunbookBindingCatalog = {
    targets: RunbookBindingTarget[];
    notices: string[];
    total: number;
};
export type RunbookBindingReadiness = {
    valid: boolean;
    argumentChecks?: {
        binding: RunbookBindingCheck;
        bindingIndex: number;
        argumentsValidated: true;
    }[];
    issues: {
        binding: RunbookBindingCheck;
        bindingIndex?: number;
        message: string;
        code?: "unavailable" | "drifted" | "invalidArguments";
    }[];
};
export type RunbookBindingSuggestionRequest = {
    inputSchema: Record<string, unknown>;
    commandText?: string;
};
export type RunbookBindingSuggestion = {
    kind: RunbookBindingReference["kind"] | "commandText" | "manual";
    target?: RunbookBindingTarget;
    reasons: string[];
    schemaFit: "exact" | "partial" | "manual";
};

// Explicitly named, non-executing functions only. Plain objects/functions are
// proxied by agent-rpc; classes, Maps and validator callbacks never cross it.
export type RunbookHostCapabilities = {
    listSkills(
        request?: ListSkillsRequest & RunbookCatalogPageRequest,
    ): Promise<CatalogEntry[]>;
    getSkill(request: GetSkillRequest): Promise<CatalogEntry | undefined>;
    readSkillFile(
        request: ReadSkillFileRequest,
    ): Promise<ReadSkillFileResponse>;
    previewProcedureArtifact(
        request: Extract<ProcedureArtifactRequest, { kind: "skill" }>,
    ): Promise<ProcedureArtifactPreview>;
    promoteProcedureArtifact(
        request: Extract<ProcedureArtifactRequest, { kind: "skill" }>,
    ): Promise<ProcedureArtifactPromotion>;
    getSkillLifecycle(
        request: SelectSkillRevisionRequest,
    ): Promise<RunbookSkillLifecycle>;
    changeSkillLifecycle(request: RunbookSkillMutation): Promise<CatalogEntry>;
    listBindingTargets(
        request?: RunbookCatalogPageRequest,
    ): Promise<RunbookBindingCatalog>;
    checkBindingTargets(
        request: RunbookBindingCheckRequest,
    ): Promise<RunbookBindingReadiness>;
    suggestBindings(
        request: RunbookBindingSuggestionRequest,
    ): Promise<{ suggestions: RunbookBindingSuggestion[]; notices: string[] }>;
};
