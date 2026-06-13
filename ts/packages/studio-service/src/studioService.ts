// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import registerDebug from "debug";
import {
    generateStudioServiceToken,
    writeStudioServiceToken,
    clearStudioServiceToken,
} from "@typeagent/core/runtime";
import { StudioServiceServer } from "./studioServiceServer.js";
import { getStudioRuntime } from "./runtime.js";

const debug = registerDebug("typeagent:studio:service");

/** A running Studio service instance. */
export interface StudioServiceHandle {
    /** The bound loopback port. */
    readonly port: number;
    /** The capability token a client must present (`Authorization: Bearer`). */
    readonly token: string;
    /** Stop the server and clear the published token file. */
    close(): Promise<void>;
}

/**
 * Start a standalone Studio service: mint a capability token, bind the WebSocket
 * server (loopback, OS-assigned port unless `port` is given), publish the token
 * to the per-port file so clients can authenticate, and resolve the per-workspace
 * runtime per request via `getStudioRuntime`. Fail closed: if the token file
 * can't be written, tear the server down rather than leave it unauthenticatable.
 */
export async function startStudioService(
    options: { port?: number } = {},
): Promise<StudioServiceHandle> {
    const token = generateStudioServiceToken();
    const server = await StudioServiceServer.start(
        (repoRoot) => getStudioRuntime(repoRoot),
        options.port ?? 0,
        token,
    );
    try {
        await writeStudioServiceToken(server.port, token);
    } catch (e) {
        await server.close();
        throw e;
    }
    debug(`studio service listening on 127.0.0.1:${server.port}`);
    return {
        port: server.port,
        token,
        close: async () => {
            const port = server.port;
            await server.close();
            await clearStudioServiceToken(port);
            debug("studio service stopped");
        },
    };
}
