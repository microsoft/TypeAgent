// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getRequestListener } from "@hono/node-server";
import { Hono, type Context } from "hono";
import { DAEMON_ROUTE, SESSIONS_ROUTE } from "../daemonApi.js";
import { daemonApiHandler } from "./routes/daemonApiHandler.js";
import { sessionsApiHandler } from "./routes/sessionsApiHandler.js";
import { storyCommitsApiHandler } from "./routes/storyCommitsApiHandler.js";

const HTTP_NOT_FOUND = 404;
const HTTP_METHOD_NOT_ALLOWED = 405;
const HTTP_INTERNAL_ERROR = 500;

// All API routes.
// Example: GET /api/story/commits/abc123 -> storyCommitsApiHandler, param hash="abc123"
const methodNotAllowed = (c: Context) =>
    c.json(
        { error: `Method not allowed: ${c.req.method}` },
        HTTP_METHOD_NOT_ALLOWED,
        {
            Allow: "GET",
        },
    );

const app = new Hono()
    .get(DAEMON_ROUTE, daemonApiHandler)
    .get("/api/story/commits/:hash", storyCommitsApiHandler)
    .post(SESSIONS_ROUTE, sessionsApiHandler)
    // Known paths with any other method: 405, not 404.
    .all(DAEMON_ROUTE, methodNotAllowed)
    .all("/api/story/commits/:hash", methodNotAllowed)
    .notFound((c) =>
        c.json({ error: `Not found: ${c.req.path}` }, HTTP_NOT_FOUND),
    )
    .onError((e, c) => c.json({ error: e.message }, HTTP_INTERNAL_ERROR));

// node:http request listener for the app.
export const route = getRequestListener(app.fetch);
