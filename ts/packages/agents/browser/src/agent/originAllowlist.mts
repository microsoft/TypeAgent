// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Origin allowlist for the browser agent's WebSocket server.
 *
 * Allowed:
 *  - `chrome-extension://...` and `moz-extension://...` (the typeagent
 *    Chrome / Edge browser extensions).
 *  - `http(s)://localhost(:port)` and `http(s)://127.0.0.1(:port)`
 *    (the Electron shell's inline browser, plus loopback dev clients).
 *  - **No Origin header** — Node `ws` clients (and any non-browser caller
 *    that hits the bridge over loopback) don't send Origin. The bridge
 *    binds to localhost, so this is loopback-restricted at the OS level.
 *
 * Anything else is rejected with HTTP 403 before the `connection` event
 * fires. Per design §4.2, every per-agent listener migrated to the
 * PortRegistrar must gate Origin to keep ephemeral ports from being
 * dialed by arbitrary web pages on the same host.
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
        return u.hostname === "localhost" || u.hostname === "127.0.0.1";
    } catch {
        return false;
    }
}
