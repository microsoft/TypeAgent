// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TextEncoder, TextDecoder } from "node:util";
import type {
    MemoryBatchImport,
    RunbookJobResult,
} from "@typeagent/memory-service";
import type {
    RunbookImportResponse,
    RunbookImportBatch,
} from "@typeagent/browser-control-rpc/runbookImportViewTypes";
import { invokeView } from "./viewClient";
import { mountMemoryHubRunbookImports } from "./memoryHubRunbookImports";

jest.mock("./memoryHubRunbookImports.css", () => ({}));
jest.mock("./viewClient", () => ({ invokeView: jest.fn() }));
const invoke = invokeView as jest.Mock;
let host: HTMLElement;
let mounted: ReturnType<typeof mountMemoryHubRunbookImports>;
let scope: string | undefined;
let onError: jest.Mock;
let onChanged: jest.Mock;
let onOpenRunbook: jest.Mock;
let batches: RunbookImportBatch[];
let jobs: RunbookJobResult[];
const batchId = "a".repeat(64);

function batch(
    state: MemoryBatchImport["state"] = "complete",
    corpusId = "alpha",
): RunbookImportBatch {
    return {
        batchId,
        corpusId,
        state,
        createdAt: "2026-10-02T00:00:00Z",
        updatedAt: "2026-10-02T00:00:00Z",
        members: [
            {
                memberId: "0",
                title: "Guide",
                canonicalUri: "urn:guide",
                contentIdentity: "content",
                stage: "ingestion",
                state: "complete",
                sourceId: "source",
                revisionId: "revision",
                jobId: "ingestion-job",
                warnings: [],
            },
        ],
    };
}
function synthesisJob(
    state: RunbookJobResult["state"] = "failed",
): RunbookJobResult {
    return {
        jobId: "synthesis-job",
        corpusId: "alpha",
        sourceId: "source",
        revisionId: "revision",
        state,
        createdAt: "",
        updatedAt: "",
        candidateIds: [],
        warnings: [],
    };
}
function control<T extends HTMLElement>(name: string): T {
    return host.querySelector<T>(`[name="${name}"]`)!;
}
function click(name: string): void {
    control<HTMLButtonElement>(name).click();
}
function textButton(label: string): HTMLButtonElement {
    return Array.from(host.querySelectorAll("button")).find(
        (button) => button.textContent === label,
    )!;
}
function urls(value = "https://public.example/guide"): void {
    const field = control<HTMLTextAreaElement>("runbook-import-urls");
    field.value = value;
    field.dispatchEvent(new Event("input"));
}
async function settle(): Promise<void> {
    for (let index = 0; index < 30; index++) await Promise.resolve();
}
async function openUrls(): Promise<void> {
    mounted.open("urls");
    await settle();
    urls();
}
function startRequests() {
    return invoke.mock.calls.filter(
        (call) => call[0] === "memoryHubStartRunbookImport",
    );
}

beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(globalThis, "TextEncoder", {
        value: TextEncoder,
        configurable: true,
    });
    Object.defineProperty(globalThis, "TextDecoder", {
        value: TextDecoder,
        configurable: true,
    });
    HTMLDialogElement.prototype.showModal = function () {
        this.open = true;
    };
    HTMLDialogElement.prototype.close = function () {
        this.open = false;
    };
    scope = "alpha";
    batches = [];
    jobs = [];
    host = document.createElement("div");
    document.body.replaceChildren(host);
    onError = jest.fn();
    onChanged = jest.fn().mockResolvedValue(undefined);
    onOpenRunbook = jest.fn();
    invoke.mockImplementation(
        async (method: string, parameters: { corpusId?: string }) => {
            if (method === "memoryListCorpora")
                return [
                    { corpusId: "alpha", name: "Alpha" },
                    { corpusId: "beta", name: "Beta" },
                ];
            if (method === "memoryHubRunbookBatches") return batches;
            if (method === "memoryHubRunbookJobs") return jobs;
            if (method === "memoryHubStartRunbookImport") {
                const accepted = batch("complete", parameters.corpusId);
                batches = [
                    accepted,
                    ...batches.filter(
                        (item) => item.batchId !== accepted.batchId,
                    ),
                ];
                return {
                    batch: accepted,
                    acquisition: [],
                    warnings: ["No tools executed"],
                };
            }
            if (method === "memoryHubCancelRunbookBatch")
                return batch("cancelled");
            if (method === "memoryHubRetryRunbookBatch")
                return batch("running");
            throw new Error(`Unexpected method: ${method}`);
        },
    );
    mounted = mountMemoryHubRunbookImports(host, {
        scope: () => scope,
        onError,
        onChanged,
        onOpenRunbook,
    });
});
afterEach(() => {
    mounted.dispose();
    jest.useRealTimers();
    jest.restoreAllMocks();
});

test("requires a named target and uses the explicitly chosen corpus instead of all-corpora scope", async () => {
    scope = undefined;
    mounted.scopeChanged();
    await openUrls();
    expect(control<HTMLButtonElement>("runbook-import-start").disabled).toBe(
        true,
    );
    const target = control<HTMLSelectElement>("runbook-import-target");
    target.value = "beta";
    target.dispatchEvent(new Event("change"));
    urls();
    click("runbook-import-start");
    await settle();
    expect(startRequests()[0][1]).toEqual(
        expect.objectContaining({
            corpusId: "beta",
            kind: "urls",
            urls: ["https://public.example/guide"],
        }),
    );
    expect(host.textContent).toContain(
        "Whole plain Markdown, HTML and text originals",
    );
    expect(host.textContent).toContain("manual review remains required");
    expect(onChanged).toHaveBeenCalledTimes(1);
});

test("request key and exact inputs survive a lost response; duplicate starts are prevented", async () => {
    let finish!: (response: RunbookImportResponse) => void;
    invoke.mockImplementation((method: string) => {
        if (method === "memoryListCorpora")
            return Promise.resolve([{ corpusId: "alpha", name: "Alpha" }]);
        if (method === "memoryHubStartRunbookImport")
            return new Promise<RunbookImportResponse>((resolve) => {
                finish = resolve;
            });
        return Promise.resolve([]);
    });
    await openUrls();
    click("runbook-import-start");
    click("runbook-import-start");
    await settle();
    expect(startRequests()).toHaveLength(1);
    click("runbook-import-close");
    mounted.open("folder");
    expect(host.querySelector("dialog")!.open).toBe(true);
    expect(control<HTMLTextAreaElement>("runbook-import-urls").disabled).toBe(
        true,
    );
    finish({ acquisition: [], warnings: ["No batch"] });
    await settle();
    const first = startRequests()[0][1];
    click("runbook-import-start");
    await settle();
    expect(startRequests()).toHaveLength(2);
    expect(startRequests()[1][1]).toEqual(first);
});

test("network failure does not publish success and unchanged retry retains idempotency key", async () => {
    await openUrls();
    expect(host.textContent).toContain(
        "Before admission, fetched URL content is not durably frozen",
    );
    expect(host.textContent).toContain("fingerprint identifies the selection");
    invoke.mockImplementation(async (method: string) => {
        if (method === "memoryHubStartRunbookImport")
            throw new Error("server offline after dispatch");
        return [];
    });
    click("runbook-import-start");
    await settle();
    expect(host.textContent).toContain("server offline after dispatch");
    expect(onChanged).not.toHaveBeenCalled();
    const key = startRequests()[0][1].idempotencyKey;
    click("runbook-import-start");
    await settle();
    expect(startRequests()[1][1].idempotencyKey).toBe(key);
    expect(onError).toHaveBeenCalledTimes(2);
});

test("URL credentials and excessive counts are rejected before upload without truncation", async () => {
    await openUrls();
    urls("https://user:password@public.example");
    click("runbook-import-start");
    await settle();
    expect(host.textContent).toContain("credential-free");
    urls(
        Array.from(
            { length: 51 },
            (_, index) => `https://public.example/${index}`,
        ).join("\n"),
    );
    click("runbook-import-start");
    await settle();
    expect(host.textContent).toContain("1-50");
    expect(startRequests()).toHaveLength(0);
});

test("selected folder uploads explicit bounded base64 bytes and relative paths, not host paths", async () => {
    mounted.open("folder");
    await settle();
    const file = new File(["# Guide"], "guide.md", { type: "text/markdown" });
    Object.defineProperty(file, "webkitRelativePath", {
        value: "export/guide.md",
    });
    const input = control<HTMLInputElement>("runbook-import-files");
    Object.defineProperty(input, "files", {
        value: [file],
        configurable: true,
    });
    jest.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(
        function () {
            Object.defineProperty(this, "result", {
                value: "data:text/markdown;base64,IyBHdWlkZQ==",
                configurable: true,
            });
            this.dispatchEvent(new ProgressEvent("load"));
        },
    );
    expect(input.hasAttribute("webkitdirectory")).toBe(true);
    click("runbook-import-start");
    await settle();
    expect(startRequests()[0][1].files).toEqual([
        {
            relativePath: "export/guide.md",
            contentBase64: "IyBHdWlkZQ==",
            mimeType: "text/markdown",
        },
    ]);
});

test("HTML acquisition preflight never creates a browser document that could load remote resources", async () => {
    mounted.open("wiki");
    await settle();
    const file = new File(["placeholder"], "guide.html", { type: "text/html" });
    Object.defineProperty(
        control<HTMLInputElement>("runbook-import-files"),
        "files",
        { value: [file], configurable: true },
    );
    const source =
        '<title>Guide</title><img src="https://private.invalid/image"><iframe src="http://127.0.0.1"></iframe>';
    jest.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(
        function () {
            Object.defineProperty(this, "result", {
                value: `data:;base64,${Buffer.from(source).toString("base64")}`,
                configurable: true,
            });
            this.dispatchEvent(new ProgressEvent("load"));
        },
    );
    const parse = jest.spyOn(DOMParser.prototype, "parseFromString");
    click("runbook-import-start");
    await settle();
    expect(parse).not.toHaveBeenCalled();
    expect(startRequests()).toHaveLength(1);
});

test("oversized selected files fail before reading or uploading; unsupported acquisition reasons are shown", async () => {
    mounted.open("wiki");
    await settle();
    const file = new File(["small"], "guide.md");
    Object.defineProperty(file, "size", { value: 8 * 1024 * 1024 + 1 });
    Object.defineProperty(
        control<HTMLInputElement>("runbook-import-files"),
        "files",
        { value: [file], configurable: true },
    );
    const read = jest.spyOn(FileReader.prototype, "readAsDataURL");
    click("runbook-import-start");
    await settle();
    expect(host.textContent).toContain("before uploading");
    expect(read).not.toHaveBeenCalled();
    expect(startRequests()).toHaveLength(0);
    jest.spyOn(globalThis, "confirm").mockReturnValue(true);
    mounted.open("urls");
    mounted.discardChanges();
    await openUrls();
    invoke.mockResolvedValueOnce({
        acquisition: [
            {
                member: "https://public.example/guide",
                state: "rejected",
                reason: "Unsupported application/pdf",
            },
        ],
        warnings: [],
    });
    click("runbook-import-start");
    await settle();
    expect(host.textContent).toContain("Unsupported application/pdf");
    expect(host.textContent).toContain("No batch was started");
});

test("JSON escaping is counted before core upload", async () => {
    mounted.open("folder");
    await settle();
    const file = new File(["small"], "escaped.md", { type: "text/markdown" });
    Object.defineProperty(
        control<HTMLInputElement>("runbook-import-files"),
        "files",
        { value: [file], configurable: true },
    );
    const encoded = Buffer.from("\\".repeat(4.5 * 1024 * 1024)).toString(
        "base64",
    );
    jest.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(
        function () {
            Object.defineProperty(this, "result", {
                value: `data:text/markdown;base64,${encoded}`,
                configurable: true,
            });
            this.dispatchEvent(new ProgressEvent("load"));
        },
    );
    click("runbook-import-start");
    await settle();
    expect(host.textContent).toContain("8 MB core limit");
    expect(startRequests()).toHaveLength(0);
});

test("a selected image referenced by multiple documents is counted per revision before upload", async () => {
    mounted.open("folder");
    await settle();
    const first = new File(["![screen](screen.png)"], "first.md", {
        type: "text/markdown",
    });
    const second = new File(["![screen](screen.png)"], "second.md", {
        type: "text/markdown",
    });
    const image = new File(["placeholder"], "screen.png", {
        type: "image/png",
    });
    Object.defineProperty(image, "size", { value: 4 * 1024 * 1024 });
    for (const file of [first, second, image])
        Object.defineProperty(file, "webkitRelativePath", {
            value: `export/${file.name}`,
        });
    Object.defineProperty(
        control<HTMLInputElement>("runbook-import-files"),
        "files",
        { value: [first, second, image], configurable: true },
    );
    const imageBytes = Buffer.alloc(4 * 1024 * 1024).toString("base64");
    const markdown = Buffer.from("![screen](screen.png)").toString("base64");
    jest.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(
        function (file) {
            Object.defineProperty(this, "result", {
                value: `data:;base64,${file === image ? imageBytes : markdown}`,
                configurable: true,
            });
            this.dispatchEvent(new ProgressEvent("load"));
        },
    );
    click("runbook-import-start");
    await settle();
    expect(host.textContent).toContain("8 MB core limit");
    expect(startRequests()).toHaveLength(0);
});

test("Activity prefers the canonical heading over its basename display label", async () => {
    const accepted = batch();
    accepted.members[0].title = "Guide / Full procedure heading";
    accepted.members[0].displayName = "Full procedure heading";
    batches = [accepted];
    mounted.showActivity();
    await settle();
    expect(host.textContent).toContain(
        "Member 0: Guide / Full procedure heading",
    );
});

test("Activity reads durable interrupted/partial/duplicate states and linked post-commit jobs after remount", async () => {
    batches = [
        {
            ...batch("interrupted"),
            warnings: ["Orphan selected image was not attached"],
            members: [
                {
                    ...batch().members[0],
                    title: undefined,
                    displayName: "Guide",
                    clientKey: "b".repeat(64),
                    state: "interrupted",
                    reason: "Service restarted",
                    warnings: ["Incomplete extraction"],
                },
                {
                    ...batch().members[0],
                    memberId: "1",
                    state: "duplicate",
                    duplicateOf: "0",
                    warnings: [],
                },
                {
                    memberId: "2",
                    contentIdentity: "",
                    stage: "acquisition",
                    displayName: "archive.zip",
                    state: "failed",
                    reason: "Archive extraction unavailable",
                    warnings: [],
                },
            ],
            acquisitionIssues: [
                {
                    member: "b".repeat(64),
                    state: "warning",
                    reason: "Referenced image missing.png was not selected",
                },
            ],
        },
    ];
    jobs = [
        {
            jobId: "runbook-job",
            corpusId: "alpha",
            sourceId: "source",
            revisionId: "revision",
            state: "interrupted",
            createdAt: "",
            updatedAt: "",
            classification: "runbook",
            confidence: 0.8,
            reason: "Post-commit restart",
            candidateIds: ["candidate"],
            warnings: ["Manual image description required"],
        },
    ];
    mounted.dispose();
    mounted = mountMemoryHubRunbookImports(host, {
        scope: () => scope,
        onError,
        onChanged,
        onOpenRunbook,
    });
    mounted.showActivity();
    await settle();
    expect(host.textContent).toContain("Service restarted");
    expect(host.textContent).toContain("bounded results, not corpus totals");
    expect(host.textContent).toContain("duplicate of 0");
    expect(host.textContent).toContain("Member 0: Guide");
    expect(host.textContent).toContain(
        "Acquisition warning for Guide: Referenced image missing.png was not selected",
    );
    expect(host.textContent).toContain("ingestion-job");
    expect(host.textContent).toContain(`batches: ${batchId}`);
    expect(host.textContent).toContain("Manual image description required");
    expect(host.textContent).toContain(
        "Orphan selected image was not attached",
    );
    expect(host.textContent).toContain("Archive extraction unavailable");
    expect(host.textContent).toContain(
        "Acquisition rejections were not imported",
    );
    textButton("Review Runbook candidate").click();
    expect(onOpenRunbook).toHaveBeenCalledWith("alpha", "candidate");
    textButton("Retry failed/interrupted/cancelled members").click();
    await settle();
    expect(invoke).toHaveBeenCalledWith("memoryHubRetryRunbookBatch", {
        corpusId: "alpha",
        batchId,
    });
});

test("real cancellation waits for transport result and exposes failure rather than claiming cancellation", async () => {
    batches = [batch("running")];
    mounted.showActivity();
    await settle();
    let fail!: (reason: Error) => void;
    invoke.mockImplementation((method: string) => {
        if (method === "memoryHubCancelRunbookBatch")
            return new Promise<MemoryBatchImport>((_resolve, reject) => {
                fail = reject;
            });
        return Promise.resolve(
            method === "memoryHubRunbookBatches" ? batches : [],
        );
    });
    textButton("Request batch cancellation").click();
    textButton("Request batch cancellation").click();
    await settle();
    expect(
        invoke.mock.calls.filter(
            (call) => call[0] === "memoryHubCancelRunbookBatch",
        ),
    ).toHaveLength(1);
    expect(host.textContent).toContain("Awaiting server confirmation");
    expect(onChanged).not.toHaveBeenCalled();
    fail(new Error("Cancellation unavailable in this transport"));
    await settle();
    expect(host.textContent).toContain("Cancellation unavailable");
    expect(host.textContent).not.toContain("Server batch state: cancelled");
});

test("confirmed cancellation displays actual server state and keeps committed source identities", async () => {
    batches = [batch("running")];
    mounted.showActivity();
    await settle();
    invoke.mockImplementation(async (method: string) => {
        if (method === "memoryHubCancelRunbookBatch") {
            batches = [batch("cancelled")];
            return batches[0];
        }
        return method === "memoryHubRunbookBatches" ? batches : [];
    });
    textButton("Request batch cancellation").click();
    await settle();
    expect(host.textContent).toContain(`${batchId}: cancelled`);
    expect(host.textContent).toContain("Source: source");
    expect(textButton("Request batch cancellation")).toBeUndefined();
    expect(onChanged).toHaveBeenCalledTimes(1);
});

test("rejection-only durable batches show original member identities/names and offer no fake reacquisition retry", async () => {
    batches = [
        {
            ...batch("failed"),
            members: [
                {
                    memberId: "rejected-member",
                    contentIdentity: "",
                    clientKey: "b".repeat(64),
                    displayName: "archive.zip",
                    stage: "acquisition",
                    state: "failed",
                    reason: "Archive extraction is unavailable",
                    warnings: [],
                },
            ],
        },
    ];
    mounted.showActivity();
    await settle();
    expect(host.textContent).toContain("Member rejected-member: archive.zip");
    expect(host.textContent).toContain("batch retry never reacquires");
    expect(
        textButton("Retry failed/interrupted/cancelled members"),
    ).toBeUndefined();
    expect(
        invoke.mock.calls.some(
            (call) => call[0] === "memoryHubRetryRunbookBatch",
        ),
    ).toBe(false);
});

test("scope changes suppress stale activity/import responses and never render other-corpus items", async () => {
    let finish!: (response: RunbookImportResponse) => void;
    await openUrls();
    invoke.mockImplementation((method: string) => {
        if (method === "memoryHubStartRunbookImport")
            return new Promise<RunbookImportResponse>((resolve) => {
                finish = resolve;
            });
        if (method === "memoryListCorpora")
            return Promise.resolve([{ corpusId: "beta", name: "Beta" }]);
        return Promise.resolve([]);
    });
    click("runbook-import-start");
    await settle();
    scope = "beta";
    mounted.scopeChanged();
    finish({
        batch: batch("complete", "alpha"),
        acquisition: [],
        warnings: ["STALE ALPHA"],
    });
    await settle();
    expect(host.textContent).not.toContain("STALE ALPHA");
    expect(onChanged).not.toHaveBeenCalled();
    invoke.mockImplementation(async (method: string) =>
        method === "memoryHubRunbookBatches"
            ? [batch("complete", "alpha")]
            : [],
    );
    mounted.showActivity();
    await settle();
    expect(host.textContent).toContain("another target corpus");
    expect(host.textContent).not.toContain(`${batchId}: complete`);
});

test("activity polling is durable and stops after disposal; late responses cannot publish changes", async () => {
    jest.useFakeTimers();
    batches = [batch("running")];
    mounted.showActivity();
    await settle();
    expect(jest.getTimerCount()).toBe(1);
    const count = invoke.mock.calls.length;
    mounted.dispose();
    expect(jest.getTimerCount()).toBe(0);
    jest.advanceTimersByTime(10000);
    await settle();
    expect(invoke.mock.calls.length).toBe(count);
    expect(host.children).toHaveLength(0);
    expect(onChanged).not.toHaveBeenCalled();
});

test("Activity can mount outside the global dialog host and is removed on disposal", async () => {
    mounted.dispose();
    const activityHost = document.createElement("section");
    document.body.append(activityHost);
    mounted = mountMemoryHubRunbookImports(host, {
        scope: () => scope,
        onError,
        onChanged,
        activityHost,
    });
    batches = [batch()];
    mounted.showActivity();
    await settle();
    expect(activityHost.textContent).toContain("Member 0: Guide");
    expect(activityHost.textContent).toContain(batchId);
    expect(host.textContent).not.toContain(batchId);
    mounted.open("urls");
    await settle();
    expect(host.querySelector("dialog")!.open).toBe(true);
    expect(activityHost.querySelector("dialog")).toBeNull();
    mounted.dispose();
    expect(activityHost.children).toHaveLength(0);
    expect(host.children).toHaveLength(0);
});

test("pause and hide stop polling without cancelling durable server work, and show resumes", async () => {
    jest.useFakeTimers();
    batches = [batch("running")];
    mounted.showActivity();
    await settle();
    expect(jest.getTimerCount()).toBe(1);
    mounted.pauseActivity();
    expect(jest.getTimerCount()).toBe(0);
    const count = invoke.mock.calls.length;
    jest.advanceTimersByTime(10000);
    await settle();
    expect(invoke.mock.calls).toHaveLength(count);
    mounted.showActivity();
    await settle();
    expect(jest.getTimerCount()).toBe(1);
    mounted.hideActivity();
    expect(jest.getTimerCount()).toBe(0);
    expect(
        host.querySelector<HTMLElement>(".hub-runbook-import-activity")!.hidden,
    ).toBe(true);
    expect(
        invoke.mock.calls.some(
            (call) => call[0] === "memoryHubCancelRunbookBatch",
        ),
    ).toBe(false);
});

test("pausing during an Activity request prevents its late response from restarting polling", async () => {
    jest.useFakeTimers();
    let finish!: (value: RunbookImportBatch[]) => void;
    invoke.mockImplementation((method: string) =>
        method === "memoryHubRunbookBatches"
            ? new Promise<RunbookImportBatch[]>((resolve) => {
                  finish = resolve;
              })
            : Promise.resolve([]),
    );
    mounted.showActivity();
    await settle();
    mounted.pauseActivity();
    finish([batch("running")]);
    await settle();
    expect(jest.getTimerCount()).toBe(0);
    expect(host.textContent).not.toContain(`${batchId}: running`);
});

test("durable state changes notify the Hub only after actual server completion", async () => {
    jest.useFakeTimers();
    batches = [batch("running")];
    mounted.showActivity();
    await settle();
    expect(onChanged).not.toHaveBeenCalled();
    batches = [batch("complete")];
    await jest.advanceTimersByTimeAsync(2000);
    await settle();
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain(`${batchId}: complete`);
    expect(jest.getTimerCount()).toBe(0);
});

test("first Activity observation of an already completed candidate refreshes Inbox once, not every poll", async () => {
    batches = [batch("complete")];
    jobs = [
        {
            jobId: "ready-job",
            corpusId: "alpha",
            sourceId: "source",
            revisionId: "revision",
            state: "complete",
            createdAt: "",
            updatedAt: "",
            classification: "runbook",
            candidateIds: ["imported-candidate"],
            warnings: [],
        },
    ];
    let inbox: string[] = [];
    onChanged.mockImplementation(async () => {
        inbox = jobs.flatMap((job) => job.candidateIds);
    });
    mounted.showActivity();
    await settle();
    expect(inbox).toEqual(["imported-candidate"]);
    expect(onChanged).toHaveBeenCalledTimes(1);
    mounted.showActivity();
    await settle();
    expect(onChanged).toHaveBeenCalledTimes(1);
});

test("candidate-ID transitions refresh the Hub even if job state stays complete", async () => {
    jobs = [
        {
            jobId: "job",
            corpusId: "alpha",
            sourceId: "source",
            revisionId: "revision",
            state: "complete",
            createdAt: "",
            updatedAt: "",
            candidateIds: [],
            warnings: [],
        },
    ];
    mounted.showActivity();
    await settle();
    expect(onChanged).toHaveBeenCalledTimes(1);
    jobs = [{ ...jobs[0], candidateIds: ["new-candidate"] }];
    mounted.showActivity();
    await settle();
    expect(onChanged).toHaveBeenCalledTimes(2);
    mounted.showActivity();
    await settle();
    expect(onChanged).toHaveBeenCalledTimes(2);
});

test("disposal ignores late import completion and callbacks", async () => {
    await openUrls();
    let finish!: (response: RunbookImportResponse) => void;
    invoke.mockImplementation(
        () =>
            new Promise<RunbookImportResponse>((resolve) => {
                finish = resolve;
            }),
    );
    click("runbook-import-start");
    await settle();
    mounted.dispose();
    finish({ batch: batch(), acquisition: [], warnings: [] });
    await settle();
    expect(onChanged).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(host.children).toHaveLength(0);
});

test.each(["failed", "interrupted", "cancelled"] as const)(
    "post-commit %s synthesis retry uses exact retained identity without batch retry or reacquisition",
    async (state) => {
        jobs = [synthesisJob(state)];
        mounted.showActivity();
        await settle();
        onChanged.mockClear();
        const result = {
            ...synthesisJob("complete"),
            jobId: "new-attempt",
            candidateIds: ["saved-candidate"],
        };
        invoke.mockImplementationOnce(async () => {
            jobs = [...jobs, result];
            return result;
        });
        textButton("Retry post-commit synthesis").click();
        await settle();
        expect(invoke).toHaveBeenCalledWith("memoryHubRetryRunbookSynthesis", {
            corpusId: "alpha",
            sourceId: "source",
            revisionId: "revision",
        });
        expect(startRequests()).toHaveLength(0);
        expect(
            invoke.mock.calls.some(
                (call) => call[0] === "memoryHubRetryRunbookBatch",
            ),
        ).toBe(false);
        expect(onChanged).toHaveBeenCalledTimes(1);
        expect(host.textContent).toContain("new-attempt: complete");
        expect(host.textContent).toContain(
            "synthesis cancellation is unavailable",
        );
        textButton("Review Runbook saved-candidate").click();
        expect(onOpenRunbook).toHaveBeenCalledWith("alpha", "saved-candidate");
    },
);

test("synthesis retry blocks duplicate starts and reports stale/offline errors without claiming success", async () => {
    jobs = [synthesisJob()];
    mounted.showActivity();
    await settle();
    onChanged.mockClear();
    let reject!: (error: Error) => void;
    invoke.mockImplementationOnce(
        () =>
            new Promise((_resolve, failure) => {
                reject = failure;
            }),
    );
    const retry = textButton("Retry post-commit synthesis");
    retry.click();
    retry.click();
    expect(retry.disabled).toBe(true);
    expect(
        invoke.mock.calls.filter(
            (call) => call[0] === "memoryHubRetryRunbookSynthesis",
        ),
    ).toHaveLength(1);
    reject(new Error("Revision is stale; compare the current active revision"));
    await settle();
    expect(host.textContent).toContain("Revision is stale");
    expect(onChanged).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(retry.disabled).toBe(false);
    invoke.mockRejectedValueOnce(new Error("Offline"));
    retry.click();
    await settle();
    expect(host.textContent).toContain("Offline");
    expect(onError).toHaveBeenCalledTimes(2);
    expect(onChanged).not.toHaveBeenCalled();
});

test("synthesis retry rejects mismatched returned identity and ignores completion after disposal", async () => {
    jobs = [synthesisJob()];
    mounted.showActivity();
    await settle();
    onChanged.mockClear();
    invoke.mockResolvedValueOnce({
        ...synthesisJob("complete"),
        revisionId: "another-revision",
    });
    textButton("Retry post-commit synthesis").click();
    await settle();
    expect(host.textContent).toContain("another target or source revision");
    expect(onChanged).not.toHaveBeenCalled();
    let finish!: (value: RunbookJobResult) => void;
    invoke.mockImplementationOnce(
        () =>
            new Promise((resolve) => {
                finish = resolve;
            }),
    );
    textButton("Retry post-commit synthesis").click();
    mounted.dispose();
    finish(synthesisJob("complete"));
    await settle();
    expect(onChanged).not.toHaveBeenCalled();
    expect(host.childElementCount).toBe(0);
});

test("discard requires an explicit choice for unsent selections and is blocked during acquisition", async () => {
    await openUrls();
    const confirm = jest.spyOn(globalThis, "confirm").mockReturnValue(false);
    expect(mounted.discardChanges()).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
    confirm.mockReturnValue(true);
    expect(mounted.discardChanges()).toBe(true);
    urls();
    invoke.mockImplementation(() => new Promise(() => {}));
    click("runbook-import-start");
    await settle();
    expect(mounted.discardChanges()).toBe(false);
    expect(host.textContent).toContain("Wait for acquisition");
});
