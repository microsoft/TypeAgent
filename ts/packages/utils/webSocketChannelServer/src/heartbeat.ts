// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { WebSocket, WebSocketServer } from "ws";
import registerDebug from "debug";

const debug = registerDebug("typeagent:transport:heartbeat");

export interface HeartbeatOptions {
    /**
     * Milliseconds between liveness sweeps. A client that has not
     * answered the previous sweep's ping is terminated on the next one,
     * so a dead peer is detected in `intervalMs`..`2 * intervalMs`.
     * Default 30000 (detection within 30–60s).
     */
    intervalMs?: number;
    /**
     * Invoked with the socket about to be terminated for failing the
     * liveness check, just before `terminate()`. A seam for diagnostics
     * or scrubbing cached per-client state during self-recovery.
     */
    onStale?: (ws: WebSocket) => void;
}

// Per-socket liveness flag. A Symbol avoids colliding with any property
// the consuming server may set on its sockets.
const ALIVE = Symbol("heartbeatAlive");

/**
 * Attach RFC 6455 ping/pong liveness to every client of `wss`.
 *
 * Each sweep terminates any socket that did not pong since the previous
 * sweep, then pings the survivors. `terminate()` surfaces the drop to
 * the server's existing `close` handler immediately, so half-open
 * sockets (sleep/wake, VPN flip, a killed MV3 service worker) are
 * reaped in seconds instead of waiting on the OS TCP timeout.
 *
 * Browsers answer protocol pings automatically, so no client change is
 * required. Returns a stop function; the sweep is also stopped when
 * `wss` emits `close`.
 */
export function attachHeartbeat(
    wss: WebSocketServer,
    options: HeartbeatOptions = {},
): () => void {
    const intervalMs = options.intervalMs ?? 30000;

    const track = (ws: WebSocket) => {
        (ws as any)[ALIVE] = true;
        ws.on("pong", () => {
            (ws as any)[ALIVE] = true;
        });
    };

    for (const ws of wss.clients) {
        track(ws);
    }
    wss.on("connection", track);

    const timer = setInterval(() => {
        for (const ws of wss.clients) {
            try {
                if ((ws as any)[ALIVE] === false) {
                    debug("terminating unresponsive client");
                    options.onStale?.(ws);
                    ws.terminate();
                    continue;
                }
                (ws as any)[ALIVE] = false;
                ws.ping();
            } catch (e) {
                // A socket mid-close (or a throwing onStale) must not
                // abort the sweep for the remaining clients, nor escalate
                // to an uncaught exception out of the timer callback.
                debug("heartbeat sweep error: %o", e);
            }
        }
    }, intervalMs);

    // Never hold the process open solely for the heartbeat.
    if (typeof timer.unref === "function") {
        timer.unref();
    }

    let stopped = false;
    const stop = () => {
        if (stopped) {
            return;
        }
        stopped = true;
        clearInterval(timer);
    };
    wss.on("close", stop);
    return stop;
}
