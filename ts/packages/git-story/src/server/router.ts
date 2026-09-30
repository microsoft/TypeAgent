// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { IncomingMessage, ServerResponse } from "node:http";
import { daemonApiHandler } from "./routes/daemonApiHandler.js";
import { storyCommitsApiHandler } from "./routes/storyCommitsApiHandler.js";

export type JsonResponse = ServerResponse & {
    json(status: number, body: unknown): void;
};

export type RouteHandler = (
    req: IncomingMessage,
    res: JsonResponse,
    params: Record<string, string>,
) => void | Promise<void>;

type Route = { method: string; pattern: RegExp; handler: RouteHandler };

const HTTP_NOT_FOUND = 404;
const HTTP_METHOD_NOT_ALLOWED = 405;
const HTTP_INTERNAL_ERROR = 500;

// All API routes. Named groups become handler params.
// Example: GET /api/story/commits/abc123 -> storyCommitsApiHandler({hash:"abc123"})
// Identity route: `daemon status` checks the pid it returns.
export const DAEMON_ROUTE = "/api/daemon";

const ROUTES: Route[] = [
    { method: "GET", pattern: /^\/api\/daemon$/, handler: daemonApiHandler },
    {
        method: "GET",
        pattern: /^\/api\/story\/commits\/(?<hash>[^/]+)$/,
        handler: storyCommitsApiHandler,
    },
];

// Matches the request to a route and runs its handler. Unknown paths get 404,
// known paths with the wrong method get 405, handler errors get 500.
export async function route(
    req: IncomingMessage,
    serverRes: ServerResponse,
): Promise<void> {
    const res = serverRes as JsonResponse;
    res.json = (status, body) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(body) + "\n");
    };
    const { pathname } = new URL(req.url ?? "/", "http://localhost");
    const matches = ROUTES.map((r) => ({
        r,
        m: r.pattern.exec(pathname),
    })).filter((x) => x.m !== null);
    if (matches.length === 0) {
        return res.json(HTTP_NOT_FOUND, { error: `Not found: ${pathname}` });
    }
    const match = matches.find((x) => x.r.method === req.method);
    if (match === undefined) {
        return res.json(HTTP_METHOD_NOT_ALLOWED, {
            error: `Method not allowed: ${req.method}`,
        });
    }
    try {
        const params = Object.fromEntries(
            Object.entries(match.m!.groups ?? {}).map(([k, v]) => [
                k,
                decodeURIComponent(v),
            ]),
        );
        await match.r.handler(req, res, params);
    } catch (e) {
        if (!res.headersSent) {
            res.json(HTTP_INTERNAL_ERROR, { error: (e as Error).message });
        } else {
            res.end();
        }
    }
}
