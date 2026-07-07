// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Starts the agent-server and then brings up the dev-tunnel host (if
// configured). Intended for development use: `pnpm run start:tunnel`.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = path.resolve(__dirname, "../../../../tools/scripts");
const tunnelServe = path.join(scriptsDir, "typeagent-serve.mjs");

// Import and run the server inline (same process).
await import("./server.js");

// Give the server a moment to bind, then start the tunnel host.
setTimeout(() => {
    const child = spawn(process.execPath, [tunnelServe, "tunnel", "start"], {
        stdio: "inherit",
        cwd: scriptsDir,
    });
    child.on("exit", (code) => {
        if (code !== 0) {
            console.error(
                `Tunnel host failed to start (exit ${code}). Is a tunnel configured? Run: node ${path.join(scriptsDir, "setup-devtunnel.mjs")}`,
            );
        }
    });
}, 1000);
