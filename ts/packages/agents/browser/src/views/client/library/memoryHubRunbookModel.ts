// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    AgentEdition,
    AgentEditionInput,
    ProcedureDocument,
    ProcedureSaveRequest,
} from "@typeagent/memory-service";
import type { RunbookDetail } from "@typeagent/browser-control-rpc/viewRpc";
import {
    draftAgentEdition,
    normalizeAgentEditionDocument,
    redactRunbookText,
    validateAgentEditionReadiness,
} from "@typeagent/memory-service/agent-edition-validation";
import {
    procedureFromMarkdown,
    procedureToMarkdown,
    validateProcedureDocument,
} from "@typeagent/memory-service/procedure-markdown";

function detailDocument(detail: RunbookDetail): ProcedureDocument {
    if (detail.procedure) return detail.procedure.document;
    const candidate = detail.candidate;
    if (!candidate) return { title: "", steps: [], citations: [] };
    const metadata = new Set([
        "candidateId",
        "corpusId",
        "state",
        "createdAt",
        "updatedAt",
    ]);
    return {
        ...Object.fromEntries(
            Object.entries(candidate).filter(([key]) => !metadata.has(key)),
        ),
        title: candidate.title,
        summary: candidate.summary,
        steps: candidate.steps,
        citations: candidate.citations,
        additionalSections: candidate.additionalSections,
        agentEdition: candidate.agentEdition,
    };
}
export function createRunbookDraft(detail: RunbookDetail) {
    let document = normalizeAgentEditionDocument(detailDocument(detail));
    if (document.agentEdition && !detail.procedure)
        document.agentEdition = draftAgentEdition(
            document.agentEdition,
            "Candidate edition is not reviewed for a saved procedure version.",
        );
    let markdown = "";
    let markdownChanged = false;
    let dirty = false;
    let reviewRequested = false;
    let safetyConfirmed = false;
    const safetyReviewed = new Set<string>();
    function changed() {
        dirty = true;
        reviewRequested = false;
        safetyConfirmed = false;
        safetyReviewed.clear();
        if (document.agentEdition)
            document.agentEdition.review = {
                state: "draft",
                reason: "Content edited; review must be repeated for the saved version.",
            };
    }
    function currentDocument() {
        if (!markdownChanged) return normalizeAgentEditionDocument(document);
        const merged = procedureFromMarkdown(markdown, document);
        if (merged.agentEdition)
            merged.agentEdition = draftAgentEdition(
                merged.agentEdition,
                "Markdown edited; review must be repeated.",
            );
        return normalizeAgentEditionDocument(merged);
    }
    function saveRequest(): ProcedureSaveRequest {
        const submitted = currentDocument();
        validateProcedureDocument(submitted);
        if (reviewRequested) {
            if (!submitted.agentEdition)
                throw new Error(
                    "An agent edition is required for version review.",
                );
            if (
                !safetyConfirmed ||
                submitted.agentEdition.steps.some(
                    (step) =>
                        step.safety === "changesData" &&
                        !safetyReviewed.has(step.id),
                )
            )
                throw new Error(
                    "Explicit overall safety confirmation and every state-changing step acknowledgement are required.",
                );
            validateAgentEditionReadiness(submitted.agentEdition);
        }
        return {
            corpusId: detail.corpusId,
            ...(detail.procedure
                ? {
                      procedureId: detail.procedure.procedureId,
                      expectedVersion: detail.procedure.version,
                  }
                : {}),
            ...(detail.candidate
                ? { candidateId: detail.candidate.candidateId }
                : {}),
            document: submitted,
            ...(reviewRequested
                ? { reviewAgentEdition: true, safetyConfirmed: true }
                : {}),
        };
    }
    return {
        get document() {
            return document;
        },
        get dirty() {
            return dirty;
        },
        get reviewRequested() {
            return reviewRequested;
        },
        get safetyConfirmed() {
            return safetyConfirmed;
        },
        safetyReviewed,
        changed,
        saveRequest,
        setReview(value: boolean) {
            reviewRequested = value;
            dirty = true;
        },
        setSafety(value: boolean) {
            safetyConfirmed = value;
            dirty = true;
        },
        markdown() {
            if (!markdownChanged) markdown = procedureToMarkdown(document);
            return markdown;
        },
        preview(): { content?: string; error?: string } {
            try {
                return {
                    content: procedureToMarkdown(
                        markdownChanged ? currentDocument() : document,
                    ),
                };
            } catch (error) {
                return {
                    error:
                        error instanceof Error ? error.message : String(error),
                };
            }
        },
        editMarkdown(value: string) {
            markdown = value;
            changed();
            markdownChanged = true;
        },
        useStructured() {
            if (markdownChanged) {
                document = currentDocument();
                markdownChanged = false;
            }
        },
        addEdition() {
            const edition: AgentEdition = {
                schemaVersion: 1,
                goal: document.title,
                applicability: [],
                inputs: [],
                preconditions: [],
                steps: document.steps.map((text, index) => ({
                    id: `step-${index + 1}`,
                    title: `Step ${index + 1}`,
                    humanText: text,
                    agentInstruction: text,
                    safety: "unknown",
                    needsAttention: true,
                    attentionReasons: [
                        "Manual synthesis and safety review required",
                    ],
                    citations: structuredClone(document.citations),
                })),
                verification: [],
                rollback: [],
                synthesis: {
                    sourceReferences: structuredClone(document.citations),
                },
                review: {
                    state: "draft",
                    reason: "Manual draft; not model-synthesized or reviewed.",
                },
            };
            document.agentEdition = edition;
            changed();
        },
        markSecret(input: AgentEditionInput, secret: boolean) {
            input.secret = secret;
            if (secret) {
                const literals = [
                    input.defaultValue,
                    ...(input.examples ?? []),
                    ...(input.enumValues ?? []),
                ].filter(
                    (value): value is string =>
                        typeof value === "string" && Boolean(value),
                );
                function scrub(value: unknown, depth = 0) {
                    if (depth > 30)
                        throw new Error(
                            "Runbook content exceeds the nesting limit.",
                        );
                    if (value === null || typeof value !== "object") return;
                    for (const [key, entry] of Object.entries(value)) {
                        if (typeof entry === "string")
                            Reflect.set(
                                value,
                                key,
                                literals.reduce(
                                    (text, literal) =>
                                        text.split(literal).join("[REDACTED]"),
                                    redactRunbookText(entry),
                                ),
                            );
                        else scrub(entry, depth + 1);
                    }
                }
                scrub(document);
                delete input.defaultValue;
                delete input.examples;
                delete input.enumValues;
            }
            changed();
        },
    };
}
export type RunbookDraft = ReturnType<typeof createRunbookDraft>;
