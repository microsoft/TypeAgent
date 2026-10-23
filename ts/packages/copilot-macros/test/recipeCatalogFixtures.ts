// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { CopilotToolMacro } from "@typeagent/copilot-macros";
import {
    recipeDigest,
    recipeRuntimeAbi,
    sealRecipeArtifact,
    type RecipeArtifact,
    type RecipeCapture,
    type RecipeJob,
} from "@typeagent/copilot-macros/recipeCore";

export function macroProgramArtifact(macro: CopilotToolMacro): RecipeArtifact {
    return recipeArtifact(macro.macroId, macro.sourceTraceId, {
        inputSchema: {
            type: "object",
            properties: { step_1_path: { type: "string" } },
            required: ["step_1_path"],
            additionalProperties: false,
        },
        matching: {
            grammar: ["<Start> = fixture -> {};"],
            examples: [
                {
                    request: "fixture",
                    input: { step_1_path: "package.json" },
                    evidenceIds: ["evidence"],
                },
            ],
            negatives: ["delete"],
            collisionEvidenceIds: [],
        },
        provenance: {
            captureId: macro.learning!.authoring.captureId,
            taskId: macro.learning!.authoring.taskId,
            tokenId: macro.learning!.authoring.tokenId,
            evidenceIds: ["evidence", macro.learning!.authoring.contextDigest],
            legacySource: { macroId: macro.macroId, version: macro.version },
        },
    });
}

export const recipeScope = { workspaceId: "workspace", profileId: "profile" };

export function recipeCapture(
    captureId = "capture",
    mode: RecipeCapture["mode"] = "all",
): RecipeCapture {
    return {
        captureId,
        tokenId: captureId,
        sessionId: "session",
        taskId: captureId,
        boundary: { firstEventId: "first", lastEventId: "last" },
        origin: "task",
        outcome: "succeeded",
        scope: recipeScope,
        mode,
        request: "read document",
        decisionSummary: "Read-only fixture.",
        contextArtifacts: [],
        omissions: [],
        outputEvidenceIds: ["evidence"],
        calls: [],
    };
}

export function recipeJob(captureId = "capture"): RecipeJob {
    return {
        jobId: `job-${captureId}`,
        captureId,
        scope: recipeScope,
        state: "queued",
        attempt: 0,
    };
}

export function recipeArtifact(
    recipeId = "read-document",
    captureId = "capture",
    change: Partial<Omit<RecipeArtifact, "revision">> = {},
): RecipeArtifact {
    const text = "This fixture is stored as data and is never executed.";
    return sealRecipeArtifact({
        schemaVersion: 1,
        kind: "program",
        recipeId,
        name: recipeId,
        description: "Host-independent catalog fixture.",
        execution: "symbolic",
        authorization: "live_host",
        source: { language: "typescript", text, digest: recipeDigest(text) },
        executable: {
            language: "javascript",
            text,
            digest: recipeDigest(text),
            sourceDigest: recipeDigest(text),
            compiler: {
                name: "fixture",
                version: "1",
                optionsDigest: "options",
            },
            runtimeAbi: recipeRuntimeAbi,
        },
        inputSchema: {
            type: "object",
            properties: { title: { type: "string" } },
            required: ["title"],
            additionalProperties: false,
        },
        outputSchema: { type: "string" },
        output: {
            kind: "value",
            requirements: ["Current"],
            identity: "current_run",
        },
        capabilities: [],
        semanticFunctions: [],
        applicability: { assumptions: [], unsupported: [] },
        generalization: [],
        specification: {
            id: "spec",
            revision: "1",
            intent: "Read",
            outputRequirements: ["Current"],
            rubric: "Exact",
            counterexamples: ["Delete"],
        },
        matching: {
            grammar: ['<Start> = read document -> { title: "document" };'],
            examples: [
                {
                    request: "read document",
                    input: { title: "document" },
                    evidenceIds: ["evidence"],
                },
            ],
            negatives: ["delete document"],
            collisionEvidenceIds: [],
        },
        provenance: {
            captureId,
            taskId: captureId,
            tokenId: captureId,
            evidenceIds: ["evidence"],
        },
        fixtures: [
            {
                id: "fixture",
                origin: "synthetic",
                result: "passed",
                specificationRevision: "1",
                noLiveEffects: true,
            },
        ],
        createdAt: "2026-10-15T20:00:00Z",
        ...change,
    });
}
