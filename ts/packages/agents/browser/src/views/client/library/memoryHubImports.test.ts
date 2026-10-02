// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mountMemoryHubImports } from "./memoryHubImports";
import {
    checkViewHealth,
    connectViewEvents,
    invokeView,
    onViewEvent,
} from "./viewClient";
import type { ImportResult } from "./importTypes/websiteImport.types";

jest.mock("./memoryHubImports.css", () => ({}));
jest.mock("./viewClient", () => ({
    checkViewHealth: jest.fn(),
    connectViewEvents: jest.fn(),

function input(name: string): HTMLInputElement {
    return host.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
}

function setValue(name: string, value: string): void {
    input(name).value = value;
    input(name).dispatchEvent(new Event("change"));
}

function submit(): void {
    host.querySelector("form")!.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
    );
}

async function settle(): Promise<void> {
    for (let index = 0; index < 20; index++) await Promise.resolve();
}

function pendingResult(): (value: ImportResult) => void {
    let finish!: (value: ImportResult) => void;
    invoke.mockImplementation(
        () =>
            new Promise<ImportResult>((resolve) => {
                finish = resolve;
            }),
    );
    return (value) => finish(value);
}

beforeEach(() => {
    jest.clearAllMocks();
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.append(host);
    HTMLDialogElement.prototype.showModal = function () {
        this.open = true;
    };
    HTMLDialogElement.prototype.close = function () {
        this.open = false;
    };
    health.mockResolvedValue(true);
    connect.mockResolvedValue();
    invoke.mockResolvedValue(result);
    unsubscribe = jest.fn();
    subscribe.mockImplementation((_name, callback) => {
        progressListener = callback;
        return unsubscribe;
    });
    onError = jest.fn();
    onComplete = jest.fn().mockResolvedValue(undefined);
    consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    mounted = mountMemoryHubImports(host, {
        targetLabel: "Browser memories <not markup>",
        onError,
        onComplete,
    });
});

afterEach(() => {
    mounted.dispose();
    consoleError.mockRestore();
});

test("shows the fixed target, warning and unavailable cancellation without a cancel control", () => {
    mounted.openBrowserImport();
    expect(host.textContent).toContain(
        "Import target: Browser memories <not markup>",
    );
    expect(host.textContent).toContain(
        "corpus selector does not change that target",
    );
    expect(host.textContent).toContain("Cancellation unavailable");
    expect(host.textContent).toContain("Closing this dialog does not cancel");
    expect(
        Array.from(host.querySelectorAll("button"))
            .filter((button) => !button.hidden)
            .map((button) => button.textContent),
    ).toEqual(["Start import", "Close dialog"]);
    expect(host.querySelector("not")).toBeNull();
});

test("jobs navigation is explicitly browser-corpus scoped and does not submit or cancel an import", () => {
    mounted.dispose();
    const onOpenJobs = jest.fn();
    mounted = mountMemoryHubImports(host, {
        targetLabel: "Browser corpus",
        onError,
        onComplete,
        onOpenJobs,
    });
    mounted.openBrowserImport();
    expect(host.textContent).toContain("not an import-specific job");
    host.querySelector<HTMLButtonElement>('[name="jobs"]')!.click();
    expect(onOpenJobs).toHaveBeenCalledTimes(1);
    expect(host.querySelector<HTMLDialogElement>("dialog")!.open).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
});

test("retains typed browser options, subscribes before invocation, and renders actual stages and final results", async () => {
    const finish = pendingResult();
    mounted.openBrowserImport();
    setValue("source", "edge");
    setValue("type", "history");
    setValue("days", "14");
    setValue("browserLimit", "22");
    setValue("concurrent", "3");
    setValue("timeout", "12");
    submit();
    await settle();
    expect(subscribe.mock.invocationCallOrder[0]).toBeLessThan(
        invoke.mock.invocationCallOrder[0],
    );
    expect(connect.mock.invocationCallOrder[0]).toBeLessThan(
        invoke.mock.invocationCallOrder[0],
    );
    expect(invoke).toHaveBeenCalledWith(
        "importWebsiteDataWithProgress",
        expect.objectContaining({
            source: "edge",
            type: "history",
            days: 14,
            limit: 22,
            maxConcurrent: 3,
            contentTimeout: 12000,
            mode: "content",
        }),
    );
    const parameters = invoke.mock.calls[0][1] as { importId: string };
    progressListener({
        importId: parameters.importId,
        phase: "extracting",
        current: 2,
        total: 5,
        description: "Example page",
        itemDetails: {
            currentAction: "Extracting knowledge",
            url: "https://example.org",
        },
    });
    expect(host.textContent).toContain("Stage: extracting");
    expect(host.textContent).toContain("Items processed: 2 / 5");
    expect(host.textContent).toContain("Example page");
    progressListener({
        importId: parameters.importId,
        phase: "complete",
        current: 5,
        total: 5,
        description: "",
    });
    expect(onComplete).not.toHaveBeenCalled();
    finish(result);
    await settle();
    expect(host.textContent).toContain("Import completed.");
    expect(host.textContent).toContain("Processed: 5; imported: 4");
    expect(host.textContent).toContain(
        "Knowledge: 3; entities: 2; topics: 1; actions: 0",
    );
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
});

test("sends bookmark folder only for bookmarks", async () => {
    mounted.openBrowserImport();
    setValue("bookmarkFolder", " Research ");
    submit();
    await settle();
    expect(invoke).toHaveBeenCalledWith(
        "importWebsiteDataWithProgress",
        expect.objectContaining({
            type: "bookmarks",
            folder: "Research",
            days: undefined,
        }),
    );
});

test("retains HTML folder options and uses the agent host path with no selected corpus parameter", async () => {
    mounted.openFolderImport();
    setValue("folderPath", " C:\\pages ");
    setValue("folderLimit", "30");
    setValue("maxSize", "2");
    input("recursive").checked = false;
    input("skipHidden").checked = false;
    host.querySelector<HTMLInputElement>(
        '[name="fileType"][value=".mhtml"]',
    )!.checked = false;
    submit();
    await settle();
    expect(invoke).toHaveBeenCalledWith("importHtmlFolder", {
        folderPath: "C:\\pages",
        importId: expect.any(String),
        options: {
            mode: "content",
            recursive: false,
            preserveStructure: true,
            skipHidden: false,
            fileTypes: [".html", ".htm"],
            limit: 30,
            maxFileSize: 2 * 1024 * 1024,
        },
    });
    expect(host.textContent).toContain("server-side path");
});

test("rejects invalid folder paths and empty file type selections before contacting the service", async () => {
    mounted.openFolderImport();
    setValue("folderPath", "C:\\bad*path");
    submit();
    await settle();
    expect(onError).toHaveBeenCalled();
    expect(host.textContent).toContain("invalid characters");
    setValue("folderPath", "C:\\pages");
    host.querySelectorAll<HTMLInputElement>('[name="fileType"]').forEach(
        (element) => {
            element.checked = false;
        },
    );
    submit();
    await settle();
    expect(host.textContent).toContain("Choose at least one HTML file type");
    expect(health).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
});

test("enforces numeric browser validation", async () => {
    mounted.openBrowserImport();
    setValue("concurrent", "21");
    submit();
    await settle();
    expect(input("concurrent").validity.rangeOverflow).toBe(true);
    expect(invoke).not.toHaveBeenCalled();
});

test("offline health blocks invocation and explicitly reports failure", async () => {
    health.mockRejectedValue(new Error("offline"));
    mounted.openBrowserImport();
    submit();
    await settle();
    expect(host.textContent).toContain(
        "Import service is offline. No import was started.",
    );
    expect(onError).toHaveBeenCalledTimes(1);
    expect(invoke).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
});

test("an unavailable progress stream prevents starting and removes its subscription", async () => {
    connect.mockRejectedValue(new Error("Progress stream unavailable"));
    mounted.openFolderImport();
    setValue("folderPath", "C:\\pages");
    submit();
    await settle();
    expect(host.textContent).toContain("Import failed.");
    expect(host.textContent).toContain("Progress stream unavailable");
    expect(invoke).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onComplete).not.toHaveBeenCalled();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
});

test("failed transport or result never becomes success", async () => {
    invoke.mockRejectedValue(new Error("connection lost"));
    mounted.openBrowserImport();
    submit();
    await settle();
    expect(host.textContent).toContain("Import failed.");
    expect(host.textContent).toContain("connection lost");
    expect(onComplete).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    invoke.mockResolvedValue({
        ...result,
        success: false,
        errors: [
            {
                type: "processing",
                message: "Partial extraction failed",
                timestamp: 1,
            },
        ],
    });
    submit();
    await settle();
    expect(host.textContent).toContain("Processed: 5; imported: 4");
    expect(host.textContent).toContain("Partial extraction failed");
    expect(onComplete).not.toHaveBeenCalled();
});

test("closing and reopening keeps the active operation, prevents duplicates, and does not cancel", async () => {
    const finish = pendingResult();
    mounted.openBrowserImport();
    submit();
    submit();
    await settle();
    host.querySelector<HTMLButtonElement>('[name="close"]')!.click();
    mounted.openFolderImport();
    expect(host.querySelector("dialog")!.open).toBe(true);
    expect(
        host.querySelector<HTMLFieldSetElement>('[name="browserFields"]')!
            .hidden,
    ).toBe(false);
    expect(input("start").disabled).toBe(true);
    submit();
    await settle();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(unsubscribe).not.toHaveBeenCalled();
    finish(result);
    await settle();
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(input("start").disabled).toBe(false);
});

test("lost progress is explicit, is not polled, and remains visible alongside the eventual result", async () => {
    const finish = pendingResult();
    mounted.openBrowserImport();
    submit();
    await settle();
    window.dispatchEvent(
        new CustomEvent("viewServiceError", { detail: "disconnected" }),
    );
    expect(host.textContent).toContain("Progress connection lost");
    expect(host.textContent).toContain("durable polling/replay is unavailable");
    expect(onError).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledTimes(1);
    finish(result);
    await settle();
    expect(host.textContent).toContain("Import completed.");
    expect(host.textContent).toContain("Progress connection lost");
});

test("disposal removes listeners and does not cancel or publish late completion", async () => {
    const finish = pendingResult();
    mounted.openBrowserImport();
    submit();
    await settle();
    mounted.dispose();
    mounted.dispose();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(host.children).toHaveLength(0);
    window.dispatchEvent(
        new CustomEvent("viewServiceError", { detail: "disconnected" }),
    );
    finish(result);
    await settle();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(onComplete).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    mounted.openBrowserImport();
    expect(host.children).toHaveLength(0);
});

test("disposal during health check prevents starting an import", async () => {
    let finish!: (connected: boolean) => void;
    health.mockImplementation(
        () =>
            new Promise((resolve) => {
                finish = resolve;
            }),
    );
    mounted.openBrowserImport();
    submit();
    mounted.dispose();
    finish(true);
    await settle();
    expect(invoke).not.toHaveBeenCalled();
});

test("refresh failure is reported separately from a successful import", async () => {
    onComplete.mockRejectedValue(new Error("refresh offline"));
    mounted.openBrowserImport();
    submit();
    await settle();
    expect(host.textContent).toContain(
        "Import completed, but refreshing Memory Hub failed: refresh offline",
    );
    expect(onError).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
});
