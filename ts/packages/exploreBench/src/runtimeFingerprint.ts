// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { resolvePackagedRipgrep } from "./ripgrep.js";
import type {
    McpServerConfig,
    RunRuntimeFingerprint,
    RuntimeFileFingerprint,
} from "./types.js";

export async function resolveRunRuntimeFingerprint(
    copilotPath: string,
    mcp: McpServerConfig,
): Promise<RunRuntimeFingerprint> {
    const [copilot, ripgrep, mcpCommand] = await Promise.all([
        fingerprintFile(copilotPath, true),
        resolvePackagedRipgrep(),
        fingerprintFile(mcp.command, true),
    ]);
    const mcpEntrypoint = isNodeCommand(mcp.command)
        ? await fingerprintNodeEntrypoint(mcp)
        : undefined;
    const lsp = mcp.pythonLspCommand
        ? await fingerprintLanguageServerRuntime(mcp)
        : undefined;
    return {
        copilot,
        ripgrep,
        mcpCommand,
        ...(mcpEntrypoint ? { mcpEntrypoint } : {}),
        ...(lsp ?? {}),
    };
}

async function fingerprintLanguageServerRuntime(
    mcp: McpServerConfig,
): Promise<
    Pick<
        RunRuntimeFingerprint,
        | "pythonLsp"
        | "pythonLspInterpreter"
        | "pythonLspLock"
        | "typescriptLspCommand"
        | "typescriptLspEntrypoint"
    >
> {
    const pythonLspCommand = mcp.pythonLspCommand!;
    const typescriptLspCommand = mcp.typescriptLspCommand;
    const typescriptLspEntrypoint = mcp.typescriptLspArgs?.[0];
    if (!typescriptLspCommand || !typescriptLspEntrypoint) {
        throw new Error(
            "LSP benchmark runtime requires a pinned TypeScript language-server command and entrypoint",
        );
    }
    const launcher = await readFile(pythonLspCommand, "utf8");
    const firstLine = launcher.split(/\r?\n/u, 1)[0];
    const pythonInterpreterPath =
        process.platform === "win32"
            ? path.join(path.dirname(pythonLspCommand), "python.exe")
            : firstLine?.startsWith("#!")
              ? firstLine.slice(2).trim()
              : "";
    if (!path.isAbsolute(pythonInterpreterPath)) {
        throw new Error(
            "Pinned Python language-server launcher must name an absolute shebang interpreter",
        );
    }
    const pythonLockPath = path.resolve(
        path.dirname(pythonLspCommand),
        "../..",
        "uv.lock",
    );
    const [
        pythonLsp,
        pythonLspInterpreter,
        pythonLspLock,
        typescriptCommand,
        typescriptEntrypoint,
    ] = await Promise.all([
        fingerprintFile(pythonLspCommand, true),
        fingerprintFile(pythonInterpreterPath, true),
        fingerprintFile(pythonLockPath),
        fingerprintFile(typescriptLspCommand, true),
        fingerprintFile(typescriptLspEntrypoint),
    ]);
    return {
        pythonLsp,
        pythonLspInterpreter,
        pythonLspLock,
        typescriptLspCommand: typescriptCommand,
        typescriptLspEntrypoint: typescriptEntrypoint,
    };
}

async function fingerprintFile(
    file: string,
    executable = false,
): Promise<RuntimeFileFingerprint> {
    const resolvedPath = await realpath(file);
    if (!(await stat(resolvedPath)).isFile()) {
        throw new Error(
            `Benchmark runtime target is not a file: ${resolvedPath}`,
        );
    }
    if (executable) {
        try {
            await access(resolvedPath, constants.X_OK);
        } catch {
            throw new Error(
                `Benchmark runtime target is not executable: ${resolvedPath}`,
            );
        }
    }
    return {
        path: resolvedPath,
        sha256: createHash("sha256")
            .update(await readFile(resolvedPath))
            .digest("hex"),
    };
}

async function fingerprintNodeEntrypoint(
    mcp: McpServerConfig,
): Promise<RuntimeFileFingerprint> {
    const entrypoint = mcp.args[0];
    if (!entrypoint || entrypoint.startsWith("-")) {
        throw new Error(
            "Node-based TypeAgent MCP configuration requires a file entrypoint as its first argument",
        );
    }
    return fingerprintFile(path.resolve(mcp.cwd ?? process.cwd(), entrypoint));
}

function isNodeCommand(command: string): boolean {
    const executable = path.basename(command).toLowerCase();
    return executable === "node" || executable === "node.exe";
}
