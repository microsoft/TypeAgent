// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getRequestListener } from "@hono/node-server";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { DAEMON_ROUTE, SESSIONS_ROUTE } from "../daemonApi.js";
import type { DaemonSessions } from "../daemonSessions.js";
import { daemonLogger } from "../logger.js";
import { daemonApiHandler } from "./routes/daemonApiHandler.js";
import { sessionsApiHandler } from "./routes/sessionsApiHandler.js";
import { storyCommitsApiHandler } from "./routes/storyCommitsApiHandler.js";

export function createRoute(sessions: DaemonSessions, stop: () => void) {
    const app = new Hono();
    app.use(
        "*",
        bodyLimit({
            maxSize: 64 * 1024,
            onError: (c) => c.json({ error: "Request body too large" }, 413),
        }),
    );
    app.use("*", async (c, next) => {
        if (
            c.req.method === "POST" &&
            c.req.header("Content-Type")?.split(";")[0].trim().toLowerCase() !==
                "application/json"
        )
            return c.json({ error: "JSON content type required" }, 415);
        await next();
    });
    app.get(DAEMON_ROUTE, daemonApiHandler(sessions));
    app.post(`${DAEMON_ROUTE}/stop`, async (c) => {
        const body: unknown = await c.req.json().catch(() => undefined);
        if (
            !body ||
            typeof body !== "object" ||
            Array.isArray(body) ||
            Object.keys(body).length !== 0
        )
            return c.json({ error: "Expected empty JSON object" }, 400);
        stop();
        return c.json({ stopping: true }, 202);
    });
    app.get("/api/story/commits/:hash", storyCommitsApiHandler);
    app.get(SESSIONS_ROUTE, (c) => c.json(sessions.list()));
    app.post(SESSIONS_ROUTE, sessionsApiHandler(sessions));
    for (const [route, allow] of [
        [DAEMON_ROUTE, "GET"],
        [`${DAEMON_ROUTE}/stop`, "POST"],
        [SESSIONS_ROUTE, "GET, POST"],
        ["/api/story/commits/:hash", "GET"],
    ])
        app.all(route, (c) =>
            c.json({ error: "Method not allowed" }, 405, { Allow: allow }),
        );
    app.notFound((c) => c.json({ error: "Not found" }, 404));
    app.onError((_error, c) => {
        daemonLogger.error("Daemon request failed");
        return c.json({ error: "Daemon request failed" }, 500);
    });
    return getRequestListener(app.fetch);
}
