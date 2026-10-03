// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TextEncoder } from "node:util";
import { webcrypto } from "node:crypto";
import { extractPdfMarkdown } from "@typeagent/browser-control-rpc/pdfMarkdown";
import type { MemoryCenterJob } from "@typeagent/browser-control-rpc/serviceTypes";
import {
    createPdfCorpusImport,
    type PdfImportContent,
} from "../../src/extension/views/pdfCorpusImport";

const mockInvoke = jest.fn();
const mockElectronClient = jest.fn<
    { rpc: { invoke: typeof mockInvoke } } | undefined,
    []
>();
const mockWorkerDestroy = jest.fn();
const mockDocumentDestroy = jest.fn(async () => {});
const mockGetDocument = jest.fn();
jest.mock("pdfjs-dist", () => ({
    version: "5.3.31",
    GlobalWorkerOptions: {},
    PDFWorker: jest.fn(() => ({ destroy: mockWorkerDestroy })),
    getDocument: (...args: unknown[]) => mockGetDocument(...args),
}));
jest.mock("@typeagent/browser-control-rpc/pdfMarkdown", () => ({
    extractPdfMarkdown: jest.fn(),
}));
jest.mock("../../src/extension/views/chromeRpcClient", () => ({
    createChromeRpcClient: () => ({ rpc: { invoke: mockInvoke } }),
}));
jest.mock("../../src/extension/views/electronRpcClient", () => ({
    createElectronRpcClient: () => mockElectronClient(),
}));
const pendingKey = "pdfCorpusImport.pendingJob";
const identity = {
    jobId: "job-one",
    corpusId: "corpus-one",
    sourceId: "source-one",
    revisionId: "revision-one",
};
const fixture: PdfImportContent = {
    markdown: "# Manual\n\nManual text\n",
    pageCount: 2,
    emptyPages: [],
    title: "Manual",
    canonicalUri: "https://example.com/manual.pdf",
    byteHash: "a".repeat(64),
};
function job(state: MemoryCenterJob["state"] = "embedding"): MemoryCenterJob {
    return {
        ...identity,
        state,
        progress: { completed: 2, total: 8 },
        createdAt: "2026-10-02",
        updatedAt: "2026-10-02",
        warnings: [],
    };
}
async function settle(): Promise<void> {
    for (let turn = 0; turn < 30; turn++) await Promise.resolve();
}
function click(name: string): void {
    document.querySelector<HTMLButtonElement>(`[name=${name}]`)!.click();
}
function submit(): void {
    document
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { cancelable: true }));
}
function text(): string {
    return document.querySelector("[role=status]")!.textContent!;
}
function button(selector: string): HTMLButtonElement {
    return document.querySelector<HTMLButtonElement>(selector)!;
}
async function start(content = fixture, refresh = jest.fn(async () => {})) {
    const importer = createPdfCorpusImport(refresh);
    await importer.open(async () => content);
    submit();
    await settle();
    return { importer, refresh };
}
function imports() {
    return mockInvoke.mock.calls.filter(
        ([method]) => method === "memoryImportDocument",
    );
}

describe("PDF Markdown corpus import", () => {
    beforeEach(() => {
        jest.useFakeTimers();
        Object.defineProperty(globalThis, "TextEncoder", {
            value: TextEncoder,
            configurable: true,
        });
        Object.defineProperty(globalThis, "crypto", {
            value: webcrypto,
            configurable: true,
        });
        mockWorkerDestroy.mockClear();
        mockDocumentDestroy.mockClear();
        mockGetDocument.mockReset();
        jest.mocked(extractPdfMarkdown).mockReset();
        document.body.replaceChildren();
        localStorage.clear();
        sessionStorage.clear();
        mockInvoke.mockReset();
        mockElectronClient.mockReturnValue({ rpc: { invoke: mockInvoke } });
        mockInvoke.mockImplementation(async (method: string) => {
            if (method === "memoryListCorpora")
                return [{ corpusId: identity.corpusId, name: "Documents" }];
            if (method === "memoryImportDocument")
                return {
                    ...identity,
                    state: "accepted",
                    statusUri: "memory://job-one",
                };
            if (method === "memoryListJobs") return { items: [job()] };
            if (method === "memoryCancelJob") return job("cancelling");
            throw new Error(`Unexpected RPC ${method}`);
        });
        HTMLDialogElement.prototype.showModal = function () {
            this.setAttribute("open", "");
        };
        HTMLDialogElement.prototype.close = function () {
            this.removeAttribute("open");
            this.dispatchEvent(new Event("close"));
        };
    });
    afterEach(() => {
        window.dispatchEvent(new Event("pagehide"));
        jest.clearAllTimers();
        jest.useRealTimers();
        jest.restoreAllMocks();
    });
    it("imports Markdown in Chrome without PDF grants or binary/artifact transport", async () => {
        mockElectronClient.mockReturnValue(undefined);
        await start({
            ...fixture,
            ...{ bytesBase64: "SECRET", artifact: { private: "layout" } },
        });
        expect(mockInvoke.mock.calls).toEqual([
            ["memoryListCorpora", {}],
            [
                "memoryImportDocument",
                {
                    corpusId: identity.corpusId,
                    title: fixture.title,
                    markdown: fixture.markdown,
                    canonicalUri: fixture.canonicalUri,
                },
            ],
        ]);
        await jest.advanceTimersByTimeAsync(1000);
        expect(mockInvoke).toHaveBeenLastCalledWith("memoryListJobs", {
            corpusId: identity.corpusId,
            sourceId: identity.sourceId,
            pageSize: 100,
        });
        expect(
            mockInvoke.mock.calls.every(
                ([method]) => !method.startsWith("pdf"),
            ),
        ).toBe(true);
        expect(JSON.stringify(sessionStorage)).not.toMatch(
            /SECRET|layout|captureId|capability/,
        );
        expect(JSON.parse(sessionStorage.getItem(pendingKey)!)).toEqual(
            identity,
        );
        expect(localStorage.getItem(pendingKey)).toBeNull();
        expect(document.querySelector("[name=searchCapture]")).toBeNull();
        expect(document.querySelector("[name=openCapture]")).toBeNull();
    });
    it("reuses a supplied transport", async () => {
        const invoke = jest.fn(async () => [
            { corpusId: "shared", name: "Shared" },
        ]);
        await createPdfCorpusImport(undefined, { invoke }).open();
        expect(invoke).toHaveBeenCalledWith("memoryListCorpora", {});
        expect(mockInvoke).not.toHaveBeenCalled();
    });
    it("prefers Electron preload transport", async () => {
        const invoke = jest.fn(async () => [
            { corpusId: "electron", name: "Electron" },
        ]);
        mockElectronClient.mockReturnValue({ rpc: { invoke } });
        await createPdfCorpusImport().open();
        expect(invoke).toHaveBeenCalledWith("memoryListCorpora", {});
        expect(mockInvoke).not.toHaveBeenCalled();
    });
    it("keeps Import/Cancel in the same row and restores Import after completion", async () => {
        let finish!: (content: PdfImportContent) => void;
        await createPdfCorpusImport().open(
            () =>
                new Promise((resolve) => {
                    finish = resolve;
                }),
        );
        expect(button("[type=submit]").hidden).toBe(false);
        expect(button("[name=cancel]").hidden).toBe(true);
        expect(button("[type=submit]").parentElement).toBe(
            button("[name=cancel]").parentElement,
        );
        submit();
        expect(button("[type=submit]").hidden).toBe(true);
        expect(button("[name=cancel]").disabled).toBe(false);
        finish(fixture);
        await settle();
        expect(button("[name=close]").textContent).toBe(
            "Close (keep indexing)",
        );
        mockInvoke.mockResolvedValueOnce({ items: [job("complete")] });
        await jest.advanceTimersByTimeAsync(1000);
        expect(button("[type=submit]").hidden).toBe(false);
        expect(button("[type=submit]").disabled).toBe(false);
        expect(button("[name=cancel]").hidden).toBe(true);
    });
    it.each(["complete", "partial", "failed", "cancelled"] as const)(
        "stops polling on %s and refreshes only successful imports",
        async (state) => {
            const { refresh } = await start();
            mockInvoke.mockResolvedValueOnce({
                items: [
                    {
                        ...job(state),
                        error:
                            state === "failed"
                                ? "Server indexing failed"
                                : undefined,
                        warnings:
                            state === "partial"
                                ? ["Some parts unavailable"]
                                : [],
                    },
                ],
            });
            await jest.advanceTimersByTimeAsync(1000);
            expect(text()).toContain(state);
            expect(refresh).toHaveBeenCalledTimes(
                state === "complete" || state === "partial" ? 1 : 0,
            );
            expect(sessionStorage.getItem(pendingKey)).toBeNull();
            const calls = mockInvoke.mock.calls.length;
            await jest.advanceTimersByTimeAsync(5000);
            expect(mockInvoke).toHaveBeenCalledTimes(calls);
            if (state === "failed")
                expect(text()).toContain("Server indexing failed");
            if (state === "partial")
                expect(text()).toContain("Some parts unavailable");
        },
    );
    it("reports submission failure and allows retry without persisting a job", async () => {
        await createPdfCorpusImport().open(async () => fixture);
        mockInvoke.mockRejectedValueOnce(new Error("Server unavailable"));
        submit();
        await settle();
        expect(text()).toContain("Server unavailable");
        expect(sessionStorage.getItem(pendingKey)).toBeNull();
        expect(button("[type=submit]").disabled).toBe(false);
        submit();
        await settle();
        expect(imports()).toHaveLength(2);
    });
    it.each(["cancel", "close"])(
        "%s aborts extraction and discards a provider ignoring cancellation",
        async (action) => {
            let finish!: (content: PdfImportContent) => void;
            let signal: AbortSignal | undefined;
            await createPdfCorpusImport().open((_progress, abort) => {
                signal = abort;
                return new Promise((resolve) => {
                    finish = resolve;
                });
            });
            submit();
            click(action);
            expect(signal?.aborted).toBe(true);
            finish(fixture);
            await settle();
            expect(imports()).toHaveLength(0);
            expect(text()).toContain("nothing submitted");
        },
    );
    it.each([false, true])(
        "requires explicit partial-text approval: %s",
        async (approve) => {
            jest.spyOn(window, "confirm").mockReturnValue(approve);
            await start({ ...fixture, emptyPages: [2] });
            expect(window.confirm).toHaveBeenCalledWith(
                expect.stringContaining("may need OCR"),
            );
            expect(imports()).toHaveLength(approve ? 1 : 0);
            if (approve)
                expect(imports()[0][1]).not.toHaveProperty("allowPartialText");
        },
    );
    it("offers hash identity for a signed URI without persisting secrets", async () => {
        jest.spyOn(window, "confirm").mockReturnValue(true);
        await start({
            ...fixture,
            canonicalUri: "https://example.com/manual.pdf?token=SECRET#private",
        });
        expect(imports()[0][1].canonicalUri).toBe(
            `urn:pdf:sha256:${fixture.byteHash}`,
        );
        expect(JSON.stringify(mockInvoke.mock.calls)).not.toContain("SECRET");
        expect(JSON.stringify(sessionStorage)).not.toContain("SECRET");
    });
    it("uses the byte hash when a local viewer has no URI", async () => {
        await start({ ...fixture, canonicalUri: "" });
        expect(imports()[0][1].canonicalUri).toBe(
            `urn:pdf:sha256:${fixture.byteHash}`,
        );
    });
    it.each([
        "https://user:password@example.com/a",
        "https://example.com/a?secret=yes",
        "https://example.com/a#private",
        "file:///private.pdf",
    ])("rejects unsafe alias %s", async (alias) => {
        await createPdfCorpusImport().open(async () => fixture);
        document.querySelector<HTMLInputElement>("[name=alias]")!.value = alias;
        submit();
        await settle();
        expect(imports()).toHaveLength(0);
        expect(text()).toContain("Durable URI");
    });
    it.each([
        { ...fixture, markdown: " " },
        { ...fixture, markdown: "x".repeat(16 * 1024 * 1024) },
        { ...fixture, byteHash: "invalid" },
    ])(
        "rejects empty/oversized Markdown and invalid identity before RPC",
        async (content) => {
            await start(content);
            expect(imports()).toHaveLength(0);
            expect(button("[type=submit]").disabled).toBe(false);
        },
    );
    it("rejects oversized local PDFs before creating a document or worker", async () => {
        await createPdfCorpusImport().open();
        const file = { size: 10 * 1024 * 1024 + 1, arrayBuffer: jest.fn() };
        Object.defineProperty(document.querySelector("[name=file]"), "files", {
            value: [file],
            configurable: true,
        });
        submit();
        await settle();
        expect(text()).toContain("10 MiB");
        expect(file.arrayBuffer).not.toHaveBeenCalled();
        expect(imports()).toHaveLength(0);
    });
    it("converts a local PDF with a document and worker, cleans both up, and sends only Markdown", async () => {
        const bytes = new Uint8Array([37, 80, 68, 70]).buffer;
        jest.spyOn(crypto.subtle, "digest").mockResolvedValue(
            new Uint8Array(32).buffer,
        );
        const pdfDocument = { numPages: 2, getPage: jest.fn() };
        mockGetDocument.mockReturnValue({
            promise: Promise.resolve(pdfDocument),
            destroy: mockDocumentDestroy,
        });
        jest.mocked(extractPdfMarkdown).mockResolvedValue({
            markdown: fixture.markdown,
            pageCount: 2,
            emptyPages: [],
        });
        await createPdfCorpusImport().open();
        Object.defineProperty(document.querySelector("[name=file]"), "files", {
            value: [
                {
                    name: "Manual.pdf",
                    size: bytes.byteLength,
                    arrayBuffer: async () => bytes,
                },
            ],
            configurable: true,
        });
        submit();
        await jest.advanceTimersByTimeAsync(0);
        await settle();
        expect(mockGetDocument).toHaveBeenCalledWith(
            expect.objectContaining({
                data: bytes,
                isEvalSupported: false,
                worker: expect.any(Object),
            }),
        );
        expect(extractPdfMarkdown).toHaveBeenCalledWith(
            pdfDocument,
            expect.any(Function),
            expect.objectContaining({
                signal: expect.any(AbortSignal),
                byteHash: expect.stringMatching(/^[a-f0-9]{64}$/),
            }),
        );
        expect(mockDocumentDestroy).toHaveBeenCalledTimes(1);
        expect(mockWorkerDestroy).toHaveBeenCalledTimes(1);
        expect(imports()).toHaveLength(1);
        expect(imports()[0][1]).toEqual({
            corpusId: identity.corpusId,
            title: "Manual",
            markdown: fixture.markdown,
            canonicalUri: expect.stringMatching(
                /^urn:pdf:sha256:[a-f0-9]{64}$/,
            ),
        });
        expect(JSON.stringify(imports())).not.toMatch(/bytesBase64|artifact/);
    });
    it("resumes a job on reopen without resubmitting", async () => {
        const { importer } = await start();
        click("close");
        const calls = mockInvoke.mock.calls.length;
        await jest.advanceTimersByTimeAsync(5000);
        expect(mockInvoke).toHaveBeenCalledTimes(calls);
        await importer.open();
        await settle();
        expect(mockInvoke).toHaveBeenLastCalledWith("memoryListJobs", {
            corpusId: identity.corpusId,
            sourceId: identity.sourceId,
            pageSize: 100,
        });
        expect(imports()).toHaveLength(1);
        expect(text()).toContain(identity.sourceId);
    });
    it("reconnects a fresh controller using session job/source/revision identity", async () => {
        sessionStorage.setItem(pendingKey, JSON.stringify(identity));
        await createPdfCorpusImport().open();
        await settle();
        expect(imports()).toHaveLength(0);
        expect(mockInvoke).toHaveBeenLastCalledWith("memoryListJobs", {
            corpusId: identity.corpusId,
            sourceId: identity.sourceId,
            pageSize: 100,
        });
    });
    it.each(["jobId", "corpusId", "sourceId", "revisionId"])(
        "rejects a mismatched %s without losing the pending job",
        async (key) => {
            const { refresh } = await start();
            mockInvoke.mockResolvedValueOnce({
                items: [
                    {
                        ...job("complete"),
                        [key]: "wrong",
                    },
                ],
            });
            await jest.advanceTimersByTimeAsync(1000);
            expect(text()).toContain(
                key === "jobId" ? "unavailable" : "identity does not match",
            );
            expect(refresh).not.toHaveBeenCalled();
            expect(JSON.parse(sessionStorage.getItem(pendingKey)!)).toEqual(
                identity,
            );
        },
    );
    it("reports cancel failure and observes cancelling then cancelled states", async () => {
        await start();
        mockInvoke.mockRejectedValueOnce(new Error("Disconnected"));
        click("cancel");
        await settle();
        expect(text()).toContain("Cancellation failed");
        expect(sessionStorage.getItem(pendingKey)).not.toBeNull();
        click("cancel");
        await settle();
        expect(mockInvoke).toHaveBeenLastCalledWith("memoryCancelJob", {
            jobId: identity.jobId,
        });
        expect(text()).toContain("cancelling");
        mockInvoke.mockResolvedValueOnce({ items: [job("cancelled")] });
        await jest.advanceTimersByTimeAsync(1000);
        expect(text()).toContain("cancelled");
        expect(sessionStorage.getItem(pendingKey)).toBeNull();
    });
    it("does not claim cancellation when the service returns no job", async () => {
        await start();
        mockInvoke.mockResolvedValueOnce(undefined);
        click("cancel");
        await settle();
        expect(text()).toContain("cancellation not confirmed");
        await jest.advanceTimersByTimeAsync(1000);
        expect(text()).toContain("embedding");
    });
    it("retries unavailable jobs and ignores late responses after close", async () => {
        await start();
        mockInvoke.mockResolvedValueOnce({ items: [] });
        await jest.advanceTimersByTimeAsync(1000);
        expect(text()).toContain("Reconnecting");
        let finish!: (value: { items: MemoryCenterJob[] }) => void;
        mockInvoke.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    finish = resolve;
                }),
        );
        await jest.advanceTimersByTimeAsync(1000);
        click("close");
        const previous = text();
        finish({ items: [job("complete")] });
        await settle();
        expect(text()).toBe(previous);
        expect(sessionStorage.getItem(pendingKey)).not.toBeNull();
    });
    it("finds the exact job across source-scoped pages", async () => {
        await start();
        mockInvoke.mockResolvedValueOnce({
            items: [{ ...job(), jobId: "other" }],
            nextContinuationToken: "next",
        });
        mockInvoke.mockResolvedValueOnce({ items: [job("complete")] });
        await jest.advanceTimersByTimeAsync(1000);
        expect(mockInvoke).toHaveBeenLastCalledWith("memoryListJobs", {
            corpusId: identity.corpusId,
            sourceId: identity.sourceId,
            pageSize: 100,
            continuationToken: "next",
        });
        expect(sessionStorage.getItem(pendingKey)).toBeNull();
    });
    it("stops repeated pagination tokens without losing the pending job", async () => {
        await start();
        mockInvoke.mockResolvedValueOnce({
            items: [],
            nextContinuationToken: "same",
        });
        mockInvoke.mockResolvedValueOnce({
            items: [],
            nextContinuationToken: "same",
        });
        await jest.advanceTimersByTimeAsync(1000);
        expect(text()).toContain("pagination did not advance");
        expect(sessionStorage.getItem(pendingKey)).not.toBeNull();
    });
    it("bounds monitoring to ten minutes and resumes on reopen", async () => {
        const { importer } = await start();
        await jest.advanceTimersByTimeAsync(600000);
        expect(text()).toContain("Monitoring paused");
        const calls = mockInvoke.mock.calls.length;
        await jest.advanceTimersByTimeAsync(5000);
        expect(mockInvoke).toHaveBeenCalledTimes(calls);
        click("close");
        await importer.open();
        await settle();
        expect(text()).toContain("embedding");
    }, 30000);
    it("keeps monitoring an accepted job when session storage fails", async () => {
        await createPdfCorpusImport().open(async () => fixture);
        jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
            throw new Error("Storage disabled");
        });
        submit();
        await settle();
        expect(text()).toContain("Reconnect storage failed");
        await jest.advanceTimersByTimeAsync(1000);
        expect(mockInvoke).toHaveBeenLastCalledWith("memoryListJobs", {
            corpusId: identity.corpusId,
            sourceId: identity.sourceId,
            pageSize: 100,
        });
    });
});
