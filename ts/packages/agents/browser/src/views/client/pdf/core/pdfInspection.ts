// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import DOMPurify from "dompurify";
import { setContent } from "@typeagent/chat-ui";
import {
    extractPdfMarkdown,
    PDF_EXTRACTOR_VERSION,
    preparePdfCapture,
    renderPdfSemanticDocument,
    type PdfCapturePreparation,
    type PdfExtractionArtifact,
    type PdfExtractionOptions,
    type PdfTextDocument,
} from "@typeagent/browser-control-rpc/pdfMarkdown";

export const MAX_LOCAL_PDF_BYTES = 50 * 1024 * 1024;

export interface PdfCaptureInput {
    document: PdfTextDocument;
    bytes: Uint8Array;
    title: string;
    canonicalUri?: string;
    byteHash: string;
}

export async function retainPdfBytes(data: ArrayBuffer) {
    if (!data.byteLength || data.byteLength > MAX_LOCAL_PDF_BYTES)
        throw new RangeError("PDF must be nonempty and at most 50 MB.");
    const bytes = new Uint8Array(data.slice(0));
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    const byteHash = Array.from(new Uint8Array(digest), (value) =>
        value.toString(16).padStart(2, "0"),
    ).join("");
    return { bytes, byteHash };
}

export async function openLocalPdf(
    file: File,
    load: (data: ArrayBuffer, title: string) => Promise<void>,
) {
    if (!file.size || file.size > MAX_LOCAL_PDF_BYTES)
        throw new RangeError("PDF must be nonempty and at most 50 MB.");
    const data = await file.arrayBuffer();
    if (
        new TextDecoder().decode(
            new Uint8Array(data, 0, Math.min(5, data.byteLength)),
        ) !== "%PDF-"
    )
        throw new Error("The selected file is not a PDF.");
    await load(data, file.name);
}

export interface PdfInspectionHost {
    getInput(): PdfCaptureInput | null;
    beginLocalOpen?(): void;
    load(data: ArrayBuffer, title: string): Promise<void>;
    pdfjsVersion: string;
    getCurrentPage(): number;
    goToPage(page: number): void;
    eventBus: {
        on(name: string, listener: () => void): void;
        off(name: string, listener: () => void): void;
    };
}

type CachedInspection = {
    key: string;
    artifact: PdfExtractionArtifact;
    preparation: PdfCapturePreparation;
};

function inspectionCacheKey(
    input: PdfCaptureInput,
    pdfjsVersion: string,
    options: PdfExtractionOptions,
) {
    return JSON.stringify([
        input.byteHash,
        PDF_EXTRACTOR_VERSION,
        pdfjsVersion,
        options.maxPages ?? 10000,
        options.maxTextChars ?? 10000000,
        options.maxBlocks ?? 100000,
        input.document.numPages,
        1,
        2,
    ]);
}

export function sanitizedMarkdownPreview(markdown: string): string {
    const rendered = document.createElement("div");
    setContent(
        rendered,
        { type: "markdown", content: markdown },
        { isDisplayTypeAllowed: (type) => type === "markdown" },
        "inspection",
        { handleLinkClick: () => {} },
    );
    return DOMPurify.sanitize(rendered.innerHTML, {
        ALLOWED_TAGS: [
            "div",
            "p",
            "br",
            "hr",
            "pre",
            "code",
            "strong",
            "em",
            "del",
            "blockquote",
            "ul",
            "ol",
            "li",
            "h1",
            "h2",
            "h3",
            "h4",
            "h5",
            "h6",
            "table",
            "thead",
            "tbody",
            "tr",
            "th",
            "td",
        ],
        ALLOWED_ATTR: [],
    });
}

export function setupPdfInspection(host: PdfInspectionHost) {
    let generation = 0;
    let abort: AbortController | undefined;
    let cached: CachedInspection | undefined;
    let paused = false;
    let resumeBoundary: (() => void) | undefined;
    let selectedPage = 1;
    let disposed = false;
    let openGeneration = 0;
    const listeners: (() => void)[] = [];
    const panel = document.getElementById("pdfInspection");
    const status = document.getElementById("inspectionStatus");
    const preview = document.getElementById("inspectionPreview");
    const warnings = document.getElementById("inspectionWarnings");
    const warningsGroup = document.getElementById("inspectionWarningsGroup");
    const container = document.getElementById("viewerContainer");
    const setStatus = (text: string) => {
        if (status) status.textContent = text;
    };

    function listen(
        target: EventTarget | null,
        name: string,
        handler: EventListener,
    ) {
        target?.addEventListener(name, handler);
        listeners.push(() => target?.removeEventListener(name, handler));
    }

    function updateControls() {
        const running = abort !== undefined;
        const ready = !running && Boolean(cached?.preparation.markdown.trim());
        const visibility = {
            extractPdf: !running,
            pauseInspection: running,
            cancelInspection: running,
            downloadPdfMarkdown: ready,
        };
        for (const [id, visible] of Object.entries(visibility)) {
            const element = document.getElementById(id);
            if (element) element.hidden = !visible;
        }
        const extractButton = document.getElementById(
            "extractPdf",
        ) as HTMLButtonElement | null;
        if (extractButton) extractButton.disabled = !host.getInput();
        panel
            ?.querySelectorAll<HTMLElement>("[data-inspection-content]")
            .forEach((element) => {
                element.hidden = !ready;
            });
    }

    function renderPreview() {
        if (!preview || !cached) return;
        if (cached.artifact.semanticDocument) {
            const page = cached.artifact.semanticDocument.pages.find(
                (page) => page.number === selectedPage,
            );
            preview.innerHTML = sanitizedMarkdownPreview(
                renderPdfSemanticDocument(
                    { pages: page ? [page] : [] },
                    { math: "latex", images: "none", pageBreaks: false },
                ),
            );
            return;
        }
        const entries = cached.preparation.locationMap.entries.filter(
            (entry) => entry.page === selectedPage,
        );
        const first = entries[0];
        const last = entries[entries.length - 1];
        const markdown =
            first && last
                ? cached.preparation.markdown.slice(first.start, last.end)
                : "";
        preview.innerHTML = sanitizedMarkdownPreview(markdown);
    }

    function renderInspection() {
        updateControls();
        renderPreview();
        const currentWarnings = [
            ...(cached?.artifact.warnings ?? []),
            ...(cached?.artifact.pages[selectedPage - 1]?.warnings ?? []),
        ];
        if (warnings) warnings.textContent = currentWarnings.join("\n");
        if (warningsGroup) warningsGroup.hidden = currentWarnings.length === 0;
    }

    function cancel() {
        generation++;
        abort?.abort();
        abort = undefined;
        paused = false;
        resumeBoundary?.();
        resumeBoundary = undefined;
        const pauseButton = document.getElementById("pauseInspection");
        pauseButton?.setAttribute("aria-pressed", "false");
        updateControls();
        setStatus("Cancelled");
    }

    function documentChanged() {
        cancel();
        cached = undefined;
        selectedPage = 1;
        preview?.replaceChildren();
        renderInspection();
        setStatus(host.getInput() ? "Ready" : "No PDF loaded");
    }

    async function extract(
        options: Pick<
            PdfExtractionOptions,
            "maxPages" | "maxTextChars" | "maxBlocks"
        > = {},
    ) {
        const input = host.getInput();
        if (!input || disposed) return;
        const key = inspectionCacheKey(input, host.pdfjsVersion, options);
        if (cached?.key === key) return cached;
        cancel();
        cached = undefined;
        preview?.replaceChildren();
        renderInspection();
        const job = generation;
        const controller = new AbortController();
        abort = controller;
        updateControls();
        setStatus(`Extracting 0/${input.document.numPages}`);
        const signal = controller.signal;
        const wrapped = new Proxy(input.document, {
            get(target, property) {
                if (property === "getPage")
                    return async (page: number) => {
                        if (paused && !signal.aborted)
                            await new Promise<void>((resolve) => {
                                resumeBoundary = resolve;
                            });
                        if (
                            signal.aborted ||
                            job !== generation ||
                            host.getInput()?.document !== input.document
                        )
                            throw new DOMException("Cancelled", "AbortError");
                        return target.getPage(page);
                    };
                const value = Reflect.get(target, property, target);
                return typeof value === "function" ? value.bind(target) : value;
            },
        });
        try {
            const result = await extractPdfMarkdown(
                wrapped,
                (done, total) =>
                    setStatus(
                        `${paused ? "Pausing" : done === total ? "Finalizing" : "Extracting"} ${done}/${total}`,
                    ),
                {
                    ...options,
                    signal,
                    byteHash: input.byteHash,
                    pdfjsVersion: host.pdfjsVersion,
                },
            );
            if (!result.artifact)
                throw new Error("Extractor returned no inspection artifact.");
            if (
                signal.aborted ||
                job !== generation ||
                host.getInput()?.document !== input.document
            )
                return;
            setStatus("Preparing Markdown and locations");
            const preparation = await preparePdfCapture(result.artifact);
            if (
                signal.aborted ||
                job !== generation ||
                host.getInput()?.document !== input.document
            )
                return;
            cached = { key, artifact: result.artifact, preparation };
            renderInspection();
            setStatus(`Complete: ${result.pageCount} pages`);
            return cached;
        } catch (error) {
            if (job === generation && !signal.aborted)
                setStatus(
                    error instanceof Error
                        ? error.message
                        : "Extraction failed",
                );
        } finally {
            if (job === generation) {
                abort = undefined;
                updateControls();
            }
        }
    }

    async function open(file: File) {
        const job = ++openGeneration;
        try {
            if (!file.size || file.size > MAX_LOCAL_PDF_BYTES)
                throw new RangeError("PDF must be nonempty and at most 50 MB.");
            host.beginLocalOpen?.();
            documentChanged();
            await openLocalPdf(file, async (data, title) => {
                if (job !== openGeneration || disposed) return;
                await host.load(data, title);
            });
        } catch (error) {
            if (job === openGeneration && !disposed)
                setStatus(
                    error instanceof Error ? error.message : "Open failed",
                );
        }
    }

    function download() {
        if (!cached) return;
        const text = cached.preparation.markdown;
        const url = URL.createObjectURL(
            new Blob([text], {
                type: "text/markdown;charset=utf-8",
            }),
        );
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = "pdf-extraction.md";
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 0);
    }

    const picker = document.getElementById(
        "localPdfFile",
    ) as HTMLInputElement | null;
    listen(document.getElementById("openLocalPdf"), "click", () =>
        picker?.click(),
    );
    listen(picker, "change", () => {
        const file = picker?.files?.[0];
        if (picker) picker.value = "";
        if (file) void open(file);
    });
    listen(container, "dragover", (event) => {
        event.preventDefault();
    });
    listen(container, "drop", (event) => {
        event.preventDefault();
        const files = (event as DragEvent).dataTransfer?.files;
        if (files?.length !== 1) {
            setStatus("Open one PDF at a time.");
            return;
        }
        void open(files[0]);
    });
    listen(document.getElementById("inspectPdf"), "click", () => {
        if (panel) panel.hidden = !panel.hidden;
        document
            .getElementById("inspectPdf")
            ?.setAttribute("aria-expanded", String(!panel?.hidden));
    });
    listen(document.getElementById("extractPdf"), "click", () => {
        void extract();
    });
    listen(document.getElementById("cancelInspection"), "click", cancel);
    listen(document.getElementById("pauseInspection"), "click", () => {
        if (!abort) return;
        paused = !paused;
        document
            .getElementById("pauseInspection")
            ?.setAttribute("aria-pressed", String(paused));
        if (!paused) {
            resumeBoundary?.();
            resumeBoundary = undefined;
        }
        setStatus(
            paused ? "Paused at next page boundary (memory only)" : "Resuming",
        );
    });
    listen(document.getElementById("downloadPdfMarkdown"), "click", () =>
        download(),
    );
    const onPage = () => {
        selectedPage = host.getCurrentPage();
        renderInspection();
    };
    host.eventBus.on("pagechanging", onPage);
    listeners.push(() => host.eventBus.off("pagechanging", onPage));
    renderInspection();
    return {
        extract,
        cancel,
        documentChanged,
        getArtifact: () => cached?.artifact,
        getCache: () => cached,
        getBytes: () => host.getInput()?.bytes.slice(),
        getCaptureInput: host.getInput,
        pause: () => {
            if (abort) paused = true;
        },
        resume: () => {
            paused = false;
            resumeBoundary?.();
            resumeBoundary = undefined;
        },
        destroy: () => {
            disposed = true;
            openGeneration++;
            cancel();
            cached = undefined;
            listeners.forEach((remove) => remove());
        },
    };
}

export type PdfInspectionController = ReturnType<typeof setupPdfInspection>;
