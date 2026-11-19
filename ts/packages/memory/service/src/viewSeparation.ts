// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    ViewBuildSnapshot,
    ViewCitation,
    ViewVersion,
} from "./viewTypes.js";
import {
    semanticReviewMatches,
    type ViewSemanticReview,
} from "./viewSemanticReview.js";
import { editorialProtection } from "./viewEditorial.js";
import { viewHash } from "./viewMerge.js";

export type ViewSeparationRequest =
    | {
          operation: "preview";
          corpusId: string;
          viewId: string;
          expectedHead: string | null;
          expectedVersion: number;
          revisionId: string;
      }
    | { operation: "read"; corpusId: string; viewId: string }
    | {
          operation: "confirm";
          corpusId: string;
          receiptId: string;
          expectedHead: string | null;
          confirmationToken: string;
      }
    | {
          operation: "cancel";
          corpusId: string;
          receiptId: string;
          expectedHead: string | null;
      };

export interface ViewSeparationProposal {
    receiptId: string;
    corpusId: string;
    viewId: string;
    acceptedRevisionId: string;
    acceptedVersion: number;
    contentHash: string;
    definitionHash: string;
    assessmentHash: string;
    confirmationToken: string;
    reason: string;
    overview: {
        title: string;
        retainedSectionIds: string[];
        retainedHumanUnits: string[];
    };
    destinations: Array<{
        viewId: string;
        purpose: string;
        sectionIds: string[];
        citations: ViewCitation[];
        acceptedRevisionId?: string;
    }>;
    unresolved: string[];
    state:
        | "proposed"
        | "confirmed"
        | "incomplete"
        | "cancelled"
        | "stale"
        | "active";
    reasonForState: string;
    createdAt: string;
    confirmedAt?: string;
}

export interface ViewSeparationReceipt extends ViewSeparationProposal {
    input: ViewBuildSnapshot;
    privacySourceIds: string[];
}

export interface ViewSeparationResult {
    head: string | null;
    proposal: ViewSeparationProposal | null;
}

export function separationParticipants(
    receipts: readonly ViewSeparationReceipt[],
): Set<string> {
    return new Set(
        receipts
            .filter(
                (receipt) =>
                    !["stale", "cancelled"].includes(receipt.state) ||
                    receipt.destinations.some(
                        (destination) => destination.acceptedRevisionId,
                    ),
            )
            .flatMap((receipt) => [
                receipt.viewId,
                ...receipt.destinations.map(
                    (destination) => destination.viewId,
                ),
            ]),
    );
}

export function validateSeparationRequest(
    request: ViewSeparationRequest,
): void {
    const fields = {
        preview: [
            "operation",
            "corpusId",
            "viewId",
            "expectedHead",
            "expectedVersion",
            "revisionId",
        ],
        read: ["operation", "corpusId", "viewId"],
        confirm: [
            "operation",
            "corpusId",
            "receiptId",
            "expectedHead",
            "confirmationToken",
        ],
        cancel: ["operation", "corpusId", "receiptId", "expectedHead"],
    };
    if (
        !request ||
        !Object.prototype.hasOwnProperty.call(fields, request.operation)
    )
        throw new Error("Invalid separation operation");
    const allowed = fields[request.operation];
    if (
        Object.keys(request).length !== allowed.length ||
        Object.keys(request).some((field) => !allowed.includes(field))
    )
        throw new Error("Invalid separation request fields");
    const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
    for (const [field, value] of Object.entries(request)) {
        if (
            ["corpusId", "viewId", "receiptId", "revisionId"].includes(field) &&
            (typeof value !== "string" || !identifier.test(value))
        )
            throw new Error(`Invalid separation ${field}`);
    }
    if (
        "expectedHead" in request &&
        request.expectedHead !== null &&
        (typeof request.expectedHead !== "string" ||
            !/^[0-9a-f]{40}$/.test(request.expectedHead))
    )
        throw new Error("Invalid separation expected head");
    if (
        request.operation === "preview" &&
        (!Number.isSafeInteger(request.expectedVersion) ||
            request.expectedVersion < 1)
    )
        throw new Error("Invalid separation expected version");
    if (
        request.operation === "confirm" &&
        (typeof request.confirmationToken !== "string" ||
            !/^[0-9a-f]{64}$/.test(request.confirmationToken))
    )
        throw new Error("Invalid separation confirmation token");
}

export function separationProposal(
    view: ViewVersion,
    review: ViewSemanticReview,
    input: ViewBuildSnapshot,
): ViewSeparationReceipt {
    const separation = review.assessment?.separation;
    if (
        view.state !== "draft" ||
        view.redirect ||
        !view.generation?.input ||
        (view.content.kind !== "wiki" &&
            view.content.kind !== "projectBrief") ||
        review.state !== "complete" ||
        !semanticReviewMatches(review, view) ||
        !separation ||
        separation.destinations.length < 2 ||
        separation.destinations.length > 4
    )
        throw new Error(
            "Separation requires a completed assessment of the exact accepted article",
        );
    const assessmentHash = viewHash(review.assessment);
    const identity = viewHash([
        view.viewId,
        view.revisionId,
        assessmentHash,
        input.fingerprint,
        review.assessmentCompletedAt ?? review.completedAt,
    ]);
    const receiptId = `split-${identity}`;
    const retainedSectionIds = view.content.sections.map(
        (section) => section.id,
    );
    const destinations = separation.destinations.map((destination, index) => {
        if (
            !destination.purpose.trim() ||
            !destination.citations.length ||
            !destination.sectionIds.length ||
            destination.sectionIds.some(
                (id) => !retainedSectionIds.includes(id),
            ) ||
            destination.citations.some(
                (citation) =>
                    !input.inputs.some((source) =>
                        source.passages?.some(
                            (original) =>
                                viewHash(original) === viewHash(citation),
                        ),
                    ),
            )
        )
            throw new Error(
                "Separation destination lacks original evidence or names an unknown section",
            );
        return {
            ...structuredClone(destination),
            viewId: `split-${viewHash([receiptId, index]).slice(0, 40)}`,
        };
    });
    if (
        new Set(destinations.map((entry) => entry.purpose.trim().toLowerCase()))
            .size !== destinations.length
    )
        throw new Error("Separation destinations must have distinct purposes");
    const proposal = {
        receiptId,
        corpusId: view.corpusId,
        viewId: view.viewId,
        acceptedRevisionId: view.revisionId,
        acceptedVersion: view.version,
        contentHash: viewHash(view.content),
        definitionHash: viewHash(view.definition),
        assessmentHash,
        reason: separation.reason,
        overview: {
            title: view.content.title,
            retainedSectionIds,
            retainedHumanUnits: editorialProtection(view),
        },
        destinations,
        unresolved: structuredClone(separation.unresolved),
    };
    return {
        ...proposal,
        confirmationToken: viewHash(proposal),
        state: "proposed",
        reasonForState:
            "Awaiting explicit confirmation; the original article and every anchor remain unchanged",
        createdAt: new Date().toISOString(),
        input: structuredClone(input),
        privacySourceIds: separationPrivacySources(view, input),
    };
}

function separationPrivacySources(
    view: ViewVersion,
    input: ViewBuildSnapshot,
): string[] {
    const sources = [
        ...input.inputs,
        ...(input.influenceSources ?? []),
        ...input.definition.selector.sources,
        ...(input.informationalRetrieval?.sources ?? []),
        ...(input.informationalRetrieval?.followSources ?? []),
    ];
    return [
        ...new Set([
            ...sources.map((source) => source.sourceId),
            ...(view.definition.wiki?.excludedSourceIds ?? []),
            ...(view.definition.projectSummary?.excludedSourceIds ?? []),
            ...(input.maintenance?.privacySources ?? []),
        ]),
    ];
}

export function publicSeparation(
    receipt: ViewSeparationReceipt,
): ViewSeparationProposal {
    const { input: _input, privacySourceIds: _privacy, ...proposal } = receipt;
    return structuredClone(proposal);
}

export function assertSeparationParent(
    receipt: ViewSeparationReceipt,
    parent: ViewVersion | undefined,
): void {
    if (
        !parent ||
        parent.state !== "draft" ||
        parent.redirect ||
        parent.revisionId !== receipt.acceptedRevisionId ||
        parent.version !== receipt.acceptedVersion ||
        viewHash(parent.content) !== receipt.contentHash ||
        viewHash(parent.definition) !== receipt.definitionHash
    )
        throw new Error(
            "Separation overview changed; request and confirm a new preview",
        );
}

export function separationChildInput(
    receipt: ViewSeparationReceipt,
    index: number,
): ViewBuildSnapshot {
    const destination = receipt.destinations[index];
    if (!destination) throw new Error("Unknown separation destination");
    const input = structuredClone(receipt.input);
    input.definition.viewId = destination.viewId;
    delete input.definition.maintenance;
    const scope = input.definition.wiki ?? input.definition.projectSummary;
    if (!scope) throw new Error("Separation requires an informational scope");
    scope.query = destination.purpose;
    scope.aliases = [];
    input.expectedVersion = 0;
    delete input.targetRevisionId;
    delete input.definitionRevisionId;
    delete input.editorial;
    delete input.semanticReviewOnly;
    delete input.maintenance;
    // Keep the entire original evidence and influence closure. Narrowing the
    // purpose must not make previously read sources disappear from privacy checks.
    input.fingerprint = viewHash([
        receipt.confirmationToken,
        destination.viewId,
        input,
    ]);
    return input;
}
