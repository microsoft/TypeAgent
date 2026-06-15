// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createAgentOriginAllowlist } from "@typeagent/websocket-utils/originAllowlist";

/**
 * Origin allowlist for the visualStudio agent's WebSocket bridge.
 *
 * The only legitimate client is the in-process Visual Studio extension
 * (`dotnet/visualStudioTypeAgent/Bridge/AgentBridgeClient.cs`), which uses
 * `System.Net.WebSockets.ClientWebSocket`. That client does **not**
 * send an `Origin` header, so we rely on the shared no-Origin baseline
 * documented on {@link createAgentOriginAllowlist}.
 *
 * No extension scheme prefixes are accepted — anything beyond loopback
 * web clients (manual debugging, future webview consumers) and
 * Origin-less native clients is rejected with HTTP 403 before the
 * `connection` event fires. Every per-agent listener that binds to an
 * ephemeral port via the PortRegistrar must gate Origin so those ports
 * can't be dialed by arbitrary web pages on the same host.
 */
export const isAllowedAgentOrigin = createAgentOriginAllowlist();
