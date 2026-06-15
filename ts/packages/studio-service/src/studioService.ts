// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import registerDebug from "debug";
import {
    generateStudioServiceToken,
    writeStudioServiceToken,
    clearStudioServiceToken,
    studioWorkspaceKey,
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
    /** The canonical repo root this service is bound to. */
    readonly repoRoot: string;
    /** The canonical workspace key ({@link studioWorkspaceKey}) it serves. */
    readonly workspaceKey: string;
    /** Stop the server and clear the published token file. */
    close(): Promise<void>;
}

/**
 * Start a standalone Studio service: mint a capability token, bind the WebSocket
 * server (loopback, OS-assigned port unless `port` is given), publish the token
 * to the per-port file so clients can authenticate, and serve **one** workspace.
 *
 * The service is per-workspace (launched with `--workspace`), so it binds to a
 * single canonical workspace at startup and refuses any request whose `repoRoot`
 * canonicalizes to a *different* workspace — rather than silently multiplexing
 * runtimes for arbitrary roots a client might send (which is how the "wrong
 * workspace" class of bugs arises). `repoRoot` omitted, or matching the bound
 * workspace, is served normally.
 *
 * Fail closed: if the token file can't be written, tear the server down rather
 * than leave it unauthenticatable.
 */
export async function startStudioService(
    options: { port?: number; repoRoot?: string } = {},
): Promise<StudioServiceHandle> {
    const token = generateStudioServiceToken();
    // Resolve the one workspace this service serves (canonical repo root + key).
    const boundRuntime = getStudioRuntime(options.repoRoot);
    const boundRepoRoot = boundRuntime.getRepoRootInfo().repoRoot;
    const boundKey = studioWorkspaceKey(boundRepoRoot);
    const resolveRuntime = (repoRoot?: string) => {
        if (
            repoRoot !== undefined &&
            repoRoot.trim().length > 0 &&
            studioWorkspaceKey(repoRoot) !== boundKey
        ) {
            throw new Error(
                `Studio service is bound to workspace '${boundRepoRoot}'; refusing a request for a different workspace.`,
            );
        }
        return boundRuntime;
    };
    const server = await StudioServiceServer.start(
        resolveRuntime,
        options.port ?? 0,
        token,
    );
    try {
        await writeStudioServiceToken(server.port, token);
    } catch (e) {
        await server.close();
        throw e;
    }
    debug(
        `studio service listening on 127.0.0.1:${server.port} (workspace ${boundRepoRoot})`,
    );
    return {
        port: server.port,
        token,
        repoRoot: boundRepoRoot,
        workspaceKey: boundKey,
        close: async () => {
            const port = server.port;
            await server.close();
            await clearStudioServiceToken(port);
            debug("studio service stopped");
        },
    };
}
