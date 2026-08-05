// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const packageDirectory = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
);
const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "agent-memory-package-"),
);

try {
    const packOutput = runNpm(
        ["pack", "--json", packageDirectory],
        temporaryDirectory,
        "pipe",
    );
    const [{ filename, files }] = JSON.parse(packOutput);
    const tarballPath = path.join(temporaryDirectory, filename);
    const packedPaths = new Set(files.map((file) => file.path));

    for (const requiredPath of [
        "dist/src/main.js",
        "migrations/README.md",
        "package.json",
    ]) {
        if (!packedPaths.has(requiredPath)) {
            throw new Error(`Packed server is missing ${requiredPath}`);
        }
    }
    if ([...packedPaths].some((packedPath) => packedPath.includes("test"))) {
        throw new Error("Packed server contains test files");
    }

    runNpm(["init", "--yes"], temporaryDirectory);
    runNpm(["install", "--ignore-scripts", tarballPath], temporaryDirectory);

    const installedPackageDirectory = path.join(
        temporaryDirectory,
        "node_modules",
        "@typeagent",
        "agent-memory-mcp",
    );
    const installedManifest = JSON.parse(
        await readFile(
            path.join(installedPackageDirectory, "package.json"),
            "utf8",
        ),
    );
    const runtimeDependencies = Object.keys(
        installedManifest.dependencies ?? {},
    );
    if (runtimeDependencies.some((name) => name.startsWith("@typeagent/"))) {
        throw new Error("Packed server has a TypeAgent runtime dependency");
    }

    const client = new Client({
        name: "agent-memory-package-smoke",
        version: "0.0.1",
    });
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [path.join(installedPackageDirectory, "dist", "src", "main.js")],
        cwd: temporaryDirectory,
        stderr: "pipe",
    });

    try {
        await client.connect(transport);
        const result = await client.callTool({
            name: "memory_status",
            arguments: {},
        });
        if (result.structuredContent?.service !== "agent-memory-mcp") {
            throw new Error("Packed server returned an unexpected status");
        }
    } finally {
        await client.close();
    }
} finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
}

function runNpm(args, cwd, output = "ignore") {
    if (process.platform === "win32") {
        const npmCliPath = path.join(
            path.dirname(process.execPath),
            "node_modules",
            "npm",
            "bin",
            "npm-cli.js",
        );
        return execFileSync(process.execPath, [npmCliPath, ...args], {
            cwd,
            encoding: "utf8",
            stdio: output === "pipe" ? "pipe" : "ignore",
        });
    }

    return execFileSync("npm", args, {
        cwd,
        encoding: "utf8",
        stdio: output === "pipe" ? "pipe" : "ignore",
    });
}
