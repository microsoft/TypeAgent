// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DAEMON_ROUTE, SESSIONS_ROUTE } from "./server/router.js";
import { LOOPBACK_HOST } from "./server/server.js";
import type { StoryCommit } from "./server/routes/storyCommitsApiHandler.js";
import type { SessionRegistration } from "./sessionWatcher.js";

export type DaemonIdentity = { pid: number };
export type SessionAccepted = { sessionId: string };

// Typed HTTP client for the git-story daemon API. One method per route;
// non-2xx responses throw with the daemon's error message.
// Example: new GitStoryDaemonClient(51703, 2000).registerSession(req)
//   -> POST http://127.0.0.1:51703/api/sessions -> {"sessionId":"s7"}
export class GitStoryDaemonClient {
    constructor(
        private readonly port: number,
        private readonly timeoutMs: number,
    ) {}

    // GET /api/daemon
    identity(): Promise<DaemonIdentity> {
        return this.request("GET", DAEMON_ROUTE);
    }

    // POST /api/sessions
    registerSession(request: SessionRegistration): Promise<SessionAccepted> {
        return this.request("POST", SESSIONS_ROUTE, request);
    }

    // GET /api/story/commits/{hash}?project=<absolute path>
    storyCommit(project: string, hash: string): Promise<StoryCommit> {
        const query = new URLSearchParams({ project });
        return this.request(
            "GET",
            `/api/story/commits/${encodeURIComponent(hash)}?${query}`,
        );
    }

    // Sends one JSON request and parses the JSON response.
    private async request<T>(
        method: string,
        path: string,
        body?: unknown,
    ): Promise<T> {
        const init: RequestInit = {
            method,
            signal: AbortSignal.timeout(this.timeoutMs),
        };
        if (body !== undefined) {
            init.headers = { "Content-Type": "application/json" };
            init.body = JSON.stringify(body);
        }
        const res = await fetch(
            `http://${LOOPBACK_HOST}:${this.port}${path}`,
            init,
        );
        const json = (await res.json()) as T & { error?: string };
        if (!res.ok) {
            throw new Error(json.error ?? `${method} ${path}: ${res.status}`);
        }
        return json;
    }
}
