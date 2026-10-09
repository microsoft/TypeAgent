// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { DerivedViewUsage } from "@typeagent/browser-control-rpc/viewRpc";
import { invokeMemory, invokeView } from "./viewClient";
import { rbNode, rbButton } from "./memoryHubRunbookUi";
import { viewContentToText } from "@typeagent/memory-service/view-text";

export function renderDerivedViewUsage(
    items: DerivedViewUsage[],
    total: number,
    run: (operation: () => Promise<void>) => void,
): HTMLElement {
    const root = rbNode("section");
    root.setAttribute("aria-label", "Derived view source impact");
    root.append(
        rbNode(
            "h4",
            `${total} derived view revisions and build receipts use this source`,
        ),
    );
    const detail = rbNode("article");
    for (const item of items) {
        root.append(
            rbButton(
                `${item.title} · ${item.kind} · ${item.state} · ${item.reason}`,
                () => {
                    run(async () => {
                        if (item.revisionId) {
                            const view = await invokeMemory("memoryGetView", {
                                corpusId: item.corpusId,
                                viewId: item.viewId,
                                revisionId: item.revisionId,
                            });
                            if (!view || view.revisionId !== item.revisionId)
                                throw new Error(
                                    "Exact derived revision is unavailable; latest is not substituted",
                                );
                            detail.replaceChildren(
                                rbNode(
                                    "h5",
                                    `${view.content.title} · exact version ${view.version}`,
                                ),
                                rbNode(
                                    "p",
                                    `Affected sections/pages: ${[...new Set(item.sectionIds)].join(", ") || "Selected input membership"}. Historical inspection is not current publication.`,
                                ),
                                rbNode("pre", viewContentToText(view.content)),
                            );
                            for (const citation of view.content.citations) {
                                if (!citation.locator) continue;
                                detail.append(
                                    rbButton(
                                        `${citation.sourceId} @ ${citation.revisionId} ${citation.locator}`,
                                        () => {
                                            run(async () => {
                                                const original =
                                                    "evidence" in citation &&
                                                    citation.evidence
                                                        ? await invokeView(
                                                              "memoryHubEvidence",
                                                              {
                                                                  corpusId:
                                                                      item.corpusId,
                                                                  kind: "event",
                                                                  objectId:
                                                                      citation
                                                                          .evidence
                                                                          .eventId,
                                                                  revisionId:
                                                                      citation.revisionId,
                                                              },
                                                          )
                                                        : await invokeView(
                                                              "memoryHubRunbookOriginal",
                                                              {
                                                                  corpusId:
                                                                      item.corpusId,
                                                                  sourceId:
                                                                      citation.sourceId,
                                                                  revisionId:
                                                                      citation.revisionId,
                                                                  locator:
                                                                      citation.locator,
                                                              },
                                                          );
                                                if (
                                                    "available" in original &&
                                                    !original.available
                                                )
                                                    throw new Error(
                                                        original.error ??
                                                            "Exact source evidence unavailable",
                                                    );
                                                detail.append(
                                                    rbNode(
                                                        "h5",
                                                        original.title,
                                                    ),
                                                    rbNode(
                                                        "pre",
                                                        original.content,
                                                    ),
                                                );
                                            });
                                        },
                                    ),
                                );
                            }
                        } else if (item.jobId) {
                            const job = await invokeMemory(
                                "memoryGetViewBuild",
                                { corpusId: item.corpusId, jobId: item.jobId },
                            );
                            if (!job)
                                throw new Error(
                                    "Build receipt is unavailable or forgotten",
                                );
                            detail.replaceChildren(
                                rbNode("h5", `Build ${job.jobId}`),
                                rbNode(
                                    "pre",
                                    JSON.stringify(
                                        job.results.filter(
                                            (result) =>
                                                result.viewId === item.viewId,
                                        ),
                                        null,
                                        2,
                                    ),
                                ),
                            );
                        }
                    });
                },
            ),
        );
    }
    root.append(detail);
    return root;
}
