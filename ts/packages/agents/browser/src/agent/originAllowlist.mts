// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createAgentOriginAllowlist } from "websocket-utils/originAllowlist";

/**
 * Origin allowlist for the browser agent's WebSocket server.
 *
 * Allowed:
 *  - `chrome-extension://...` and `moz-extension://...` (the typeagent
 *    Chrome / Edge browser extensions).
 *  - The shared loopback + no-Origin baseline documented on
 *    {@link createAgentOriginAllowlist} (Electron shell's inline
 *    browser, Node `ws` clients).
 *
 * Anything else is rejected with HTTP 403 before the `connection` event
 * fires. Every per-agent listener that binds to an ephemeral port via
 * the PortRegistrar must gate Origin so those ports can't be dialed by
 * arbitrary web pages on the same host.
 */
export const isAllowedAgentOrigin = createAgentOriginAllowlist({
    extensionSchemes: ["chrome-extension://", "moz-extension://"],
});
