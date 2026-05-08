// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createServer } from "net";

/**
 * Reserve `count` ephemeral ports by binding to port 0, reading the
 * OS-assigned port, then closing.
 *
 * Note: there is a small race window between close and the consumer's
 * subsequent bind during which another process could grab the port. In
 * practice the OS does not reuse ports rapidly, so the race is rare. If
 * EADDRINUSE occurs at consumer-bind time, the caller should retry by
 * allocating a fresh port.
 */
export async function reservePorts(count: number): Promise<number[]> {
    if (count < 1) {
        throw new Error(`reservePorts: count must be >= 1, got ${count}`);
    }
    const ports: number[] = [];
    for (let i = 0; i < count; i++) {
        ports.push(await reserveOnePort());
    }
    return ports;
}

function reserveOnePort(): Promise<number> {
    return new Promise<number>((resolve, reject) => {
        const srv = createServer();
        srv.unref();
        srv.on("error", reject);
        srv.listen(0, "127.0.0.1", () => {
            const addr = srv.address();
            if (addr === null || typeof addr === "string") {
                srv.close();
                reject(
                    new Error(
                        `reservePorts: unexpected address shape ${JSON.stringify(addr)}`,
                    ),
                );
                return;
            }
            const port = addr.port;
            srv.close((err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(port);
                }
            });
        });
    });
}
