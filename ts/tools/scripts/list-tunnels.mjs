#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// List the user's Dev Tunnels with their derived agent-server client URLs and
// live/down state, and flag which one matches the local `devtunnel.json`. Answers
// "what's my tunnel URL and is a host running?" in one command.
//
// Usage:
//   node list-tunnels.mjs [options]
//     --json     Machine-readable output.
//     --token    Also print a connect token for the configured tunnel.

import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

function parseArgs(argv) {
    const args = { json: false, token: false };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--json") args.json = true;
        else if (a === "--token") args.token = true;
        else if (a === "-h" || a === "--help") {
            console.log(fs.readFileSync(new URL(import.meta.url)).toString());
            process.exit(0);
        } else {
            console.error(`Unknown argument: ${a}`);
            process.exit(1);
        }
    }
    return args;
}

function userDataDir() {
    return (
        process.env.TYPEAGENT_USER_DATA_DIR ??
        path.join(os.homedir(), ".typeagent")
    );
}

function dt(args, { json = false, check = true } = {}) {
    const finalArgs = json ? [...args, "--json"] : args;
    const res = spawnSync("devtunnel", finalArgs, { encoding: "utf-8" });
    if (res.error?.code === "ENOENT") {
        console.error(
            "devtunnel CLI not found (install: winget install Microsoft.devtunnel / brew install --cask devtunnel).",
        );
        process.exit(1);
    }
    if (check && res.status !== 0) {
        throw new Error(
            `devtunnel ${finalArgs.join(" ")} failed (${res.status}): ${res.stderr ?? ""}`,
        );
    }
    if (json) {
        try {
            return JSON.parse(res.stdout);
        } catch {
            return undefined;
        }
    }
    return res.stdout;
}

function readLocalConfig() {
    try {
        return JSON.parse(
            fs.readFileSync(path.join(userDataDir(), "devtunnel.json"), "utf-8"),
        );
    } catch {
        return undefined;
    }
}

function deriveWssUrl(fullTunnelId, cluster, port) {
    const bareId =
        cluster && fullTunnelId.endsWith(`.${cluster}`)
            ? fullTunnelId.slice(0, -(cluster.length + 1))
            : fullTunnelId;
    return `wss://${bareId}-${port}.${cluster}.devtunnels.ms`;
}

function main() {
    const args = parseArgs(process.argv);

    const loginStatus = spawnSync("devtunnel", ["user", "show"], {
        encoding: "utf-8",
    });
    if (loginStatus.error?.code === "ENOENT") dt(["--version"]);
    if (!(loginStatus.stdout ?? "").toLowerCase().includes("logged in")) {
        console.error("Not signed in. Run `devtunnel user login` first.");
        process.exit(1);
    }

    const local = readLocalConfig();
    const listed = dt(["list"], { json: true, check: false });
    const tunnels = listed?.tunnels ?? [];

    const rows = [];
    for (const t of tunnels) {
        const id = t.tunnelId; // "<id>.<cluster>"
        const cluster = id.includes(".") ? id.slice(id.indexOf(".") + 1) : "";
        // Per-tunnel details for ports + live host state.
        const info = dt(["show", id], { json: true, check: false });
        const tunnel = info?.tunnel ?? t;
        const live = (tunnel.hostConnections ?? 0) > 0;
        const ports = (tunnel.ports ?? []).map((p) => p.portNumber);
        rows.push({
            tunnelId: id,
            cluster,
            labels: tunnel.labels ?? [],
            ports,
            live,
            urls: ports.map((p) => ({
                port: p,
                url: deriveWssUrl(id, cluster, p),
            })),
            configured: local?.tunnelId === id,
        });
    }

    if (args.json) {
        console.log(JSON.stringify({ tunnels: rows, local }, null, 2));
        return;
    }

    if (rows.length === 0) {
        console.log("No Dev Tunnels found. Run setup-devtunnel.mjs to create one.");
        return;
    }
    for (const r of rows) {
        const mark = r.configured ? " (configured)" : "";
        console.log(
            `\n${r.tunnelId}${mark}  [${r.live ? "LIVE" : "host down"}]` +
                (r.labels.length ? `  labels: ${r.labels.join(",")}` : ""),
        );
        for (const u of r.urls) {
            console.log(`  ${u.port}: ${u.url}`);
        }
    }

    if (args.token) {
        const id = local?.tunnelId ?? rows[0].tunnelId;
        console.log(`\nConnect token for ${id}:`);
        process.stdout.write(dt(["token", id, "--scopes", "connect"]));
    }
}

main();
