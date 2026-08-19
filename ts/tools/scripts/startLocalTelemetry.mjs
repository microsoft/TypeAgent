#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const containerName = "typeagent-otel";
const imageName = "grafana/otel-lgtm:latest";
const dockerReadyTimeoutMs = 120_000;
const grafanaReadyTimeoutMs = 120_000;

const args = new Set(process.argv.slice(2));
if (args.has("--help") || args.has("-h")) {
    console.log(`Usage: pnpm run telemetry:grafana [--install | --stop]

Starts Docker Desktop when needed on Windows or macOS, then starts the local
Grafana LGTM OpenTelemetry stack with loopback-only ports:
  Grafana:   http://localhost:3000
  OTLP/gRPC: http://localhost:4317
  OTLP/HTTP: http://localhost:4318

Options:
  --install  Install Docker Desktop when it is missing, then start Grafana.
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
    return ["3000/tcp", "4317/tcp", "4318/tcp"].every((port) => {
        const entries = bindings[port];
        return (
            Array.isArray(entries) &&
            entries.length === 1 &&
            entries[0]?.HostIp === "127.0.0.1"
        );
    });
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
        throw new Error(
            "Docker CLI was not found. Install Docker Desktop before using this command.",
        );
    }
    if (!isDockerReady()) {
        console.log("[telemetry:grafana] Docker is not running.");
        return;
    }
    if (getContainerId(true) === "") {
        console.log("[telemetry:grafana] Grafana LGTM is not running.");
        return;
    }
    runDocker(["stop", containerName]);
}

async function start() {
    if (!isDockerInstalled()) {
        if (!args.has("--install")) {
            throw new Error(
                "Docker Desktop is not installed. Run `pnpm run telemetry:grafana --install` or install it manually from https://docs.docker.com/desktop/.",
            );
        }
        installDockerDesktop();
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
        await waitForGrafana();
        return;
    }

    if (getContainerId(true) !== "") {
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
            "-p",
            "127.0.0.1:4317:4317",
            "-p",
            "127.0.0.1:4318:4318",
            imageName,
        ]);
    }

    await waitForGrafana();
    console.log("[telemetry:grafana] Grafana:   http://localhost:3000");
    console.log("[telemetry:grafana] OTLP/HTTP: http://localhost:4318");
    console.log("[telemetry:grafana] OTLP/gRPC: http://localhost:4317");
}

try {
    for (const arg of args) {
        if (arg !== "--install" && arg !== "--stop") {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }
    if (args.has("--install") && args.has("--stop")) {
        throw new Error("--install and --stop cannot be used together.");
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
