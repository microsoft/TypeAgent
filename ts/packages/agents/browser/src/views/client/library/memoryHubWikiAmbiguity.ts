// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    WikiAmbiguityReview,
    WikiAmbiguityResolution,
    WikiAmbiguityReviewAction,
} from "@typeagent/memory-service";
import type { InboxAttentionCard } from "./memoryHubInbox";
import { rbButton, rbNode, rbError } from "./memoryHubDocumentUi";

export function wikiAmbiguityAttention(
    review: WikiAmbiguityReview,
    resolve: (
        request: WikiAmbiguityReviewAction,
    ) => Promise<WikiAmbiguityReview>,
    refresh: () => Promise<void>,
    openView?: (corpusId: string, viewId: string, revisionId?: string) => void,
): InboxAttentionCard {
    const detail = rbNode("section");
    const status = rbNode("p", review.reason);
    status.setAttribute("role", "status");
    detail.append(
        rbNode("h4", "Wiki ambiguity · retained proposals"),
        status,
        rbNode(
            "p",
            `${review.state} · ${review.request.model} · ${review.request.logicalRequests} logical request reserved · transport retries: ${review.request.transportRetries ?? "not reported"}`,
        ),
    );
    const receipts = rbNode("details");
    receipts.append(
        rbNode("summary", "Complete decision, validation and request receipts"),
        rbNode(
            "pre",
            JSON.stringify(
                {
                    assessment: review.assessment,
                    request: review.request,
                    verification: review.verification,
                },
                null,
                2,
            ),
        ),
    );
    detail.append(receipts);
    for (const participant of review.participants) {
        const content = participant.page?.content ?? participant.draft?.content;
        const section = rbNode("section");
        section.append(
            rbNode(
                "h4",
                content?.title ??
                    `Source-bound candidate proposal: ${participant.id}`,
            ),
        );
        if (participant.page && openView)
            section.append(
                rbButton("Open original article", () =>
                    openView(
                        review.corpusId,
                        participant.id,
                        participant.revisionId ?? undefined,
                    ),
                ),
            );
        if (content) {
            if (content.summary) section.append(rbNode("p", content.summary));
            for (const item of content.sections)
                section.append(
                    rbNode("h5", item.heading),
                    rbNode("pre", item.body),
                );
        } else
            section.append(
                rbNode(
                    "p",
                    "No generated body is available; original candidate evidence is retained below.",
                ),
            );
        const evidence = rbNode("details");
        evidence.append(
            rbNode(
                "summary",
                `Original evidence and revision: ${participant.revisionId ?? "new candidate"}`,
            ),
            rbNode(
                "pre",
                JSON.stringify(
                    {
                        input: participant.input,
                        page: participant.page,
                        draft: participant.draft,
                        citations: content?.citations,
                    },
                    null,
                    2,
                ),
            ),
        );
        if (participant.proposal && !participant.draft)
            evidence.append(
                rbNode("pre", JSON.stringify(participant.proposal, null, 2)),
            );
        section.append(evidence);
        detail.append(section);
    }
    if (review.resolution) {
        const preview = rbNode("details");
        preview.open = true;
        preview.append(
            rbNode("summary", "Complete proposed grouping and combined forms"),
        );
        preview.append(
            rbNode("pre", JSON.stringify(review.resolution, null, 2)),
        );
        detail.append(preview);
    }
    const editor = document.createElement("textarea");
    editor.setAttribute(
        "aria-label",
        "Edit complete Wiki ambiguity resolution JSON",
    );
    editor.rows = 12;
    editor.value = JSON.stringify(
        review.resolution ?? {
            status: "resolved",
            reason: "Human keeps all subjects separate",
            groups: review.participants.map((participant) => ({
                action: "keep_separate",
                ids: [participant.id],
                survivorId: null,
                combined: null,
                sections: [],
            })),
        },
        null,
        2,
    );
    const edit = rbNode("details");
    edit.append(rbNode("summary", "Edit and revalidate proposal"), editor);
    const buttons: HTMLButtonElement[] = [];
    async function act(action: WikiAmbiguityReviewAction["action"]) {
        buttons.forEach((button) => {
            button.disabled = true;
        });
        try {
            const resolution =
                action === "edit"
                    ? (JSON.parse(editor.value) as WikiAmbiguityResolution)
                    : undefined;
            const result = await resolve({
                corpusId: review.corpusId,
                reviewId: review.id,
                expectedVersion: review.version,
                action,
                ...(resolution ? { resolution } : {}),
            });
            status.textContent = `${result.state}: ${result.reason}`;
            await refresh();
        } catch (error) {
            status.textContent = `Review not applied: ${rbError(error)}`;
        } finally {
            buttons.forEach((button) => {
                button.disabled = false;
            });
            buttons[1].disabled = review.resolution?.status !== "resolved";
        }
    }
    buttons.push(
        rbButton("Keep separate", () => void act("keep_separate")),
        rbButton("Approve verified combination", () => void act("approve")),
        rbButton("Revalidate edited proposal", () => void act("edit")),
    );
    buttons[1].disabled = review.resolution?.status !== "resolved";
    edit.append(buttons[2]);
    detail.append(buttons[0], buttons[1], edit);
    return {
        id: review.id,
        fingerprint: JSON.stringify([review.id, review.version, review.state]),
        title: `Wiki ambiguity · ${review.state}`,
        summary: review.reason,
        detail,
    };
}
