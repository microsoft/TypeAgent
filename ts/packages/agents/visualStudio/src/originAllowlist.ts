// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Origin allowlist for the visualStudio agent's WebSocket bridge.
 *
 * The only legitimate client is the in-process Visual Studio extension
 * (`host/csharp/Bridge/AgentBridgeClient.cs`), which uses
 * `System.Net.WebSockets.ClientWebSocket`. That client does **not** send
 * an `Origin` header, so we accept missing/empty Origin.
 *
 * Allowed:
 *  - **No Origin header** — the C# `ClientWebSocket` doesn't set one.
 *  - `http(s)://localhost(:port)`, `http(s)://127.0.0.1(:port)`,
 *    `http(s)://[::1](:port)` — loopback web clients (manual debugging,
 *    future webview consumers). The server already binds to loopback, so
 *    this is OS-level restricted as well.
 *
 * Anything else (including arbitrary `https://example.com`) is rejected
 * with HTTP 403 before the `connection` event fires.
 *
 * Every per-agent listener that binds to an ephemeral port via the
 * PortRegistrar must gate Origin so those ports can't be dialed by
 * arbitrary web pages on the same host.
 *
 * Kept in sync with `agents/code/src/originAllowlist.ts` and
 * `agents/browser/src/agent/originAllowlist.mts`; duplicated rather than
 * shared because each agent's allowed client surface differs (VS Code
 * webview schemes for `code`, Chrome/Firefox extension schemes for
 * `browser`, none for `visualStudio`).
 */
export function isAllowedAgentOrigin(origin: string | undefined): boolean {
    if (origin === undefined || origin === "" || origin === "null") {
        return true;
    }
    try {
        const u = new URL(origin);
        if (u.protocol !== "http:" && u.protocol !== "https:") {
            return false;
        }
        // Node's URL parser preserves IPv6 brackets in `hostname`
        // (e.g. `new URL("http://[::1]:8080").hostname === "[::1]"`),
        // so match the bracketed form.
        return (
            u.hostname === "localhost" ||
            u.hostname === "127.0.0.1" ||
            u.hostname === "[::1]"
        );
    } catch {
        return false;
    }
}
