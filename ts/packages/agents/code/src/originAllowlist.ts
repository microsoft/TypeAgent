// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Origin allowlist for the code agent's WebSocket server.
 *
 * Allowed:
 *  - `vscode-webview://...`, `vscode-file://...`, and
 *    `vscode-resource://...` (the VS Code extension host's
 *    sandboxed surfaces).
 *  - `http(s)://localhost(:port)` and `http(s)://127.0.0.1(:port)`
 *    (loopback dev clients).
 *  - **No Origin header** — Node `ws` clients (and the VS Code
 *    extension's own `ws` client) don't send Origin. The server
 *    binds to localhost, so this is loopback-restricted at the OS
 *    level.
 *
 * Anything else is rejected with HTTP 403 before the `connection`
 * event fires. Per design §4.2, every per-agent listener migrated to
 * the PortRegistrar must gate Origin to keep ephemeral ports from
 * being dialed by arbitrary web pages on the same host.
 *
 * Kept in sync with `agents/browser/src/agent/originAllowlist.mts`;
 * duplicated rather than shared because the policies differ in which
 * extension scheme prefixes are accepted (Chrome/Firefox vs. VS Code).
 */
export function isAllowedAgentOrigin(origin: string | undefined): boolean {
    if (origin === undefined || origin === "" || origin === "null") {
        // No Origin header: legitimate for Node `ws` clients (the
        // VS Code extension uses one).
        return true;
    }
    if (
        origin.startsWith("vscode-webview://") ||
        origin.startsWith("vscode-file://") ||
        origin.startsWith("vscode-resource://")
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
