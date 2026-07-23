// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { defineTool, type Tool } from "@github/copilot-sdk";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, readFile, realpath, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import type { CopilotToolCallTrace } from "./types.js";

interface ReadArgs {
    path: string;
    offset?: number;
    limit?: number;
}

interface GrepArgs {
    pattern: string;
    path?: string;
    glob?: string;
    literal?: boolean;
    maxMatches?: number;
}

interface GlobArgs {
    pattern: string;
    maxMatches?: number;
}

interface BashArgs {
    command: string;
    cwd?: string;
    timeoutMs?: number;
}

interface ToolBudget {
    executed: number;
    limit: number;
    exhaustedRecorded: boolean;
}

type ReadOnlyExecutable = "pwd" | "ls" | "find" | "git";
type ReadOnlyExecutables = Record<ReadOnlyExecutable, string>;

const DEFAULT_MAX_TOOL_CALLS = 8;
const MAX_TOOL_CALLS = 100;
const MAX_READ_FILE_BYTES = 1024 * 1024;
const MAX_TRACE_STRING = 2_000;
const MAX_TRACE_OUTPUT = 12_000;
const SEARCH_EXCLUDE_GLOBS = [
    "!node_modules/**",
    "!**/node_modules/**",
    "!.git/**",
    "!**/.git/**",
    "!dist/**",
    "!runs/**",
    "!.data/**",
    "!.env",
    "!.env.*",
    "!**/.env",
    "!**/.env.*",
    "!**/.npmrc",
    "!**/.npmrc.*",
    "!**/.pypirc",
    "!**/.netrc",
    "!**/_netrc",
    "!**/.git-credentials",
    "!**/.ssh/**",
    "!**/.aws/**",
    "!**/.azure/**",
    "!**/.gnupg/**",
    "!**/credentials.json",
    "!**/secrets.json",
    "!**/id_rsa",
    "!**/id_dsa",
    "!**/id_ecdsa",
    "!**/id_ed25519",
    "!**/*.pem",
    "!**/*.key",
    "!**/*.p12",
    "!**/*.pfx",
] as const;
const TRUSTED_SYSTEM_PATH = ["/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(
    path.delimiter,
);
const TRUSTED_EXECUTABLE_CANDIDATES: Record<
    ReadOnlyExecutable,
    readonly string[]
> = {
    pwd: ["/usr/bin/pwd", "/bin/pwd"],
    ls: ["/usr/bin/ls", "/bin/ls"],
    find: ["/usr/bin/find", "/bin/find"],
    git: ["/usr/bin/git", "/bin/git"],
};

export async function createCopilotExplorationTools(
    repoPath: string,
    trace: CopilotToolCallTrace[],
    maxToolCalls = DEFAULT_MAX_TOOL_CALLS,
): Promise<Tool<any>[]> {
    const root = await realpath(repoPath);
    const ripgrepPath = await resolvePackagedRipgrepPath();
    const executables = await resolveReadOnlyExecutables();
    const limit = Number.isFinite(maxToolCalls)
        ? Math.min(MAX_TOOL_CALLS, Math.max(0, Math.floor(maxToolCalls)))
        : DEFAULT_MAX_TOOL_CALLS;
    const budget = {
        executed: Math.min(trace.length, limit),
        limit,
        exhaustedRecorded: trace.length > limit,
    };

    return [
        defineTool<ReadArgs>("read", {
            description:
                "Read a UTF-8 text file inside the benchmark repository with line numbers.",
            parameters: {
                type: "object",
                properties: {
                    path: {
                        type: "string",
                        description: "Repository-relative file path",
                    },
                    offset: {
                        type: "number",
                        description: "1-based first line to return",
                        default: 1,
                    },
                    limit: {
                        type: "number",
                        description: "Maximum lines to return",
                        default: 200,
                    },
                },
                required: ["path"],
            },
            overridesBuiltInTool: true,
            skipPermission: true,
            handler: (args) =>
                traced(trace, "read", args, budget, () => readTool(root, args)),
        }),
        defineTool<GrepArgs>("grep", {
            description:
                "Search files inside the benchmark repository using ripgrep and return path:line matches.",
            parameters: {
                type: "object",
                properties: {
                    pattern: { type: "string", description: "Search pattern" },
                    path: {
                        type: "string",
                        description:
                            "Optional repository-relative file or directory",
                    },
                    glob: {
                        type: "string",
                        description: "Optional ripgrep glob, e.g. *.ts",
                    },
                    literal: {
                        type: "boolean",
                        description: "Treat pattern as a fixed string",
                        default: false,
                    },
                    maxMatches: {
                        type: "number",
                        description: "Maximum matching lines",
                        default: 50,
                    },
                },
                required: ["pattern"],
            },
            overridesBuiltInTool: true,
            skipPermission: true,
            handler: (args) =>
                traced(trace, "grep", args, budget, () =>
                    grepTool(root, ripgrepPath, args),
                ),
        }),
        defineTool<GlobArgs>("glob", {
            description:
                "Find repository-relative file paths matching a glob pattern.",
            parameters: {
                type: "object",
                properties: {
                    pattern: {
                        type: "string",
                        description:
                            "Repository-relative POSIX glob, e.g. *.ts or **/test_*.py",
                    },
                    maxMatches: {
                        type: "number",
                        description: "Maximum matching paths",
                        default: 200,
                    },
                },
                required: ["pattern"],
            },
            overridesBuiltInTool: true,
            skipPermission: true,
            handler: (args) =>
                traced(trace, "glob", args, budget, () =>
                    globTool(root, ripgrepPath, args),
                ),
        }),
        defineTool<BashArgs>("bash", {
            description:
                "Run one allowlisted read-only repository command: pwd, ls, find, or a non-mutating git inspection command. Shell syntax is rejected.",
            parameters: {
                type: "object",
                properties: {
                    command: {
                        type: "string",
                        description: "Read-only shell command",
                    },
                    cwd: {
                        type: "string",
                        description:
                            "Optional repository-relative working directory",
                        default: ".",
                    },
                    timeoutMs: {
                        type: "number",
                        description: "Timeout in milliseconds",
                        default: 30000,
                    },
                },
                required: ["command"],
            },
            overridesBuiltInTool: true,
            skipPermission: true,
            handler: (args) =>
                traced(trace, "bash", args, budget, () =>
                    bashTool(root, executables, args),
                ),
        }),
    ];
}

async function readTool(root: string, args: ReadArgs): Promise<string> {
    const file = await resolveInside(root, args.path);
    rejectSensitivePath(root, file);
    const info = await stat(file);
    if (!info.isFile()) throw new Error(`${args.path} is not a file`);
    if (info.size > MAX_READ_FILE_BYTES) {
        throw new Error(`${args.path} exceeds the 1 MiB read limit`);
    }

    const offset = Math.max(1, Math.floor(args.offset ?? 1));
    const limit = Math.min(1000, Math.max(1, Math.floor(args.limit ?? 200)));
    const lines = (await readFile(file, "utf8")).split(/\r?\n/);
    return lines
        .slice(offset - 1, offset - 1 + limit)
        .map(
            (line, index) =>
                `${args.path}:${offset + index}: ${line.slice(0, 500)}`,
        )
        .join("\n");
}

async function grepTool(
    root: string,
    ripgrepPath: string,
    args: GrepArgs,
): Promise<string> {
    const target = await resolveInside(root, args.path ?? ".");
    if ((await stat(target)).isFile()) rejectSensitivePath(root, target);
    const maxMatches = Math.min(
        200,
        Math.max(1, Math.floor(args.maxMatches ?? 50)),
    );
    const ripgrepArgs = [
        "--line-number",
        "--no-heading",
        "--color",
        "never",
        "--max-columns",
        "500",
    ];
    if (args.literal) ripgrepArgs.push("--fixed-strings");
    if (args.glob) ripgrepArgs.push("--glob", args.glob);
    for (const excluded of SEARCH_EXCLUDE_GLOBS) {
        ripgrepArgs.push("--iglob", excluded);
    }
    ripgrepArgs.push("--", args.pattern, target);

    const result = await runProcess(
        ripgrepPath,
        ripgrepArgs,
        root,
        30_000,
        120_000,
        root,
    );
    if (result.code === 1 && !result.output.trim()) return "No matches";
    if (result.code !== 0 && result.code !== 1) {
        throw new Error(result.output || `rg exited ${result.code}`);
    }
    return (
        result.output
            .split(/\r?\n/)
            .filter(Boolean)
            .slice(0, maxMatches)
            .join("\n") || "No matches"
    );
}

async function globTool(
    root: string,
    ripgrepPath: string,
    args: GlobArgs,
): Promise<string> {
    const pattern = validateRepositoryGlob(args.pattern);
    const maxMatches = Math.min(
        1_000,
        Math.max(1, Math.floor(args.maxMatches ?? 200)),
    );
    const ripgrepArgs = ["--files", "--color", "never", "--glob", pattern];
    for (const excluded of SEARCH_EXCLUDE_GLOBS) {
        ripgrepArgs.push("--iglob", excluded);
    }
    ripgrepArgs.push("--", ".");

    const result = await runProcess(
        ripgrepPath,
        ripgrepArgs,
        root,
        30_000,
        120_000,
        root,
    );
    if (result.code !== 0 && result.code !== 1) {
        throw new Error(result.output || `rg exited ${result.code}`);
    }
    const matches = result.output
        .split(/\r?\n/)
        .filter(Boolean)
        .map((file) => file.replace(/^\.\//, ""))
        .filter((file) => !isSensitiveRelativePath(file))
        .sort()
        .slice(0, maxMatches);
    return matches.join("\n") || "No matches";
}

async function bashTool(
    root: string,
    executables: ReadOnlyExecutables,
    args: BashArgs,
): Promise<string> {
    const cwd = await resolveInside(root, args.cwd ?? ".");
    if (cwd !== root) rejectSensitivePath(root, cwd);
    const command = parseReadOnlyCommand(args.command);
    const commandName = command[0] as ReadOnlyExecutable;
    const commandArgs = command.slice(1);
    await validateReadOnlyCommand(root, cwd, commandName, commandArgs);
    const executable = executables[commandName];
    const timeoutMs = Math.min(
        120_000,
        Math.max(1_000, Math.floor(args.timeoutMs ?? 30_000)),
    );
    const result = await runProcess(
        executable,
        commandArgs,
        cwd,
        timeoutMs,
        12_000,
        root,
    );
    return [`exit=${result.code}`, result.output.slice(0, 12_000)].join("\n");
}

async function traced<T>(
    trace: CopilotToolCallTrace[],
    tool: string,
    args: unknown,
    budget: ToolBudget,
    run: () => Promise<T>,
): Promise<T | string> {
    const start = Date.now();
    if (budget.executed >= budget.limit) {
        const output =
            "TOOL_BUDGET_EXHAUSTED: answer now using the evidence already gathered.";
        if (!budget.exhaustedRecorded) {
            trace.push({
                tool,
                args: boundTraceValue(args),
                ok: true,
                durationMs: Date.now() - start,
                output,
            });
            budget.exhaustedRecorded = true;
        }
        return output;
    }
    budget.executed += 1;
    try {
        const value = await run();
        trace.push({
            tool,
            args: boundTraceValue(args),
            ok: true,
            durationMs: Date.now() - start,
            output: String(value).slice(0, MAX_TRACE_OUTPUT),
        });
        return value;
    } catch (error) {
        const message = (error as Error).message;
        trace.push({
            tool,
            args: boundTraceValue(args),
            ok: false,
            durationMs: Date.now() - start,
            output: message.slice(0, MAX_TRACE_OUTPUT),
        });
        throw error;
    }
}

async function resolveInside(
    root: string,
    input: string,
    base = root,
): Promise<string> {
    const absolute = path.resolve(base, input);
    const resolved = await realpath(absolute);
    const relative = path.relative(root, resolved);
    if (
        relative === ".." ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative)
    ) {
        throw new Error(`Path escapes repo root: ${input}`);
    }
    return resolved;
}

function rejectSensitivePath(root: string, file: string): void {
    const relative = path.relative(root, file).split(path.sep).join("/");
    if (isSensitiveRelativePath(relative)) {
        throw new Error(`Refusing to read likely secret file: ${relative}`);
    }
}

function validateRepositoryGlob(input: string): string {
    const pattern = input.trim();
    if (!pattern || pattern.length > 512 || pattern.includes("\\")) {
        throw new Error(
            "glob must be a non-empty POSIX pattern of at most 512 characters",
        );
    }
    if (
        path.posix.isAbsolute(pattern) ||
        pattern.split("/").some((part) => part === "..")
    ) {
        throw new Error("glob must be repository-relative");
    }
    return pattern;
}

function isSensitiveRelativePath(input: string): boolean {
    const normalized = input.replaceAll("\\", "/").toLowerCase();
    const parts = normalized.split("/").filter(Boolean);
    const name = parts.at(-1) ?? "";
    return (
        parts.some((part) =>
            new Set([".git", ".ssh", ".aws", ".azure", ".gnupg"]).has(part),
        ) ||
        /^\.env(?:\..*)?$/.test(name) ||
        /^\.(?:npmrc|pypirc|netrc)(?:\..*)?$/.test(name) ||
        name === "_netrc" ||
        name === ".git-credentials" ||
        /^(?:credentials|secrets)(?:\.json)?$/.test(name) ||
        /^id_(?:rsa|dsa|ecdsa|ed25519)$/.test(name) ||
        /\.(?:pem|key|p12|pfx)$/.test(name)
    );
}

function parseReadOnlyCommand(input: string): string[] {
    if (!input.trim() || /[\0\r\n;&|`$()<>{}]/.test(input)) {
        throw rejectedCommand(
            "shell operators, substitutions, redirects, and empty commands are not allowed",
        );
    }

    const words: string[] = [];
    let word = "";
    let quote: "'" | '"' | undefined;
    let escaped = false;
    let active = false;
    for (const character of input) {
        if (escaped) {
            word += character;
            escaped = false;
            active = true;
        } else if (character === "\\" && quote !== "'") {
            escaped = true;
            active = true;
        } else if (quote) {
            if (character === quote) quote = undefined;
            else word += character;
        } else if (character === "'" || character === '"') {
            quote = character;
            active = true;
        } else if (/\s/.test(character)) {
            if (active) {
                words.push(word);
                word = "";
                active = false;
            }
        } else {
            word += character;
            active = true;
        }
    }
    if (escaped || quote) {
        throw rejectedCommand("unterminated quoting or escaping");
    }
    if (active) words.push(word);
    if (words.length === 0) throw rejectedCommand("empty command");
    return words;
}

async function validateReadOnlyCommand(
    root: string,
    cwd: string,
    executable: string,
    args: string[],
): Promise<void> {
    switch (executable) {
        case "pwd":
            if (args.some((arg) => arg !== "-L" && arg !== "-P")) {
                throw rejectedCommand("pwd accepts only -L or -P");
            }
            return;
        case "ls":
            await validateLsArgs(root, cwd, args);
            return;
        case "find":
            await validateFindArgs(root, cwd, args);
            return;
        case "git":
            validateGitArgs(args);
            return;
        default:
            throw rejectedCommand(
                `${JSON.stringify(executable)} is not an allowlisted command`,
            );
    }
}

async function validateLsArgs(
    root: string,
    cwd: string,
    args: string[],
): Promise<void> {
    let optionsEnded = false;
    for (const arg of args) {
        if (!optionsEnded && arg === "--") {
            optionsEnded = true;
        } else if (!optionsEnded && arg.startsWith("-")) {
            if (
                arg.startsWith("--dereference") ||
                (!arg.startsWith("--") && arg.slice(1).includes("L"))
            ) {
                throw rejectedCommand("ls may not follow symbolic links");
            }
            continue;
        } else {
            await validateCommandPath(root, cwd, arg);
        }
    }
}

async function validateFindArgs(
    root: string,
    cwd: string,
    args: string[],
): Promise<void> {
    const forbidden =
        /^(?:-delete|-exec|-execdir|-ok|-okdir|-fls|-fprint|-fprint0|-fprintf|-files0-from)$/;
    const pathPredicates = new Set([
        "-anewer",
        "-cnewer",
        "-newer",
        "-samefile",
    ]);
    let index = 0;
    while (
        index < args.length &&
        !args[index].startsWith("-") &&
        args[index] !== "!"
    ) {
        await validateCommandPath(root, cwd, args[index]);
        index += 1;
    }
    for (; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === "-H" || arg === "-L" || arg === "-follow") {
            throw rejectedCommand("find may not follow symbolic links");
        }
        if (forbidden.test(arg)) {
            throw rejectedCommand(
                `find predicate ${JSON.stringify(arg)} is not read-only`,
            );
        }
        rejectOutsidePathSyntax(arg);
        if (isSensitiveRelativePath(arg)) {
            throw rejectedCommand("find may not inspect a likely secret path");
        }
        if (pathPredicates.has(arg)) {
            const operand = args[index + 1];
            if (!operand)
                throw rejectedCommand(`${arg} requires a repository path`);
            await validateCommandPath(root, cwd, operand);
            index += 1;
        }
    }
}

function validateGitArgs(args: string[]): void {
    const commandArgs = [...args];
    const subcommandIndex = commandArgs[0] === "--no-pager" ? 1 : 0;
    if (subcommandIndex === 1) commandArgs.shift();
    const subcommand = commandArgs.shift();
    const allowed = new Set([
        "status",
        "diff",
        "log",
        "show",
        "ls-files",
        "rev-parse",
        "blame",
        "branch",
    ]);
    if (!subcommand || !allowed.has(subcommand)) {
        throw rejectedCommand(
            `git subcommand ${JSON.stringify(subcommand)} is not read-only`,
        );
    }
    if (
        subcommand === "branch" &&
        commandArgs.some(
            (arg) =>
                !new Set([
                    "--show-current",
                    "--list",
                    "-a",
                    "-r",
                    "-v",
                    "-vv",
                ]).has(arg),
        )
    ) {
        throw rejectedCommand("git branch may only list branches");
    }
    const forbiddenOption =
        /^(?:-C|-c|--git-dir|--work-tree|--config-env|--no-index|--output|--ext-diff|--textconv|--contents|--open-files-in-pager)(?:=|$)/;
    for (const arg of commandArgs) {
        if (forbiddenOption.test(arg) || /pager/i.test(arg)) {
            throw rejectedCommand(
                `git option ${JSON.stringify(arg)} is not allowed`,
            );
        }
        rejectOutsidePathSyntax(arg);
        const treePath = arg.includes(":")
            ? arg.slice(arg.indexOf(":") + 1)
            : arg;
        if (isSensitiveRelativePath(treePath)) {
            throw rejectedCommand("git may not inspect a likely secret path");
        }
    }
    if (new Set(["diff", "log", "show"]).has(subcommand)) {
        args.splice(subcommandIndex + 1, 0, "--no-ext-diff", "--no-textconv");
    }
}

async function validateCommandPath(
    root: string,
    cwd: string,
    input: string,
): Promise<void> {
    rejectOutsidePathSyntax(input);
    const resolved = await resolveInside(root, input, cwd);
    rejectSensitivePath(root, resolved);
}

function rejectOutsidePathSyntax(input: string): void {
    const normalized = input.replaceAll("\\", "/");
    if (
        path.isAbsolute(input) ||
        path.win32.isAbsolute(input) ||
        normalized === ".." ||
        normalized.startsWith("../") ||
        normalized.includes("/../") ||
        normalized.startsWith("~")
    ) {
        throw rejectedCommand(
            `outside path ${JSON.stringify(input)} is not allowed`,
        );
    }
}

function rejectedCommand(reason: string): Error {
    return new Error(
        `Rejected unsafe command: ${reason}. Use read/grep or one allowlisted read-only repository command.`,
    );
}

function boundTraceValue(value: unknown, depth = 0): unknown {
    if (typeof value === "string") return value.slice(0, MAX_TRACE_STRING);
    if (
        value === null ||
        typeof value === "number" ||
        typeof value === "boolean"
    ) {
        return value;
    }
    if (depth >= 3) return "[truncated]";
    if (Array.isArray(value)) {
        return value
            .slice(0, 20)
            .map((item) => boundTraceValue(item, depth + 1));
    }
    if (typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value)
                .slice(0, 20)
                .map(([key, item]) => [
                    key.slice(0, 100),
                    boundTraceValue(item, depth + 1),
                ]),
        );
    }
    return String(value).slice(0, MAX_TRACE_STRING);
}

function safeChildEnv(root: string): NodeJS.ProcessEnv {
    return {
        PATH: TRUSTED_SYSTEM_PATH,
        HOME: path.join(path.parse(root).root, "__typeagent_no_home__"),
        LANG: process.env.LANG,
        LC_ALL: process.env.LC_ALL,
        TERM: process.env.TERM,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "core.fsmonitor",
        GIT_CONFIG_VALUE_0: "false",
        GIT_OPTIONAL_LOCKS: "0",
        GIT_TERMINAL_PROMPT: "0",
        GIT_PAGER: "/bin/cat",
        PAGER: "/bin/cat",
    };
}

async function resolveReadOnlyExecutables(): Promise<ReadOnlyExecutables> {
    if (process.platform !== "darwin" && process.platform !== "linux") {
        throw new Error(
            `Read-only baseline commands are unsupported on ${process.platform}`,
        );
    }
    return Object.fromEntries(
        await Promise.all(
            (
                Object.entries(TRUSTED_EXECUTABLE_CANDIDATES) as Array<
                    [ReadOnlyExecutable, readonly string[]]
                >
            ).map(async ([name, candidates]) => [
                name,
                await resolveTrustedExecutable(name, candidates),
            ]),
        ),
    ) as ReadOnlyExecutables;
}

async function resolveTrustedExecutable(
    name: ReadOnlyExecutable,
    candidates: readonly string[],
): Promise<string> {
    for (const candidate of candidates) {
        try {
            await access(candidate, constants.X_OK);
            const resolved = await realpath(candidate);
            if ((await stat(resolved)).isFile()) {
                return resolved;
            }
        } catch {
            // Try the other fixed system location.
        }
    }
    throw new Error(
        `Trusted system executable ${name} not found at ${candidates.join(" or ")}`,
    );
}

async function resolvePackagedRipgrepPath(): Promise<string> {
    const localRequire = createRequire(import.meta.url);
    const copilotManifest = localRequire.resolve(
        "@github/copilot/package.json",
    );
    const copilotRequire = createRequire(copilotManifest);
    const platformTags = resolvePlatformTags(copilotRequire);

    for (const platformTag of platformTags) {
        const packageName = `@github/copilot-${platformTag}-${process.arch}`;
        let packageBinary: string;
        try {
            packageBinary = copilotRequire.resolve(packageName);
        } catch {
            continue;
        }

        const packageRoot = path.dirname(packageBinary);
        const binaryName = process.platform === "win32" ? "rg.exe" : "rg";
        const binaryPlatforms = new Set([platformTag, process.platform]);
        for (const binaryPlatform of binaryPlatforms) {
            const candidate = path.join(
                packageRoot,
                "ripgrep",
                "bin",
                `${binaryPlatform}-${process.arch}`,
                binaryName,
            );
            try {
                if ((await stat(candidate)).isFile()) return candidate;
            } catch {
                // Try the other packaged platform layout.
            }
        }
    }

    throw new Error(
        `Bundled ripgrep not found in @github/copilot-${process.platform}-${process.arch}`,
    );
}

function resolvePlatformTags(copilotRequire: NodeRequire): string[] {
    if (process.platform !== "linux") return [process.platform];
    try {
        const detectLibc = copilotRequire("detect-libc") as {
            isNonGlibcLinuxSync(): boolean;
        };
        return detectLibc.isNonGlibcLinuxSync()
            ? ["linuxmusl", "linux"]
            : ["linux", "linuxmusl"];
    } catch {
        return ["linux", "linuxmusl"];
    }
}

function runProcess(
    command: string,
    args: string[],
    cwd: string,
    timeoutMs: number,
    maxOutputChars: number,
    root: string,
): Promise<{ code: number | null; output: string }> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd,
            stdio: ["ignore", "pipe", "pipe"],
            env: safeChildEnv(root),
        });
        let output = "";
        const timer = setTimeout(() => {
            child.kill("SIGKILL");
            reject(new Error(`${command} timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        const append = (chunk: unknown) => {
            const remaining = maxOutputChars - output.length;
            if (remaining > 0) output += String(chunk).slice(0, remaining);
        };
        child.stdout.on("data", append);
        child.stderr.on("data", append);
        child.on("error", (error) => {
            clearTimeout(timer);
            reject(error);
        });
        child.on("close", (code) => {
            clearTimeout(timer);
            resolve({ code, output });
        });
    });
}
