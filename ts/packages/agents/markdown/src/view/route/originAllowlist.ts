// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createAgentOriginAllowlist } from "websocket-utils/originAllowlist";

/**
 * Origin allowlist for the markdown view server (HTTP preview + Yjs
 * collaboration WebSocket).
 *
 * Accepts only the shared loopback + no-Origin baseline documented on
 * {@link createAgentOriginAllowlist} (loopback browser tabs, the
 * Electron shell's inline browser, same-origin XHR/fetch from the
 * preview page, and Node `ws`/HTTP clients). The server binds to
 * localhost, so this is loopback-restricted at the OS level.
 *
 * Anything else is rejected with HTTP 403 (HTTP routes) or 403 on the
 * upgrade response (WebSocket).
 */
export const isAllowedViewOrigin = createAgentOriginAllowlist();
