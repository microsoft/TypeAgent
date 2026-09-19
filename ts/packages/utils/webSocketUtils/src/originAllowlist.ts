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
 *  - A missing/empty Origin is allowed — Node `ws` clients and other
 *    non-browser callers don't send Origin, and the listener binds to
 *    loopback so this remains OS-level restricted.
 *  - An `Origin: "null"` header (sent by `file://` pages and sandboxed/
 *    opaque-origin documents) is allowed only when
 *    {@link OriginAllowlistOptions.allowNullOrigin} is `true` (the
 *    default, for backwards compatibility with agent-side bridges that
 *    may see opaque-origin clients). View-server gates that only ever
 *    serve browser tabs should set this to `false`.
 *  - All other `http(s)` origins are rejected; non-`http(s)` schemes are
 *    rejected unless explicitly named in {@link extensionSchemes}.
 *
 * Agents layer in their own additional client surfaces (browser
 * extensions, VS Code webviews, etc.) by passing scheme prefixes via
 * {@link OriginAllowlistOptions.extensionSchemes}. Each entry is
 * matched as a literal prefix against the Origin string (e.g.
 * `"chrome-extension://"` accepts `chrome-extension://abc123`).
 *
 * The returned predicate accepts the raw Node header value type
 * (`string | string[] | undefined`). In practice Node combines repeated
 * Origin headers into a single comma-joined string at the parser level,
 * so the array form is not expected at runtime — but if it ever
 * appears, an array of length other than 1 is rejected outright and a
 * single-element array is normalized to its sole entry. Repeated
 * Origins are inherently ambiguous and should not be trusted.
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
    /**
     * Whether to accept `Origin: "null"` (the opaque-origin sentinel
     * sent by `file://` pages and sandboxed iframes). Defaults to
     * `true` for backwards compatibility with agent-side bridges. View
     * servers that only intend to serve same-origin browser tabs should
     * set this to `false` so a malicious `file://` page can't read
     * loopback responses.
     */
    allowNullOrigin?: boolean;
};

/**
 * Origin of the Visual Studio chat panel. The extension maps its bundled
 * WebView2 content to a virtual host
 * (`SetVirtualHostNameToFolderMapping("typeagent.local", ...)` in
 * `dotnet/visualStudioTypeAgent/ChatToolWindowControl.xaml.cs`) and navigates
 * to `https://typeagent.local/index.html`, so the panel's WebSocket upgrade
 * carries this Origin rather than a loopback one.
 *
 * It is matched exactly, never as a prefix: a prefix test would also accept
 * `https://typeagent.local.example.com`, a domain an attacker can register.
 */
export const VISUAL_STUDIO_WEBVIEW_ORIGIN = "https://typeagent.local";

/**
 * Reduce an origin to the `scheme://host[:port]` form browsers send, so a
 * configured entry with a trailing slash or stray case still matches.
 * Returns undefined for anything that isn't a usable absolute http(s)
 * origin.
 */
export function normalizeOrigin(value: string): string | undefined {
    const trimmed = value.trim();
    if (trimmed === "") {
        return undefined;
    }
    try {
        const url = new URL(trimmed);
        if (url.protocol !== "http:" && url.protocol !== "https:") {
            return undefined;
        }
        return url.origin.toLowerCase();
    } catch {
        return undefined;
    }
}

/**
 * Split a comma separated configuration value into normalized origins,
 * dropping entries that aren't usable absolute http(s) origins.
 */
export function parseAllowedOrigins(raw: string | undefined): string[] {
    if (raw === undefined) {
        return [];
    }
    return raw
        .split(",")
        .map((entry) => normalizeOrigin(entry))
        .filter((entry): entry is string => entry !== undefined);
}

/**
 * The baseline allowlist widened by origins an operator named explicitly.
 *
 * A server that binds beyond loopback serves its page from some other
 * hostname, so the browser sends that hostname as `Origin` and the loopback
 * baseline alone would refuse it. Naming the origins reopens exactly those
 * deployments while still refusing a DNS rebinding attacker, whose Origin is
 * its own domain rather than one listed here. Comparing `Origin` against the
 * request's `Host` would not: a rebinding attacker's request has the two
 * agree.
 */
export function createConfiguredOriginAllowlist(
    options: OriginAllowlistOptions,
    allowedOrigins: readonly string[],
): (origin: string | string[] | undefined) => boolean {
    const baseline = createAgentOriginAllowlist(options);
    const configured = new Set(allowedOrigins);
    return (origin: string | string[] | undefined): boolean => {
        if (baseline(origin)) {
            return true;
        }
        if (configured.size === 0 || Array.isArray(origin)) {
            return false;
        }
        const normalized =
            origin === undefined ? undefined : normalizeOrigin(origin);
        return normalized !== undefined && configured.has(normalized);
    };
}

/**
 * Returns a predicate that decides whether an incoming WebSocket
 * upgrade's `Origin` header should be accepted. See
 * {@link OriginAllowlistOptions} for the shared policy.
 */
export function createAgentOriginAllowlist(
    options: OriginAllowlistOptions = {},
): (origin: string | string[] | undefined) => boolean {
    const schemes = options.extensionSchemes ?? [];
    const allowNullOrigin = options.allowNullOrigin ?? true;
    return (origin: string | string[] | undefined): boolean => {
        // Node's header types claim repeated headers may surface as
        // `string[]`. In practice the parser joins repeated Origin
        // headers into a single comma-separated string, but if an array
        // ever does arrive, reject anything other than a single entry —
        // multiple Origins are inherently ambiguous and the safer
        // posture is to drop the request.
        let header: string | undefined;
        if (Array.isArray(origin)) {
            if (origin.length !== 1) {
                return false;
            }
            header = origin[0];
        } else {
            header = origin;
        }
        if (header === undefined || header === "") {
            // No Origin header: legitimate for Node `ws` and other
            // non-browser clients.
            return true;
        }
        if (header === "null") {
            return allowNullOrigin;
        }
        for (const scheme of schemes) {
            if (header.startsWith(scheme)) {
                return true;
            }
        }
        try {
            const u = new URL(header);
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
