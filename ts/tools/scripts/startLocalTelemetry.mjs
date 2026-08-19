#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import readline from "node:readline/promises";
import {
    disableTelemetryLocal,
    enableTelemetryLocal,
    resolveLocalConfigPath,
} from "./lib/telemetryLocalYaml.mjs";

const containerName = "typeagent-otel";
const imageName = "grafana/otel-lgtm:latest";
const dockerReadyTimeoutMs = 120_000;
const grafanaReadyTimeoutMs = 120_000;

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceTsRoot = path.resolve(scriptDir, "../..");

const args = new Set(process.argv.slice(2));
if (args.has("--help") || args.has("-h")) {
    console.log(`Usage: pnpm run telemetry:grafana [--stop]

Starts Docker Desktop when needed on Windows or macOS, then starts the local
Grafana LGTM OpenTelemetry stack:
  Grafana: http://localhost:3000

The collector ports are assigned dynamically on the loopback interface and
configured automatically in config.local.yaml (path resolved with the same
precedence as getKeys):
  TYPEAGENT_CONFIG_LOCAL > TYPEAGENT_CONFIG_DIR/config.local.yaml >
  ts/config.local.yaml

Starting sets telemetry.local.enabled to the string "true" and
telemetry.local.otlpEndpoint to the discovered OTLP/HTTP address, only AFTER
Grafana reports healthy. This script owns otlpEndpoint: any stale or
hand-customized value is overwritten on every start, since the assigned
port can differ from one run to the next. Stopping sets enabled to "false"
after the container is confirmed stopped (or already not running); other
local settings (logFile/logRetentionBytes/debugBridge/structuredLogs) are
left untouched.

TypeAgent reads config.local.yaml at process startup, so RESTART TypeAgent
after each toggle for the change to take effect.

Options:
  --stop     Stop the local Grafana LGTM container.
  --help     Show this help.`);
    process.exit(0);
}

function findDockerExecutable() {
    if (process.platform === "win32") {
        const installedExecutable = path.join(
            process.env.ProgramFiles ?? "C:\\Program Files",
            "Docker",
            "Docker",
            "resources",
            "bin",
            "docker.exe",
        );
        if (fs.existsSync(installedExecutable)) {
            return installedExecutable;
        }
    }

    const result = spawnSync("docker", ["--version"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
    });
    return result.status === 0 ? "docker" : undefined;
}

let dockerExecutable = findDockerExecutable();

function runDocker(dockerArgs, { capture = false, check = true } = {}) {
    if (dockerExecutable === undefined) {
        throw new Error("Docker CLI was not found.");
    }
    const result = spawnSync(dockerExecutable, dockerArgs, {
        encoding: "utf8",
        stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    if (check && result.status !== 0) {
        const detail = capture ? result.stderr?.trim() : undefined;
        throw new Error(
            `docker ${dockerArgs.join(" ")} failed${detail ? `: ${detail}` : "."}`,
        );
    }
    return result;
}

function isDockerInstalled() {
    return dockerExecutable !== undefined;
}

function isDockerReady() {
    return (
        runDocker(["info", "--format", "{{.ServerVersion}}"], {
            capture: true,
            check: false,
        }).status === 0
    );
}

function runInstaller(command, installerArgs) {
    const result = spawnSync(command, installerArgs, {
        stdio: "inherit",
    });
    if (result.error?.code === "ENOENT") {
        throw new Error(`${command} was not found.`);
    }
    if (result.status !== 0) {
        throw new Error(`${command} installation failed (${result.status}).`);
    }
}

function installDockerDesktop() {
    if (process.platform === "win32") {
        console.log(
            "[telemetry:grafana] Installing Docker Desktop with winget...",
        );
        runInstaller("winget", [
            "install",
            "--exact",
            "--id",
            "Docker.DockerDesktop",
            "--accept-package-agreements",
            "--accept-source-agreements",
        ]);
    } else if (process.platform === "darwin") {
        console.log(
            "[telemetry:grafana] Installing Docker Desktop with Homebrew...",
        );
        runInstaller("brew", ["install", "--cask", "docker"]);
    } else {
        throw new Error(
            "Automatic Docker installation is supported only on Windows and macOS. Install Docker Engine for this platform, then run the command again.",
        );
    }

    async function promptToInstallDockerDesktop() {
        if (!process.stdin.isTTY || !process.stdout.isTTY) {
            throw new Error(
                "Docker Desktop is not installed. Run this command in an interactive terminal to install it, or install it manually from https://docs.docker.com/desktop/.",
            );
        }

        const stdio = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });
        try {
            const answer = await stdio.question(
                "[telemetry:grafana] Docker Desktop is not installed. Install it now? (y/N) ",
            );
            if (answer.trim().toLowerCase() !== "y") {
                throw new Error(
                    "Docker Desktop is required. Install it from https://docs.docker.com/desktop/, then run this command again.",
                );
            }
        } finally {
            stdio.close();
        }

        installDockerDesktop();
    }

    dockerExecutable = findDockerExecutable();
    if (dockerExecutable === undefined) {
        throw new Error(
            "Docker Desktop was installed, but the Docker CLI is not available. Restart the terminal and run `pnpm run telemetry:grafana`.",
        );
    }
}

function startDockerDesktop() {
    if (process.platform === "win32") {
        const candidates = [
            path.join(
                process.env.ProgramFiles ?? "C:\\Program Files",
                "Docker",
                "Docker",
                "Docker Desktop.exe",
            ),
            path.join(
                process.env.LOCALAPPDATA ?? "",
                "Docker",
                "Docker Desktop.exe",
            ),
        ];
        const executable = candidates.find((candidate) =>
            fs.existsSync(candidate),
        );
        if (executable === undefined) {
            throw new Error(
                "Docker Desktop is installed but its executable could not be found.",
            );
        }
        const child = spawn(executable, [], {
            detached: true,
            stdio: "ignore",
        });
        child.unref();
        return;
    }

    if (process.platform === "darwin") {
        const result = spawnSync("open", ["-a", "Docker"], {
            stdio: "ignore",
        });
        if (result.status !== 0) {
            throw new Error("Docker Desktop could not be started.");
        }
        return;
    }

    throw new Error(
        "The Docker daemon is not running. Start it, then run this command again.",
    );
}

async function waitFor(description, timeoutMs, probe) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await probe()) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    throw new Error(`${description} did not become ready within 2 minutes.`);
}

function getContainerId(all) {
    const dockerArgs = ["ps", "-q"];
    if (all) {
        dockerArgs.push("-a");
    }
    dockerArgs.push("--filter", `name=^/${containerName}$`);
    const result = runDocker(dockerArgs, { capture: true });
    return result.stdout.trim();
}

function isLoopbackBinding(entries) {
    return (
        Array.isArray(entries) &&
        entries.length === 1 &&
        entries[0]?.HostIp === "127.0.0.1"
    );
}

function isDynamicLoopbackBinding(entries) {
    return isLoopbackBinding(entries) && entries[0].HostPort === "";
}

// `HostConfig.PortBindings` holds the *requested* binding spec and is
// available whether the container is running or stopped, but for a
// dynamically-assigned port (empty host port) it never reflects the actual
// host port Docker chose. It only tells us the port is bound to loopback,
// which is what we need to decide whether an existing container is
// compatible with the current (loopback-only) scheme.
function hasLoopbackBindings() {
    const result = runDocker(
        [
            "inspect",
            "--format",
            "{{json .HostConfig.PortBindings}}",
            containerName,
        ],
        { capture: true },
    );
    const bindings = JSON.parse(result.stdout);
    return (
        isLoopbackBinding(bindings["3000/tcp"]) &&
        bindings["3000/tcp"][0].HostPort === "3000" &&
        ["4317/tcp", "4318/tcp"].every((port) =>
            isDynamicLoopbackBinding(bindings[port]),
        )
    );
}

// `NetworkSettings.Ports` reflects the *actual* live port assignment and is
// only populated while the container is running. Docker picks a fresh
// ephemeral host port for the OTLP receivers on every start, so this must
// be re-queried each time rather than cached across runs.
function getRuntimeOtlpPorts() {
    const result = runDocker(
        [
            "inspect",
            "--format",
            "{{json .NetworkSettings.Ports}}",
            containerName,
        ],
        { capture: true },
    );
    const bindings = JSON.parse(result.stdout);
    const otlpHttpPort = getLoopbackHostPort(bindings, 4318);
    const otlpGrpcPort = getLoopbackHostPort(bindings, 4317);
    if (otlpHttpPort === undefined || otlpGrpcPort === undefined) {
        throw new Error(
            "Docker did not report loopback host ports for the OTLP endpoints.",
        );
    }
    return { otlpHttpPort, otlpGrpcPort };
}

function getLoopbackHostPort(bindings, containerPort) {
    const entries = bindings[`${containerPort}/tcp`];
    return isLoopbackBinding(entries) ? entries[0].HostPort : undefined;
}

async function waitForGrafana() {
    await waitFor("Grafana", grafanaReadyTimeoutMs, async () => {
        try {
            const response = await fetch("http://127.0.0.1:3000/api/health");
            return response.ok;
        } catch {
            return false;
        }
    });
}

async function stop() {
    if (!isDockerInstalled()) {
        console.log("[telemetry:grafana] Docker CLI was not found.");
        toggleTelemetryLocal(false);
        return;
    }
    if (!isDockerReady()) {
        console.log("[telemetry:grafana] Docker is not running.");
        // Container is definitely not exporting; safe to flip the sink off.
        toggleTelemetryLocal(false);
        return;
    }
    if (getContainerId(true) === "") {
        console.log("[telemetry:grafana] Grafana LGTM is not running.");
        toggleTelemetryLocal(false);
        return;
    }
    // Only flip the sink off after `docker stop` succeeds. If it fails, we
    // leave config.local.yaml alone: TypeAgent may still be exporting to a
    // partially-alive container, and a stale "enabled: false" would be
    // misleading on the next start attempt.
    runDocker(["stop", containerName]);
    toggleTelemetryLocal(false);
}

async function start() {
    if (!isDockerInstalled()) {
        if (process.platform === "win32" || process.platform === "darwin") {
            await promptToInstallDockerDesktop();
        } else {
            throw new Error(
                "Docker Engine is not installed. Install it using your distribution's supported procedure, then run this command again.",
            );
        }
    }

    if (!isDockerReady()) {
        console.log("[telemetry:grafana] Starting Docker Desktop...");
        startDockerDesktop();
        await waitFor("Docker Desktop", dockerReadyTimeoutMs, isDockerReady);
    }

    if (getContainerId(true) !== "" && !hasLoopbackBindings()) {
        console.log(
            "[telemetry:grafana] Recreating the container with loopback-only ports...",
        );
        runDocker(["rm", "--force", containerName]);
    }

    if (getContainerId(false) !== "") {
        console.log(
            "[telemetry:grafana] Grafana LGTM is already running at http://localhost:3000",
        );
    } else if (getContainerId(true) !== "") {
        console.log("[telemetry:grafana] Starting the existing container...");
        runDocker(["start", containerName]);
    } else {
        console.log(
            "[telemetry:grafana] Pulling and starting Grafana LGTM as needed...",
        );
        runDocker([
            "run",
            "--detach",
            "--rm",
            "--name",
            containerName,
            "-p",
            "127.0.0.1:3000:3000",
            // Let Docker pick the host port for the OTLP receivers (empty
            // host port) so they never collide with something else already
            // listening on 4317/4318. The chosen ports are discovered below
            // and written into config.local.yaml.
            "-p",
            "127.0.0.1::4317",
            "-p",
            "127.0.0.1::4318",
            imageName,
        ]);
    }

    await waitForGrafana();
    // Grafana is healthy: safe to advertise the local sink to TypeAgent.
    // We intentionally discover ports and toggle AFTER health passes so a
    // failed startup does not leave the config claiming a working sink is
    // available. Re-discover the ports even when the container was already
    // running: Docker may have assigned different ephemeral ports than the
    // last time this script ran, and this script owns otlpEndpoint, so any
    // stale/customized value must not survive.
    const { otlpHttpPort, otlpGrpcPort } = getRuntimeOtlpPorts();
    const otlpEndpoint = `http://127.0.0.1:${otlpHttpPort}`;
    toggleTelemetryLocal(true, otlpEndpoint);
    console.log("[telemetry:grafana] Grafana:   http://localhost:3000");
    console.log(
        "[telemetry:grafana] Restart TypeAgent so it picks up the new telemetry config.",
    );
}

function toggleTelemetryLocal(enable, otlpEndpoint) {
    const filePath = resolveLocalConfigPath(workspaceTsRoot);
    const result = enable
        ? enableTelemetryLocal(filePath, otlpEndpoint)
        : disableTelemetryLocal(filePath);
    if (result.changed) {
        console.log(
            `[telemetry:grafana] ${enable ? "Enabled" : "Disabled"} telemetry.local in ${result.path}. Restart TypeAgent for the change to take effect.`,
        );
    } else {
        console.log(
            `[telemetry:grafana] telemetry.local already ${enable ? "enabled" : "disabled"} in ${result.path}; no change.`,
        );
    }
}

try {
    for (const arg of args) {
        if (arg !== "--stop") {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }
    if (args.has("--stop")) {
        await stop();
    } else {
        await start();
    }
} catch (error) {
    console.error(
        `[telemetry:grafana] ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
}
