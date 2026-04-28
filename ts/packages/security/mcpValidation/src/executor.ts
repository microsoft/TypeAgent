// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// ═══════════════════════════════════════════════════════════════════════════
// executor.ts - Actual file/shell operations for validated proxy tools
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { execSync, spawnSync } from "node:child_process";
import { dirname } from "node:path";
import type { ContainerPolicy, NetworkPolicy, PathPolicy } from "validation";
import { buildDockerArgs } from "validation";
import fg from "fast-glob";

// ─── Read ────────────────────────────────────────────────────────────────

export function executeRead(
    filePath: string,
    offset?: number,
    limit?: number,
): string {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");

    const start = offset ?? 0;
    const end = limit ? start + limit : lines.length;

    return lines
        .slice(start, end)
        .map((line, i) => `${start + i + 1}\t${line}`)
        .join("\n");
}

// ─── Write ───────────────────────────────────────────────────────────────

export function executeWrite(filePath: string, content: string): string {
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
    writeFileSync(filePath, content, "utf-8");
    return `Wrote ${content.length} bytes to ${filePath}`;
}

// ─── Edit ────────────────────────────────────────────────────────────────

export function executeEdit(
    filePath: string,
    oldString: string,
    newString: string,
): string {
    const content = readFileSync(filePath, "utf-8");
    if (!content.includes(oldString)) {
        throw new Error(`old_string not found in ${filePath}`);
    }
    const occurrences = content.split(oldString).length - 1;
    if (occurrences > 1) {
        throw new Error(
            `old_string is not unique in ${filePath} (found ${occurrences} occurrences). Provide more surrounding context.`,
        );
    }
    const updated = content.replace(oldString, newString);
    writeFileSync(filePath, updated, "utf-8");
    return `Edited ${filePath}`;
}

// ─── Glob ────────────────────────────────────────────────────────────────

export async function executeGlob(
    pattern: string,
    path?: string,
): Promise<string> {
    const files = await fg(pattern, {
        cwd: path ?? process.cwd(),
        dot: false,
        absolute: true,
    });
    return files.join("\n") || "(no matches)";
}

// ─── Grep ────────────────────────────────────────────────────────────────

export async function executeGrep(
    pattern: string,
    path?: string,
    include?: string,
): Promise<string> {
    const searchPath = path ?? process.cwd();
    const files = await fg(include ?? "**/*", {
        cwd: searchPath,
        dot: false,
        absolute: true,
        onlyFiles: true,
        ignore: ["**/node_modules/**", "**/dist/**", "**/.git/**"],
    });

    const regex = new RegExp(pattern);
    const results: string[] = [];

    for (const file of files) {
        try {
            const content = readFileSync(file, "utf-8");
            const lines = content.split("\n");
            for (let i = 0; i < lines.length; i++) {
                if (regex.test(lines[i])) {
                    results.push(`${file}:${i + 1}: ${lines[i]}`);
                }
            }
        } catch {
            // Skip binary/unreadable files
        }
    }

    return results.join("\n") || "(no matches)";
}

// ─── Bash ────────────────────────────────────────────────────────────────

export function executeBash(
    command: string,
    cwd?: string,
    timeoutMs: number = 30000,
): string {
    try {
        return execSync(command, {
            cwd: cwd ?? process.cwd(),
            timeout: timeoutMs,
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
        });
    } catch (err: any) {
        const output = [
            err.stdout ? `stdout: ${err.stdout}` : "",
            err.stderr ? `stderr: ${err.stderr}` : `error: ${err.message}`,
            `exit code: ${err.status ?? 1}`,
        ]
            .filter(Boolean)
            .join("\n");
        throw new Error(output);
    }
}

// ─── Capability executor (spawnSync, no shell) ──────────────────────────

/**
 * Runs a command with array arguments via spawnSync.
 * No shell interpretation — arguments are passed directly to the process.
 * This eliminates shell injection entirely.
 */
function executeCapability(
    command: string,
    args: string[],
    cwd?: string,
    timeoutMs: number = 30000,
): string {
    const result = spawnSync(command, args, {
        cwd: cwd ?? process.cwd(),
        timeout: timeoutMs,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
    });

    if (result.error) {
        throw new Error(`Failed to run ${command}: ${result.error.message}`);
    }
    if (result.status !== 0) {
        const output = [
            result.stdout ? `stdout: ${result.stdout}` : "",
            result.stderr ? `stderr: ${result.stderr}` : "",
            `exit code: ${result.status}`,
        ]
            .filter(Boolean)
            .join("\n");
        throw new Error(output);
    }

    return result.stdout + (result.stderr ? `\nstderr: ${result.stderr}` : "");
}

/**
 * Splits an optional args string into an array for spawnSync.
 * Respects quoted strings.
 */
function splitArgs(args?: string): string[] {
    if (!args || !args.trim()) return [];
    const result: string[] = [];
    let current = "";
    let inQuote: string | null = null;

    for (const ch of args) {
        if (inQuote) {
            if (ch === inQuote) {
                inQuote = null;
            } else {
                current += ch;
            }
        } else if (ch === '"' || ch === "'") {
            inQuote = ch;
        } else if (ch === " " || ch === "\t") {
            if (current) {
                result.push(current);
                current = "";
            }
        } else {
            current += ch;
        }
    }
    if (current) result.push(current);
    return result;
}

// ─── Npm ────────────────────────────────────────────────────────────────

export function executeNpm(
    subcommand: string,
    args?: string,
    cwd?: string,
    timeoutMs?: number,
): string {
    return executeCapability(
        "npm",
        [subcommand, ...splitArgs(args)],
        cwd,
        timeoutMs,
    );
}

// ─── Git ────────────────────────────────────────────────────────────────

export function executeGit(
    subcommand: string,
    args?: string,
    cwd?: string,
    timeoutMs?: number,
): string {
    return executeCapability(
        "git",
        [subcommand, ...splitArgs(args)],
        cwd,
        timeoutMs,
    );
}

// ─── Node ───────────────────────────────────────────────────────────────

export function executeNode(
    scriptPath: string,
    args?: string,
    cwd?: string,
    timeoutMs?: number,
): string {
    return executeCapability(
        "node",
        [scriptPath, ...splitArgs(args)],
        cwd,
        timeoutMs,
    );
}

// ─── Tsc ────────────────────────────────────────────────────────────────

export function executeTsc(
    args?: string,
    cwd?: string,
    timeoutMs?: number,
): string {
    return executeCapability("tsc", splitArgs(args), cwd, timeoutMs);
}

// ─── Container sandbox ─────────────────────────────────────────────────

/**
 * Runs a bash command inside a Docker container with restricted
 * networking, filesystem, and resource limits.
 * The kernel enforces what string parsing cannot.
 *
 * Volume mounts are either derived from the org policy's path restrictions
 * (when deriveVolumesFromPolicy is true) or limited to the working directory.
 */
export function executeBashInContainer(
    command: string,
    cwd: string,
    policy: ContainerPolicy,
    pathPolicy?: PathPolicy,
    networkPolicy?: NetworkPolicy,
): string {
    const dockerArgs = buildDockerArgs(
        command,
        cwd,
        policy,
        pathPolicy,
        networkPolicy,
    );

    const result = spawnSync("docker", dockerArgs, {
        timeout: policy.timeoutMs ?? 60000,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
    });

    if (result.error) {
        if (result.error.message.includes("ENOENT")) {
            throw new Error(
                "Docker is not installed or not in PATH. " +
                    "Container sandbox requires Docker. " +
                    "Install Docker or set container.enabled to false in the org policy.",
            );
        }
        throw new Error(`Docker execution failed: ${result.error.message}`);
    }
    if (result.status !== 0) {
        const output = [
            result.stdout ? `stdout: ${result.stdout}` : "",
            result.stderr ? `stderr: ${result.stderr}` : "",
            `exit code: ${result.status}`,
        ]
            .filter(Boolean)
            .join("\n");
        throw new Error(output);
    }

    return result.stdout;
}
