// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { MemoryHubChangeReceipt } from "@typeagent/browser-control-rpc/viewRpc";
import { mountMemoryHubChanges } from "./memoryHubChanges";
import { invokeView } from "./viewClient";

jest.mock("./memoryHubPhase2.css", () => ({}));
jest.mock("./viewClient", () => ({ invokeView: jest.fn() }));
const invoke = invokeView as jest.Mock;
let host: HTMLElement;
let mounted: ReturnType<typeof mountMemoryHubChanges>;
let scope: string | undefined;
let onError: jest.Mock;
const receipt: MemoryHubChangeReceipt = {
    changeId: "change-opaque",
    corpusId: "a",
    operation: "replace",
    createdAt: "2026-10-02T10:00:00Z",
    outcome: "committed",
    sourceId: "source-hash",
    previousRevisionId: "old-hash",
    revisionId: "new-hash",
    counts: { sources: 1, revisions: 1, knowledge: 8 },
};
function button(label: string): HTMLButtonElement {
    return Array.from(host.querySelectorAll("button")).find(
        (value) => value.textContent === label,
    )!;
}
async function settle() {
    for (let index = 0; index < 20; index++) await Promise.resolve();
}
beforeEach(() => {
    invoke.mockReset();
    scope = "a";
    onError = jest.fn();
    host = document.createElement("div");
    document.body.append(host);
    mounted = mountMemoryHubChanges(host, { scope: () => scope, onError });
});
afterEach(() => {
    mounted.dispose();
    host.remove();
});

test("committed receipts display metadata only and opaque references never become navigation", async () => {
    invoke.mockResolvedValueOnce({
        items: [
            {
                ...receipt,
                content: "PRIVATE SOURCE",
                confirmationToken: "SECRET TOKEN",
            },
        ],
        total: 1,
        errors: [],
    });
    await mounted.refresh();
    expect(invoke).toHaveBeenCalledWith("memoryHubChanges", {
        corpusId: "a",
        pageSize: 25,
        continuationToken: undefined,
    });
    expect(host.textContent).toContain("replace · committed");
    expect(host.textContent).toContain("90 days");
    expect(host.textContent).toContain("domain-hashed opaque references");
    expect(host.querySelectorAll("a")).toHaveLength(0);
    expect(host.textContent).not.toContain("PRIVATE SOURCE");
    expect(host.textContent).not.toContain("SECRET TOKEN");
    expect(host.textContent).not.toContain("source-hash");
});

test("paging carries continuation tokens and refresh resets to first page", async () => {
    invoke.mockResolvedValueOnce({
        items: [receipt],
        total: 26,
        nextContinuationToken: "next",
        errors: [],
    });
    await mounted.refresh();
    expect(button("Next changes").disabled).toBe(false);
    invoke.mockResolvedValueOnce({
        items: [{ ...receipt, operation: "forget" }],
        total: 26,
        errors: [],
    });
    button("Next changes").click();
    await settle();
    expect(invoke).toHaveBeenLastCalledWith("memoryHubChanges", {
        corpusId: "a",
        pageSize: 25,
        continuationToken: "next",
    });
    expect(host.querySelector(".phase2-status")!.textContent).toContain(
        "Page 2",
    );
    invoke.mockResolvedValueOnce({
        items: [receipt],
        total: 26,
        nextContinuationToken: "next",
        errors: [],
    });
    button("Previous changes").click();
    await settle();
    expect(invoke).toHaveBeenLastCalledWith(
        "memoryHubChanges",
        expect.objectContaining({ continuationToken: undefined }),
    );
    invoke.mockResolvedValueOnce({ items: [], total: 0, errors: [] });
    await mounted.refresh();
    expect(button("Previous changes").disabled).toBe(true);
    expect(host.textContent).toContain("No committed changes");
});

test("healthy empty history differs from partial history and unavailable services", async () => {
    invoke.mockResolvedValueOnce({
        items: [],
        total: 0,
        errors: [
            { corpusId: "b", operation: "changes", message: "not supported" },
        ],
    });
    await mounted.refresh();
    expect(host.textContent).toContain("not a successful empty history");
    expect(host.querySelector(".phase2-warning")!.textContent).toContain(
        "not supported",
    );
    invoke.mockRejectedValueOnce(new Error("offline"));
    await mounted.refresh();
    expect(host.querySelector(".phase2-status")!.textContent).toContain(
        "Change history unavailable: offline",
    );
    expect(onError).toHaveBeenCalled();
});

test("changed scope rejects stale receipts and starts new paging at the first page", async () => {
    let resolveOld!: (value: unknown) => void;
    invoke.mockImplementationOnce(
        () =>
            new Promise((resolve) => {
                resolveOld = resolve;
            }),
    );
    const old = mounted.refresh();
    scope = "b";
    invoke.mockResolvedValueOnce({ items: [], total: 0, errors: [] });
    await mounted.refresh();
    resolveOld({ items: [receipt], total: 1, errors: [] });
    await old;
    expect(invoke).toHaveBeenLastCalledWith("memoryHubChanges", {
        corpusId: "b",
        pageSize: 25,
        continuationToken: undefined,
    });
    expect(host.querySelectorAll("article")).toHaveLength(0);
    expect(host.textContent).toContain("No committed changes");
});

test("dispose ignores later completion and removes the module", async () => {
    let resolve!: (value: unknown) => void;
    invoke.mockImplementationOnce(
        () =>
            new Promise((done) => {
                resolve = done;
            }),
    );
    const pending = mounted.refresh();
    mounted.dispose();
    resolve({ items: [receipt], total: 1, errors: [] });
    await pending;
    expect(host.children).toHaveLength(0);
});
