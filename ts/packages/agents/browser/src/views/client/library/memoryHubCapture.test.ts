// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mountMemoryHubCapture } from "./memoryHubCapture";
import { invokeView } from "./viewClient";

jest.mock("./viewClient", () => ({ invokeView: jest.fn() }));
const invoke = invokeView as jest.Mock;
const page = {
    pageId: "tab:1",
    title: "<img src=x onerror=alert(1)>",
    url: "https://example.invalid/guide",
};
let panel: ReturnType<typeof mountMemoryHubCapture>;
let complete: jest.Mock;
let error: jest.Mock;

async function settle() {
    for (let i = 0; i < 20; i++) await Promise.resolve();
}
function button(selector: string) {
    return document.querySelector<HTMLButtonElement>(selector)!;
}
function choose() {
    const selector = document.querySelector<HTMLSelectElement>("select")!;
    selector.value = page.pageId;
    selector.dispatchEvent(new Event("change"));
}
beforeEach(() => {
    document.body.innerHTML = "<div id='host'></div>";
    HTMLDialogElement.prototype.showModal = function () {
        this.open = true;
    };
    HTMLDialogElement.prototype.close = function () {
        this.open = false;
        this.dispatchEvent(new Event("close"));
    };
    invoke.mockReset();
    invoke.mockImplementation(async (method) =>
        method === "memoryHubCapturePages"
            ? { pages: [page] }
            : { corpusId: "browser", sourceId: "saved", warnings: [] },
    );
    complete = jest.fn(async () => {});
    error = jest.fn();
    panel = mountMemoryHubCapture(document.getElementById("host")!, {
        onComplete: complete,
        onError: error,
    });
});
afterEach(() => {
    panel.dispose();
    document.body.innerHTML = "";
});

test("explicit page selection binds ID and reviewed URL without rendering HTML titles", async () => {
    panel.open();
    await settle();
    expect(button("[data-capture]").disabled).toBe(true);
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("dialog")!.textContent).toContain(page.title);
    choose();
    expect(document.querySelector("[data-target]")!.textContent).toBe(page.url);
    button("[data-capture]").click();
    await settle();
    expect(invoke).toHaveBeenCalledWith("memoryHubCapturePage", {
        pageId: page.pageId,
        expectedUrl: page.url,
    });
    expect(complete).toHaveBeenCalledWith({
        corpusId: "browser",
        sourceId: "saved",
        warnings: [],
    });
    expect(document.querySelector<HTMLDialogElement>("dialog")!.open).toBe(
        false,
    );
});

test("unavailable providers and empty lists leave capture disabled with actionable status", async () => {
    invoke.mockRejectedValueOnce(
        new Error("Explicit-page capture unsupported"),
    );
    panel.open();
    await settle();
    expect(document.querySelector('[role="status"]')!.textContent).toContain(
        "capture unsupported",
    );
    expect(button("[data-capture]").disabled).toBe(true);
    expect(error).toHaveBeenCalledTimes(1);
    invoke.mockResolvedValueOnce({ pages: [] });
    button("[data-refresh]").click();
    await settle();
    expect(document.querySelector('[role="status"]')!.textContent).toContain(
        "No eligible pages",
    );
    expect(button("[data-capture]").disabled).toBe(true);
});

test("capture cannot double-submit or claim cancellation while running", async () => {
    let finish!: (value: unknown) => void;
    panel.open();
    await settle();
    choose();
    invoke.mockImplementationOnce(
        () =>
            new Promise((resolve) => {
                finish = resolve;
            }),
    );
    button("[data-capture]").click();
    button("[data-capture]").click();
    expect(button("[data-close]").disabled).toBe(true);
    const cancel = new Event("cancel", { cancelable: true });
    document.querySelector("dialog")!.dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(
        invoke.mock.calls.filter(
            ([method]) => method === "memoryHubCapturePage",
        ),
    ).toHaveLength(1);
    finish({
        corpusId: "browser",
        sourceId: "saved",
        warnings: ["Frames omitted"],
    });
    await settle();
    expect(complete).toHaveBeenCalledTimes(1);
});

test("failed capture keeps target reviewable and reports no completion", async () => {
    panel.open();
    await settle();
    choose();
    invoke.mockRejectedValueOnce(new Error("Selected page changed"));
    button("[data-capture]").click();
    await settle();
    expect(document.querySelector('[role="status"]')!.textContent).toContain(
        "Capture failed: Selected page changed",
    );
    expect(complete).not.toHaveBeenCalled();
    expect(button("[data-refresh]").disabled).toBe(false);
    expect(error).toHaveBeenCalledTimes(1);
});

test("closed and disposed pickers ignore late listing responses", async () => {
    let finish!: (value: unknown) => void;
    invoke.mockImplementationOnce(
        () =>
            new Promise((resolve) => {
                finish = resolve;
            }),
    );
    panel.open();
    button("[data-close]").click();
    finish({ pages: [page] });
    await settle();
    expect(document.querySelectorAll("option")).toHaveLength(1);
    invoke.mockImplementationOnce(
        () =>
            new Promise((resolve) => {
                finish = resolve;
            }),
    );
    panel.open();
    panel.dispose();
    finish({ pages: [page] });
    await settle();
    expect(document.querySelector("dialog")).toBeNull();
    expect(complete).not.toHaveBeenCalled();
});
