// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createAgentOriginAllowlist } from "websocket-utils/originAllowlist";

/**
 * Origin allowlist for the code agent's WebSocket server.
 *
 * Allowed:
 *  - `vscode-webview://...`, `vscode-file://...`, and
 *    `vscode-resource://...` (the VS Code extension host's sandboxed
 *    surfaces).
 *  - The shared loopback + no-Origin baseline documented on
 *    {@link createAgentOriginAllowlist} (the VS Code extension's own
 *    `ws` client, manual loopback debugging).
 *
 * Anything else is rejected with HTTP 403 before the `connection` event
 * fires. Every per-agent listener that binds to an ephemeral port via
 * the PortRegistrar must gate Origin so those ports can't be dialed by
 * arbitrary web pages on the same host.
 */
export const isAllowedAgentOrigin = createAgentOriginAllowlist({
    extensionSchemes: [
        "vscode-webview://",
        "vscode-file://",
        "vscode-resource://",
    ],
});
