// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    ViewVersion,
    ViewSeparationProposal,
    ViewSeparationRequest,
    ViewSeparationResult,
} from "@typeagent/memory-service";
import { invokeMemory } from "./viewClient";
import { rbButton, rbError, rbNode } from "./memoryHubDocumentUi";

export function createSeparationPanel(view: ViewVersion): HTMLElement {
    const panel = rbNode("details");
    panel.append(rbNode("summary", "Narrower articles and separation"));
    const body = rbNode("div");
    const error = rbNode("div");
    panel.append(body, error);
    let head: string | null = null;
    let proposal: ViewSeparationProposal | null = null;
    let loaded = false;
    let running = false;

    async function request(input: ViewSeparationRequest): Promise<void> {
        error.replaceChildren();
        try {
            const result: ViewSeparationResult = await invokeMemory(
                "memorySeparateView",
                input,
            );
            head = result.head;
            proposal = result.proposal;
            render();
        } catch (reason) {
            if (input.operation === "confirm") await read();
            error.replaceChildren(rbError(reason));
        }
    }

    const read = () =>
        request({
            operation: "read",
            corpusId: view.corpusId,
            viewId: view.viewId,
        });
    const preview = () =>
        request({
            operation: "preview",
            corpusId: view.corpusId,
            viewId: view.viewId,
            expectedHead: head,
            expectedVersion: view.version,
            revisionId: view.revisionId,
        });
    function render(): void {
        body.replaceChildren(
            rbNode(
                "p",
                "The accepted overview stays unchanged, including all facts, old anchors and human-authored units. Only explicitly confirmed narrower articles can be added.",
            ),
        );
        if (!proposal) {
            body.append(
                rbButton("Preview proposed separation", () => {
                    void preview();
                }),
            );
            return;
        }
        const current = proposal;
        body.append(
            rbNode("p", `${current.state}: ${current.reasonForState}`),
            rbNode("p", current.reason),
            rbNode("h4", `Retained overview: ${current.overview.title}`),
            rbNode(
                "p",
                `Retained anchors: ${current.overview.retainedSectionIds.join(", ")}`,
            ),
            rbNode(
                "p",
                `Retained human units: ${current.overview.retainedHumanUnits.join(", ") || "none recorded"}`,
            ),
        );
        const destinations = rbNode("ul");
        for (const destination of current.destinations) {
            const item = rbNode("li");
            item.append(rbNode("p", destination.purpose));
            item.append(
                rbNode(
                    "p",
                    `Original sections: ${destination.sectionIds.join(", ")}; original evidence: ${destination.citations.map((citation) => `${citation.sourceId} @ ${citation.revisionId} (${citation.locator})`).join("; ")}`,
                ),
            );
            if (current.state === "active" && destination.acceptedRevisionId) {
                const link = rbNode("a", "Read narrower article");
                link.href = `#/views/${encodeURIComponent(view.corpusId)}/${encodeURIComponent(destination.viewId)}/revision/${encodeURIComponent(destination.acceptedRevisionId)}`;
                item.append(link);
            } else {
                item.append(
                    rbNode(
                        "p",
                        destination.acceptedRevisionId
                            ? "Accepted destination; navigation withheld until every exact index is ready"
                            : "Destination not yet accepted",
                    ),
                );
            }
            destinations.append(item);
        }
        body.append(destinations);
        if (current.unresolved.length)
            body.append(
                rbNode(
                    "p",
                    `Unresolved assignments remain in the unchanged overview: ${current.unresolved.join("; ")}`,
                ),
            );
        if (
            ["proposed", "incomplete", "cancelled", "confirmed"].includes(
                current.state,
            )
        ) {
            const label = rbNode("label");
            const consent = document.createElement("input");
            consent.type = "checkbox";
            label.append(
                consent,
                rbNode(
                    "span",
                    "I confirm this proposal's destinations and retention of the complete original overview.",
                ),
            );
            const confirm = rbButton(
                current.confirmedAt
                    ? "Retry confirmed separation"
                    : "Confirm this separation",
                () => {
                    if (!consent.checked || running) return;
                    running = true;
                    confirm.disabled = true;
                    void request({
                        operation: "confirm",
                        corpusId: view.corpusId,
                        receiptId: current.receiptId,
                        expectedHead: head,
                        confirmationToken: current.confirmationToken,
                    }).finally(() => {
                        running = false;
                        confirm.disabled = !consent.checked;
                    });
                },
            );
            confirm.disabled = true;
            consent.onchange = () => {
                confirm.disabled = !consent.checked || running;
            };
            body.append(label, confirm);
            body.append(
                rbButton("Cancel separation", () => {
                    void request({
                        operation: "cancel",
                        corpusId: view.corpusId,
                        receiptId: current.receiptId,
                        expectedHead: head,
                    });
                }),
            );
        }
        if (current.state === "stale")
            body.append(
                rbNode(
                    "p",
                    "Run semantic review for the current article and request a new preview before continuing.",
                ),
                rbButton("Preview updated separation", () => {
                    void preview();
                }),
            );
        body.append(
            rbButton("Refresh separation status", () => {
                void read();
            }),
        );
    }
    panel.ontoggle = () => {
        if (!panel.open || loaded) return;
        loaded = true;
        void read();
    };
    return panel;
}
