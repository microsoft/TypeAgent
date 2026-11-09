// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "node:path";
import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import type {
    DocumentIngestRequest,
    RevisionAssetInput,
} from "@typeagent/memory-service";
import { validateAssetInputs } from "@typeagent/memory-service";
import type {
    RunbookAcquisitionIssue,
    RunbookImportFile,
} from "@typeagent/browser-control-rpc/runbookImportViewTypes";

export type AcquiredDocument = Omit<DocumentIngestRequest, "corpusId">;
export interface RunbookAcquisition {
    documents: AcquiredDocument[];
    issues: RunbookAcquisitionIssue[];
}
const imageMime: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
};
const documentExtensions = [".md", ".markdown", ".html", ".htm", ".txt"];

export function selectedRelativePath(value: string): string {
    if (
        !value ||
        value.length > 1024 ||
        /[\\:\0]/.test(value) ||
        value.startsWith("/") ||
        value.split("/").some((part) => !part || part === "." || part === "..")
    )
        throw new Error(
            "Selected file must have a relative tree path; traversal, symlinks and host paths are not accepted.",
        );
    return value;
}

export function selectedFileBytes(file: RunbookImportFile): Buffer {
    const bytes = Buffer.from(file.contentBase64, "base64");
    if (bytes.toString("base64") !== file.contentBase64)
        throw new Error("Selected file has invalid base64 bytes.");
    if (!bytes.length) throw new Error("Selected file is empty.");
    return bytes;
}

export function runbookTitle(
    content: string,
    fallback: string,
    html: boolean,
): string {
    const title = html
        ? cheerio.load(content)("title").first().text().trim()
        : /^#\s+(.+)$/m.exec(content)?.[1]?.trim();
    return (title || fallback).slice(0, 8192);
}

function imageReferences(content: string, html: boolean): string[] {
    if (html) {
        const references: string[] = [];
        cheerio
            .load(content)("img[src]")
            .each((_index, image) => {
                const src = image.attribs.src;
                if (src) references.push(src);
            });
        return [...new Set(references)];
    }
    const references = Array.from(
        content.matchAll(
            /!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\s*\)/g,
        ),
        (match) => match[1] ?? match[2],
    );
    const definitions = new Map(
        Array.from(
            content.matchAll(/^\s*\[([^\]]+)\]:\s*(?:<([^>]+)>|(\S+))/gm),
            (match) => [match[1].toLowerCase(), match[2] ?? match[3]],
        ),
    );
    for (const match of content.matchAll(/!\[([^\]]*)\]\[([^\]]*)\]/g)) {
        const reference = definitions.get((match[2] || match[1]).toLowerCase());
        if (reference) references.push(reference);
    }
    return [...new Set(references)];
}

function referencedSelectedPath(
    documentPath: string,
    reference: string,
): string {
    if (/^(?:[a-z][a-z0-9+.-]*:|[/\\])/i.test(reference))
        throw new Error(
            "Remote, data and absolute image references are not fetched.",
        );
    const decoded = decodeURIComponent(reference.split(/[?#]/)[0]);
    if (/[\\:\0]/.test(decoded))
        throw new Error("Image reference is not a local selected-tree path.");
    const resolved = path.posix.normalize(
        path.posix.join(path.posix.dirname(documentPath), decoded),
    );
    const root = documentPath.includes("/")
        ? documentPath.split("/")[0]
        : undefined;
    if (
        resolved === ".." ||
        resolved.startsWith("../") ||
        (root && !resolved.startsWith(`${root}/`))
    )
        throw new Error("Image reference escapes the selected relative tree.");
    return selectedRelativePath(resolved);
}

function acquireImages(
    documentPath: string,
    references: string[],
    files: Map<string, RunbookImportFile>,
    issues: RunbookAcquisitionIssue[],
    inputIndex: number,
) {
    const assets: RevisionAssetInput[] = [];
    const links: Array<{ reference: string; assetName: string }> = [];
    for (const reference of references) {
        try {
            const selectedPath = referencedSelectedPath(
                documentPath,
                reference,
            );
            const file = files.get(selectedPath);
            if (!file)
                throw new Error("Image was not among the user-selected files.");
            const mimeType =
                imageMime[path.posix.extname(selectedPath).toLowerCase()];
            if (!mimeType)
                throw new Error("Unsupported selected image format.");
            const bytes = selectedFileBytes(file);
            const digest = createHash("sha256")
                .update(
                    path.posix.relative(
                        path.posix.dirname(documentPath),
                        selectedPath,
                    ),
                )
                .digest("hex")
                .slice(0, 12);
            const fullName = `${digest}-${path.posix.basename(selectedPath)}`;
            const assetName = fullName.slice(0, 200);
            if (fullName.length > 200)
                issues.push({
                    member: documentPath,
                    inputIndex,
                    state: "warning",
                    reason: `Image display name abbreviated for ${reference}; original image bytes and the source reference were not truncated.`,
                });
            const asset = {
                name: assetName,
                mimeType,
                bytes: new Uint8Array(bytes),
                ...(file.description ? { description: file.description } : {}),
            };
            validateAssetInputs([asset]);
            const existing = assets.find((item) => item.name === assetName);
            if (existing && !Buffer.from(existing.bytes).equals(bytes))
                throw new Error(
                    "Selected images have conflicting display identities; the conflicting image was not attached.",
                );
            if (!existing) assets.push(asset);
            links.push({ reference, assetName });
        } catch (error) {
            issues.push({
                member: documentPath,
                inputIndex,
                state: "warning",
                reason: `Image ${reference}: ${error instanceof Error ? error.message : String(error)}`,
            });
        }
    }
    validateAssetInputs(assets);
    return { assets, links };
}

export function acquireSelectedRunbooks(
    kind: "folder" | "wiki",
    selected: RunbookImportFile[],
): RunbookAcquisition {
    const files = new Map<string, RunbookImportFile>();
    for (const file of selected) {
        const relativePath = selectedRelativePath(file.relativePath);
        if (files.has(relativePath))
            throw new Error(`Duplicate selected path: ${relativePath}`);
        files.set(relativePath, file);
    }
    const documents: AcquiredDocument[] = [];
    const issues: RunbookAcquisitionIssue[] = [];
    const usedImages = new Set<string>();
    for (const [inputIndex, file] of selected.entries()) {
        const extension = path.posix.extname(file.relativePath).toLowerCase();
        if (imageMime[extension]) continue;
        try {
            if (!documentExtensions.includes(extension))
                throw new Error(
                    "Unsupported format; select plain Markdown, HTML or text. Archives and extraction are unavailable.",
                );
            const text = new TextDecoder("utf-8", {
                fatal: true,
                ignoreBOM: true,
            }).decode(selectedFileBytes(file));
            const html = [".html", ".htm"].includes(extension);
            const { assets, links } = acquireImages(
                file.relativePath,
                imageReferences(text, html),
                files,
                issues,
                inputIndex,
            );
            for (const link of links)
                usedImages.add(
                    referencedSelectedPath(file.relativePath, link.reference),
                );
            documents.push({
                source: {
                    sourceType: html
                        ? "html"
                        : extension === ".txt"
                          ? "text"
                          : "markdown",
                    title: runbookTitle(
                        text,
                        path.posix.basename(file.relativePath),
                        html,
                    ),
                    canonicalUri: `urn:typeagent:runbook-import:${kind}:${encodeURIComponent(file.relativePath)}`,
                    ...(html
                        ? { html: text }
                        : extension === ".txt"
                          ? { text }
                          : { markdown: text }),
                    assets,
                    metadata: {
                        runbookImport: {
                            kind,
                            relativePath: file.relativePath,
                            originalInputIndex: inputIndex,
                            imageReferences: links,
                        },
                    },
                },
            });
        } catch (error) {
            issues.push({
                member: file.relativePath,
                inputIndex,
                state: "rejected",
                reason: error instanceof Error ? error.message : String(error),
            });
        }
    }
    for (const [inputIndex, file] of selected.entries()) {
        if (
            imageMime[path.posix.extname(file.relativePath).toLowerCase()] &&
            !usedImages.has(file.relativePath)
        )
            issues.push({
                member: file.relativePath,
                inputIndex,
                state: "warning",
                reason: "Selected image has no recognized local reference in an acquired document; it was not attached.",
            });
    }
    return { documents, issues };
}
