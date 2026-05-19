// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Origin allowlist for the browser agent's WebSocket server.
 *
 * Allowed:
 *  - `chrome-extension://...` and `moz-extension://...` (the typeagent
 *    Chrome / Edge browser extensions).
 *  - `http(s)://localhost(:port)`, `http(s)://127.0.0.1(:port)`, and
 *    `http(s)://[::1](:port)` (the Electron shell's inline browser,
 *    plus loopback dev clients on either IPv4 or IPv6).
 *  - **No Origin header** — Node `ws` clients (and any non-browser caller
 *    that hits the bridge over loopback) don't send Origin. The bridge
 *    binds to localhost, so this is loopback-restricted at the OS level.
 *
 * Anything else is rejected with HTTP 403 before the `connection` event
 * fires. Every per-agent listener that binds to an ephemeral port via the
 * PortRegistrar must gate Origin so those ports can't be dialed by
 * arbitrary web pages on the same host.
 */
export function isAllowedAgentOrigin(origin: string | undefined): boolean {
    if (origin === undefined || origin === "" || origin === "null") {
        // No Origin header: legitimate for Node `ws` clients.
        return true;
    }
    if (
        origin.startsWith("chrome-extension://") ||
        origin.startsWith("moz-extension://")
    ) {
        return true;
    }
    try {
        const u = new URL(origin);
        if (u.protocol !== "http:" && u.protocol !== "https:") {
            return false;
        }
        // Node's URL parser preserves IPv6 brackets in `hostname`
        // (e.g. `new URL("http://[::1]:8080").hostname === "[::1]"`),
        // so match the bracketed form. Also accept the unbracketed
        // `::1` for robustness against URL parser/serializer
        // differences across runtimes (other SSRF guards in the repo,
        // e.g. examples/workflow/engine/src/builtinTasks.ts, accept
        // both).
        return (
            u.hostname === "localhost" ||
            u.hostname === "127.0.0.1" ||
            u.hostname === "[::1]" ||
            u.hostname === "::1"
        );
    } catch {
        return false;
    }
}
