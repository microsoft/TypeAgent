// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { AddressInfo } from "node:net";

/**
 * Resolve the TCP port of a server that may have been bound to an OS-assigned
 * ephemeral port (i.e. opened with `port: 0`). Throws if the server is not
 * currently listening on a TCP/IP socket (e.g. it is closed, never started,
 * or bound to a Unix domain socket / pipe).
 *
 * Use the `"listening"` event to know when it is safe to call this.
 */
export function getBoundPort(server: {
    address(): AddressInfo | string | null;
}): number {
    const addr = server.address();
    if (addr === null) {
        throw new Error("Server is not listening");
    }
    if (typeof addr === "string") {
        throw new Error(
            `Server is not bound to a TCP/IP socket (address: ${addr})`,
        );
    }
    return addr.port;
}
