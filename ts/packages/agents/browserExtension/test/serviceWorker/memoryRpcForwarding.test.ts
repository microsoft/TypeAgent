// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { AllServiceWorkerInvokeFunctions } from "@typeagent/browser-control-rpc/serviceTypes";
import { createAllHandlers } from "../../src/extension/serviceWorker/serviceWorkerRpcHandlers";
import { sendActionToAgent } from "../../src/extension/serviceWorker/websocket";

jest.mock("../../src/extension/serviceWorker/tabManager", () => ({}));
jest.mock("../../src/extension/serviceWorker/storage", () => ({}));
jest.mock("../../src/extension/serviceWorker/websocket", () => ({
    sendActionToAgent: jest.fn(),
}));
jest.mock(
    "../../src/extension/serviceWorker/screenshotCoordinator",
    () => ({}),
);
jest.mock(
    "../../src/extension/serviceWorker/browserViewNavigation",
    () => ({}),
);
jest.mock("../../src/extension/serviceWorker/dispatcherConnection", () => ({}));
jest.mock("../../src/extension/serviceWorker/recording", () => ({}));
jest.mock("../../src/extension/serviceWorker/messageHandlers", () => ({}));
jest.mock("../../src/extension/serviceWorker/crosswordDecisionRpc", () => ({}));
jest.mock("@typeagent/dispatcher-types", () => ({}));

const send = jest.mocked(sendActionToAgent);
type ResolveRequest = Parameters<
    AllServiceWorkerInvokeFunctions["memoryResolveWikiAmbiguityReview"]
>[0];

beforeEach(() => {
    jest.resetAllMocks();
});

test("ambiguity list forwards corpus identity and returns the unchanged review feed", async () => {
    const params: Parameters<
        AllServiceWorkerInvokeFunctions["memoryListWikiAmbiguityReviews"]
    >[0] = { corpusId: "corpus" };
    const reviews = [
        { id: "review", state: "needsReview", reason: "Identity uncertain" },
    ];
    send.mockResolvedValue(reviews);
    await expect(
        createAllHandlers().memoryListWikiAmbiguityReviews(params),
    ).resolves.toBe(reviews);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
        actionName: "memoryListWikiAmbiguityReviews",
        parameters: params,
    });
});

test.each(["keep_separate", "approve", "edit"] as const)(
    "ambiguity %s forwards typed version-guarded action and complete edited forms without rewriting",
    async (action) => {
        const params: ResolveRequest = {
            corpusId: "corpus",
            reviewId: "review",
            expectedVersion: 7,
            action,
            ...(action === "edit"
                ? {
                      resolution: {
                          status: "resolved",
                          reason: "Human edited complete grouping",
                          groups: [
                              {
                                  action: "combine",
                                  ids: ["candidate", "existing"],
                                  survivorId: "existing",
                                  combined: JSON.stringify({
                                      content: {
                                          title: "Complete combined form",
                                          body: "Original [f0] and literal `[f42]`",
                                      },
                                  }),
                                  sections: [
                                      {
                                          id: "candidate",
                                          sectionId: "section",
                                          combinedSectionId: "combined-section",
                                      },
                                  ],
                              },
                          ],
                      },
                  }
                : {}),
        };
        const review = {
            id: "review",
            state: "needsReview",
            reason: "Verification still uncertain",
        };
        send.mockResolvedValue(review);
        await expect(
            createAllHandlers().memoryResolveWikiAmbiguityReview(params),
        ).resolves.toBe(review);
        expect(send).toHaveBeenCalledTimes(1);
        expect(send).toHaveBeenCalledWith({
            actionName: "memoryResolveWikiAmbiguityReview",
            parameters: params,
        });
        expect(send.mock.calls[0][0].parameters).toBe(params);
    },
);

test.each(["list", "resolve"] as const)(
    "ambiguity %s preserves rejected RPC errors instead of substituting success or empty data",
    async (method) => {
        const error = new Error(
            "Review version conflict or dispatcher unavailable",
        );
        send.mockRejectedValue(error);
        const handlers = createAllHandlers();
        const result =
            method === "list"
                ? handlers.memoryListWikiAmbiguityReviews({
                      corpusId: "corpus",
                  })
                : handlers.memoryResolveWikiAmbiguityReview({
                      corpusId: "corpus",
                      reviewId: "review",
                      expectedVersion: 7,
                      action: "approve",
                  });
        await expect(result).rejects.toBe(error);
        expect(send).toHaveBeenCalledTimes(1);
    },
);

test("explicit agent error payload is not hidden by the ambiguity forwarder", async () => {
    const error = { error: "Source authorization revoked" };
    send.mockResolvedValue(error);
    await expect(
        createAllHandlers().memoryListWikiAmbiguityReviews({
            corpusId: "corpus",
        }),
    ).resolves.toBe(error);
});
