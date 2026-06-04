// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createAgentOriginAllowlist } from "websocket-utils/originAllowlist";

/**
 * Origin allowlist for the montage view server.
 *
 * Accepts only the shared loopback + no-Origin baseline documented on
 * {@link createAgentOriginAllowlist} (loopback browser tabs, the
 * Electron shell's inline browser, same-origin XHR/fetch from the
 * gallery page, and Node `ws`/HTTP clients). The server binds to
 * localhost, so this is loopback-restricted at the OS level.
 *
 * `Origin: "null"` (sent by `file://` pages and sandboxed iframes) is
 * rejected — the gallery only ever serves regular browser tabs and
 * same-origin fetches, so an opaque-origin caller is necessarily
 * something we do not want to honor.
 *
 * Anything else is rejected with HTTP 403 before the route handler runs.
 */
export const isAllowedViewOrigin = createAgentOriginAllowlist({
    allowNullOrigin: false,
});
