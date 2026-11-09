// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { MacroLearningMode, PrivateResultReference } from "./contracts.js";

export const recipeArtifactVersion = 1;
export const recipeRuntimeAbi = "typeagent-recipe-v1";

export type JsonValue =
    | null
    | boolean
    | number
    | string
    | JsonValue[]
    | { [key: string]: JsonValue };

// This deliberately small JSON Schema subset rejects unsupported keywords.
export type RuntimeJsonSchema =
    | { type: "null" }
    | { type: "boolean"; enum?: boolean[] }
    | { type: "number" | "integer"; minimum?: number; maximum?: number }
    | {
          type: "string";
          enum?: string[];
          minLength?: number;
          maxLength?: number;
      }
    | {
          type: "array";
          items: RuntimeJsonSchema;
          minItems?: number;
          maxItems?: number;
      }
    | {
          type: "object";
          properties: Record<string, RuntimeJsonSchema>;
          required?: string[];
          additionalProperties: false;
      };

export interface RecipeScope {
    workspaceId: string;
    profileId: string;
}

// These are opaque identities, not credentials or reusable authorization.
export interface RecipeBindingScope extends RecipeScope {
    providerId: string;
    accountId: string;
    sessionId: string;
    generation: string;
}

export interface RecipeRevisionRef {
    recipeId: string;
    revision: string;
}

export type RecipeEffect = "read" | "write" | "unknown";

export interface RecipeCapability {
    id: string;
    transport: "native" | "mcp";
    providerId: string;
    operation: string;
    contractVersion: string;
    inputSchema: RuntimeJsonSchema;
    outputSchema?: RuntimeJsonSchema;
    schemaDigest: string;
    compatibility: "exact";
    effect: RecipeEffect;
}

export interface RecipeSemanticFunction {
    id: string;
    revision: string;
    inputSchema: RuntimeJsonSchema;
    outputSchema: RuntimeJsonSchema;
    specification: {
        id: string;
        revision: string;
        task: string;
        rubric: string;
    };
    modelPolicy: { id: string; revision: string };
    bounds: {
        timeoutMs: number;
        maxInputBytes: number;
        maxOutputBytes: number;
        maxCalls: number;
        maxRepairAttempts: number;
        maxConcurrency: number;
    };
    evidence: {
        sourceIds: "none" | "known" | "complete";
        quotations: boolean;
    };
}

export interface RecipeSemanticEvidence {
    functionId: string;
    functionRevision: string;
    resolvedModel: string;
    latencyMs: number;
    inputTokens?: number;
    outputTokens?: number;
    validation: "passed" | "failed";
    sourceIds: string[];
}

export interface RecipePrivateArtifact {
    reference: PrivateResultReference;
    scope: RecipeScope;
    taskId: string;
}

export interface RecipeResultEvidence {
    raw?: JsonValue;
    modelVisible?: JsonValue;
    privateArtifacts?: RecipePrivateArtifact[];
}

export interface RecipeCallContext {
    runId: string;
    callId: string;
    parentCallId?: string;
    binding: RecipeBindingScope;
    signal: AbortSignal;
}

export type RecipeCallOutcome =
    | {
          status: "completed";
          value: JsonValue;
          evidence?: RecipeResultEvidence;
      }
    | {
          status: "requires_interaction";
          interactionId: string;
          prompt: string;
      }
    | {
          status:
              | "failed"
              | "cancelled"
              | "unavailable"
              | "unsupported"
              | "denied";
          code: string;
          message: string;
      }
    | {
          status: "execution_uncertain";
          operationId: string;
          message: string;
      };

export type RecipeSemanticOutcome =
    | {
          status: "completed";
          value: JsonValue;
          evidence: RecipeSemanticEvidence;
      }
    | { status: "abstained"; reason: string }
    | {
          status:
              | "invalid_input"
              | "invalid_output"
              | "provider_error"
              | "limit_exceeded"
              | "cancelled"
              | "unsupported";
          message: string;
      };

// An adapter must preserve its host's permissions, hooks, and cancellation.
export interface RecipeHost {
    inspectCapability(
        requirement: RecipeCapability,
        binding: RecipeBindingScope,
    ): Promise<
        | { status: "available"; capability: RecipeCapability }
        | { status: "unavailable" | "unsupported"; message: string }
    >;
    invokeCapability(
        capability: RecipeCapability,
        input: JsonValue,
        context: RecipeCallContext,
    ): Promise<RecipeCallOutcome>;
    invokeSemantic(
        definition: RecipeSemanticFunction,
        input: JsonValue,
        context: RecipeCallContext,
    ): Promise<RecipeSemanticOutcome>;
}

export interface RecipeSpecification {
    id: string;
    revision: string;
    intent: string;
    outputRequirements: string[];
    rubric: string;
    counterexamples: string[];
}

export type RecipeGeneralization =
    | {
          kind: "invariant";
          name: string;
          value: JsonValue;
          assumption: string;
          evidenceIds: string[];
      }
    | {
          kind: "parameter" | "derived" | "semantic" | "host_owned";
          name: string;
          producer: string;
          evidenceIds: string[];
      }
    | {
          kind: "guarded";
          name: string;
          producer: string;
          guard: string;
          resolverFunctionId: string;
          scope: "binding";
          evidenceIds: string[];
      };

export interface RecipeCapture {
    captureId: string;
    tokenId: string;
    sessionId: string;
    taskId: string;
    boundary: { firstEventId: string; lastEventId: string };
    origin: "task" | "legacy_trace";
    outcome: "succeeded";
    scope: RecipeScope;
    mode: MacroLearningMode;
    request: string;
    decisionSummary: string;
    contextArtifacts: RecipePrivateArtifact[];
    omissions: string[];
    outputEvidenceIds: string[];
    calls: {
        callId: string;
        parentCallId?: string;
        executionOwner: "program" | "host";
    }[];
}

export interface RecipeFixtureEvidence {
    id: string;
    origin: "observed" | "synthetic" | "independent";
    result: "passed" | "failed";
    specificationRevision: string;
    noLiveEffects: true;
}

export interface RecipeArtifact extends RecipeRevisionRef {
    schemaVersion: 1;
    kind: "program";
    name: string;
    description: string;
    execution: "symbolic" | "hybrid";
    authorization: "live_host";
    source: { language: "typescript"; text: string; digest: string };
    executable: {
        language: "javascript";
        text: string;
        digest: string;
        sourceDigest: string;
        compiler: { name: string; version: string; optionsDigest: string };
        runtimeAbi: string;
    };
    inputSchema: RuntimeJsonSchema;
    outputSchema: RuntimeJsonSchema;
    output: {
        kind: "value" | "content" | "artifact";
        requirements: string[];
        identity: "current_run";
    };
    capabilities: RecipeCapability[];
    semanticFunctions: RecipeSemanticFunction[];
    applicability: { assumptions: string[]; unsupported: string[] };
    generalization: RecipeGeneralization[];
    specification: RecipeSpecification;
    matching: {
        grammar: string[];
        examples: {
            request: string;
            input: JsonValue;
            evidenceIds: string[];
        }[];
        negatives: string[];
        collisionEvidenceIds: string[];
    };
    provenance: {
        captureId: string;
        taskId: string;
        tokenId: string;
        evidenceIds: string[];
        legacySource?: { macroId: string; version: number };
    };
    fixtures: RecipeFixtureEvidence[];
    createdAt: string;
}

export type RecipePublicationState =
    | "candidate"
    | "prepared"
    | "ready"
    | "disabled"
    | "superseded"
    | "deleted";

export interface RecipeCatalogEntry {
    artifact: RecipeArtifact;
    state: RecipePublicationState;
    captureId: string;
}

export interface RecipeJob {
    jobId: string;
    captureId: string;
    scope: RecipeScope;
    state:
        | "queued"
        | "authoring"
        | "validating"
        | "prepared"
        | "ready"
        | "blocked"
        | "failed";
    attempt: number;
    claim?: { ownerId: string; token: string; expiresAt: string };
    message?: string;
    result?: RecipeRevisionRef;
}

export interface RecipeRoutingSnapshot {
    scope: RecipeScope;
    catalogRevision: number;
    entries: RecipeCatalogEntry[];
}

export interface RecipeInvalidation {
    scope: RecipeScope;
    catalogRevision: number;
    recipe: RecipeRevisionRef;
    reason: "disabled" | "deleted" | "superseded" | "binding_changed";
    inFlight: "pin_revision_stop_future_calls";
}

// P2 supplies the mutation authority. A callback is committed atomically or not
// at all; expectedRevision is a CAS guard, not a process-local promise queue.
export interface RecipeCatalogTransaction {
    putImmutable(artifact: RecipeArtifact): void;
    publish(
        recipe: RecipeRevisionRef,
        captureId: string,
        state: "prepared" | "ready",
    ): void;
    invalidate(
        recipe: RecipeRevisionRef,
        reason: RecipeInvalidation["reason"],
    ): void;
    enqueueCapture(
        capture: RecipeCapture,
        job: RecipeJob,
    ): "inserted" | "existing";
    claimJob(
        jobId: string,
        ownerId: string,
        now: string,
        expiresAt: string,
    ): RecipeJob | undefined;
    updateJob(job: RecipeJob, claimToken: string): void;
}

export interface RecipeCatalog {
    snapshot(scope: RecipeScope): Promise<RecipeRoutingSnapshot>;
    transact(
        scope: RecipeScope,
        expectedRevision: number,
        mutate: (transaction: RecipeCatalogTransaction) => void,
    ): Promise<
        | { status: "committed"; catalogRevision: number }
        | { status: "conflict"; catalogRevision: number }
    >;
    subscribe(listener: (event: RecipeInvalidation) => void): () => void;
}

export interface RecipeEffectCheckpoint {
    callId: string;
    parentCallId?: string;
    capabilityId: string;
    effect: RecipeEffect;
    phase: "not_dispatched" | "dispatched" | "completed" | "uncertain";
    operationId?: string;
}

export interface RecipeRunResult extends RecipeRevisionRef {
    runId: string;
    accepted: boolean;
    status:
        | "completed"
        | "failed"
        | "cancelled"
        | "denied"
        | "unsupported"
        | "unavailable"
        | "requires_interaction"
        | "execution_uncertain"
        | "abstained"
        | "limit_exceeded";
    output?: JsonValue;
    artifacts?: RecipePrivateArtifact[];
    message?: string;
    interactionId?: string;
    checkpoints: RecipeEffectCheckpoint[];
    completedCallIds: string[];
    semanticEvidence: RecipeSemanticEvidence[];
    performance?: {
        workerQueueMs: number;
        workerReused: boolean;
    };
    fallback: "never";
}
