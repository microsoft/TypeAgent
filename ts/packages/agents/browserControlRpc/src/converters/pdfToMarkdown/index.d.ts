// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// TypeAgent-authored declarations for upstream engine.js and export.js:
// https://github.com/beatrizalmeidaf/papero-pdf-text-extractor/tree/f9e92cbc0224d1413c11dda15b284ee41b9fc48f/web/assets

import type {
    DocumentInitParameters,
    PDFDocumentLoadingTask,
    PDFDocumentProxy,
    PDFWorker,
} from "pdfjs-dist/types/src/display/api.js";

export type PdfBlockType =
    | "heading"
    | "paragraph"
    | "list_item"
    | "table"
    | "formula"
    | "figure"
    | "caption"
    | "code"
    | "header"
    | "footer"
    | "page_number";

export interface PdfRun {
    text: string;
    bold?: boolean;
    italic?: boolean;
    script?: "super" | "sub";
}

export interface PdfImage {
    name: string;
    mime: "image/png";
    width: number;
    height: number;
    data: string;
}

export interface MarkdownBlock {
    type: PdfBlockType;
    text: string;
    level?: number;
    marker?: string;
    rows?: string[][];
    latex?: string;
    number?: string;
    caption?: string;
    runs?: PdfRun[];
    image?: PdfImage;
}

export interface PdfBlock extends MarkdownBlock {
    id: string;
    order: number;
    bbox: [number, number, number, number] | null;
    style?: {
        size: number;
        bold: boolean;
        pt?: number;
        font?: string;
        tracking?: number;
    };
    format?: {
        align: "left" | "right" | "center" | "justify";
        indent?: number;
        first_line?: number;
        line_spacing?: number;
        leading?: number;
    };
}

export interface PdfPage {
    number: number;
    width: number;
    height: number;
    scanned: boolean;
    blocks: PdfBlock[];
}

export interface MarkdownDocument {
    pages: { number: number; blocks: MarkdownBlock[] }[];
}

export interface PdfDocument extends MarkdownDocument {
    schema: "pdf-text-api/document@1";
    engine: "pdf.js";
    source_type: "application/pdf";
    page_count: number;
    pages_extracted: number;
    likely_scanned: boolean;
    metadata: Partial<
        Record<
            | "title"
            | "author"
            | "subject"
            | "keywords"
            | "producer"
            | "creator_tool"
            | "created"
            | "modified"
            | "pdf_version",
            string
        >
    >;
    elapsed_ms: number;
    timings: { layout_ms: number; total_ms: number };
    warnings: string[];
    pages: PdfPage[];
}

export interface ExtractOptions {
    maxTextChars?: number;
    maxBlocks?: number;
    pages?: string;
    password?: string;
    tables?: boolean;
    formulas?: boolean;
    images?: boolean;
    imageScale?: number;
    concurrency?: 1 | 2 | 3 | 4;
    signal?: AbortSignal;
    retainPdf?: boolean;
    worker?: PDFWorker;
    getDocument?: (
        parameters: DocumentInitParameters,
    ) => PDFDocumentLoadingTask;
    getDocumentOptions?: Omit<
        DocumentInitParameters,
        | "data"
        | "url"
        | "password"
        | "worker"
        | "fontExtraProperties"
        | "isEvalSupported"
    >;
    onPassword?: (
        updatePassword: (password: string) => void,
        reason: number,
    ) => void;
    onProgress?: (done: number, total: number) => void;
}

export interface ExtractResult {
    doc: PdfDocument;
    pdf: PDFDocumentProxy | null;
    destroy: () => Promise<void>;
}

export interface MarkdownOptions {
    images?: "none" | "ref" | "embed";
    pageBreaks?: boolean;
    math?: "unicode" | "latex";
}

export function extractExistingDocument(
    pdf: PDFDocumentProxy,
    options?: ExtractOptions,
): Promise<ExtractResult>;
export function figureWords(text: string): string[];
export function toMarkdown(
    document: MarkdownDocument,
    options?: MarkdownOptions,
): string;
