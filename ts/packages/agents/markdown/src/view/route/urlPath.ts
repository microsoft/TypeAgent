// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Parse the nested user-relative document path from a browser URL like
// `/document/team/2025/plan` or `/document/my%20notes`. Every segment is
// URL-decoded independently so slashes and spaces round-trip cleanly.
// Returns null when the URL does not target the /document/... route or
// when any segment fails to decode.
export function parseDocumentPathFromUrl(pathname: string): string | null {
    if (typeof pathname !== "string") {
        return null;
    }
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
            // A leading, trailing, or double slash points at nothing.
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

// Normalize a raw user-relative path so it can be compared to a bound
// relative path reported by the service. The service always includes
// the `.md` extension in `boundRelativePath`; the browser may or may
// not have appended it depending on the caller. Callers on the browser
// side pass the display form (without `.md`) or the fully-qualified
// form, so we accept either and always return the `.md` form.
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
