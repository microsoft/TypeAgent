// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    RecipeArtifact,
    RecipeCapture,
    RecipeJob,
    RecipeScope,
} from "./recipeContracts.js";
import { validateRecipeArtifact } from "./recipeValidation.js";

export function recipeRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function strings(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function textFields(value: Record<string, unknown>, fields: string[]) {
    return fields.every((field) => typeof value[field] === "string");
}

export function assertRecipeScope(
    value: unknown,
): asserts value is RecipeScope {
    if (
        !recipeRecord(value) ||
        !textFields(value, ["workspaceId", "profileId"]) ||
        !value.workspaceId ||
        !value.profileId
    )
        throw new Error("Invalid recipe scope.");
}

export function assertStoredArtifact(
    value: unknown,
): asserts value is RecipeArtifact {
    try {
        if (
            !recipeRecord(value) ||
            !textFields(value, [
                "recipeId",
                "revision",
                "name",
                "description",
            ]) ||
            !recipeRecord(value.provenance) ||
            !textFields(value.provenance, ["captureId", "taskId", "tokenId"]) ||
            !recipeRecord(value.matching) ||
            !strings(value.matching.grammar) ||
            !strings(value.matching.negatives) ||
            !Array.isArray(value.matching.examples) ||
            value.matching.examples.some(
                (example) =>
                    !recipeRecord(example) ||
                    typeof example.request !== "string" ||
                    !("input" in example),
            ) ||
            validateRecipeArtifact(value as unknown as RecipeArtifact).length
        )
            throw new Error("Invalid artifact.");
    } catch {
        throw new Error("Invalid stored recipe artifact.");
    }
}

export function assertStoredCapture(
    value: unknown,
): asserts value is RecipeCapture {
    if (
        !recipeRecord(value) ||
        !textFields(value, [
            "captureId",
            "tokenId",
            "sessionId",
            "taskId",
            "request",
            "decisionSummary",
        ]) ||
        !recipeRecord(value.boundary) ||
        !textFields(value.boundary, ["firstEventId", "lastEventId"]) ||
        !["task", "legacy_trace"].includes(String(value.origin)) ||
        value.outcome !== "succeeded" ||
        !["off", "prepare", "read-only", "all"].includes(String(value.mode)) ||
        !strings(value.omissions) ||
        !strings(value.outputEvidenceIds) ||
        !Array.isArray(value.contextArtifacts) ||
        !Array.isArray(value.calls) ||
        value.calls.some(
            (call) =>
                !recipeRecord(call) ||
                typeof call.callId !== "string" ||
                !["program", "host"].includes(String(call.executionOwner)),
        )
    )
        throw new Error("Invalid stored recipe capture.");
    assertRecipeScope(value.scope);
}

export function assertStoredJob(value: unknown): asserts value is RecipeJob {
    if (
        !recipeRecord(value) ||
        !textFields(value, ["jobId", "captureId"]) ||
        ![
            "queued",
            "authoring",
            "validating",
            "prepared",
            "ready",
            "blocked",
            "failed",
        ].includes(String(value.state)) ||
        !Number.isInteger(value.attempt) ||
        Number(value.attempt) < 0
    )
        throw new Error("Invalid stored recipe job.");
    assertRecipeScope(value.scope);
    if (
        value.claim !== undefined &&
        (!recipeRecord(value.claim) ||
            !textFields(value.claim, ["ownerId", "token", "expiresAt"]) ||
            !Number.isFinite(Date.parse(String(value.claim.expiresAt))))
    )
        throw new Error("Invalid stored job claim.");
}

export function assertCatalogPayload(value: unknown) {
    if (
        !recipeRecord(value) ||
        !Number.isSafeInteger(value.revision) ||
        Number(value.revision) < 0 ||
        !Array.isArray(value.entries) ||
        !Array.isArray(value.captures) ||
        !Array.isArray(value.jobs) ||
        !Array.isArray(value.runs) ||
        (value.mode !== undefined &&
            !["off", "prepare", "read-only", "all"].includes(
                String(value.mode),
            ))
    )
        throw new Error("Invalid recipe catalog payload.");
    for (const entry of value.entries) {
        if (
            !recipeRecord(entry) ||
            typeof entry.captureId !== "string" ||
            ![
                "candidate",
                "prepared",
                "ready",
                "disabled",
                "superseded",
                "deleted",
            ].includes(String(entry.state))
        )
            throw new Error("Invalid catalog entry.");
        assertStoredArtifact(entry.artifact);
    }
    value.captures.forEach(assertStoredCapture);
    value.jobs.forEach(assertStoredJob);
    value.runs.forEach(assertStoredRun);
}

function assertStoredRun(run: unknown) {
    if (
        !recipeRecord(run) ||
        !textFields(run, ["runId", "acceptedAt"]) ||
        typeof run.cancelRequested !== "boolean" ||
        !Array.isArray(run.checkpoints) ||
        !recipeRecord(run.recipe) ||
        !textFields(run.recipe, ["recipeId", "revision"])
    )
        throw new Error("Invalid stored run.");
    run.checkpoints.forEach(assertCheckpoint);
    if (
        run.result !== undefined &&
        (!recipeRecord(run.result) ||
            run.result.runId !== run.runId ||
            run.result.recipeId !== run.recipe.recipeId ||
            run.result.revision !== run.recipe.revision ||
            run.result.accepted !== true ||
            run.result.fallback !== "never" ||
            ![
                "completed",
                "failed",
                "cancelled",
                "denied",
                "unsupported",
                "unavailable",
                "requires_interaction",
                "execution_uncertain",
                "abstained",
                "limit_exceeded",
            ].includes(String(run.result.status)) ||
            !Array.isArray(run.result.checkpoints) ||
            !strings(run.result.completedCallIds) ||
            !Array.isArray(run.result.semanticEvidence))
    )
        throw new Error("Invalid stored run result.");
}

function assertCheckpoint(value: unknown) {
    if (
        !recipeRecord(value) ||
        !textFields(value, ["callId", "capabilityId"]) ||
        !["read", "write", "unknown"].includes(String(value.effect)) ||
        !["not_dispatched", "dispatched", "completed", "uncertain"].includes(
            String(value.phase),
        )
    )
        throw new Error("Invalid effect checkpoint.");
}
