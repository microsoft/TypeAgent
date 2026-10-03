// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import type {
    ProcedureDocument,
    ProcedureSaveRequest,
    ProcedureVersion,
} from "./types.js";
import {
    canonicalizeProcedure,
    getRunbookCatalogBindings,
    normalizeAgentEditionDocument,
    validateAgentEditionReviewIntent,
    validateAgentEditionReadiness,
    validateRunbookCatalogBindings,
    type RunbookBindingValidator,
} from "./agentEditionValidation.js";

export * from "./agentEditionValidation.js";

export function agentEditionContentHash(document: ProcedureDocument): string {
    const content = structuredClone(document);
    if (content.agentEdition !== undefined) {
        content.agentEdition.review = { state: "draft" };
    }
    return createHash("sha256")
        .update(canonicalizeProcedure(content))
        .digest("hex");
}

export function validateReviewedAgentEdition(
    procedure: ProcedureVersion,
): void {
    const edition = procedure.document.agentEdition;
    if (edition === undefined) return;
    validateAgentEditionReadiness(edition);
    const review = edition.review;
    if (procedure.state !== "saved" || review.state !== "reviewed") {
        throw new Error(
            "Agent edition must be saved and reviewed before publication",
        );
    }
    if (
        review.procedureVersion !== procedure.version ||
        review.contentHash !== agentEditionContentHash(procedure.document)
    ) {
        throw new Error(
            "Agent-edition review does not match the exact saved version and content hash",
        );
    }
    if (
        getRunbookCatalogBindings(edition).length > 0 &&
        review.argumentsValidation !== "accepted"
    ) {
        throw new Error(
            "Reviewed catalog argument templates require schema validation",
        );
    }
    if (
        canonicalizeProcedure(
            normalizeAgentEditionDocument(procedure.document),
        ) !== canonicalizeProcedure(procedure.document)
    ) {
        throw new Error("Agent-edition content contains unredacted secrets");
    }
}

export async function prepareAgentEditionSave(
    document: ProcedureDocument,
    request: Pick<
        ProcedureSaveRequest,
        "reviewAgentEdition" | "safetyConfirmed"
    >,
    resultingVersion: number,
    previous?: ProcedureVersion,
    validator?: RunbookBindingValidator,
): Promise<ProcedureDocument> {
    validateAgentEditionReviewIntent(request);
    const next = normalizeAgentEditionDocument(document);
    const edition = next.agentEdition;
    if (edition === undefined) {
        if (request.reviewAgentEdition)
            throw new Error("No agent edition to review");
        return next;
    }
    const contentHash = agentEditionContentHash(next);
    edition.review = { state: "draft", reason: "Content requires review" };
    if (request.reviewAgentEdition) {
        if (request.safetyConfirmed !== true)
            throw new Error(
                "Explicit safety confirmation is required for review",
            );
        validateAgentEditionReadiness(edition);
        await validateRunbookCatalogBindings(edition, validator);
        edition.review = {
            state: "reviewed",
            procedureVersion: resultingVersion,
            contentHash,
            reviewedAt: new Date().toISOString(),
            safetyConfirmed: true,
            bindingValidation: "accepted",
            argumentsValidation: "accepted",
        };
    } else if (
        previous?.state === "saved" &&
        previous.document.agentEdition?.review.state === "reviewed"
    ) {
        const oldReview = previous.document.agentEdition.review;
        if (
            oldReview.procedureVersion === previous.version &&
            oldReview.contentHash ===
                agentEditionContentHash(previous.document) &&
            oldReview.contentHash === contentHash &&
            (getRunbookCatalogBindings(edition).length === 0 ||
                oldReview.argumentsValidation === "accepted")
        ) {
            edition.review = {
                ...oldReview,
                procedureVersion: resultingVersion,
            };
        }
    }
    return next;
}
