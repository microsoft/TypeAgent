// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { MemoryAcquisitionProgress } from "@typeagent/browser-control-rpc/serviceTypes";
import { mountMemoryHubAcquisitions } from "./memoryHubAcquisitions";
import { invokeMemory } from "./viewClient";

jest.mock("./viewClient", () => ({ invokeMemory: jest.fn() }));
const invoke = invokeMemory as jest.Mock;
const corpus = { corpusId: "corpus", name: "Corpus" };
function request(
    state: MemoryAcquisitionProgress["state"],
): MemoryAcquisitionProgress {
    return {
        corpusId: "corpus",
        requestId: state,
        sourceId: "source",
        state,
        createdAt: "2026-10-22",
        updatedAt: "2026-10-23",
        calls: 1,
        retries: 0,
        consumers: [
            {
                viewId: "view",
                slotId: "name",
                definitionRevision: "definition",
            },
        ],
        hasError: state === "failed",
    };
}
async function settle() {
    for (let index = 0; index < 30; index++) await Promise.resolve();
}
function setup() {
    document.body.innerHTML = "<main></main>";
    window.confirm = jest.fn(() => true);
    return mountMemoryHubAcquisitions(document.querySelector("main")!);
}
beforeEach(() => invoke.mockReset());

test("all lifecycle states remain visible without staged content, authorized arguments or raw errors", async () => {
    const requests = (
        [
            "pending",
            "deferred",
            "fetching",
            "acquired",
            "ingesting",
            "ingested",
            "resolved",
            "cancelled",
            "failed",
        ] as const
    ).map((state) => ({
        ...request(state),
        authorizedArguments: { query: "PRIVATE-ARGUMENT" },
        staged: { content: "PRIVATE-CONTENT" },
        error: "PRIVATE-ERROR",
    }));
    invoke.mockResolvedValue(requests);
    const panel = setup();
    await panel.refresh([corpus]);
    for (const item of requests)
        expect(document.body.textContent).toContain(
            `${item.requestId} · ${item.state}`,
        );
    for (const sensitive of [
        "PRIVATE-ARGUMENT",
        "PRIVATE-CONTENT",
        "PRIVATE-ERROR",
    ])
        expect(document.body.textContent).not.toContain(sensitive);
    expect(
        document.querySelectorAll("button[data-terminal=true]:disabled"),
    ).toHaveLength(2);
    expect(document.body.textContent).toContain("requests");
});

test("manual run and cancellation are explicit and send only corpus/request identity", async () => {
    invoke.mockImplementation(async (method: string) =>
        method === "memoryListAcquisitions" ? [request("pending")] : [],
    );
    const panel = setup();
    await panel.refresh([corpus]);
    expect(invoke.mock.calls).toEqual([
        ["memoryListAcquisitions", { corpusId: "corpus" }],
    ]);
    document.querySelector<HTMLButtonElement>("button")!.click();
    await settle();
    expect(invoke).toHaveBeenCalledWith("memoryRunAcquisitions", {
        corpusId: "corpus",
    });
    [...document.querySelectorAll("button")]
        .find((button) => button.textContent === "Cancel acquisition")!
        .click();
    await settle();
    expect(invoke).toHaveBeenCalledWith("memoryCancelAcquisition", {
        corpusId: "corpus",
        requestId: "pending",
    });
    expect(window.confirm).toHaveBeenCalledTimes(2);
    expect(
        invoke.mock.calls.some(([method]) =>
            /RequestAcquisition|Periodic/.test(method),
        ),
    ).toBe(false);
});

test("disabled and unavailable hosts are explicit; operational errors never echo arguments", async () => {
    const panel = setup();
    invoke.mockRejectedValueOnce(new Error("Unsupported host PRIVATE"));
    await panel.refresh([corpus]);
    expect(document.body.textContent).toContain("capability is unavailable");
    expect(document.body.textContent).not.toContain("PRIVATE");
    invoke.mockRejectedValueOnce(new Error("Disabled host PRIVATE"));
    await panel.refresh([corpus]);
    expect(document.body.textContent).toContain("disabled by host policy");
    invoke.mockImplementation(async (method: string) => {
        if (method === "memoryListAcquisitions") return [request("pending")];
        throw new Error("PRIVATE-AUTHORIZED-ARGUMENTS");
    });
    await panel.refresh([corpus]);
    document.querySelector<HTMLButtonElement>("button")!.click();
    await settle();
    expect(document.body.textContent).toContain("operation failed");
    expect(document.body.textContent).not.toContain("PRIVATE");
});

test("view filtering and ingestion links preserve shared request consumer and receipt identities", async () => {
    invoke.mockResolvedValue([
        {
            ...request("ingesting"),
            receipt: { jobId: "job/1", revisionId: "r1", state: "indexing" },
        },
    ]);
    const panel = setup();
    await panel.refresh([corpus], "other-view");
    expect(document.querySelectorAll("article")).toHaveLength(0);
    await panel.refresh([corpus], "view");
    expect(
        document.querySelector('a[href="#/activity/corpus/job%2F1"]'),
    ).not.toBeNull();
    expect(
        document.querySelector('a[href="#/questions/corpus/view"]'),
    ).not.toBeNull();
    expect(
        document.querySelector('a[href="#/library/corpus/source"]'),
    ).not.toBeNull();
});
