// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { IncomingMessage, ServerResponse } from "node:http";
import { daemonApiHandler } from "./routes/daemonApiHandler.js";
import { storyCommitsApiHandler } from "./routes/storyCommitsApiHandler.js";

// Handlers return a response instead of writing one, so the router is the only
// writer: no double writes, no forgotten `end()`, errors always become JSON.
export type ApiResponse = {
    status: number;
    body: unknown;
    headers?: Record<string, string>;
};

export type RouteHandler = (
    params: Record<string, string>,
    req: IncomingMessage,
) => ApiResponse | Promise<ApiResponse>;

const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_METHOD_NOT_ALLOWED = 405;
const HTTP_INTERNAL_ERROR = 500;

// Identity route: `daemon status` checks the pid it returns.
export const DAEMON_ROUTE = "/api/daemon";

type Route = { method: string; segments: string[]; handler: RouteHandler };

const splitPath = (p: string) => p.split("/").filter((s) => s !== "");

const routes: Route[] = [];

// Express-style registration. A `:name` segment matches one path segment and
// becomes params.name.
// Example: GET /api/story/commits/abc123 -> storyCommitsApiHandler({hash:"abc123"})
const get = (path: string, handler: RouteHandler) =>
    routes.push({ method: "GET", segments: splitPath(path), handler });

// All API routes.
get(DAEMON_ROUTE, daemonApiHandler);
get("/api/story/commits/:hash", storyCommitsApiHandler);

// Params when `segments` (still percent-encoded) match the route, else
// undefined. Throws URIError on a malformed escape such as "%E0".
function matchSegments(
    route: Route,
    segments: string[],
): Record<string, string> | undefined {
    if (route.segments.length !== segments.length) return undefined;
    const params: Record<string, string> = {};
    for (const [i, part] of route.segments.entries()) {
        if (part.startsWith(":")) {
            params[part.slice(1)] = decodeURIComponent(segments[i]);
        } else if (part !== segments[i]) {
            return undefined;
        }
    }
    return params;
}

// Picks the handler for a request. Split on the encoded path, so "%2F" inside
// a parameter never creates an extra segment.
async function dispatch(req: IncomingMessage): Promise<ApiResponse> {
    const { pathname } = new URL(req.url ?? "/", "http://localhost");
    const segments = splitPath(pathname);
    const allowed: string[] = [];
    for (const route of routes) {
        let params: Record<string, string> | undefined;
        try {
            params = matchSegments(route, segments);
        } catch {
            return {
                status: HTTP_BAD_REQUEST,
                body: { error: `Malformed path: ${pathname}` },
            };
        }
        if (!params) continue;
        if (route.method === req.method) return route.handler(params, req);
        allowed.push(route.method);
    }
    return allowed.length > 0
        ? {
              status: HTTP_METHOD_NOT_ALLOWED,
              body: { error: `Method not allowed: ${req.method}` },
              // RFC 9110 requires Allow on 405, e.g. "Allow: GET".
              headers: { Allow: allowed.join(", ") },
          }
        : { status: HTTP_NOT_FOUND, body: { error: `Not found: ${pathname}` } };
}

// Runs the matching handler and writes its result as JSON. A thrown handler
// becomes 500; the server keeps running.
export async function route(
    req: IncomingMessage,
    res: ServerResponse,
): Promise<void> {
    let result: ApiResponse;
    try {
        result = await dispatch(req);
    } catch (e) {
        result = {
            status: HTTP_INTERNAL_ERROR,
            body: { error: (e as Error).message },
        };
    }
    res.writeHead(result.status, {
        ...result.headers,
        "Content-Type": "application/json",
    });
    res.end(JSON.stringify(result.body) + "\n");
}
