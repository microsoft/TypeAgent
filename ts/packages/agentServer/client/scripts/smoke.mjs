// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// End-to-end smoke driver for the well-known port architecture.
// Spawns a real agent-server in an isolated profile on a non-default
// port (so it never collides with a developer's running AS), then
// verifies:
//   - connectAgentServer succeeds at the configured URL
//   - lookupAgentServer returns a handle pointing at the same port
//   - a second AS in the same data dir refuses with ERR_INSTANCE_LOCKED
//   - graceful shutdown via RPC stops the process
//
// Run from the package dir (after building both client + server):
//   node scripts/smoke.mjs

import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    connectAgentServer,
    getAgentServerUrl,
    lookupAgentServer,
} from "../dist/index.js";

const profileDir = path.join(
    os.tmpdir(),
    `typeagent-smoke-${process.pid}-${Date.now()}`,
);
const here = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.resolve(here, "../../server/dist/server.js");

async function pickFreePort() {
    return await new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.unref();
        srv.on("error", reject);
        srv.listen(0, "127.0.0.1", () => {
            const port = srv.address().port;
            srv.close(() => resolve(port));
        });
    });
}

const port = await pickFreePort();
process.env.TYPEAGENT_USER_DATA_DIR = profileDir;
process.env.AGENT_SERVER_PORT = String(port);

let pass = 0;
let fail = 0;
const log = (m) => console.log(m);

function check(name, cond) {
    if (cond) {
        pass++;
        log(`PASS  ${name}`);
    } else {
        fail++;
        log(`FAIL  ${name}`);
    }
}

function spawnServer(env) {
    return spawn("node", [serverPath], {
        env: { ...process.env, ...env },
        stdio: ["ignore", "pipe", "pipe"],
    });
}

async function waitFor(predicate, timeoutMs = 30_000, intervalMs = 100) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const v = await predicate();
            if (v) return v;
        } catch {}
        await new Promise((r) => setTimeout(r, intervalMs));
    }
    return undefined;
}

let child;
let conflictChild;
try {
    log(`spawning server: ${serverPath}`);
    log(`profile: ${profileDir}`);
    log(`port: ${port}`);
    child = spawnServer({});
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));

    const url = getAgentServerUrl();
    check(
        "getAgentServerUrl honors AGENT_SERVER_PORT",
        url.endsWith(`:${port}`),
    );

    const handle = await waitFor(() => lookupAgentServer(), 120_000);
    check("lookupAgentServer finds running server", handle !== undefined);
    check(
        "lookupAgentServer reports configured port",
        handle !== undefined && handle.port === port,
    );

    const conn = await connectAgentServer(url);
    check("client connects at configured url", true);

    log("spawning conflict server (same data dir, different port)...");
    const conflictPort = await pickFreePort();
    let conflictStderr = "";
    let conflictStdout = "";
    conflictChild = spawnServer({ AGENT_SERVER_PORT: String(conflictPort) });
    conflictChild.stderr.on("data", (d) => (conflictStderr += d.toString()));
    conflictChild.stdout.on("data", (d) => (conflictStdout += d.toString()));
    const conflictExit = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(undefined), 90_000);
        conflictChild.once("exit", (code) => {
            clearTimeout(timer);
            resolve(code);
        });
    });
    check(
        "second AS in same data dir exits non-zero",
        conflictExit !== 0 && conflictExit !== undefined,
    );
    const conflictAll = conflictStderr + conflictStdout;
    check(
        "second AS reports instance lock conflict",
        conflictAll.includes("ERR_INSTANCE_LOCKED") ||
            conflictAll.includes("already using the instance directory"),
    );

    // Shutdown: the server closes the WebSocket as part of shutting
    // down, so the in-flight RPC call rejects with "Agent channel
    // disconnected". That's expected — swallow it.
    await conn.shutdown().catch(() => {});

    await new Promise((resolve) => {
        const timer = setTimeout(resolve, 8_000);
        child.once("exit", () => {
            clearTimeout(timer);
            resolve();
        });
    });

    check(
        "server process exited after shutdown rpc",
        child.exitCode !== null || child.killed,
    );

    const legacyDiscovery = path.join(profileDir, "agent-server.json");
    check("no legacy discovery file written", !fs.existsSync(legacyDiscovery));

    if (fail > 0) {
        log(`\n--- server stdout ---\n${stdout}`);
        log(`\n--- server stderr ---\n${stderr}`);
        log(`\n--- conflict stderr ---\n${conflictStderr}`);
    }
} catch (err) {
    fail++;
    log(`FAIL  unexpected error: ${err.stack || err}`);
} finally {
    for (const c of [child, conflictChild]) {
        try {
            if (c && !c.killed && c.exitCode === null) {
                c.kill("SIGKILL");
            }
        } catch {}
    }
    try {
        fs.rmSync(profileDir, { recursive: true, force: true });
    } catch {}
}

log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
