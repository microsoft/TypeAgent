// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createAgentOriginAllowlist } from "@typeagent/websocket-utils/originAllowlist";

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
 * back any extension UI. See {@link createAgentOriginAllowlist} for the
 * shared loopback + no-Origin baseline.
 *
 * `Origin: "null"` (sent by `file://` pages and sandboxed iframes) is
 * rejected — only regular browser tabs and same-origin fetches are
 * legitimate clients, so an opaque-origin caller is necessarily
 * something we do not want to honor.
 *
 * Anything else is rejected with HTTP 403 before the route handler runs.
 */
export const isAllowedViewOrigin = createAgentOriginAllowlist({
    allowNullOrigin: false,
});
