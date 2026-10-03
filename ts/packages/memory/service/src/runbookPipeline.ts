// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import {
    draftAgentEdition,
    validateAgentEdition,
    type AgentEdition,
} from "./agentEdition.js";
import { redactRunbookText } from "./runbookRedaction.js";
import type { RevisionAssetDescriptor } from "./revisionAssetStore.js";
import type {
    PersonalHowToSettings,
    ProcedureCandidateCreateRequest,
    ProcedureSourceCitation,
} from "./types.js";

export interface RunbookPreferences {
    buildAgentEdition: boolean;
    describeImages: boolean;
    mcpTools: boolean;
    approvedAutomations: boolean;
}

export interface RunbookSynthesisRequest {
    corpusId: string;
    sourceId: string;
    revisionId: string;
}

export interface RunbookSynthesisInput {
    corpusId: string;
    sourceId: string;
    revisionId: string;
    title: string;
    content: string;
    assets: RevisionAssetDescriptor[];
    images: Array<{ assetId: string; mimeType: string; bytes: Uint8Array }>;
    preferences: RunbookPreferences;
    guidance?: string;
    seeds: ProcedureCandidateCreateRequest[];
    linkedDocuments?: Array<{
        sourceId: string;
        revisionId: string;
        title: string;
        canonicalUri?: string;
    }>;
}

export interface SynthesizedProcedure {
    sectionFingerprint: string;
    title: string;
    summary?: string;
    agentEdition: AgentEdition;
}

export interface RunbookSynthesisOutput {
    classification: "runbook" | "reference" | "other";
    confidence: number;
    reason: string;
    procedures: SynthesizedProcedure[];
    warnings: string[];
}

export type RunbookSynthesizer = (
    input: RunbookSynthesisInput,
    signal: AbortSignal,
) => Promise<RunbookSynthesisOutput>;

export interface RunbookJobResult {
    jobId: string;
    corpusId: string;
    sourceId: string;
    revisionId: string;
    state: "running" | "complete" | "failed" | "interrupted" | "cancelled";
    createdAt: string;
    updatedAt: string;
    classification?: RunbookSynthesisOutput["classification"];
    confidence?: number;
    reason?: string;
    candidateIds: string[];
    warnings: string[];
}

export function runbookPreferences(
    settings: PersonalHowToSettings,
): RunbookPreferences | undefined {
    const value = settings.preferences?.runbook;
    if (
        !settings.enabled ||
        !settings.detectCandidates ||
        value === null ||
        typeof value !== "object"
    )
        return undefined;
    const options = value as Record<string, unknown>;
    if (options.buildAgentEdition !== true) return undefined;
    return {
        buildAgentEdition: true,
        describeImages: options.describeImages === true,
        mcpTools: options.mcpTools === true,
        approvedAutomations: options.approvedAutomations === true,
    };
}

function supportedCitation(
    citation: ProcedureSourceCitation,
    input: RunbookSynthesisInput,
): boolean {
    if (
        citation.sourceId !== input.sourceId ||
        citation.revisionId !== input.revisionId
    )
        return false;
    // Only producer offsets are locators. Matching an excerpt does not invent a location.
    const match = /^chars:(\d+)-(\d+)$/.exec(citation.locator ?? "");
    if (!match) return false;
    const start = Number(match[1]);
    const end = Number(match[2]);
    return (
        start >= 0 &&
        end > start &&
        end <= input.content.length &&
        citation.excerpt === input.content.slice(start, end)
    );
}

function validateOutput(output: RunbookSynthesisOutput): void {
    if (Buffer.byteLength(JSON.stringify(output)) > 1024 * 1024)
        throw new Error("Runbook result exceeds 1 MiB output limit");
    if (
        !["runbook", "reference", "other"].includes(output.classification) ||
        !Number.isFinite(output.confidence) ||
        output.confidence < 0 ||
        output.confidence > 1 ||
        typeof output.reason !== "string" ||
        !output.reason.trim()
    )
        throw new Error("Invalid runbook classification");
    if (
        !Array.isArray(output.procedures) ||
        output.procedures.length > 20 ||
        !Array.isArray(output.warnings) ||
        output.warnings.length > 20 ||
        output.warnings.some(
            (warning) => typeof warning !== "string" || warning.length > 1000,
        ) ||
        output.reason.length > 2000
    )
        throw new Error("Invalid bounded synthesis result");
}

export function synthesisCandidates(
    input: RunbookSynthesisInput,
    output: RunbookSynthesisOutput,
): ProcedureCandidateCreateRequest[] {
    validateOutput(output);
    const identities = new Set<string>();
    return output.procedures.map((procedure) => {
        validateAgentEdition(procedure.agentEdition);
        if (
            !procedure.sectionFingerprint ||
            procedure.sectionFingerprint.length > 200 ||
            !procedure.title?.trim()
        )
            throw new Error("Missing section fingerprint/title");
        const candidateId = createHash("sha256")
            .update(
                `${input.sourceId}\0${input.revisionId}\0${procedure.sectionFingerprint}`,
            )
            .digest("hex");
        if (identities.has(candidateId))
            throw new Error("Duplicate synthesized section fingerprint");
        identities.add(candidateId);
        const edition = draftAgentEdition(
            procedure.agentEdition,
            "Synthesized edition requires human review",
        );
        for (const step of edition.steps) {
            validateStepEvidence(step, input);
            step.agentInstruction = redactRunbookText(step.agentInstruction);
            if (step.binding) {
                // Catalog resolution/acceptance belongs to explicit review, never synthesis.
                delete step.binding;
                step.needsAttention = true;
                (step.attentionReasons ??= []).push(
                    "Binding proposal requires catalog-backed review",
                );
            }
        }
        edition.synthesis = {
            ...edition.synthesis,
            sourceReferences: [
                { sourceId: input.sourceId, revisionId: input.revisionId },
            ],
            linkedDocuments: (edition.synthesis.linkedDocuments ?? []).filter(
                (citation) =>
                    input.linkedDocuments?.some(
                        (document) =>
                            document.sourceId === citation.sourceId &&
                            document.revisionId === citation.revisionId &&
                            document.canonicalUri !== undefined &&
                            input.content.includes(document.canonicalUri),
                    ),
            ),
            synthesizedAt: new Date().toISOString(),
        };
        return {
            corpusId: input.corpusId,
            candidateId,
            state: "draft",
            title: redactRunbookText(procedure.title),
            ...(procedure.summary === undefined
                ? {}
                : { summary: redactRunbookText(procedure.summary) }),
            steps: edition.steps.map((step) =>
                redactRunbookText(step.humanText),
            ),
            citations: edition.steps.flatMap((step) => step.citations),
            agentEdition: edition,
        };
    });
}

function validateStepEvidence(
    step: AgentEdition["steps"][number],
    input: RunbookSynthesisInput,
): void {
    const reasons: string[] = [];
    if (
        input.assets.some(
            (asset) =>
                asset.instructionBearing &&
                !input.images.some((image) => image.assetId === asset.assetId),
        )
    ) {
        reasons.push(
            "Instruction-bearing image unavailable to configured model; human must inspect original",
        );
    }
    const supported = step.citations.filter((citation) =>
        supportedCitation(citation, input),
    );
    if (supported.length !== step.citations.length || supported.length === 0)
        reasons.push("Missing or unsupported retained passage citation");
    if (
        !supported.some((citation) =>
            citation.excerpt?.includes(step.humanText),
        )
    )
        reasons.push("Human text is not an exact retained excerpt");
    // Keep original human text only when validated; never manufacture text or offsets.
    if (reasons.length)
        step.humanText = supported[0]?.excerpt ?? "[Unsupported source text]";
    step.citations = supported;
    if (supported.length && step.agentInstruction !== step.humanText) {
        step.needsAttention = true;
        (step.attentionReasons ??= []).push(
            "Derived instruction requires semantic source-support review",
        );
    }
    for (const reference of step.assets ?? []) {
        const asset = input.assets.find(
            (item) =>
                item.assetId === reference.assetId &&
                item.sourceId === reference.sourceId &&
                item.revisionId === reference.revisionId,
        );
        if (!asset) reasons.push("Unknown revision image reference");
        else if (
            asset.instructionBearing &&
            !input.images.some((image) => image.assetId === asset.assetId)
        )
            reasons.push(
                "Instruction-bearing image is unreadable or unsupported; human must inspect original",
            );
    }
    step.assets = (step.assets ?? []).filter((reference) =>
        input.assets.some(
            (asset) =>
                asset.assetId === reference.assetId &&
                asset.sourceId === reference.sourceId &&
                asset.revisionId === reference.revisionId,
        ),
    );
    if (reasons.length) {
        step.needsAttention = true;
        step.attentionReasons = [...(step.attentionReasons ?? []), ...reasons];
        step.manualReason = reasons.join("; ");
        step.agentInstruction =
            "Ask the human to inspect the cited original; do not infer unsupported instructions.";
        step.safety = "unknown";
        delete step.binding;
    }
}
