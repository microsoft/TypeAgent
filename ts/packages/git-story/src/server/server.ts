// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { route } from "./router.js";

// Loopback only: the API reads the repository and has no authentication.
export const LOOPBACK_HOST = "127.0.0.1";

// Starts the HTTP API on `port` (0 = any free port) and resolves with the
// bound port once listening.
export function startServer(
    port = 0,
): Promise<{ server: Server; port: number }> {
    const server = createServer((req, res) => void route(req, res));
    return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, LOOPBACK_HOST, () => {
            const bound = (server.address() as AddressInfo).port;
            resolve({ server, port: bound });
        });
    });
}
