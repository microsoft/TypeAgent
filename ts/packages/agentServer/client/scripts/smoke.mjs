// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// End-to-end smoke driver for the discovery-file architecture.
// Spawns a real agent-server in an isolated profile, connects via
// the discovery file, sends shutdown, and verifies the file is
// removed.
//
// Run from the package dir (after building the package):
//   node scripts/smoke.mjs

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    connectAgentServer,
    isProcessAlive,
    readDiscoveryFile,
    waitForDiscoveryFile,
    getDiscoveryFilePath,
} from "../dist/index.js";

const profileDir = path.join(
    os.tmpdir(),
    `typeagent-smoke-${process.pid}-${Date.now()}`,
);
const here = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.resolve(here, "../../server/dist/server.js");

const discoveryFile = getDiscoveryFilePath();
let initialDiscovery = undefined;
if (fs.existsSync(discoveryFile)) {
    initialDiscovery = fs.readFileSync(discoveryFile, "utf-8");
    fs.unlinkSync(discoveryFile);
}

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

let child;
try {
    log(`spawning server: ${serverPath}`);
    log(`profile: ${profileDir}`);
    child = spawn("node", [serverPath], {
        env: {
            ...process.env,
            TYPEAGENT_USER_DATA_DIR: profileDir,
        },
        stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));

    const record = await waitForDiscoveryFile(120_000);
    check("discovery file appears", record !== undefined);
    check(
        "discovery file has port",
        typeof record.port === "number" && record.port > 0,
    );
    check("discovery file pid alive", isProcessAlive(record.pid));

    const url = `ws://localhost:${record.port}`;
    const conn = await connectAgentServer(url);
    check("client connects via discovery url", true);

    const reread = readDiscoveryFile();
    check(
        "readDiscoveryFile returns matching record",
        reread !== undefined &&
            reread.port === record.port &&
            reread.pid === record.pid,
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
        child.once("close", () => {
            clearTimeout(timer);
            resolve();
        });
    });

    check(
        "server process exited",
        child.exitCode !== null || child.killed,
    );
    check(
        "discovery file removed on shutdown",
        !fs.existsSync(discoveryFile),
    );

    if (fail > 0) {
        log(`\n--- server stdout ---\n${stdout}`);
        log(`\n--- server stderr ---\n${stderr}`);
    }
} catch (err) {
    fail++;
    log(`FAIL  unexpected error: ${err.stack || err}`);
} finally {
    try {
        if (child && !child.killed && child.exitCode === null) {
            child.kill("SIGKILL");
        }
    } catch {}
    try {
        fs.rmSync(profileDir, { recursive: true, force: true });
    } catch {}
    if (initialDiscovery !== undefined && !fs.existsSync(discoveryFile)) {
        try {
            fs.writeFileSync(discoveryFile, initialDiscovery);
        } catch {}
    }
}

log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
