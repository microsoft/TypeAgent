// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import {
    chmod,
    mkdir,
    mkdtemp,
    realpath,
    rm,
    writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveRunRuntimeFingerprint } from "../src/runtimeFingerprint.js";

test("fingerprints Copilot, packaged ripgrep, and the Node MCP entrypoint", async () => {
    const directory = await mkdtemp(
        path.join(os.tmpdir(), "runtime-fingerprint-"),
    );
    const copilot = path.join(directory, "copilot");
    const server = path.join(directory, "server.js");
    const lsp = await createLspRuntime(directory);
    try {
        await writeFile(copilot, "copilot-v1");
        await writeFile(server, "server-v1");
        await chmod(copilot, 0o700);
        const first = await resolveRunRuntimeFingerprint(copilot, {
            command: process.execPath,
            args: [server],
            envVars: [],
            pythonLspCommand: lsp.pythonLauncher,
            typescriptLspCommand: process.execPath,
            typescriptLspArgs: [lsp.typescriptEntrypoint, "--stdio"],
        });

        await writeFile(copilot, "copilot-v2");
        await writeFile(server, "server-v2");
        await writeFile(
            lsp.pythonLauncher,
            `#!${lsp.pythonInterpreter}\n# pylsp-v2\n`,
        );
        await writeFile(lsp.pythonInterpreter, "python-v2");
        await writeFile(lsp.pythonLock, "lock-v2");
        await writeFile(lsp.typescriptEntrypoint, "typescript-v2");
        const second = await resolveRunRuntimeFingerprint(copilot, {
            command: process.execPath,
            args: [server],
            envVars: [],
            pythonLspCommand: lsp.pythonLauncher,
            typescriptLspCommand: process.execPath,
            typescriptLspArgs: [lsp.typescriptEntrypoint, "--stdio"],
        });

        assert.notEqual(first.copilot.sha256, second.copilot.sha256);
        assert.equal(first.ripgrep.sha256, second.ripgrep.sha256);
        assert.notEqual(
            first.mcpEntrypoint?.sha256,
            second.mcpEntrypoint?.sha256,
        );
        assert.notEqual(first.pythonLsp?.sha256, second.pythonLsp?.sha256);
        assert.notEqual(
            first.pythonLspInterpreter?.sha256,
            second.pythonLspInterpreter?.sha256,
        );
        assert.notEqual(
            first.pythonLspLock?.sha256,
            second.pythonLspLock?.sha256,
        );
        assert.notEqual(
            first.typescriptLspEntrypoint?.sha256,
            second.typescriptLspEntrypoint?.sha256,
        );
        assert.equal(
            first.typescriptLspCommand?.sha256,
            second.typescriptLspCommand?.sha256,
        );
        assert.equal(first.mcpCommand.path, await realpath(process.execPath));
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("rejects a non-executable Python LSP launcher", async () => {
    const directory = await mkdtemp(
        path.join(os.tmpdir(), "runtime-fingerprint-"),
    );
    const copilot = path.join(directory, "copilot");
    const server = path.join(directory, "server.js");
    const lsp = await createLspRuntime(directory, 0o600);
    try {
        await writeFile(copilot, "copilot");
        await writeFile(server, "server");
        await chmod(copilot, 0o700);

        await assert.rejects(
            resolveRunRuntimeFingerprint(copilot, {
                command: process.execPath,
                args: [server],
                envVars: [],
                pythonLspCommand: lsp.pythonLauncher,
                typescriptLspCommand: process.execPath,
                typescriptLspArgs: [lsp.typescriptEntrypoint, "--stdio"],
            }),
            /not executable/i,
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

async function createLspRuntime(directory: string, launcherMode = 0o700) {
    const project = path.join(directory, "python-lsp");
    const bin = path.join(project, ".venv", "bin");
    const pythonLauncher = path.join(bin, "pylsp");
    const pythonInterpreter = path.join(bin, "python");
    const pythonLock = path.join(project, "uv.lock");
    const typescriptEntrypoint = path.join(directory, "typescript-cli.mjs");
    await mkdir(bin, { recursive: true });
    await writeFile(pythonInterpreter, "python-v1");
    await writeFile(pythonLauncher, `#!${pythonInterpreter}\n# pylsp-v1\n`);
    await writeFile(pythonLock, "lock-v1");
    await writeFile(typescriptEntrypoint, "typescript-v1");
    await chmod(pythonInterpreter, 0o700);
    await chmod(pythonLauncher, launcherMode);
    return {
        pythonLauncher,
        pythonInterpreter,
        pythonLock,
        typescriptEntrypoint,
    };
}

test("fails before cache selection when a Node MCP entrypoint is missing", async () => {
    const directory = await mkdtemp(
        path.join(os.tmpdir(), "runtime-fingerprint-"),
    );
    const copilot = path.join(directory, "copilot");
    try {
        await writeFile(copilot, "copilot");
        await chmod(copilot, 0o700);
        await assert.rejects(
            resolveRunRuntimeFingerprint(copilot, {
                command: process.execPath,
                args: [],
                envVars: [],
            }),
            /requires a file entrypoint/i,
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
