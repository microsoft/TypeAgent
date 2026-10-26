// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    MemoryQuestion,
    InventoryPageRequest,
} from "@typeagent/memory-service";

type Fixture = (method: string, params?: unknown) => unknown | Promise<unknown>;

export function inventoryFixture(legacy: Fixture): Fixture {
    return async (method, params) => {
        if (
            method !== "memoryListQuestionSummaries" &&
            method !== "memoryGetQuestion"
        )
            return legacy(method, params);
        const request = params as InventoryPageRequest & { slotId?: string };
        const inventory = (await legacy("memoryListQuestions", {
            corpusId: request.corpusId,
        })) as { head: string | null; items: MemoryQuestion[] };
        if (method === "memoryGetQuestion")
            return inventory.items.find(
                (item) =>
                    item.viewId === request.viewId &&
                    item.slot.id === request.slotId,
            );
        const offset = Number(request.continuationToken ?? 0);
        const size = request.pageSize ?? 25;
        return {
            ...inventory,
            total: inventory.items.length,
            ...(offset + size < inventory.items.length
                ? { nextContinuationToken: String(offset + size) }
                : {}),
            items: inventory.items
                .slice(offset, offset + size)
                .map(({ slot, details, ...identity }) => ({
                    ...identity,
                    slot: {
                        id: slot.id,
                        question: slot.question,
                        approval: slot.approval,
                        rubric: {
                            requireConfirmation:
                                slot.rubric.requireConfirmation,
                        },
                        discoveryCitationCount: slot.discoveryCitations.length,
                    },
                    details: {
                        answerState: details.answerState,
                        reviewState: details.reviewState,
                        freshness: details.freshness,
                        candidateCount: details.candidates.length,
                        hasUnreviewedCandidates: details.candidates.some(
                            (candidate) => candidate.review === "unreviewed",
                        ),
                    },
                })),
        };
    };
}
