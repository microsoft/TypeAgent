// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createServer, type Server } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { LOOPBACK_HOST } from "../daemonApi.js";
import type { DaemonSessions } from "../daemonSessions.js";
import { createRoute } from "./router.js";

export function startServer(
    port: number,
    options: { token: string; sessions: DaemonSessions; stop: () => void },
): Promise<Server> {
    if (!/^[0-9a-f]{64}$/.test(options.token))
        throw new Error("Invalid daemon credential");
    const route = createRoute(options.sessions, options.stop);
    const expected = Buffer.from(`Bearer ${options.token}`);
    const server = createServer({ maxHeaderSize: 8192 }, (req, res) => {
        const address = server.address();
        const boundPort =
            address && typeof address !== "string" ? address.port : port;
        const allowed = [
            `${LOOPBACK_HOST}:${boundPort}`,
            `localhost:${boundPort}`,
        ];
        const provided = Buffer.from(req.headers.authorization ?? "");
        const browser =
            req.headers.origin !== undefined ||
            (req.headers["sec-fetch-site"] !== undefined &&
                req.headers["sec-fetch-site"] !== "none");
        if (!allowed.includes(req.headers.host ?? "") || browser) {
            res.writeHead(403, { "Content-Type": "application/json" }).end(
                '{"error":"Forbidden"}',
            );
        } else if (
            provided.length !== expected.length ||
            !timingSafeEqual(provided, expected)
        ) {
            res.writeHead(401, { "Content-Type": "application/json" }).end(
                '{"error":"Unauthorized"}',
            );
        } else {
            void route(req, res);
        }
    });
    server.requestTimeout = 5000;
    server.headersTimeout = 5000;
    server.setTimeout(5000, (socket) => socket.destroy());
    return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, LOOPBACK_HOST, () => resolve(server));
    });
}
