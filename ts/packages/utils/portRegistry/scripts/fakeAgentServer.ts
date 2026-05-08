// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Fake agent-server stub used by the port-registry smoke driver.
 *
 * Behaves like a real agent server from the registry's point of view —
 * it allocates a slot in the AgentServer namespace, registers itself
 * under a workspace key, and binds an HTTP server on the allocated
 * port serving a `/health` endpoint. It stays alive until killed.
 *
 * Usage (invoked by the smoke driver, not by users):
 *
 *   node fakeAgentServer.js \
 *     --workspace <key> \
 *     [--ready-fd <fd>]      // signals readiness by writing a line to this fd
 *     [--client-only]         // do not enable server mode; lookup-only mode
 */

import * as http from "node:http";
import { globalRegistry, Namespaces } from "@typeagent/port-registry";

function arg(name: string): string | undefined {
    const i = process.argv.indexOf(name);
    return i !== -1 && i + 1 < process.argv.length
        ? process.argv[i + 1]
        : undefined;
}

function flag(name: string): boolean {
    return process.argv.includes(name);
}

const debug = (...args: unknown[]) =>
    console.error(`[fake-agent ${process.pid}]`, ...args);

async function main() {
    const workspace = arg("--workspace");
    if (!workspace) {
        console.error("--workspace is required");
        process.exit(2);
    }
    const clientOnly = flag("--client-only");

    if (!clientOnly) {
        globalRegistry.enableServerMode();
    }

    debug(`starting (workspace=${workspace} clientOnly=${clientOnly})`);

    if (clientOnly) {
        // Lookup-only mode: just confirm we can resolve and exit.
        await globalRegistry.ensure();
        const result = await globalRegistry.lookup(
            Namespaces.AgentServer,
            workspace,
        );
        console.log(JSON.stringify({ kind: "lookup", workspace, result }));
        process.exit(0);
    }

    const allocated = await globalRegistry.allocate(Namespaces.AgentServer, {
        count: 1,
        key: workspace,
    });
    const port = allocated.ports[0]!;
    debug(`allocated slot=${allocated.slotId} port=${port}`);

    const server = http.createServer((req, res) => {
        if (req.url === "/health") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
                JSON.stringify({
                    ok: true,
                    pid: process.pid,
                    workspace,
                    slotId: allocated.slotId,
                }),
            );
            return;
        }
        res.writeHead(404);
        res.end();
    });
    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => resolve());
    });
    debug(`listening on http://127.0.0.1:${port}/health`);

    // Print a single line of JSON on stdout for the smoke driver to parse.
    console.log(
        JSON.stringify({
            kind: "ready",
            pid: process.pid,
            workspace,
            port,
            slotId: allocated.slotId,
        }),
    );

    const shutdown = async (signal: string) => {
        debug(`received ${signal}, shutting down`);
        try {
            await globalRegistry.release(allocated.slotId);
        } catch (err) {
            debug(`release failed: ${err}`);
        }
        try {
            await new Promise<void>((resolve) => server.close(() => resolve()));
        } catch {}
        try {
            await globalRegistry.stop();
        } catch {}
        process.exit(0);
    };
    process.on("SIGINT", () => void shutdown("SIGINT"));
    process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
    debug(`fatal: ${err?.stack ?? err}`);
    process.exit(1);
});
