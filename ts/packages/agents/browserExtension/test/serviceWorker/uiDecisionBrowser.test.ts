// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createUiDecisionBrowser } from "../../src/extension/serviceWorker/uiDecisionBrowser";
import type { UiFrameRequest } from "@typeagent/browser-control-rpc/uiDecisionTypes";
import { TextEncoder } from "node:util";

describe("grounded UI document/frame transport", () => {
    const tab = {
        id: 7,
        url: "https://shop.example/",
        status: "complete" as const,
    };
    const frames = [
        { frameId: 0, documentId: "top", url: tab.url },
        { frameId: 4, documentId: "child", url: "https://products.example/" },
    ];
    let active: jest.Mock;
    let calls: { request: UiFrameRequest; documentId: string }[];

    beforeEach(() => {
        jest.clearAllMocks();
        Object.defineProperty(globalThis, "TextEncoder", {
            configurable: true,
            value: TextEncoder,
        });
        let id = 0;
        Object.defineProperty(crypto, "randomUUID", {
            configurable: true,
            value: () => `snapshot-${++id}`,
        });
        Object.defineProperty(chrome, "permissions", {
            configurable: true,
            value: { contains: jest.fn(async () => true) },
        });
        active = jest.fn(async () => tab);
        calls = [];
        (chrome.webNavigation.getAllFrames as jest.Mock).mockResolvedValue(
            frames,
        );
        (chrome.tabs.sendMessage as jest.Mock).mockImplementation(
            async (_tabId, { request }, { documentId }) => {
                calls.push({ request, documentId });
                if (request.method === "capture")
                    return {
                        data: {
                            snapshotId: `local-${documentId}`,
                            url: frames.find(
                                (frame) => frame.documentId === documentId,
                            )!.url,
                            createdAt: Date.now(),
                            complete: true,
                            content: documentId,
                            candidates: [
                                {
                                    id: "c0",
                                    name: "Details",
                                    role: "link",
                                    context: documentId,
                                    disabled: false,
                                    capabilities: ["activate"],
                                },
                            ],
                        },
                    };
                return {
                    data:
                        request.method === "execute"
                            ? { dispatched: true }
                            : {},
                };
            },
        );
    });

    test("capture does not revalidate dynamic evidence; explicit action validation still does", async () => {
        const send = chrome.tabs.sendMessage as jest.Mock;
        const original = send.getMockImplementation()!;
        send.mockImplementation(async (...args) => {
            const response = await original(...args);
            return args[1].request.method === "validate"
                ? { error: "stale: dynamic content changed" }
                : response;
        });
        const browser = createUiDecisionBrowser(active);
        const observation = await browser.captureUiObservation();
        expect(calls.every((call) => call.request.method === "capture")).toBe(
            true,
        );
        await expect(
            browser.validateUiObservation(observation.snapshotId),
        ).rejects.toThrow("stale");
    });

    test("merges frame evidence and executes only in the selected trusted document", async () => {
        const browser = createUiDecisionBrowser(active);
        const observation = await browser.captureUiObservation();
        expect(observation.candidates.map((item) => item.id)).toEqual([
            "f0_c0",
            "f1_c0",
        ]);
        await browser.executeUiAction(observation.snapshotId, "f1_c0", {
            type: "activate",
        });
        expect(
            calls.filter((call) => call.request.method === "execute"),
        ).toEqual([
            {
                documentId: "child",
                request: {
                    method: "execute",
                    snapshotId: "local-child",
                    candidateId: "c0",
                    action: { type: "activate" },
                },
            },
        ]);
        await expect(
            browser.executeUiAction(observation.snapshotId, "f1_c0", {
                type: "activate",
            }),
        ).rejects.toThrow("stale");
    });

    test.each(["tab", "document", "removed-frame", "validation"])(
        "rejects %s changes without dispatch",
        async (change) => {
            const browser = createUiDecisionBrowser(active);
            const observation = await browser.captureUiObservation();
            if (change === "tab") active.mockResolvedValue({ ...tab, id: 9 });
            if (change === "document")
                (
                    chrome.webNavigation.getAllFrames as jest.Mock
                ).mockResolvedValue([
                    { ...frames[0], documentId: "replacement" },
                    frames[1],
                ]);
            if (change === "removed-frame")
                (
                    chrome.webNavigation.getAllFrames as jest.Mock
                ).mockResolvedValue([frames[0]]);
            if (change === "validation")
                (chrome.tabs.sendMessage as jest.Mock).mockResolvedValue({
                    error: "stale: changed",
                });
            await expect(
                browser.executeUiAction(observation.snapshotId, "f1_c0", {
                    type: "activate",
                }),
            ).rejects.toThrow("stale");
            expect(
                calls.filter((call) => call.request.method === "execute"),
            ).toHaveLength(0);
        },
    );

    test("rejects inaccessible frames and incognito instead of claiming a complete observation", async () => {
        const browser = createUiDecisionBrowser(active);
        (chrome.permissions.contains as jest.Mock).mockResolvedValue(false);
        await expect(browser.captureUiObservation()).rejects.toThrow(
            "inaccessible",
        );
        expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
        active.mockResolvedValue({ ...tab, incognito: true });
        await expect(browser.captureUiObservation()).rejects.toThrow(
            "unavailable",
        );
    });

    test("strict default rejects opaque frames while explicit main-document scope excludes all child evidence", async () => {
        const inventory = [
            ...frames,
            { frameId: 8, documentId: "blank", url: "about:blank" },
        ];
        (chrome.webNavigation.getAllFrames as jest.Mock).mockResolvedValue(
            inventory,
        );
        const browser = createUiDecisionBrowser(active);
        await expect(browser.captureUiObservation()).rejects.toThrow(
            "inaccessible",
        );
        const observation = await browser.captureUiObservation("main-document");
        expect(observation.frameScope).toBe("main-document");
        expect(observation.candidates.map((candidate) => candidate.id)).toEqual(
            ["f0_c0"],
        );
        expect(observation.content).not.toContain("child");
        (chrome.webNavigation.getAllFrames as jest.Mock).mockResolvedValue([
            frames[0],
            { ...inventory[1], documentId: "replaced-child" },
        ]);
        await browser.executeUiAction(observation.snapshotId, "f0_c0", {
            type: "activate",
        });
        expect(calls.every((call) => call.documentId === "top")).toBe(true);
    });

    test("main-document scope still rejects missing identity, denied permission and main document replacement", async () => {
        const browser = createUiDecisionBrowser(active);
        const observation = await browser.captureUiObservation("main-document");
        (chrome.webNavigation.getAllFrames as jest.Mock).mockResolvedValue([
            { ...frames[0], documentId: "new-top" },
            frames[1],
        ]);
        await expect(
            browser.executeUiAction(observation.snapshotId, "f0_c0", {
                type: "activate",
            }),
        ).rejects.toThrow("stale");
        (chrome.permissions.contains as jest.Mock).mockResolvedValue(false);
        await expect(
            browser.captureUiObservation("main-document"),
        ).rejects.toThrow("inaccessible");
        (chrome.webNavigation.getAllFrames as jest.Mock).mockResolvedValue([
            frames[1],
        ]);
        await expect(
            browser.captureUiObservation("main-document"),
        ).rejects.toThrow("incomplete");
        expect(
            calls.filter((call) => call.request.method === "execute"),
        ).toHaveLength(0);
    });

    test("rejects unknown scope without capturing and retains the strict participating-frame bound", async () => {
        const browser = createUiDecisionBrowser(active);
        await expect(
            Reflect.apply(browser.captureUiObservation, browser, ["website"]),
        ).rejects.toThrow("frame scope");
        expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
        (chrome.webNavigation.getAllFrames as jest.Mock).mockResolvedValue([
            frames[0],
            ...Array.from({ length: 16 }, (_, index) => ({
                ...frames[1],
                frameId: index + 1,
            })),
        ]);
        await expect(browser.captureUiObservation()).rejects.toThrow(
            "incomplete",
        );
        expect(
            (await browser.captureUiObservation("main-document")).frameScope,
        ).toBe("main-document");
    });

    test("main-document scope permits ready main UI while subframes load but never permits pending main navigation", async () => {
        active.mockResolvedValue({ ...tab, status: "loading" });
        const browser = createUiDecisionBrowser(active);
        await expect(browser.captureUiObservation()).rejects.toThrow(
            "unavailable",
        );
        const observation = await browser.captureUiObservation("main-document");
        await browser.validateUiObservation(observation.snapshotId);
        active.mockResolvedValue({
            ...tab,
            status: "loading",
            pendingUrl: "https://shop.example/next",
        });
        await expect(
            browser.executeUiAction(observation.snapshotId, "f0_c0", {
                type: "activate",
            }),
        ).rejects.toThrow("stale");
        await expect(
            browser.captureUiObservation("main-document"),
        ).rejects.toThrow("unavailable");
        expect(
            calls.filter((call) => call.request.method === "execute"),
        ).toHaveLength(0);
    });

    test("a timed-out or failed action is consumed and never automatically retried", async () => {
        const browser = createUiDecisionBrowser(active);
        const observation = await browser.captureUiObservation();
        (chrome.tabs.sendMessage as jest.Mock).mockImplementation(
            async (_tabId, { request }) => {
                if (request.method === "execute")
                    throw new Error("network failure after click");
                return { data: {} };
            },
        );
        await expect(
            browser.executeUiAction(observation.snapshotId, "f1_c0", {
                type: "activate",
            }),
        ).rejects.toThrow("network failure");
        await expect(
            browser.executeUiAction(observation.snapshotId, "f1_c0", {
                type: "activate",
            }),
        ).rejects.toThrow("stale");
    });

    test("concurrent calls cannot dispatch the same observation twice", async () => {
        const browser = createUiDecisionBrowser(active);
        const observation = await browser.captureUiObservation();
        const results = await Promise.allSettled([
            browser.executeUiAction(observation.snapshotId, "f1_c0", {
                type: "activate",
            }),
            browser.executeUiAction(observation.snapshotId, "f1_c0", {
                type: "activate",
            }),
        ]);
        expect(
            results.filter((result) => result.status === "fulfilled"),
        ).toHaveLength(1);
        expect(
            calls.filter((call) => call.request.method === "execute"),
        ).toHaveLength(1);
    });
});
