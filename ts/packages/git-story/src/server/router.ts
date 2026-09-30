// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getRequestListener } from "@hono/node-server";
import { Hono } from "hono";
import { daemonApiHandler } from "./routes/daemonApiHandler.js";
import { storyCommitsApiHandler } from "./routes/storyCommitsApiHandler.js";

const HTTP_NOT_FOUND = 404;
const HTTP_INTERNAL_ERROR = 500;

// Identity route: `daemon status` checks the pid it returns.
export const DAEMON_ROUTE = "/api/daemon";

// All API routes.
// Example: GET /api/story/commits/abc123 -> storyCommitsApiHandler, param hash="abc123"
const app = new Hono()
    .get(DAEMON_ROUTE, daemonApiHandler)
    .get("/api/story/commits/:hash", storyCommitsApiHandler)
    .notFound((c) =>
        c.json({ error: `Not found: ${c.req.path}` }, HTTP_NOT_FOUND),
    )
    .onError((e, c) => c.json({ error: e.message }, HTTP_INTERNAL_ERROR));

// node:http request listener for the app.
export const route = getRequestListener(app.fetch);
