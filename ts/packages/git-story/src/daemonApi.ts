// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Daemon address, routes, and zod schemas, shared by the server and its
// client. Imports only zod, so the CLI can reach the daemon without loading
// the server.
// Example: POST http://127.0.0.1:51703/api/sessions

import path from "node:path";
import { z } from "zod";
import type { StoryCommit } from "./server/routes/storyCommitsApiHandler.js";
import type { SessionRegistration } from "./sessionWatcher.js";

// Loopback only: the API reads the repository and has no authentication.
export const LOOPBACK_HOST = "127.0.0.1";

// Fixed so every client knows where the daemon listens. Chosen from the
// IANA dynamic range (49152-65535) to avoid registered services.
export const DAEMON_PORT = 51703;

// Identity route: `daemon status` checks the pid it returns.
export const DAEMON_ROUTE = "/api/daemon";

// Session registration route: Copilot `sessionStart` hook posts here.
export const SESSIONS_ROUTE = "/api/sessions";

// Absolute path on this OS, e.g. /Users/me/repo or C:\\Users\\me\\repo.
const absolutePath = z.string().refine(path.isAbsolute, "must be absolute");

// GET /api/daemon -> {"pid":4242}
export const DaemonIdentitySchema = z.object({ pid: z.number().int() });

// POST /api/sessions body. Checked against the SessionRegistration type.
export const SessionRegistrationSchema = z.object({
    projectPath: absolutePath,
    sessionId: z.string().min(1),
    transcriptPath: absolutePath.optional(),
    metadata: z.object({
        clientName: z.string(),
        models: z.array(z.string()),
    }),
}) satisfies z.ZodType<SessionRegistration>;

// POST /api/sessions -> 202 {"sessionId":"s7"}
export const SessionAcceptedSchema = z.object({ sessionId: z.string() });

// GET /api/story/commits/{hash} -> {"hash":"739e112...","subject":"..."}
export const StoryCommitSchema = z.object({
    hash: z.string(),
    subject: z.string(),
}) satisfies z.ZodType<StoryCommit>;

// Any non-2xx response -> {"error":"..."}
export const ErrorResponseSchema = z.object({ error: z.string() });

export type DaemonIdentity = z.infer<typeof DaemonIdentitySchema>;
export type SessionAccepted = z.infer<typeof SessionAcceptedSchema>;
