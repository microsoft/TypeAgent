// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { extractPdfMarkdown } from "@typeagent/browser-control-rpc/pdfMarkdown";
import type {
    MemoryCenterInvokeFunctions,
    MemoryCenterJob,
} from "@typeagent/browser-control-rpc/serviceTypes";
import { createChromeRpcClient } from "./chromeRpcClient";
import { createElectronRpcClient } from "./electronRpcClient";

type PdfImportFunctions = MemoryCenterInvokeFunctions;

export interface PdfImportContent {
    title: string;
    canonicalUri: string;
    byteHash: string;
    markdown: string;
    pageCount: number;
    emptyPages: number[];
}
export type PdfProvider = (
    progress: (completed: number, total: number) => void,
    signal?: AbortSignal,
) => Promise<PdfImportContent>;
type PendingImport = Pick<
    MemoryCenterJob,
    "jobId" | "corpusId" | "sourceId" | "revisionId"
>;
const pendingKey = "pdfCorpusImport.pendingJob";
const maxFileBytes = 10 * 1024 * 1024;
const maxRequestBytes = 16 * 1024 * 1024;
const terminalStates = new Set(["complete", "partial", "failed", "cancelled"]);

function checkAbort(signal?: AbortSignal): void {
    if (signal?.aborted)
        throw new DOMException("PDF extraction cancelled", "AbortError");
}
async function extractFile(
    file: File,
    progress: (completed: number, total: number) => void,
    signal?: AbortSignal,
): Promise<PdfImportContent> {
    if (file.size > maxFileBytes)
        throw new Error("PDF imports are limited to 10 MiB.");
    checkAbort(signal);
    const bytes = await file.arrayBuffer();
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    const byteHash = Array.from(new Uint8Array(hash), (value) =>
        value.toString(16).padStart(2, "0"),
    ).join("");
    checkAbort(signal);
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "../vendor/pdfjs/pdf.worker.min.mjs",
        window.location.href,
    ).toString();
    const worker = new pdfjs.PDFWorker();
    const assetRoot = new URL("../vendor/pdfjs/", window.location.href).href;
    const task = pdfjs.getDocument({
        data: bytes,
        worker,
        fontExtraProperties: true,
        isEvalSupported: false,
        cMapUrl: `${assetRoot}cmaps/`,
        cMapPacked: true,
        standardFontDataUrl: `${assetRoot}standard_fonts/`,
        wasmUrl: `${assetRoot}wasm/`,
    });
    const abort = () => {
        void task.destroy();
    };
    signal?.addEventListener("abort", abort, { once: true });
    task.onPassword = (updatePassword: (password: string) => void) => {
        const password = window.prompt("Password for this PDF");
        if (password === null) void task.destroy();
        else updatePassword(password);
    };
    try {
        checkAbort(signal);
        const document = await task.promise;
        const result = await extractPdfMarkdown(document, progress, {
            byteHash,
            pdfjsVersion: pdfjs.version,
            signal,
        });
        return {
            markdown: result.markdown,
            pageCount: result.pageCount,
            emptyPages: result.emptyPages,
            byteHash,
            title: file.name.replace(/\.pdf$/i, ""),
            canonicalUri: `urn:pdf:sha256:${byteHash}`,
        };
    } finally {
        signal?.removeEventListener("abort", abort);
        try {
            await task.destroy();
        } finally {
            worker.destroy();
        }
    }
}
function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
function readPending(): PendingImport | undefined {
    try {
        const value = JSON.parse(sessionStorage.getItem(pendingKey) ?? "null");
        if (
            ["jobId", "corpusId", "sourceId", "revisionId"].every(
                (key) =>
                    typeof value?.[key] === "string" && value[key].length > 0,
            )
        )
            return value as PendingImport;
    } catch {}
    return undefined;
}
function canonicalUri(result: PdfImportContent, alias: string): string {
    if (!/^[a-f0-9]{64}$/.test(result.byteHash))
        throw new Error("PDF extraction did not return a valid byte hash.");
    const fallback = `urn:pdf:sha256:${result.byteHash}`;
    const uri = new URL(alias.trim() || result.canonicalUri || fallback);
    if (uri.username || uri.password || uri.search || uri.hash) {
        if (alias.trim())
            throw new Error(
                "Durable URI must not contain credentials, a query, or a fragment.",
            );
        if (
            !window.confirm(
                "This PDF URL may contain secrets. Import using a local byte-hash URI instead? Cancel to enter a durable URI alias.",
            )
        )
            throw new Error(
                "Import cancelled; enter a durable URI alias. Nothing submitted.",
            );
        return fallback;
    }
    if (!["https:", "http:", "urn:"].includes(uri.protocol))
        throw new Error("Durable URI must use HTTP, HTTPS, or URN.");
    return uri.toString();
}
function importRequest(
    result: PdfImportContent,
    corpusId: string,
    alias: string,
) {
    if (!result.markdown.trim())
        throw new Error("PDF has no extractable text. Nothing submitted.");
    const request = {
        corpusId,
        title: result.title,
        markdown: result.markdown,
        canonicalUri: canonicalUri(result, alias),
    };
    if (
        new TextEncoder().encode(JSON.stringify(request)).byteLength +
            64 * 1024 >
        maxRequestBytes
    )
        throw new Error(
            "PDF Markdown exceeds the 16 MiB inline RPC budget. Nothing submitted.",
        );
    return request;
}
export function createPdfCorpusImport(
    onImported: () => Promise<void> = async () => {},
    transport?: Pick<ReturnType<typeof createChromeRpcClient>["rpc"], "invoke">,
): { open: (provider?: PdfProvider) => Promise<void> } {
    const rpc =
        transport ??
        createElectronRpcClient<PdfImportFunctions>()?.rpc ??
        (typeof chrome !== "undefined" && chrome.runtime
            ? createChromeRpcClient<PdfImportFunctions>()
            : undefined
        )?.rpc;
    async function invoke<Method extends keyof PdfImportFunctions>(
        method: Method,
        params: Parameters<PdfImportFunctions[Method]>[0],
    ): Promise<Awaited<ReturnType<PdfImportFunctions[Method]>>> {
        if (!rpc) throw new Error("Memory RPC transport is unavailable.");
        return rpc.invoke(method, params) as Promise<
            Awaited<ReturnType<PdfImportFunctions[Method]>>
        >;
    }
    const dialog = document.createElement("dialog");
    dialog.style.cssText =
        "box-sizing:border-box;max-width:520px;width:calc(100% - 48px);border:1px solid #888;border-radius:6px;padding:24px;";
    dialog.innerHTML = `<form><h2 style="font-size:20px;margin:0 0 16px">Import PDF to corpus</h2>
        <p><label style="display:block">Corpus <select class="form-select" style="max-width:100%" name="corpus" required></select></label></p>
        <p><label style="display:block">PDF file <input class="form-control" style="max-width:100%" name="file" type="file" accept="application/pdf,.pdf" required></label></p>
        <p><label style="display:block">Durable URI alias (optional) <input class="form-control" style="max-width:100%" name="alias" type="text"></label></p>
        <p role="status" aria-live="polite" style="overflow-wrap:anywhere"></p>
        <div data-import-actions style="display:flex;flex-wrap:wrap;align-items:center;gap:8px">
        <button class="btn btn-primary" style="width:auto;margin:0" type="submit">Import PDF</button>
        <button class="btn btn-secondary" style="width:auto;margin:0;display:none" type="button" name="cancel" hidden disabled>Cancel import</button>
        <button class="btn btn-secondary" style="width:auto;margin:0" type="button" name="close">Close</button></div></form>`;
    document.body.append(dialog);
    const form = dialog.querySelector("form")!;
    const select = dialog.querySelector<HTMLSelectElement>("select")!;
    const fileInput = dialog.querySelector<HTMLInputElement>("[name=file]")!;
    const aliasInput = dialog.querySelector<HTMLInputElement>("[name=alias]")!;
    const status = dialog.querySelector<HTMLParagraphElement>("[role=status]")!;
    const submit = dialog.querySelector<HTMLButtonElement>("[type=submit]")!;
    const close = dialog.querySelector<HTMLButtonElement>("[name=close]")!;
    const cancel = dialog.querySelector<HTMLButtonElement>("[name=cancel]")!;
    let provider: PdfProvider | undefined;
    let busy = false;
    let extraction: AbortController | undefined;
    let pending = readPending();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let generation = 0;
    let notifiedJobId: string | undefined;
    let cancelling = false;
    function stopPolling(): void {
        generation++;
        clearTimeout(timer);
        timer = undefined;
    }
    function controls(): void {
        const running = busy || Boolean(pending);
        submit.hidden = running;
        submit.style.display = running ? "none" : "inline-flex";
        cancel.hidden = !running;
        cancel.style.display = running ? "inline-flex" : "none";
        submit.disabled = running || !select.value;
        select.disabled = fileInput.disabled = aliasInput.disabled = running;
        cancel.disabled = cancelling || (!extraction && !pending);
        close.disabled = busy && !extraction;
        close.textContent = pending ? "Close (keep indexing)" : "Close";
    }
    function jobText(job: MemoryCenterJob): string {
        const progress = job.progress;
        return `Job ${job.jobId}: ${job.state}. Source ${job.sourceId} | Revision ${job.revisionId}. Service parts: ${progress.completed}${progress.total === undefined ? "" : ` of ${progress.total}`}${progress.message ? `. ${progress.message}` : ""}${job.error ? `. ${job.error}` : ""}${job.warnings.length ? `. ${job.warnings.join(". ")}` : ""}`;
    }
    function verifyJob(job: MemoryCenterJob, expected: PendingImport): void {
        if (
            ["jobId", "corpusId", "sourceId", "revisionId"].some(
                (key) =>
                    job[key as keyof PendingImport] !==
                    expected[key as keyof PendingImport],
            )
        )
            throw new Error(
                "Import job identity does not match this source and revision.",
            );
    }
    async function showJob(
        job: MemoryCenterJob,
        expected: PendingImport,
    ): Promise<boolean> {
        verifyJob(job, expected);
        status.textContent = jobText(job);
        const terminal = terminalStates.has(job.state);
        if (terminal) {
            pending = undefined;
            try {
                sessionStorage.removeItem(pendingKey);
            } catch {}
        }
        controls();
        if (
            (job.state === "complete" || job.state === "partial") &&
            notifiedJobId !== job.jobId
        ) {
            notifiedJobId = job.jobId;
            try {
                await onImported();
            } catch (error) {
                status.textContent += `. Refresh failed: ${errorText(error)}`;
            }
        }
        return terminal;
    }
    async function findJob(
        expected: PendingImport,
        epoch: number,
    ): Promise<MemoryCenterJob | undefined> {
        let continuationToken: string | undefined;
        for (let page = 0; page < 100; page++) {
            const result = await invoke("memoryListJobs", {
                corpusId: expected.corpusId,
                sourceId: expected.sourceId,
                pageSize: 100,
                ...(continuationToken ? { continuationToken } : {}),
            });
            if (epoch !== generation || !dialog.open) return undefined;
            const found = result.items.find(
                (job) => job.jobId === expected.jobId,
            );
            if (found) return found;
            if (!result.nextContinuationToken) return undefined;
            if (result.nextContinuationToken === continuationToken)
                throw new Error("Import job pagination did not advance.");
            continuationToken = result.nextContinuationToken;
        }
        throw new Error("Import job lookup exceeded its page limit.");
    }
    async function poll(epoch: number, attempts: number): Promise<void> {
        const expected = pending;
        if (!expected || epoch !== generation || !dialog.open) return;
        let terminal = false;
        try {
            const value = await findJob(expected, epoch);
            if (epoch !== generation || !dialog.open) return;
            if (!value) throw new Error("Import job is unavailable.");
            terminal = await showJob(value, expected);
        } catch (error) {
            if (epoch !== generation || !dialog.open) return;
            status.textContent = `Job ${expected.jobId}: status unavailable. ${errorText(error)}. Reconnecting...`;
        }
        if (terminal || epoch !== generation || !dialog.open) return;
        if (attempts >= 600) {
            status.textContent +=
                ". Monitoring paused after 10 minutes; reopen to check status.";
            return;
        }
        timer = setTimeout(() => {
            void poll(epoch, attempts + 1);
        }, 1000);
    }
    function startPolling(immediate = false): void {
        stopPolling();
        if (!dialog.open || !pending) return;
        const epoch = generation;
        if (immediate) void poll(epoch, 1);
        else
            timer = setTimeout(() => {
                void poll(epoch, 1);
            }, 1000);
    }
    function dismiss(): void {
        if (busy && !extraction) return;
        extraction?.abort();
        stopPolling();
        dialog.close();
    }
    close.onclick = dismiss;
    dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        dismiss();
    });
    dialog.addEventListener("close", () => {
        extraction?.abort();
        stopPolling();
    });
    window.addEventListener("pagehide", () => {
        extraction?.abort();
        stopPolling();
        dialog.close();
    });
    cancel.onclick = () => {
        if (extraction) {
            extraction.abort();
            status.textContent = "Extraction cancelled; nothing submitted.";
            return;
        }
        const expected = pending;
        if (!expected || cancelling) return;
        cancelling = true;
        stopPolling();
        const epoch = generation;
        controls();
        void (async () => {
            try {
                const job = await invoke("memoryCancelJob", {
                    jobId: expected.jobId,
                });
                if (epoch !== generation || !dialog.open) return;
                if (job) await showJob(job, expected);
                else
                    status.textContent = `Job ${expected.jobId}: cancellation not confirmed; checking job status.`;
            } catch (error) {
                if (epoch === generation && dialog.open)
                    status.textContent = `Cancellation failed: ${errorText(error)}. Import remains accepted.`;
            } finally {
                cancelling = false;
                if (epoch === generation && dialog.open) startPolling();
                controls();
            }
        })();
    };
    async function importPdf(
        source: PdfProvider,
        corpusId: string,
    ): Promise<void> {
        const controller = new AbortController();
        extraction = controller;
        busy = true;
        controls();
        status.textContent = "Loading PDF...";
        try {
            const result = await source((completed, total) => {
                if (!controller.signal.aborted)
                    status.textContent = `Extracting layout: page ${completed} of ${total}`;
            }, controller.signal);
            checkAbort(controller.signal);
            if (
                result.emptyPages.length &&
                !window.confirm(
                    `${result.emptyPages.length} pages have no extractable text and may need OCR. Import available text anyway?`,
                )
            ) {
                status.textContent = "Import cancelled; nothing submitted.";
                return;
            }
            const request = importRequest(result, corpusId, aliasInput.value);
            checkAbort(controller.signal);
            extraction = undefined;
            controls();
            status.textContent = "Submitting PDF Markdown...";
            const value = await invoke("memoryImportDocument", request);
            pending = {
                jobId: value.jobId,
                corpusId,
                sourceId: value.sourceId,
                revisionId: value.revisionId,
            };
            status.textContent = `Job ${value.jobId}: ${value.state}. Source ${value.sourceId} | Revision ${value.revisionId}.`;
            try {
                sessionStorage.setItem(pendingKey, JSON.stringify(pending));
                localStorage.setItem("memoryCenter.activeCorpusId", corpusId);
            } catch (error) {
                status.textContent += ` Reconnect storage failed: ${errorText(error)}`;
            }
            startPolling();
        } catch (error) {
            status.textContent = controller.signal.aborted
                ? "Extraction cancelled; nothing submitted."
                : errorText(error);
        } finally {
            extraction = undefined;
            busy = false;
            controls();
        }
    }
    form.onsubmit = (event) => {
        event.preventDefault();
        if (busy || pending || !rpc || !select.value) return;
        const file = fileInput.files?.[0];
        if (!provider && !file) return;
        void importPdf(
            provider ??
                ((progress, signal) => extractFile(file!, progress, signal)),
            select.value,
        );
    };
    return {
        async open(source) {
            if (busy || dialog.open) return;
            stopPolling();
            const epoch = generation;
            pending = readPending() ?? pending;
            provider = source;
            form.reset();
            fileInput.required = !source;
            fileInput.closest("p")!.hidden = !!source;
            select.replaceChildren();
            status.textContent = "Loading corpora...";
            controls();
            dialog.showModal();
            try {
                const corpora = await invoke("memoryListCorpora", {});
                if (epoch !== generation || !dialog.open) return;
                for (const corpus of corpora)
                    select.add(new Option(corpus.name, corpus.corpusId));
                const activeId =
                    pending?.corpusId ??
                    localStorage.getItem("memoryCenter.activeCorpusId");
                if (
                    activeId &&
                    corpora.some((corpus) => corpus.corpusId === activeId)
                )
                    select.value = activeId;
                status.textContent = corpora.length
                    ? ""
                    : "Create a corpus in Memory Center first.";
                controls();
                if (pending) {
                    status.textContent = `Reconnecting to job ${pending.jobId}...`;
                    startPolling(true);
                }
            } catch (error) {
                if (epoch === generation && dialog.open)
                    status.textContent = errorText(error);
            }
        },
    };
}
