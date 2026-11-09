// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Daemon address, routes, and zod schemas, shared by the server and its
// client. Uses lightweight validation helpers so the CLI can reach the daemon
// without loading the server.
// Example: POST http://127.0.0.1:51703/api/sessions

import path from "node:path";
import { z } from "zod";
import type { StoryCommit } from "./server/routes/storyCommitsApiHandler.js";
import type { SessionRegistration } from "./sessionWatcher.js";
import { isSessionTimestamp } from "./sessionRecord.js";

// Loopback plus a per-instance credential from private local daemon state.
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
// Also reject Windows device names, trailing dots/spaces and alternate streams.
export const SessionIdSchema = z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/)
    .refine((id) => !id.endsWith("."))
    .refine((id) => !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i.test(id));
const sessionTimestamp = z
    .string()
    .refine(
        isSessionTimestamp,
        "must be a parseable date-time with a timezone",
    );

// GET /api/daemon -> {"pid":4242}
export const DaemonIdentitySchema = z.object({
    pid: z.number().int(),
    configured: z.boolean(),
    stopping: z.boolean(),
});

// POST /api/sessions body. Checked against the SessionRegistration type.
export const SessionRegistrationSchema = z.object({
    projectPath: absolutePath,
    sessionId: SessionIdSchema,
    transcriptPath: absolutePath.optional(),
    metadata: z
        .object({
            clientName: z.string().min(1).max(128),
            models: z.array(z.string().max(256)).max(64),
            parentSessionId: z.string().max(256).optional(),
            startedAt: sessionTimestamp.optional(),
            lastEventTimestamp: sessionTimestamp.optional(),
        })
        .strict()
        .transform(
            ({
                clientName,
                models,
                parentSessionId,
                startedAt,
                lastEventTimestamp,
            }) => ({
                clientName,
                models,
                ...(parentSessionId !== undefined ? { parentSessionId } : {}),
                ...(startedAt !== undefined ? { startedAt } : {}),
                ...(lastEventTimestamp !== undefined
                    ? { lastEventTimestamp }
                    : {}),
            }),
        ),
}) satisfies z.ZodType<SessionRegistration>;

const CheckpointSchema = z.object({
    sessionId: SessionIdSchema,
    transcriptPath: absolutePath,
    sourceByteOffset: z
        .string()
        .regex(/^(0|[1-9]\d*)$/)
        .refine((value) => Number.isSafeInteger(Number(value))),
});
export const SessionFailureSchema = z.object({
    stage: z.enum([
        "configuration",
        "monitoring",
        "capture",
        "restore",
        "normalize",
        "metadata",
        "privacy",
        "delivery",
        "reporting",
    ]),
    captureMayHaveAdvanced: z.boolean(),
});
export const SessionStatusSchema = z.object({
    phase: z.enum(["waiting", "processing", "idle", "failed", "stopped"]),
    monitoring: z.boolean(),
    generation: z.string().optional(),
    readCheckpoint: CheckpointSchema.optional(),
    diagnostics: z.array(
        z.object({
            code: z.enum([
                "invalid-json",
                "invalid-utf8",
                "source-reset",
                "unsupported-event",
                "malformed-event",
            ]),
            source: CheckpointSchema.extend({ generation: z.string() }),
        }),
    ),
    diagnosticCount: z.number().int().nonnegative(),
    failure: SessionFailureSchema.optional(),
    reportingFailed: z.boolean().optional(),
});
export const SessionReceiptSchema = z.object({
    sessionId: SessionIdSchema,
    projectPath: absolutePath,
    transcriptPath: absolutePath,
    state: z.enum(["starting", "active", "blocked", "stopped"]),
    status: SessionStatusSchema.optional(),
    recoveryRequired: z.boolean(),
});
export const SessionAcceptedSchema = SessionReceiptSchema;
export const SessionListSchema = z.array(SessionReceiptSchema);
export const DaemonStoppingSchema = z.object({ stopping: z.literal(true) });

// GET /api/story/commits/{hash} -> {"hash":"739e112...","subject":"..."}
export const StoryCommitSchema = z.object({
    hash: z.string(),
    subject: z.string(),
}) satisfies z.ZodType<StoryCommit>;

// Any non-2xx response -> {"error":"..."}
export const ErrorResponseSchema = z.object({ error: z.string() });

export type DaemonIdentity = z.infer<typeof DaemonIdentitySchema>;
export type SessionAccepted = z.infer<typeof SessionAcceptedSchema>;
export type SessionReceipt = z.infer<typeof SessionReceiptSchema>;
