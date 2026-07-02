#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Create (or reuse) a Microsoft Dev Tunnel that forwards the agent-server port
// so a client on another device can reach the service, and write the mapping to
// `~/.typeagent/devtunnel.json` for the agent-server's discovery resolver.
//
// The tunnel is a pure relay with no store-and-forward: traffic only flows while
// a host process is connected (`devtunnel host <id>`), so this script sets up the
// tunnel and prints the host command (or runs it with --host).
//
// Usage:
//   node setup-devtunnel.mjs [options]
//     --port <n>      Agent-server port to forward (default 8999)
//     --name <id>     Tunnel id (default typeagent-<hostname>)
//     --anonymous     Allow anonymous client access (WARNING: removes the only
//                     auth on an otherwise unauthenticated service). Default is
//                     private (clients present a connect token).
//     --host          Start `devtunnel host` in the foreground after setup.
//     --no-login      Don't attempt an interactive login if not signed in.

import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

function parseArgs(argv) {
    const args = {
        port: 8999,
        name: undefined,
        anonymous: false,
        host: false,
        login: true,
    };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--port") args.port = parseInt(argv[++i], 10);
        else if (a === "--name") args.name = argv[++i];
        else if (a === "--anonymous") args.anonymous = true;
        else if (a === "--host") args.host = true;
        else if (a === "--no-login") args.login = false;
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

// Run devtunnel, returning stdout (or parsed JSON with {json:true}). When the
// CLI is missing, print install guidance and exit.
function dt(args, { json = false, check = true } = {}) {
    const finalArgs = json ? [...args, "--json"] : args;
    const res = spawnSync("devtunnel", finalArgs, { encoding: "utf-8" });
    if (res.error && res.error.code === "ENOENT") {
        console.error(
            "devtunnel CLI not found. Install it:\n" +
                "  Windows: winget install Microsoft.devtunnel\n" +
                "  macOS:   brew install --cask devtunnel\n" +
                "  Linux:   curl -sL https://aka.ms/DevTunnelCliInstall | bash",
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

// devtunnel ids: lowercase alphanumeric + dashes, 3-60 chars.
function defaultTunnelName() {
    const host = os
        .hostname()
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-");
    return `typeagent-${host}`.slice(0, 60).replace(/-+$/, "");
}

function deriveWssUrl(fullTunnelId, cluster, port) {
    const bareId = fullTunnelId.endsWith(`.${cluster}`)
        ? fullTunnelId.slice(0, -(cluster.length + 1))
        : fullTunnelId;
    return `wss://${bareId}-${port}.${cluster}.devtunnels.ms`;
}

function main() {
    const args = parseArgs(process.argv);
    const name = args.name ?? defaultTunnelName();

    // Login check (devtunnel user show exits non-zero when signed out).
    const loginStatus = spawnSync("devtunnel", ["user", "show"], {
        encoding: "utf-8",
    });
    if (loginStatus.error?.code === "ENOENT") {
        dt(["--version"]); // triggers the install-guidance path + exit
    }
    const signedIn = (loginStatus.stdout ?? "")
        .toLowerCase()
        .includes("logged in");
    if (!signedIn) {
        if (!args.login) {
            console.error(
                "Not signed in to devtunnel. Run `devtunnel user login` (Entra/Microsoft) first, or omit --no-login.",
            );
            process.exit(1);
        }
        console.log(
            "Signing in to Dev Tunnels (a browser window will open)...",
        );
        const login = spawnSync("devtunnel", ["user", "login"], {
            stdio: "inherit",
        });
        if (login.status !== 0) {
            console.error("devtunnel login failed.");
            process.exit(1);
        }
    }

    // Create or reuse the tunnel.
    let info = dt(["show", name], { json: true, check: false });
    if (info?.tunnel === undefined) {
        console.log(`Creating tunnel "${name}"...`);
        const createArgs = ["create", name, "--labels", "typeagent"];
        if (args.anonymous) createArgs.push("--allow-anonymous");
        info = dt(createArgs, { json: true });
    } else {
        console.log(`Reusing existing tunnel "${name}".`);
    }
    const fullTunnelId = info.tunnel.tunnelId; // "<id>.<cluster>"
    const cluster = fullTunnelId.includes(".")
        ? fullTunnelId.slice(fullTunnelId.indexOf(".") + 1)
        : "";

    // Ensure the port is forwarded (idempotent — ignore "already exists").
    const ports = info.tunnel.ports ?? [];
    const hasPort = ports.some((p) => p.portNumber === args.port);
    if (!hasPort) {
        console.log(`Forwarding port ${args.port}...`);
        dt(["port", "create", name, "-p", String(args.port)], { check: false });
    }

    // Write the discovery mapping.
    const dir = userDataDir();
    fs.mkdirSync(dir, { recursive: true });
    const configPath = path.join(dir, "devtunnel.json");
    const config = {
        tunnelId: fullTunnelId,
        cluster,
        ports: { [String(args.port)]: "agent-server" },
        access: args.anonymous ? "anonymous" : "private",
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
    console.log(`Wrote ${configPath}`);

    const wss = deriveWssUrl(fullTunnelId, cluster, args.port);
    console.log(`\nTunnel ready. Client URL: ${wss}`);
    if (args.anonymous) {
        console.warn(
            "WARNING: anonymous access is enabled — anyone with the URL can reach the\n" +
                "agent-server, which has no auth of its own. Prefer private + a connect token.",
        );
    } else {
        console.log(
            `Private tunnel — clients need a connect token:\n  devtunnel token ${name} --scopes connect`,
        );
    }

    if (args.host) {
        console.log(`\nStarting host (Ctrl+C to stop)...`);
        spawnSync("devtunnel", ["host", name], { stdio: "inherit" });
    } else {
        console.log(
            `\nTo serve traffic, run (keep it running):\n  devtunnel host ${name}`,
        );
    }
}

main();
