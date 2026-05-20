// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Origin allowlist for the markdown view server (HTTP preview + Yjs
 * collaboration WebSocket).
 *
 * Allowed:
 *  - `http(s)://localhost(:port)`, `http(s)://127.0.0.1(:port)`, and
 *    `http(s)://[::1](:port)` (loopback browser tabs and the Electron
 *    shell's inline browser).
 *  - **No Origin header** — same-origin XHR/fetch from the preview page
 *    itself, plus Node `ws`/HTTP clients. The server binds to localhost,
 *    so this is loopback-restricted at the OS level.
 *
 * Anything else is rejected with HTTP 403 (HTTP routes) or 403 on the
 * upgrade response (WebSocket).
 */
export function isAllowedViewOrigin(origin: string | undefined): boolean {
    if (origin === undefined || origin === "" || origin === "null") {
        return true;
    }
    try {
        const u = new URL(origin);
        if (u.protocol !== "http:" && u.protocol !== "https:") {
            return false;
        }
        return (
            u.hostname === "localhost" ||
            u.hostname === "127.0.0.1" ||
            u.hostname === "[::1]"
        );
    } catch {
        return false;
    }
}
