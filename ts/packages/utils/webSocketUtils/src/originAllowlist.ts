// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Build the Origin gate used by per-agent WebSocket bridges that bind to
 * an ephemeral, loopback-only port via the dispatcher's PortRegistrar.
 *
 * Every predicate returned from this factory shares the same baseline:
 *
 *  - `http(s)://localhost(:port)`, `http(s)://127.0.0.1(:port)`, and
 *    `http(s)://[::1](:port)` (also the unbracketed `::1` form) are
 *    allowed (loopback web clients on either IPv4 or IPv6; Node's URL
 *    parser preserves IPv6 brackets in `hostname`, so we match the
 *    bracketed form, while the unbracketed form is accepted defensively
 *    against URL parser/serializer differences across runtimes).
 *  - A missing/empty/`"null"` Origin is allowed — Node `ws` clients and
 *    other non-browser callers don't send Origin, and the listener binds
 *    to loopback so this remains OS-level restricted.
 *  - All other `http(s)` origins are rejected; non-`http(s)` schemes are
 *    rejected unless explicitly named in {@link extensionSchemes}.
 *
 * Agents layer in their own additional client surfaces (browser
 * extensions, VS Code webviews, etc.) by passing scheme prefixes via
 * {@link OriginAllowlistOptions.extensionSchemes}. Each entry is
 * matched as a literal prefix against the Origin string (e.g.
 * `"chrome-extension://"` accepts `chrome-extension://abc123`).
 *
 * Returned predicates are pure and reusable; build once per agent and
 * call from the WS server's `verifyClient` so denied clients are
 * rejected with HTTP 403 before the `connection` event fires.
 */
export type OriginAllowlistOptions = {
    /**
     * Additional URL-scheme prefixes (e.g. `"chrome-extension://"`,
     * `"vscode-webview://"`) whose origins should be accepted. Matched
     * as a literal prefix on the raw Origin string, so callers must
     * include the trailing `://`.
     */
    extensionSchemes?: readonly string[];
};

/**
 * Returns a predicate that decides whether an incoming WebSocket
 * upgrade's `Origin` header should be accepted. See
 * {@link OriginAllowlistOptions} for the shared policy.
 */
export function createAgentOriginAllowlist(
    options: OriginAllowlistOptions = {},
): (origin: string | undefined) => boolean {
    const schemes = options.extensionSchemes ?? [];
    return (origin: string | undefined): boolean => {
        if (origin === undefined || origin === "" || origin === "null") {
            // No Origin header: legitimate for Node `ws` and other
            // non-browser clients.
            return true;
        }
        for (const scheme of schemes) {
            if (origin.startsWith(scheme)) {
                return true;
            }
        }
        try {
            const u = new URL(origin);
            if (u.protocol !== "http:" && u.protocol !== "https:") {
                return false;
            }
            // Also accept the unbracketed `::1` for robustness against
            // URL parser/serializer differences across runtimes (other
            // SSRF guards in the repo, e.g.
            // examples/workflow/engine/src/builtinTasks.ts, accept both).
            return (
                u.hostname === "localhost" ||
                u.hostname === "127.0.0.1" ||
                u.hostname === "[::1]" ||
                u.hostname === "::1"
            );
        } catch {
            return false;
        }
    };
}
