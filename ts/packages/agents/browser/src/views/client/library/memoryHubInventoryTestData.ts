// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    MemoryQuestion,
    ViewVersion,
    ViewBuildJob,
    InventoryPageRequest,
} from "@typeagent/memory-service";

type Fixture = (method: string, params?: unknown) => unknown | Promise<unknown>;
function page<T>(items: T[], request: InventoryPageRequest) {
    const offset = Number(request.continuationToken ?? 0);
    const size = request.pageSize ?? 25;
    return {
        items: items.slice(offset, offset + size),
        total: items.length,
        ...(offset + size < items.length
            ? { nextContinuationToken: String(offset + size) }
            : {}),
    };
}

// Existing detailed fixtures also supply the independent list/detail contracts.
export function inventoryFixture(legacy: Fixture): Fixture {
    const details = new Map<string, ViewVersion>();
    return async (method, params) => {
        const request = params as InventoryPageRequest;
        const corpus = { corpusId: request?.corpusId };
        if (method === "memoryListViewSummaries") {
            const snapshot = (await legacy("memoryListViews", corpus)) as {
                head: string | null;
                views: ViewVersion[];
            };
            for (const view of snapshot.views)
                details.set(JSON.stringify([view.corpusId, view.viewId]), view);
            const items = await Promise.all(
                snapshot.views.map(async (view) => ({
                    corpusId: view.corpusId,
                    viewId: view.viewId,
                    revisionId: view.revisionId,
                    state: view.state,
                    content: {
                        kind: view.content.kind,
                        title: view.content.title,
                    },
                    maintained: !!view.definition?.maintenance,
                    publication: await legacy("memoryGetViewPublication", {
                        ...corpus,
                        viewId: view.viewId,
                    }),
                })),
            );
            const jobs = (await legacy(
                "memoryListViewBuilds",
                corpus,
            )) as ViewBuildJob[];
            const latestBuild = jobs.filter(
                (job) =>
                    !request.viewId ||
                    job.results.some(
                        (result) => result.viewId === request.viewId,
                    ),
            )[0];
            return {
                ...snapshot,
                views: undefined,
                ...page(
                    items.filter(
                        (item) =>
                            !request.viewId || item.viewId === request.viewId,
                    ),
                    request,
                ),
                ...(latestBuild
                    ? {
                          latestBuild: {
                              corpusId: latestBuild.corpusId,
                              jobId: latestBuild.jobId,
                              state: latestBuild.state,
                          },
                      }
                    : {}),
            };
        }
        if (
            method === "memoryGetView" &&
            !(params as { revisionId?: string }).revisionId
        ) {
            const request = params as { corpusId: string; viewId: string };
            const detail = details.get(
                JSON.stringify([request.corpusId, request.viewId]),
            );
            if (detail) return detail;
        }
        if (method === "memoryGetViewPublications")
            return Promise.all(
                (params as { viewIds: string[] }).viewIds.map((viewId) =>
                    legacy("memoryGetViewPublication", { ...corpus, viewId }),
                ),
            );
        if (method === "memoryListViewBuildSummaries") {
            const jobs = (await legacy(
                "memoryListViewBuilds",
                corpus,
            )) as ViewBuildJob[];
            return page(
                jobs
                    .filter(
                        (job) =>
                            !request.viewId ||
                            job.results.some(
                                (result) => result.viewId === request.viewId,
                            ),
                    )
                    .map((job) => ({
                        jobId: job.jobId,
                        corpusId: job.corpusId,
                        state: job.state,
                        createdAt: job.createdAt,
                        updatedAt: job.updatedAt,
                        maintenance: !!job.maintenancePlan,
                        results: job.results.map((result) => ({
                            viewId: result.viewId,
                            state: result.state,
                            reason: result.reason,
                            current: true,
                            revisionId: result.revisionId,
                            conflictId: result.conflictId,
                            snapshot: {
                                pipeline: result.snapshot.pipeline,
                                definition: {
                                    kind:
                                        result.snapshot.definition?.kind ??
                                        "troubleshootingGuide",
                                },
                            },
                        })),
                    })),
                request,
            );
        }
        if (
            method === "memoryListQuestionSummaries" ||
            method === "memoryGetQuestion"
        ) {
            const inventory = (await legacy("memoryListQuestions", corpus)) as {
                head: string | null;
                items: MemoryQuestion[];
            };
            if (method === "memoryGetQuestion") {
                const target = params as { viewId: string; slotId: string };
                return inventory.items.find(
                    (item) =>
                        item.viewId === target.viewId &&
                        item.slot.id === target.slotId,
                );
            }
            return {
                ...inventory,
                ...page(
                    inventory.items.map(({ slot, details, ...identity }) => ({
                        ...identity,
                        slot: {
                            id: slot.id,
                            question: slot.question,
                            approval: slot.approval,
                            rubric: {
                                requireConfirmation:
                                    slot.rubric.requireConfirmation,
                            },
                            admission: slot.admission && {
                                actor: slot.admission.actor,
                            },
                            discoveryCitationCount:
                                slot.discoveryCitations.length,
                        },
                        details: {
                            answerState: details.answerState,
                            reviewState: details.reviewState,
                            freshness: details.freshness,
                            candidateCount: details.candidates.length,
                            hasUnreviewedCandidates: details.candidates.some(
                                (candidate) =>
                                    candidate.review === "unreviewed",
                            ),
                        },
                    })),
                    request,
                ),
            };
        }
        return legacy(method, params);
    };
}
