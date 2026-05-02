// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Escape characters that are unsafe in raw HTML so untrusted strings
 * can be embedded inside HTML notification content without enabling
 * markup injection.  Use this anywhere user-supplied or backend-
 * supplied text is interpolated into an HTML string passed to
 * `addNotificationMessage({ type: "html", content })` or similar.
 */
export function escapeHtml(str: string): string {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
