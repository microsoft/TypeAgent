// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { z } from "zod";
import {
    DAEMON_ROUTE,
    DaemonIdentitySchema,
    ErrorResponseSchema,
    LOOPBACK_HOST,
    SESSIONS_ROUTE,
    SessionAcceptedSchema,
    SessionRegistrationSchema,
    SessionListSchema,
    DaemonStoppingSchema,
    StoryCommitSchema,
    type DaemonIdentity,
    type SessionAccepted,
} from "./daemonApi.js";
import type { StoryCommit } from "./server/routes/storyCommitsApiHandler.js";
import type { SessionRegistration } from "./sessionWatcher.js";
import { readDaemonState } from "./daemonState.js";

// Typed HTTP client for the git-story daemon API. One method per route;
// zod validates request bodies before sending and responses on receipt, so
// a malformed request or response throws. Non-2xx responses throw with the
// daemon's error message.
// Example: daemonClient.registerSession(req)
//   -> POST http://127.0.0.1:51703/api/sessions -> {"sessionId":"s7"}
export class GitStoryDaemonClient {
    constructor(
        private readonly port?: number,
        private readonly timeoutMs = 2000,
        private readonly token?: string,
    ) {
        if (
            !Number.isSafeInteger(timeoutMs) ||
            timeoutMs < 1 ||
            timeoutMs > 120000
        )
            throw new Error("Invalid daemon client timeout");
    }

    // GET /api/daemon
    async identity(): Promise<DaemonIdentity> {
        return this.request(DaemonIdentitySchema, "GET", DAEMON_ROUTE);
    }

    // POST /api/sessions
    async registerSession(
        request: SessionRegistration,
    ): Promise<SessionAccepted> {
        return this.request(
            SessionAcceptedSchema,
            "POST",
            SESSIONS_ROUTE,
            SessionRegistrationSchema.parse(request),
        );
    }

    async sessions() {
        return this.request(SessionListSchema, "GET", SESSIONS_ROUTE);
    }

    async stop() {
        return this.request(
            DaemonStoppingSchema,
            "POST",
            `${DAEMON_ROUTE}/stop`,
            {},
        );
    }

    // GET /api/story/commits/{hash}?project=<absolute path>
    async storyCommit(project: string, hash: string): Promise<StoryCommit> {
        const query = new URLSearchParams({ project });
        return this.request(
            StoryCommitSchema,
            "GET",
            `/api/story/commits/${encodeURIComponent(hash)}?${query}`,
        );
    }

    // Sends one JSON request; parses the response with `schema`.
    private async request<T>(
        schema: z.ZodType<T>,
        method: string,
        path: string,
        body?: unknown,
    ): Promise<T> {
        const state = this.port === undefined ? readDaemonState() : undefined;
        const port = this.port ?? state?.port;
        const token = this.token ?? state?.token;
        if (!port || !token) throw new Error("Daemon is not running");
        const init: RequestInit = {
            method,
            signal: AbortSignal.timeout(this.timeoutMs),
            headers: { Authorization: `Bearer ${token}` },
        };
        if (body !== undefined) {
            init.headers = {
                ...init.headers,
                "Content-Type": "application/json",
            };
            init.body = JSON.stringify(body);
        }
        const res = await fetch(`http://${LOOPBACK_HOST}:${port}${path}`, init);
        const json: unknown = await res.json();
        if (!res.ok) {
            const error = ErrorResponseSchema.safeParse(json);
            throw new Error(
                error.success
                    ? error.data.error
                    : `${method} ${path}: ${res.status}`,
            );
        }
        return schema.parse(json);
    }
}

// Hooks run inside the agent, so a slow daemon must not hold them up.
const DAEMON_TIMEOUT_MS = 2000;

// The one client every CLI command uses.
export const daemonClient = new GitStoryDaemonClient(
    undefined,
    DAEMON_TIMEOUT_MS,
);
