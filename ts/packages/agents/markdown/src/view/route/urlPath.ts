// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export function parseDocumentPathFromUrl(pathname: string): string | null {
    const match = pathname.match(/^\/document\/(.+)$/);
    if (match === null) {
        return null;
    }
    const encoded = match[1].replace(/\/+$/, "");
    if (encoded.length === 0) {
        return null;
    }

    const segments: string[] = [];
    for (const segment of encoded.split("/")) {
        if (segment.length === 0) {
            return null;
        }
        try {
            const decoded = decodeURIComponent(segment);
            if (
                decoded.length === 0 ||
                decoded.includes("/") ||
                decoded.includes("\\")
            ) {
                return null;
            }
            segments.push(decoded);
        } catch {
            return null;
        }
    }
    return segments.join("/");
}

export function ensureMarkdownExtension(relativePath: string): string {
    return relativePath.toLowerCase().endsWith(".md")
        ? relativePath
        : `${relativePath}.md`;
}

export function encodeDocumentPathForUrl(relativePath: string): string {
    const withoutExtension = relativePath.replace(/\.md$/i, "");
    return withoutExtension
        .split("/")
        .map((segment) => encodeURIComponent(segment))
        .join("/");
}
