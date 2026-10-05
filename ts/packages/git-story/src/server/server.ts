// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createServer, type Server } from "node:http";
import { LOOPBACK_HOST } from "../daemonApi.js";
import { route } from "./router.js";
const HTTP_FORBIDDEN = 403;

// Starts the HTTP API on `port` and resolves once listening. Rejects with
// EADDRINUSE when the port is taken.
export function startServer(port: number): Promise<Server> {
    // Reject any Host other than this loopback address, so a DNS-rebinding
    // web page cannot reach the API. Example: "evil.test:51703" -> 403.
    const server = createServer((req, res) => {
        const allowed = [`${LOOPBACK_HOST}:${port}`, `localhost:${port}`];
        if (!allowed.includes(req.headers.host ?? "")) {
            res.writeHead(HTTP_FORBIDDEN).end();
            return;
        }
        void route(req, res);
    });
    return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, LOOPBACK_HOST, () => resolve(server));
    });
}
