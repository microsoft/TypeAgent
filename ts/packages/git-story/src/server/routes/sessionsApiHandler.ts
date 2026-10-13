// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Context } from "hono";
import { SessionRegistrationSchema } from "../../daemonApi.js";
import { DaemonSessions, SessionApiError } from "../../daemonSessions.js";

export function sessionsApiHandler(sessions: DaemonSessions) {
    return async (c: Context) => {
        const json: unknown = await c.req.json().catch(() => undefined);
        try {
            const parsed = SessionRegistrationSchema.strict().safeParse(json);
            if (!parsed.success)
                return c.json({ error: "Invalid SessionRegistration" }, 400);
            return c.json(sessions.register(parsed.data), 202);
        } catch (error) {
            if (error instanceof SessionApiError)
                return c.json({ error: error.message }, error.status);
            throw error;
        }
    };
}
