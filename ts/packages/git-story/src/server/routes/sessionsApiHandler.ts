// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import os from "node:os";
import path from "node:path";
import type { Context } from "hono";
import { daemonLogger } from "../../logger.js";
import type {
    SessionRegistration,
    SessionWatchRequest,
} from "../../sessionWatcher.js";

const HTTP_ACCEPTED = 202;
const HTTP_BAD_REQUEST = 400;

// Transcript location per client name, built from the session id.
// Example: "copilot-cli", "s7" -> ~/.copilot/session-state/s7/events.jsonl
const TRANSCRIPT_PATHS = new Map<string, (sessionId: string) => string>([
    [
        "copilot-cli",
        (sessionId) =>
            path.join(
                os.homedir(),
                ".copilot",
                "session-state",
                sessionId,
                "events.jsonl",
            ),
    ],
]);

// Registered sessions, keyed by sessionId. In memory only: transcript
// watching is not implemented yet.
export const sessions = new Map<string, SessionWatchRequest>();

// True when `body` matches SessionRegistration with an absolute projectPath.
function isSessionRegistration(body: any): body is SessionRegistration {
    return (
        typeof body?.sessionId === "string" &&
        body.sessionId !== "" &&
        typeof body.projectPath === "string" &&
        path.isAbsolute(body.projectPath) &&
        typeof body.metadata?.clientName === "string" &&
        Array.isArray(body.metadata.models) &&
        body.metadata.models.every((m: unknown) => typeof m === "string")
    );
}

// Adds the client's transcriptPath to a registration. Undefined for a
// client without a known transcript location.
export function toSessionWatchRequest(
    registration: SessionRegistration,
): SessionWatchRequest | undefined {
    const transcriptPath = TRANSCRIPT_PATHS.get(
        registration.metadata.clientName,
    );
    return transcriptPath
        ? {
              ...registration,
              transcriptPath: transcriptPath(registration.sessionId),
          }
        : undefined;
}

// POST /api/sessions: records a session for later capture.
// Example: {"projectPath":"/repo","sessionId":"s7",
//   "metadata":{"clientName":"copilot-cli","models":[]}} -> 202 {"sessionId":"s7"}
export const sessionsApiHandler = async (c: Context) => {
    const body = await c.req.json().catch(() => undefined);
    if (!isSessionRegistration(body)) {
        return c.json(
            { error: "Invalid SessionRegistration" },
            HTTP_BAD_REQUEST,
        );
    }
    const request = toSessionWatchRequest(body);
    if (!request) {
        return c.json(
            { error: `Unknown client: ${body.metadata.clientName}` },
            HTTP_BAD_REQUEST,
        );
    }
    sessions.set(request.sessionId, request);
    daemonLogger.info(`Session registered: ${JSON.stringify(request)}`);
    return c.json({ sessionId: request.sessionId }, HTTP_ACCEPTED);
};
