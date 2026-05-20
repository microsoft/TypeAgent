// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Origin allowlist for the browser views server (PDF viewer + other
 * per-session HTML views forked as a child process by the browser
 * agent).
 *
 * Distinct from `agents/browser/src/agent/originAllowlist.mts`, which
 * gates the WS bridge used by the typeagent Chrome/Edge extension. The
 * views server is consumed by:
 *  - the Electron shell's inline browser (origin
 *    `http(s)://localhost(:port)` / `127.0.0.1` / `[::1]`),
 *  - external loopback browser tabs the user opens manually,
 *  - same-origin XHR/fetch from the served HTML (Origin absent or the
 *    server's own loopback origin).
 *
 * No browser-extension scheme is accepted here — this listener does not
 * back any extension UI.
 *
 * Anything else is rejected with HTTP 403 before the route handler runs.
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
