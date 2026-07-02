// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Dev-tunnel URL resolver for the discovery channel.
//
// When a remote client looks up a port, the agent-server can answer with a
// public `wss://…devtunnels.ms` URL instead of `ws://localhost:<port>`, so the
// client reaches the service across devices. A tunnel URL is only valid while a
// host process is connected (Dev Tunnels is a pure relay — no store-and-forward),
// so we verify host liveness (`devtunnel show --json` → `tunnel.hostConnections`)
// before handing one out and degrade to localhost otherwise.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readDevTunnelConfig, type DevTunnelConfig } from "agent-dispatcher";
import registerDebug from "debug";

const debug = registerDebug("agent-server:tunnel");

const execFileAsync = promisify(execFile);

// Liveness is cached briefly so we don't shell out to `devtunnel` on every
// lookup; discovery is infrequent but bursty (a client may probe several ports).
const LIVENESS_TTL_MS = 5_000;
const livenessCache = new Map<string, { at: number; live: boolean }>();

/**
 * The CLI reports `tunnelId` as `<id>.<cluster>`, but the public URL uses the
 * bare `<id>`. Tolerate either form being stored in the config.
 */
function bareTunnelId(config: DevTunnelConfig): string {
    const { tunnelId, cluster } = config;
    if (cluster && tunnelId.endsWith(`.${cluster}`)) {
        return tunnelId.slice(0, -(cluster.length + 1));
    }
    const dot = tunnelId.indexOf(".");
    return dot > 0 ? tunnelId.slice(0, dot) : tunnelId;
}

/** Derive the relay WebSocket URL for a port. Pure (no I/O). */
export function deriveTunnelUrl(config: DevTunnelConfig, port: number): string {
    const baseDomain = config.baseDomain ?? "devtunnels.ms";
    return `wss://${bareTunnelId(config)}-${port}.${config.cluster}.${baseDomain}`;
}

/**
 * Is a host currently connected to the tunnel? Cached for {@link LIVENESS_TTL_MS}.
 * Any failure (CLI missing, not logged in, tunnel gone, unparseable output) is
 * treated as "down" so discovery degrades to localhost rather than handing out a
 * dead URL.
 */
async function isTunnelHostLive(tunnelId: string): Promise<boolean> {
    const cached = livenessCache.get(tunnelId);
    const now = Date.now();
    if (cached !== undefined && now - cached.at < LIVENESS_TTL_MS) {
        return cached.live;
    }
    let live = false;
    try {
        const { stdout } = await execFileAsync(
            "devtunnel",
            ["show", tunnelId, "--json"],
            { timeout: 4_000 },
        );
        const info: any = JSON.parse(stdout);
        const count = info?.tunnel?.hostConnections ?? info?.hostConnections;
        live = typeof count === "number" && count > 0;
    } catch (e) {
        debug(`liveness probe failed for ${tunnelId}, treating as down: ${e}`);
        live = false;
    }
    livenessCache.set(tunnelId, { at: now, live });
    return live;
}

/**
 * Discovery `resolveUrl` callback: returns a tunnel URL for `(port)` only when
 * the request is remote-realm, a tunnel mapping for that port exists, and the
 * tunnel host is live. Otherwise `undefined` → caller falls back to localhost.
 *
 * Pass this to `createDiscoveryHandlers(lookup, resolveTunnelUrlForDiscovery)`.
 */
export async function resolveTunnelUrlForDiscovery(
    _agentName: string,
    port: number,
    remote?: boolean,
): Promise<string | undefined> {
    if (!remote) {
        return undefined; // local client → localhost realm
    }
    const config = readDevTunnelConfig();
    if (config === undefined) {
        return undefined; // no tunnel configured
    }
    if (config.ports[String(port)] === undefined) {
        debug(`port ${port} not in tunnel config; no tunnel URL`);
        return undefined; // port isn't forwarded by the tunnel
    }
    if (!(await isTunnelHostLive(config.tunnelId))) {
        debug(`tunnel ${config.tunnelId} host down; degrading to localhost`);
        return undefined; // relay has no live host → don't hand out a dead URL
    }
    const url = deriveTunnelUrl(config, port);
    debug(`resolved remote ${url} for port ${port}`);
    return url;
}

/** Test seam: clear the liveness cache. */
export function _resetTunnelLivenessCacheForTest() {
    livenessCache.clear();
}
