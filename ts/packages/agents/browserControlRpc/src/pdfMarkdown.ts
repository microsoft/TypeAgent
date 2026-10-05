// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { PDFDocumentProxy } from "pdfjs-dist/types/src/display/api.js";
import type {
    MarkdownDocument,
    MarkdownBlock,
    PdfBlock,
    PdfPage,
} from "./converters/pdfToMarkdown/index.js";
import { toMarkdown, figureWords } from "./converters/pdfToMarkdown/export.js";
export { toMarkdown as renderPdfSemanticDocument } from "./converters/pdfToMarkdown/export.js";

export type PdfBBox = [number, number, number, number];
export interface PdfExtractionPage {
    page: number;
    width: number;
    height: number;
    rotation: number;
    printedLabel?: string;
    warnings: string[];
    detectedStructures?: {
        kind: "table" | "formula" | "figure";
        source: "pdfjs-structure-tree";
        contentIds: string[];
    }[];
}
export interface PdfExtractionBlock {
    id: string;
    page: number;
    kind:
        | "paragraph"
        | "heading"
        | "list"
        | "table"
        | "formula"
        | "figure"
        | "furniture";
    order: number;
    bbox: PdfBBox;
    text: string;
    headingLevel?: number;
    rows?: string[][];
}
export interface PdfExtractionArtifact {
    schemaVersion: 1;
    extractorVersion: string;
    pdfjsVersion: string;
    byteHash: string;
    pageCount: number;
    pages: PdfExtractionPage[];
    blocks: PdfExtractionBlock[];
    warnings: string[];
    coverage: number[];
    semanticDocument?: MarkdownDocument;
}
export interface PdfLocationMap {
    schemaVersion: 1;
    offsetUnit: "utf16";
    contentHash: string;
    entries: {
        start: number;
        end: number;
        page: number;
        blockId: string;
        bbox: PdfBBox;
    }[];
}
export interface PdfCapturePreparation {
    artifactDigest: string;
    markdown: string;
    locationMap: PdfLocationMap;
}
export interface PdfExtractionOptions {
    signal?: AbortSignal;
    byteHash?: string;
    pdfjsVersion?: string;
    maxPages?: number;
    maxTextChars?: number;
    maxBlocks?: number;
}
export type PdfTextDocument = PDFDocumentProxy;
export type PdfTextPage = Awaited<ReturnType<PDFDocumentProxy["getPage"]>>;
export interface PdfMarkdownResult {
    markdown: string;
    pageCount: number;
    emptyPages: number[];
    artifact?: PdfExtractionArtifact;
}
export const PDF_EXTRACTOR_VERSION =
    "pdfToMarkdown/f9e92cbc0224d1413c11dda15b284ee41b9fc48f";

function checkAbort(signal?: AbortSignal) {
    if (signal?.aborted)
        throw new DOMException("PDF extraction cancelled", "AbortError");
}
function limit(value: number | undefined, fallback: number, name: string) {
    const result = value ?? fallback;
    if (!Number.isSafeInteger(result) || result < 1)
        throw new RangeError(`Invalid ${name}`);
    return result;
}
function semanticBlock(block: MarkdownBlock): MarkdownBlock {
    return {
        type: block.type,
        text: block.text,
        ...(block.level !== undefined ? { level: block.level } : {}),
        ...(block.marker !== undefined ? { marker: block.marker } : {}),
        ...(block.rows !== undefined
            ? { rows: block.rows.map((row) => [...row]) }
            : {}),
        ...(block.latex !== undefined ? { latex: block.latex } : {}),
        ...(block.number !== undefined ? { number: block.number } : {}),
        ...(block.caption !== undefined ? { caption: block.caption } : {}),
        ...(block.runs !== undefined
            ? {
                  runs: block.runs.map((run) => ({
                      text: run.text,
                      ...(run.bold !== undefined ? { bold: run.bold } : {}),
                      ...(run.italic !== undefined
                          ? { italic: run.italic }
                          : {}),
                      ...(run.script !== undefined
                          ? { script: run.script }
                          : {}),
                  })),
              }
            : {}),
    };
}
function canonicalSemantic(document: MarkdownDocument): MarkdownDocument {
    return {
        pages: document.pages.map((page) => ({
            number: page.number,
            blocks: page.blocks.map(semanticBlock),
        })),
    };
}
export function pdfSemanticPageHasText(
    page: MarkdownDocument["pages"][number],
): boolean {
    return page.blocks.some((block) => {
        if (["header", "footer", "page_number"].includes(block.type))
            return false;
        if (block.type === "figure") return figureWords(block.text).length > 0;
        if (block.type === "table" && block.rows)
            return block.rows.some((row) => row.some((cell) => cell.trim()));
        if (block.type === "formula")
            return Boolean((block.latex || block.text).trim());
        return Boolean(
            (block.runs?.length
                ? block.runs.map((run) => run.text).join("")
                : block.text
            ).trim(),
        );
    });
}
function inspectionBlock(block: PdfBlock, page: PdfPage): PdfExtractionBlock {
    const kind = ["header", "footer", "page_number"].includes(block.type)
        ? "furniture"
        : block.type === "list_item"
          ? "list"
          : ["caption", "code"].includes(block.type)
            ? "paragraph"
            : (block.type as PdfExtractionBlock["kind"]);
    const bbox = block.bbox ?? [0, 0, 0, 0];
    return {
        id: block.id,
        page: page.number,
        kind,
        order: block.order,
        bbox: [
            Math.max(0, Math.min(page.width, bbox[0])),
            Math.max(0, Math.min(page.height, bbox[1])),
            Math.max(0, Math.min(page.width, bbox[2])),
            Math.max(0, Math.min(page.height, bbox[3])),
        ],
        text: block.text,
        ...(block.level !== undefined ? { headingLevel: block.level } : {}),
        ...(block.rows !== undefined ? { rows: block.rows } : {}),
    };
}
export async function extractPdfMarkdown(
    document: PdfTextDocument,
    onProgressOrOptions:
        | ((completed: number, total: number) => void)
        | PdfExtractionOptions = () => {},
    extractionOptions: PdfExtractionOptions = {},
): Promise<PdfMarkdownResult> {
    const options =
        typeof onProgressOrOptions === "function"
            ? extractionOptions
            : onProgressOrOptions;
    const progress =
        typeof onProgressOrOptions === "function"
            ? onProgressOrOptions
            : () => {};
    const maxPages = limit(options.maxPages, 10000, "maxPages");
    const maxTextChars = limit(options.maxTextChars, 10000000, "maxTextChars");
    const maxBlocks = limit(options.maxBlocks, 100000, "maxBlocks");
    checkAbort(options.signal);
    if (!Number.isSafeInteger(document.numPages) || document.numPages < 1)
        throw new RangeError("PDF pageCount must be positive");
    if (document.numPages > maxPages)
        throw new RangeError("PDF exceeds maxPages");
    const { extractExistingDocument } = await import(
        "./converters/pdfToMarkdown/index.js"
    );
    checkAbort(options.signal);
    const { doc } = await extractExistingDocument(document, {
        ...(options.signal ? { signal: options.signal } : {}),
        images: false,
        maxTextChars,
        maxBlocks,
        onProgress: (done, total) => {
            checkAbort(options.signal);
            progress(done, total);
        },
    });
    checkAbort(options.signal);
    const semanticDocument = canonicalSemantic(doc);
    const markdown = toMarkdown(semanticDocument, {
        math: "latex",
        images: "none",
        pageBreaks: false,
    });
    if (markdown.length > maxTextChars)
        throw new RangeError("PDF exceeds maxTextChars");
    const emptyPages = semanticDocument.pages
        .filter((page) => !pdfSemanticPageHasText(page))
        .map((page) => page.number);
    if (emptyPages.length === document.numPages)
        throw new Error(
            "This PDF has no extractable text. OCR is not supported.",
        );
    const labels = await document.getPageLabels();
    checkAbort(options.signal);
    const artifact: PdfExtractionArtifact = {
        schemaVersion: 1,
        extractorVersion: PDF_EXTRACTOR_VERSION,
        pdfjsVersion: options.pdfjsVersion ?? "5.3.31",
        byteHash: options.byteHash ?? "",
        pageCount: document.numPages,
        pages: doc.pages.map((page) => ({
            page: page.number,
            width: page.width,
            height: page.height,
            rotation: 0,
            ...(labels?.[page.number - 1] !== undefined
                ? { printedLabel: labels[page.number - 1] }
                : {}),
            warnings: page.scanned
                ? ["low-text-page: OCR is not supported."]
                : [],
        })),
        blocks: doc.pages.flatMap((page) =>
            page.blocks.map((block) => inspectionBlock(block, page)),
        ),
        warnings: doc.warnings,
        coverage: doc.pages.map((page) =>
            emptyPages.includes(page.number) ? 0 : 1,
        ),
        semanticDocument,
    };
    return { markdown, pageCount: document.numPages, emptyPages, artifact };
}
export function serializePdfArtifact(artifact: PdfExtractionArtifact): string {
    return JSON.stringify({
        schemaVersion: artifact.schemaVersion,
        extractorVersion: artifact.extractorVersion,
        pdfjsVersion: artifact.pdfjsVersion,
        byteHash: artifact.byteHash,
        pageCount: artifact.pageCount,
        pages: artifact.pages.map((page) => ({
            page: page.page,
            width: page.width,
            height: page.height,
            rotation: page.rotation,
            ...(page.printedLabel !== undefined
                ? { printedLabel: page.printedLabel }
                : {}),
            warnings: [...page.warnings],
            ...(page.detectedStructures !== undefined
                ? {
                      detectedStructures: page.detectedStructures.map(
                          (structure) => ({
                              kind: structure.kind,
                              source: structure.source,
                              contentIds: [...structure.contentIds],
                          }),
                      ),
                  }
                : {}),
        })),
        blocks: artifact.blocks.map((block) => ({
            id: block.id,
            page: block.page,
            kind: block.kind,
            order: block.order,
            bbox: [...block.bbox],
            text: block.text,
            ...(block.headingLevel !== undefined
                ? { headingLevel: block.headingLevel }
                : {}),
            ...(block.rows !== undefined
                ? { rows: block.rows.map((row) => [...row]) }
                : {}),
        })),
        warnings: [...artifact.warnings],
        coverage: [...artifact.coverage],
        ...(artifact.semanticDocument !== undefined
            ? { semanticDocument: canonicalSemantic(artifact.semanticDocument) }
            : {}),
    });
}
async function sha256(text: string) {
    const digest = await globalThis.crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(text),
    );
    return Array.from(new Uint8Array(digest), (value) =>
        value.toString(16).padStart(2, "0"),
    ).join("");
}
function renderTable(rows: string[][]) {
    const escape = (text: string) =>
        text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\n/g, "<br>");
    return [
        "<table>",
        ...rows.map(
            (row) =>
                `<tr>${row.map((cell) => `<td>${escape(cell)}</td>`).join("")}</tr>`,
        ),
        "</table>",
    ].join("\n");
}
function renderLegacy(artifact: PdfExtractionArtifact, prefix: string) {
    let markdown = prefix;
    const entries: PdfLocationMap["entries"] = [];
    for (const page of artifact.pages) {
        if (page.page > 1) markdown += "\n\n";
        markdown += `## Page ${page.page}\n\n`;
        const blocks = artifact.blocks
            .filter(
                (block) =>
                    block.page === page.page && block.kind !== "furniture",
            )
            .sort((left, right) => left.order - right.order);
        for (const [index, block] of blocks.entries()) {
            if (index) markdown += "\n";
            const start = markdown.length;
            markdown +=
                block.kind === "heading"
                    ? `${"#".repeat(block.headingLevel ?? 2)} ${block.text}`
                    : block.kind === "table" && block.rows
                      ? renderTable(block.rows)
                      : block.text;
            entries.push({
                start,
                end: markdown.length,
                page: block.page,
                blockId: block.id,
                bbox: [...block.bbox],
            });
        }
    }
    return { markdown, entries };
}
export async function preparePdfCapture(
    artifact: PdfExtractionArtifact,
): Promise<PdfCapturePreparation> {
    const snapshot = JSON.parse(
        serializePdfArtifact(artifact),
    ) as PdfExtractionArtifact;
    const artifactDigest = await sha256(serializePdfArtifact(snapshot));
    const prefix = [
        "---",
        "schemaVersion: 1",
        `byteHash: ${JSON.stringify(snapshot.byteHash)}`,
        `artifactDigest: ${JSON.stringify(artifactDigest)}`,
        `extractorVersion: ${JSON.stringify(snapshot.extractorVersion)}`,
        `pdfjsVersion: ${JSON.stringify(snapshot.pdfjsVersion)}`,
        `coverage: ${JSON.stringify(snapshot.coverage)}`,
        "---",
        "",
        "",
    ].join("\n");
    const rendered = snapshot.semanticDocument
        ? {
              markdown: toMarkdown(snapshot.semanticDocument, {
                  math: "latex",
                  images: "none",
                  pageBreaks: false,
              }),
              entries: [],
          }
        : renderLegacy(snapshot, prefix);
    return {
        artifactDigest,
        markdown: rendered.markdown,
        locationMap: {
            schemaVersion: 1,
            offsetUnit: "utf16",
            contentHash: await sha256(rendered.markdown),
            entries: rendered.entries,
        },
    };
}
