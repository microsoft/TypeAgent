// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createConfiguredOriginAllowlist,
    normalizeOrigin,
    parseAllowedOrigins,
} from "@typeagent/websocket-utils/originAllowlist";

export { parseAllowedOrigins };

/**
 * Origins this server accepts browser clients from, beyond the loopback
 * baseline. Comma separated, each an exact scheme://host[:port] with no path
 * (for example `https://typeagent.example.com`).
 *
 * A deployment that widens the bind with TYPEAGENT_API_HOST serves the chat
 * view from its own public hostname, so the browser sends that hostname as
 * `Origin` and the loopback-only baseline would refuse it. Naming the origins
 * explicitly reopens exactly those deployments while keeping the gate closed
 * to every other site - in particular it still refuses a DNS rebinding
 * attacker, whose Origin is its own domain rather than one listed here.
 */
const ALLOWED_ORIGINS_ENV = "TYPEAGENT_API_ALLOWED_ORIGINS";

/**
 * Origin gate shared by the `/action/` endpoint and the dispatcher
 * WebSocket. Both reach the dispatcher with the local user's permissions, so
 * both apply the same policy: the loopback baseline, plus any origin the
 * operator named in {@link ALLOWED_ORIGINS_ENV}.
 *
 * `Origin: null` is refused. It is the opaque-origin sentinel sent by
 * `file://` pages and sandboxed iframes, neither of which is a legitimate
 * client here, and honoring it would hand a hostile page an iframe-shaped way
 * in. A missing Origin header is a different case and stays allowed for
 * non-browser callers (IoT devices, curl), which the bind address governs.
 */
export function createOriginAllowlist(
    allowedOrigins: readonly string[],
): (origin: string | string[] | undefined) => boolean {
    return createConfiguredOriginAllowlist(
        { allowNullOrigin: false },
        allowedOrigins,
    );
}

/**
 * The gate the servers actually install, reading the operator's configuration
 * from the environment.
 *
 * Resolved per call rather than once at module load: `loadConfig` merges YAML
 * and Key Vault layers into `process.env` during startup, which happens after
 * this module is first imported, so a value configured that way would be
 * missed by an allowlist captured at import time. The derived predicate is
 * cached against the raw string, so repeated requests do no extra work and a
 * config reload is still picked up.
 */
let cachedRaw: string | undefined;
let cachedAllowlist:
    | ((origin: string | string[] | undefined) => boolean)
    | undefined;

export function isAllowedApiOrigin(
    origin: string | string[] | undefined,
): boolean {
    const raw = process.env[ALLOWED_ORIGINS_ENV];
    if (cachedAllowlist === undefined || raw !== cachedRaw) {
        cachedRaw = raw;
        cachedAllowlist = createOriginAllowlist(parseAllowedOrigins(raw));
    }
    return cachedAllowlist(origin);
}

/**
 * The value to send back as `Access-Control-Allow-Origin` for a request, or
 * undefined to send no CORS header at all.
 *
 * Static assets used to go out with `*`, which let any page on the web read
 * them cross-origin. The clients that actually need these files load them from
 * the page this server itself served, so they are same-origin and need no CORS
 * header; only an operator-named origin needs one. Requests with no Origin are
 * therefore answered without the header rather than with a wildcard.
 *
 * The normalized origin is echoed rather than the raw header, so a caller
 * cannot smuggle control characters or trailing data into the response.
 */
export function resolveCorsOrigin(
    origin: string | string[] | undefined,
): string | undefined {
    if (origin === undefined || Array.isArray(origin)) {
        return undefined;
    }
    const normalized = normalizeOrigin(origin);
    if (normalized === undefined || !isAllowedApiOrigin(normalized)) {
        return undefined;
    }
    return normalized;
}
