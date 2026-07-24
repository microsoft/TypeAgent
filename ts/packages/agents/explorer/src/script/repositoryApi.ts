// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { glob } from "glob";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, lstat, open, realpath, stat } from "node:fs/promises";
import path from "node:path";
import {
    createLanguageServerManager,
    type LanguageServerOptions,
    type LspLocation,
    type LspRequest,
} from "./languageServer.js";

// The only repository capabilities exposed to generated Code Mode scripts.

const DEFAULT_MAX_CALLS = 64;
const DEFAULT_LS_DEPTH = 2;
const DEFAULT_LS_ENTRIES = 200;
const DEFAULT_GLOB_MATCHES = 200;
const DEFAULT_GREP_MATCHES = 100;
const DEFAULT_READ_LINES = 200;
const MAX_LS_DEPTH = 20;
const MAX_LS_ENTRIES = 1000;
const MAX_GLOB_MATCHES = 1000;
const MAX_GREP_MATCHES = 500;
const MAX_GREP_CONTEXT_LINES = 20;
const MAX_LSP_CALLS = 2;
const MAX_READ_LINES = 1000;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_OUTPUT_LINE_LENGTH = 500;
const MAX_TOTAL_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_GIT_OUTPUT_BYTES = 64 * 1024 * 1024;
const DEFAULT_RIPGREP_SCAN_MATCHES = 1000;
const MAX_RIPGREP_SCAN_MATCHES = 10_000;
const MAX_RIPGREP_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_RIPGREP_ARGUMENT_BYTES = ripgrepArgumentBudget(process.platform);
const TOOL_BUDGET_EXHAUSTED =
    "TOOL_BUDGET_EXHAUSTED: finish using evidence already gathered.";

const IGNORE_GLOBS = [
    "**/.git/**",
    "**/.hg/**",
    "**/.svn/**",
    "**/node_modules/**",
    "**/.venv/**",
    "**/venv/**",
    "**/__pycache__/**",
    "**/.tox/**",
    "**/dist/**",
    "**/build/**",
    "**/coverage/**",
    "**/.next/**",
    "**/target/**",
];

const IGNORED_DIRECTORY_NAMES = new Set([
    ".git",
    ".hg",
    ".svn",
    ".next",
    ".tox",
    ".venv",
    "__pycache__",
    "build",
    "coverage",
    "dist",
    "node_modules",
    "target",
    "venv",
]);

const SENSITIVE_FILE_NAMES = new Set([
    ".authinfo",
    ".envrc",
    ".git-credentials",
    ".netrc",
    ".npmrc",
    ".pypirc",
    "application_default_credentials.json",
    "config.local.json",
    "config.local.yaml",
    "config.local.yml",
    "credentials",
    "credentials.json",
    "id_rsa",
    "id_ed25519",
    "secrets.json",
    "secrets.yaml",
    "secrets.yml",
]);

const SENSITIVE_CREDENTIAL_EXTENSIONS = new Set([
    ".der",
    ".ini",
    ".json",
    ".key",
    ".p12",
    ".pem",
    ".pfx",
    ".pk8",
    ".toml",
    ".yaml",
    ".yml",
]);

export interface LsOptions {
    depth?: number | undefined;
    maxEntries?: number | undefined;
}

export interface GrepOptions {
    path?: string | undefined;
    glob?: string | undefined;
    literal?: boolean | undefined;
    maxMatches?: number | undefined;
}

export interface GlobOptions {
    maxMatches?: number | undefined;
}

export interface ReadOptions {
    offset?: number | undefined;
    limit?: number | undefined;
}

export interface GrepMatch {
    path: string;
    line: number;
    text: string;
}

export interface RepositoryApi {
    ls(relativePath?: string, options?: LsOptions): Promise<string[]>;
    glob(pattern: string, options?: GlobOptions): Promise<string[]>;
    grep(pattern: string, options?: GrepOptions): Promise<GrepMatch[]>;
    read(relativePath: string, options?: ReadOptions): Promise<string>;
    lsp?(request: LspRequest): Promise<LspLocation[]>;
}

export interface RepositoryToolCallTrace {
    tool: "ls" | "glob" | "grep" | "read" | "lsp";
    startedAt: string;
    durationMs: number;
    input: Record<string, unknown>;
    resultCount: number;
    outputBytes: number;
    truncated: boolean;
    error?: string | undefined;
}

export interface RepositoryToolTrace {
    calls: RepositoryToolCallTrace[];
    totalCalls: number;
    totalOutputBytes: number;
}

export interface RepositoryObservation {
    source: "grep" | "read";
    callIndex: number;
    path: string;
    startLine: number;
    endLine: number;
    lines: string[];
}

export interface RepositoryToolsOptions {
    repoRoot: string;
    maxCalls?: number | undefined;
    lsp?: LanguageServerOptions | undefined;
}

export interface RepositoryTools {
    api: RepositoryApi;
    trace: RepositoryToolTrace;
    observations: RepositoryObservation[];
    close(): Promise<void>;
    allowCallsThrough(
        limit: number,
        maxReadLines?: number,
        allowedTools?: readonly RepositoryToolCallTrace["tool"][],
        toolCallLimits?: Partial<
            Record<RepositoryToolCallTrace["tool"], number>
        >,
        grepContextLines?: number,
    ): void;
}

interface SnapshotFile {
    relativePath: string;
    lines: string[];
}

interface ToolResult<T> {
    value: T;
    resultCount: number;
    truncated: boolean;
    error?: string;
    traceInput?: Record<string, unknown>;
}

/**
 * Creates the only capabilities available to generated repository-exploration
 * code. Files are read into an immutable, filtered evidence snapshot up front.
 * Ripgrep receives only allowlisted repository-relative paths, and every match
 * is checked against the snapshot before it becomes observable.
 */
export async function createRepositoryTools(
    options: RepositoryToolsOptions,
): Promise<RepositoryTools> {
    const repoRoot = await resolveRepositoryRoot(options.repoRoot);
    const maxCalls = boundedInteger(
        options.maxCalls,
        DEFAULT_MAX_CALLS,
        1,
        1000,
        "maxCalls",
    );
    const files = await createRepositorySnapshot(repoRoot);
    let ripgrepPath: Promise<string> | undefined;
    const filesByPath = new Map(
        files.map((file) => [file.relativePath, file] as const),
    );
    const searchFiles = [...files].sort(compareSearchFiles);
    const ripgrepSnapshot: RipgrepSnapshot = {
        root: repoRoot,
        filesByPath,
    };
    const languageServers = options.lsp
        ? createLanguageServerManager(
              repoRoot,
              {
                  get: (relativePath) =>
                      filesByPath.get(relativePath)?.lines.join("\n"),
                  has: (relativePath) => filesByPath.has(relativePath),
                  paths: () => [...filesByPath.keys()],
              },
              options.lsp,
          )
        : undefined;
    const trace: RepositoryToolTrace = {
        calls: [],
        totalCalls: 0,
        totalOutputBytes: 0,
    };
    let claimedCalls = 0;
    const observations: RepositoryObservation[] = [];
    let allowedReadLines = MAX_READ_LINES;
    const allTools: RepositoryToolCallTrace["tool"][] = [
        "ls",
        "glob",
        "grep",
        "read",
        ...(languageServers ? (["lsp"] as const) : []),
    ];
    let allowedTools = new Set<RepositoryToolCallTrace["tool"]>(allTools);
    let toolCallLimits: Partial<
        Record<RepositoryToolCallTrace["tool"], number>
    > = {};
    let allowedGrepContextLines = 0;
    let phaseToolCalls = new Map<RepositoryToolCallTrace["tool"], number>();

    const api: RepositoryApi = {
        ls,
        glob: globRepositoryFiles,
        grep: grepRepository,
        read: readRepositoryFile,
        ...(languageServers ? { lsp: navigateLanguageServer } : {}),
    };
    let allowedCalls = maxCalls;
    return {
        api,
        trace,
        observations,
        allowCallsThrough,
        close: async () => languageServers?.close(),
    };

    function allowCallsThrough(
        limit: number,
        maxReadLines?: number,
        nextAllowedTools?: readonly RepositoryToolCallTrace["tool"][],
        nextToolCallLimits: Partial<
            Record<RepositoryToolCallTrace["tool"], number>
        > = {},
        grepContextLines = 0,
    ): void {
        allowedCalls = Math.min(maxCalls, Math.max(claimedCalls, limit));
        allowedReadLines = maxReadLines ?? MAX_READ_LINES;
        allowedTools = new Set(nextAllowedTools ?? allTools);
        toolCallLimits = nextToolCallLimits;
        allowedGrepContextLines = Math.min(
            MAX_GREP_CONTEXT_LINES,
            Math.max(0, grepContextLines),
        );
        phaseToolCalls = new Map();
    }

    async function ls(
        relativePath?: string,
        callOptions: LsOptions = {},
    ): Promise<string[]> {
        return runTool(
            "ls",
            { path: relativePath ?? ".", ...callOptions },
            async () => {
                const base = normalizeRelativePath(relativePath ?? ".");
                const depth = boundedInteger(
                    callOptions.depth,
                    DEFAULT_LS_DEPTH,
                    0,
                    MAX_LS_DEPTH,
                    "depth",
                );
                const maxEntries = boundedInteger(
                    callOptions.maxEntries,
                    DEFAULT_LS_ENTRIES,
                    1,
                    MAX_LS_ENTRIES,
                    "maxEntries",
                );
                const matches = files
                    .map((file) => file.relativePath)
                    .filter((fileName) =>
                        isWithinListingDepth(fileName, base, depth),
                    );
                return {
                    value: matches.slice(0, maxEntries),
                    resultCount: Math.min(matches.length, maxEntries),
                    truncated: matches.length > maxEntries,
                };
            },
            [],
        );
    }

    async function globRepositoryFiles(
        pattern: string,
        callOptions: GlobOptions = {},
    ): Promise<string[]> {
        return runTool(
            "glob",
            { pattern, ...callOptions },
            async () => {
                const include = compileGlob(validateGlob(pattern));
                const maxMatches = boundedInteger(
                    callOptions.maxMatches,
                    DEFAULT_GLOB_MATCHES,
                    1,
                    MAX_GLOB_MATCHES,
                    "maxMatches",
                );
                const matches = files
                    .map((file) => file.relativePath)
                    .filter((fileName) => include.test(fileName));
                return {
                    value: matches.slice(0, maxMatches),
                    resultCount: Math.min(matches.length, maxMatches),
                    truncated: matches.length > maxMatches,
                };
            },
            [],
        );
    }

    async function grepRepository(
        pattern: string,
        callOptions: GrepOptions = {},
    ): Promise<GrepMatch[]> {
        const matches = await runTool(
            "grep",
            { pattern, ...callOptions },
            async () => {
                if (pattern.length === 0) {
                    throw new Error("grep pattern must not be empty");
                }
                if (pattern.length > 1000) {
                    throw new Error("grep pattern is too long");
                }
                const base = normalizeRelativePath(callOptions.path ?? ".");
                const includePattern = callOptions.glob;
                const include = includePattern
                    ? compileGlob(validateGlob(includePattern))
                    : undefined;
                const literal = callOptions.literal ?? false;
                const searchSymbol = extractSearchSymbol(pattern);
                const maxMatches = boundedInteger(
                    callOptions.maxMatches,
                    DEFAULT_GREP_MATCHES,
                    1,
                    MAX_GREP_MATCHES,
                    "maxMatches",
                );
                const eligibleFiles = searchFiles.filter(
                    (file) =>
                        isAtOrBelow(file.relativePath, base) &&
                        (!include || include.test(file.relativePath)),
                );
                const resolvedRipgrepPath = await (ripgrepPath ??=
                    resolveRipgrepPath());
                const search = await searchSnapshotWithRipgrep(
                    resolvedRipgrepPath,
                    ripgrepSnapshot,
                    eligibleFiles,
                    pattern,
                    literal,
                    maxMatches,
                );
                const matchesByFile = new Map<string, GrepMatch[]>();
                for (const match of search.matches) {
                    const fileMatches = matchesByFile.get(match.path) ?? [];
                    fileMatches.push(match);
                    matchesByFile.set(match.path, fileMatches);
                }
                const firstMatchByFile: GrepMatch[] = [];
                const repeatedMatches: GrepMatch[] = [];
                let totalMatches = 0;
                let stoppedAtFileLimit = false;

                outer: for (const file of eligibleFiles) {
                    const fileMatches =
                        matchesByFile.get(file.relativePath) ?? [];
                    if (fileMatches.length > 0) {
                        totalMatches += fileMatches.length;
                        const representative = selectRepresentativeMatch(
                            fileMatches,
                            searchSymbol,
                        );
                        firstMatchByFile.push(representative);
                        for (const match of fileMatches) {
                            if (
                                match !== representative &&
                                repeatedMatches.length < maxMatches
                            ) {
                                repeatedMatches.push(match);
                            }
                        }
                        if (firstMatchByFile.length >= maxMatches) {
                            stoppedAtFileLimit = true;
                            break outer;
                        }
                    }
                }
                const matches = firstMatchByFile.slice(0, maxMatches);
                matches.push(
                    ...repeatedMatches.slice(0, maxMatches - matches.length),
                );

                return {
                    value: matches,
                    resultCount: matches.length,
                    truncated:
                        stoppedAtFileLimit ||
                        search.scanTruncated ||
                        totalMatches > matches.length,
                    traceInput: {
                        engine: "ripgrep",
                        ripgrepPath: path.basename(resolvedRipgrepPath),
                        ...(search.literalFallback
                            ? { literalFallback: true }
                            : {}),
                    },
                };
            },
            [],
        );
        const callIndex = trace.calls.length - 1;
        const exactFile = callOptions.path
            ? filesByPath.get(normalizeRelativePath(callOptions.path))
            : undefined;
        observations.push(
            ...matches.map((match) => {
                if (
                    !exactFile ||
                    exactFile.relativePath !== match.path ||
                    allowedGrepContextLines === 0
                ) {
                    return {
                        source: "grep" as const,
                        callIndex,
                        path: match.path,
                        startLine: match.line,
                        endLine: match.line,
                        lines: [match.text],
                    };
                }
                const startIndex = Math.max(
                    0,
                    match.line - 1 - allowedGrepContextLines,
                );
                const endIndex = Math.min(
                    exactFile.lines.length,
                    match.line + allowedGrepContextLines,
                );
                return {
                    source: "grep" as const,
                    callIndex,
                    path: match.path,
                    startLine: startIndex + 1,
                    endLine: endIndex,
                    lines: exactFile.lines
                        .slice(startIndex, endIndex)
                        .map(truncateOutputLine),
                };
            }),
        );
        return matches;
    }

    async function readRepositoryFile(
        relativePath: string,
        callOptions: ReadOptions = {},
    ): Promise<string> {
        const requestedLimit = callOptions.limit ?? DEFAULT_READ_LINES;
        if (
            !Number.isSafeInteger(requestedLimit) ||
            requestedLimit < 1 ||
            requestedLimit > MAX_READ_LINES
        ) {
            throw new Error(
                `read limit must be an integer between 1 and ${MAX_READ_LINES}`,
            );
        }
        const effectiveLimit = Math.min(requestedLimit, allowedReadLines);
        let observation: RepositoryObservation | undefined;
        const result = await runTool(
            "read",
            {
                path: relativePath,
                ...callOptions,
                limit: effectiveLimit,
                ...(effectiveLimit < requestedLimit ? { requestedLimit } : {}),
            },
            async () => {
                const normalizedPath = normalizeRelativePath(relativePath);
                if (normalizedPath.length === 0) {
                    throw new Error("read path must name a repository file");
                }
                const file = filesByPath.get(normalizedPath);
                if (!file) {
                    throw new Error(
                        `File is not available to repository tools: ${normalizedPath}`,
                    );
                }
                const offset = boundedInteger(
                    callOptions.offset,
                    0,
                    0,
                    Number.MAX_SAFE_INTEGER,
                    "offset",
                );
                const limit = boundedInteger(
                    effectiveLimit,
                    DEFAULT_READ_LINES,
                    1,
                    allowedReadLines,
                    "limit",
                );
                const selected = file.lines.slice(offset, offset + limit);
                if (selected.length > 0) {
                    observation = {
                        source: "read",
                        callIndex: -1,
                        path: normalizedPath,
                        startLine: offset + 1,
                        endLine: offset + selected.length,
                        lines: selected.map(truncateOutputLine),
                    };
                }
                let truncatedLine = false;
                const value = selected
                    .map((line, index) => {
                        if (line.length > MAX_OUTPUT_LINE_LENGTH) {
                            truncatedLine = true;
                        }
                        return `${offset + index + 1}\t${truncateOutputLine(line)}`;
                    })
                    .join("\n");
                return {
                    value,
                    resultCount: selected.length,
                    truncated:
                        offset > 0 ||
                        offset + selected.length < file.lines.length ||
                        truncatedLine,
                };
            },
            TOOL_BUDGET_EXHAUSTED,
        );
        if (observation) {
            observation.callIndex = trace.calls.length - 1;
            observations.push(observation);
        }
        return result;
    }

    async function navigateLanguageServer(
        request: LspRequest,
    ): Promise<LspLocation[]> {
        if (!languageServers) {
            throw new Error("LSP repository navigation is not enabled");
        }
        const priorCalls = trace.calls.filter(
            (call) => call.tool === "lsp",
        ).length;
        if (priorCalls >= MAX_LSP_CALLS) {
            return [];
        }
        const maxResults = request.maxResults ?? 20;
        return runTool(
            "lsp",
            { ...request },
            async () => {
                try {
                    const navigation = await languageServers.navigate(request);
                    return {
                        value: navigation.locations,
                        resultCount: navigation.locations.length,
                        truncated: navigation.locations.length >= maxResults,
                        traceInput: {
                            serverId: navigation.serverId,
                            languageId: navigation.languageId,
                        },
                    };
                } catch (error) {
                    return {
                        value: [],
                        resultCount: 0,
                        truncated: false,
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error),
                    };
                }
            },
            [],
        );
    }

    async function runTool<T>(
        tool: RepositoryToolCallTrace["tool"],
        input: Record<string, unknown>,
        operation: () => Promise<ToolResult<T>>,
        exhaustedValue: T,
    ): Promise<T> {
        if (!allowedTools.has(tool)) {
            const available = [...allowedTools]
                .map((name) => `repo.${name}`)
                .join(", ");
            throw new Error(
                `This repository phase permits only ${available} calls`,
            );
        }
        const phaseCalls = phaseToolCalls.get(tool) ?? 0;
        const toolLimit = toolCallLimits[tool];
        if (toolLimit !== undefined && phaseCalls >= toolLimit) {
            return exhaustedValue;
        }
        if (claimedCalls >= allowedCalls) {
            return exhaustedValue;
        }
        phaseToolCalls.set(tool, phaseCalls + 1);
        claimedCalls++;
        const startedAt = new Date().toISOString();
        const startTime = Date.now();
        try {
            const result = await operation();
            const outputBytes = serializedOutputBytes(result.value);
            if (trace.totalOutputBytes + outputBytes > MAX_TOTAL_OUTPUT_BYTES) {
                throw new Error("Repository tool output budget exceeded");
            }
            trace.calls.push({
                tool,
                startedAt,
                durationMs: Date.now() - startTime,
                input: { ...input, ...result.traceInput },
                resultCount: result.resultCount,
                outputBytes,
                truncated: result.truncated,
                ...(result.error ? { error: result.error } : {}),
            });
            trace.totalCalls++;
            trace.totalOutputBytes += outputBytes;
            return result.value;
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            trace.calls.push({
                tool,
                startedAt,
                durationMs: Date.now() - startTime,
                input,
                resultCount: 0,
                outputBytes: 0,
                truncated: false,
                error: message,
            });
            trace.totalCalls++;
            throw error;
        }
    }
}

interface RipgrepProcessResult {
    code: number;
    stdout: string;
    stderr: string;
    matchLimitReached: boolean;
}

interface RipgrepSnapshot {
    root: string;
    filesByPath: Map<string, SnapshotFile>;
}

async function searchSnapshotWithRipgrep(
    ripgrepPath: string,
    snapshot: RipgrepSnapshot,
    files: SnapshotFile[],
    pattern: string,
    literal: boolean,
    maxMatches: number,
): Promise<{
    matches: GrepMatch[];
    literalFallback: boolean;
    scanTruncated: boolean;
}> {
    if (files.length === 0) {
        return {
            matches: [],
            literalFallback: false,
            scanTruncated: false,
        };
    }
    const scanMatches = Math.min(
        MAX_RIPGREP_SCAN_MATCHES,
        Math.max(DEFAULT_RIPGREP_SCAN_MATCHES, maxMatches * 20),
    );
    let search = await searchRipgrepSnapshot(literal);
    let literalFallback = false;
    if (!literal && search.code === 2 && isRipgrepRegexError(search.stderr)) {
        search = await searchRipgrepSnapshot(true);
        literalFallback = true;
    }
    if (search.code !== 0 && search.code !== 1) {
        throw new Error(
            search.stderr.trim() || `ripgrep exited with code ${search.code}`,
        );
    }
    return {
        matches: search.matches,
        literalFallback,
        scanTruncated: search.truncated,
    };

    async function searchRipgrepSnapshot(literalSearch: boolean): Promise<{
        code: number;
        stderr: string;
        matches: GrepMatch[];
        truncated: boolean;
    }> {
        const candidates: SnapshotFile[] = [];
        const candidatePaths = new Set<string>();
        let candidateTruncated = false;
        let stderr = "";
        for (let priority = 0; priority <= 3; priority++) {
            const priorityTargets = files
                .filter(
                    (file) =>
                        searchPathPriority(file.relativePath) === priority,
                )
                .map((file) => file.relativePath);
            if (priorityTargets.length === 0) {
                continue;
            }
            for (const targets of chunkRipgrepTargets(priorityTargets)) {
                const remaining = maxMatches - candidates.length;
                if (remaining <= 0) {
                    break;
                }
                const result = await runRipgrep(
                    ripgrepPath,
                    pattern,
                    literalSearch,
                    snapshot.root,
                    targets,
                    undefined,
                    1,
                    remaining,
                );
                stderr += result.stderr;
                const partialResult = isUsablePartialRipgrepResult(result);
                if (result.code !== 0 && result.code !== 1 && !partialResult) {
                    return {
                        code: result.code,
                        stderr,
                        matches: [],
                        truncated: false,
                    };
                }
                candidateTruncated ||= partialResult;
                for (const match of parseRipgrepMatches(result, snapshot)) {
                    if (candidatePaths.has(match.path)) {
                        continue;
                    }
                    const file = snapshot.filesByPath.get(match.path);
                    if (!file) {
                        throw new Error(
                            "ripgrep returned an unknown snapshot path",
                        );
                    }
                    candidatePaths.add(match.path);
                    candidates.push(file);
                }
                candidateTruncated ||= result.matchLimitReached;
            }
            if (candidates.length >= maxMatches) {
                break;
            }
        }
        if (candidates.length === 0) {
            return {
                code: 1,
                stderr,
                matches: [],
                truncated: candidateTruncated,
            };
        }

        const perFileLimit = Math.max(
            1,
            Math.ceil(scanMatches / candidates.length),
        );
        const matches: GrepMatch[] = [];
        let detailTruncated = false;
        for (let priority = 0; priority <= 3; priority++) {
            const targets = candidates
                .filter(
                    (file) =>
                        searchPathPriority(file.relativePath) === priority,
                )
                .map((file) => file.relativePath);
            if (targets.length === 0) {
                continue;
            }
            for (const chunk of chunkRipgrepTargets(targets)) {
                const remaining = scanMatches - matches.length;
                if (remaining <= 0) {
                    detailTruncated = true;
                    break;
                }
                const result = await runRipgrep(
                    ripgrepPath,
                    pattern,
                    literalSearch,
                    snapshot.root,
                    chunk,
                    undefined,
                    perFileLimit,
                    remaining,
                );
                stderr += result.stderr;
                const partialResult = isUsablePartialRipgrepResult(result);
                if (result.code !== 0 && result.code !== 1 && !partialResult) {
                    return {
                        code: result.code,
                        stderr,
                        matches: [],
                        truncated: false,
                    };
                }
                detailTruncated ||= partialResult;
                matches.push(...parseRipgrepMatches(result, snapshot));
                detailTruncated ||= result.matchLimitReached;
            }
        }
        return {
            code: 0,
            stderr,
            matches: matches.slice(0, scanMatches),
            truncated:
                candidateTruncated ||
                detailTruncated ||
                matches.length >= scanMatches,
        };
    }
}

function parseRipgrepMatches(
    result: RipgrepProcessResult,
    snapshot: RipgrepSnapshot,
): GrepMatch[] {
    const matches: GrepMatch[] = [];
    const outputLines = result.stdout.split("\n");
    for (let index = 0; index < outputLines.length; index++) {
        const outputLine = outputLines[index];
        if (!outputLine) {
            continue;
        }
        let event: unknown;
        try {
            event = JSON.parse(outputLine);
        } catch {
            if (result.matchLimitReached && index === outputLines.length - 1) {
                continue;
            }
            throw new Error("ripgrep returned malformed JSON output");
        }
        if (!isRipgrepMatchEvent(event)) {
            continue;
        }
        const relativePath = normalizeRipgrepOutputPath(event.data.path.text);
        const file = snapshot.filesByPath.get(relativePath);
        const line = event.data.line_number;
        if (!file || line > file.lines.length) {
            throw new Error("ripgrep returned an out-of-range snapshot match");
        }
        if (
            event.data.lines.text.replace(/\r?\n$/u, "") !==
            file.lines[line - 1]
        ) {
            continue;
        }
        matches.push({
            path: file.relativePath,
            line,
            text: truncateOutputLine(file.lines[line - 1]),
        });
    }
    return matches;
}

function isRipgrepMatchEvent(value: unknown): value is {
    type: "match";
    data: {
        path: { text: string };
        lines: { text: string };
        line_number: number;
    };
} {
    if (!value || typeof value !== "object") {
        return false;
    }
    const event = value as Record<string, unknown>;
    if (
        event.type !== "match" ||
        !event.data ||
        typeof event.data !== "object"
    ) {
        return false;
    }
    const data = event.data as Record<string, unknown>;
    const lineNumber = data.line_number;
    const eventPath = data.path;
    const eventLines = data.lines;
    return (
        Number.isSafeInteger(lineNumber) &&
        Number(lineNumber) > 0 &&
        !!eventPath &&
        typeof eventPath === "object" &&
        typeof (eventPath as Record<string, unknown>).text === "string" &&
        !!eventLines &&
        typeof eventLines === "object" &&
        typeof (eventLines as Record<string, unknown>).text === "string"
    );
}

export function ripgrepArgumentBudget(platform: NodeJS.Platform): number {
    // Windows CreateProcess is limited to 32,767 command-line characters.
    // Leave room for the executable, fixed flags, a 1,000-character pattern,
    // and Windows argument quoting. POSIX keeps the larger proven batch size.
    return platform === "win32" ? 12 * 1024 : 128 * 1024;
}

export function chunkRipgrepTargets(
    targets: readonly string[],
    maxArgumentBytes = MAX_RIPGREP_ARGUMENT_BYTES,
): string[][] {
    const chunks: string[][] = [];
    let chunk: string[] = [];
    let bytes = 0;
    for (const target of targets) {
        const targetBytes = Buffer.byteLength(target) + 1;
        if (targetBytes > maxArgumentBytes) {
            throw new Error("repository path exceeds ripgrep argument limit");
        }
        if (chunk.length > 0 && bytes + targetBytes > maxArgumentBytes) {
            chunks.push(chunk);
            chunk = [];
            bytes = 0;
        }
        chunk.push(target);
        bytes += targetBytes;
    }
    if (chunk.length > 0) {
        chunks.push(chunk);
    }
    return chunks;
}

function isRipgrepRegexError(stderr: string): boolean {
    return /regex parse error|unclosed group|repetition operator missing expression/iu.test(
        stderr,
    );
}

function isUsablePartialRipgrepResult(result: RipgrepProcessResult): boolean {
    return result.code === 2 && result.stdout.includes('"type":"summary"');
}

function runRipgrep(
    ripgrepPath: string,
    pattern: string,
    literal: boolean,
    cwd: string,
    targets: readonly string[],
    includePattern: string | undefined,
    maxMatchesPerFile: number,
    maxMatches: number,
): Promise<RipgrepProcessResult> {
    return new Promise((resolve, reject) => {
        const args = [
            "--json",
            "--color",
            "never",
            "--max-columns",
            String(MAX_OUTPUT_LINE_LENGTH),
            "--max-count",
            String(maxMatchesPerFile),
            "--sort",
            "path",
            "--threads",
            "1",
        ];
        if (literal) {
            args.push("--fixed-strings");
        }
        if (includePattern) {
            args.push("--glob", includePattern);
        }
        args.push("--", pattern, ...targets);
        const child = spawn(ripgrepPath, args, {
            cwd,
            stdio: ["ignore", "pipe", "pipe"],
        });
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        let outputBytes = 0;
        let settled = false;
        let terminalError: Error | undefined;
        let matchCount = 0;
        let matchLineTail = "";
        let matchLimitReached = false;
        const finish = (handler: () => void): void => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            handler();
        };
        const timer = setTimeout(() => {
            terminalError ??= new Error("ripgrep timed out after 30 seconds");
            child.kill("SIGKILL");
        }, 30_000);
        child.stdout.on("data", (chunk: Buffer) => {
            if (terminalError || matchLimitReached) {
                return;
            }
            outputBytes += chunk.length;
            if (outputBytes > MAX_RIPGREP_OUTPUT_BYTES) {
                terminalError ??= new Error(
                    "ripgrep output exceeded the safety limit",
                );
                child.kill("SIGKILL");
                return;
            }
            stdout.push(chunk);
            const lines = `${matchLineTail}${chunk.toString("utf8")}`.split(
                "\n",
            );
            matchLineTail = lines.pop() ?? "";
            for (const line of lines) {
                if (line.startsWith('{"type":"match",')) {
                    matchCount++;
                }
            }
            if (matchCount >= maxMatches) {
                matchLimitReached = true;
                child.kill("SIGTERM");
            }
        });
        child.stderr.on("data", (chunk: Buffer) => {
            if (terminalError) {
                return;
            }
            outputBytes += chunk.length;
            if (outputBytes > MAX_RIPGREP_OUTPUT_BYTES) {
                terminalError ??= new Error(
                    "ripgrep output exceeded the safety limit",
                );
                child.kill("SIGKILL");
                return;
            }
            stderr.push(chunk);
        });
        child.once("error", (error) => finish(() => reject(error)));
        child.once("close", (code) =>
            finish(() => {
                if (terminalError) {
                    reject(terminalError);
                    return;
                }
                resolve({
                    code: matchLimitReached ? 0 : (code ?? -1),
                    stdout: Buffer.concat(stdout).toString("utf8"),
                    stderr: Buffer.concat(stderr).toString("utf8"),
                    matchLimitReached,
                });
            }),
        );
    });
}

async function resolveRipgrepPath(): Promise<string> {
    const configured = process.env.TYPEAGENT_RIPGREP_PATH?.trim();
    const names = configured
        ? [configured]
        : process.platform === "win32"
          ? ["rg.exe", "rg"]
          : ["rg"];
    const candidates = names.flatMap((name) => {
        if (
            path.isAbsolute(name) ||
            path.win32.isAbsolute(name) ||
            name.includes("/") ||
            name.includes("\\")
        ) {
            return [path.resolve(name)];
        }
        return (process.env.PATH ?? "")
            .split(path.delimiter)
            .filter(Boolean)
            .map((directory) => path.join(directory, name));
    });
    for (const candidate of candidates) {
        try {
            await access(candidate, constants.X_OK);
            return await realpath(candidate);
        } catch {
            // Continue to the next PATH candidate.
        }
    }
    throw new Error(
        "ripgrep is required for TypeAgent repository search; install rg or set TYPEAGENT_RIPGREP_PATH",
    );
}

function extractSearchSymbol(pattern: string): string | undefined {
    const candidate = pattern.trim();
    if (!/^[A-Za-z_$][\w$]*(?:[.][A-Za-z_$][\w$]*)*$/u.test(candidate)) {
        return undefined;
    }
    return candidate.split(".").at(-1);
}

function selectRepresentativeMatch(
    matches: GrepMatch[],
    symbol: string | undefined,
): GrepMatch {
    if (!symbol) {
        return matches[0];
    }
    return [...matches].sort(
        (left, right) =>
            symbolMatchRank(left.text, symbol) -
                symbolMatchRank(right.text, symbol) || left.line - right.line,
    )[0];
}

function symbolMatchRank(line: string, symbol: string): number {
    if (isSymbolDefinition(line, symbol)) {
        return 0;
    }
    return containsWholeSymbol(line, symbol) ? 1 : 2;
}

function isSymbolDefinition(line: string, symbol: string): boolean {
    const name = escapeRegularExpression(symbol);
    const modifiers =
        "(?:(?:export|public|private|protected|static|async|abstract|final|override|virtual|inline)\\s+)*";
    const boundary = `(?![A-Za-z0-9_$])`;
    return new RegExp(
        `^\\s*${modifiers}(?:(?:class|def|enum|fn|func|function|interface|struct|type)\\s+${name}${boundary}|(?:const|let|var)\\s+${name}${boundary}|${name}${boundary}\\s*\\([^)]*\\)\\s*(?::[^=]+)?\\s*\\{)`,
        "u",
    ).test(line);
}

function containsWholeSymbol(line: string, symbol: string): boolean {
    const name = escapeRegularExpression(symbol);
    return new RegExp(`(?:^|[^A-Za-z0-9_$])${name}(?![A-Za-z0-9_$])`, "u").test(
        line,
    );
}

function escapeRegularExpression(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function compareSearchFiles(left: SnapshotFile, right: SnapshotFile): number {
    return (
        searchPathPriority(left.relativePath) -
            searchPathPriority(right.relativePath) ||
        left.relativePath.localeCompare(right.relativePath)
    );
}

function searchPathPriority(fileName: string): number {
    const parts = fileName.toLowerCase().split("/");
    if (
        parts.some((part) =>
            [
                "doc",
                "docs",
                "documentation",
                "example",
                "examples",
                "asset",
                "assets",
                "locale",
                "locales",
                "vendor",
                "third_party",
            ].includes(part),
        )
    ) {
        return 3;
    }
    if (
        parts.some((part) =>
            ["test", "tests", "testing", "spec", "specs"].includes(part),
        ) ||
        /(?:^|[._-])(test|spec)(?:[._-]|$)/i.test(path.posix.basename(fileName))
    ) {
        return 2;
    }
    if (
        /\.(?:c|cc|cpp|cxx|go|h|hh|hpp|hxx|java|js|jsx|php|py|rb|rs|ts|tsx)$/i.test(
            fileName,
        )
    ) {
        return 0;
    }
    return 1;
}

function normalizeRipgrepOutputPath(value: string): string {
    return toPosixPath(value).replace(/^(?:[.][/])+/, "");
}

async function resolveRepositoryRoot(requestedRoot: string): Promise<string> {
    const resolved = await realpath(path.resolve(requestedRoot));
    const info = await stat(resolved);
    if (!info.isDirectory()) {
        throw new Error(`Repository root is not a directory: ${resolved}`);
    }
    return resolved;
}

async function createRepositorySnapshot(
    repoRoot: string,
): Promise<SnapshotFile[]> {
    const fileNames = await listRepositoryFiles(repoRoot);
    const files: SnapshotFile[] = [];
    for (const relativePath of fileNames) {
        if (isSensitivePath(relativePath)) {
            continue;
        }
        const absolutePath = path.join(repoRoot, relativePath);
        try {
            const info = await lstat(absolutePath);
            if (!info.isFile() || info.size > MAX_FILE_BYTES) {
                continue;
            }
            const handle = await open(
                absolutePath,
                constants.O_RDONLY | constants.O_NOFOLLOW,
            );
            try {
                const openedInfo = await handle.stat();
                const resolvedPath = await realpath(absolutePath);
                if (
                    !openedInfo.isFile() ||
                    openedInfo.size > MAX_FILE_BYTES ||
                    !isWithinRoot(repoRoot, resolvedPath)
                ) {
                    continue;
                }
                const content = await handle.readFile();
                if (content.length > MAX_FILE_BYTES || content.includes(0)) {
                    continue;
                }
                const text = content.toString("utf8");
                if (replacementCharacterRatio(text) > 0.01) {
                    continue;
                }
                files.push({
                    relativePath,
                    lines: text.split(/\r?\n/),
                });
            } finally {
                await handle.close();
            }
        } catch (error) {
            if (!isSkippableFileError(error)) {
                throw error;
            }
        }
    }
    return files;
}

async function listRepositoryFiles(repoRoot: string): Promise<string[]> {
    const gitFiles = await listGitFiles(repoRoot);
    const fileNames =
        gitFiles ??
        (await glob("**/*", {
            cwd: repoRoot,
            nodir: true,
            dot: true,
            follow: false,
            ignore: IGNORE_GLOBS,
        }));
    return fileNames
        .map(toPosixPath)
        .map(normalizeSnapshotPath)
        .filter((fileName): fileName is string => fileName !== undefined)
        .filter((fileName) => !hasIgnoredDirectory(fileName))
        .sort();
}

async function listGitFiles(repoRoot: string): Promise<string[] | undefined> {
    return new Promise<string[] | undefined>((resolve, reject) => {
        let settled = false;
        let outputBytes = 0;
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        const child = spawn(
            "git",
            [
                "ls-files",
                "--cached",
                "--others",
                "--exclude-standard",
                "-z",
                "--",
                ".",
            ],
            { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] },
        );
        const timer = setTimeout(() => {
            child.kill("SIGKILL");
            fail(new Error("git ls-files timed out after 30 seconds"));
        }, 30_000);

        child.stdout.on("data", (chunk: Buffer) => {
            outputBytes += chunk.length;
            if (outputBytes > MAX_GIT_OUTPUT_BYTES) {
                child.kill("SIGKILL");
                fail(
                    new Error("git ls-files output exceeded the safety limit"),
                );
                return;
            }
            stdout.push(chunk);
        });
        child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
        child.on("error", (error: NodeJS.ErrnoException) => {
            clearTimeout(timer);
            if (error.code !== "ENOENT") {
                fail(error);
                return;
            }
            void hasGitMarker(repoRoot).then((isGitRepository) => {
                if (isGitRepository) {
                    fail(
                        new Error(
                            "git is required to enumerate this repository safely",
                        ),
                    );
                } else {
                    succeed(undefined);
                }
            }, fail);
        });
        child.on("close", (code) => {
            clearTimeout(timer);
            if (settled) {
                return;
            }
            if (code === 0) {
                succeed(
                    Buffer.concat(stdout)
                        .toString("utf8")
                        .split("\0")
                        .filter((value) => value.length > 0),
                );
                return;
            }
            const message = Buffer.concat(stderr).toString("utf8").trim();
            if (code === 128 && /not a git repository/i.test(message)) {
                succeed(undefined);
                return;
            }
            fail(
                new Error(
                    `git ls-files failed with exit ${code}: ${message || "unknown error"}`,
                ),
            );
        });

        function succeed(value: string[] | undefined): void {
            if (!settled) {
                settled = true;
                clearTimeout(timer);
                resolve(value);
            }
        }

        function fail(error: unknown): void {
            if (!settled) {
                settled = true;
                clearTimeout(timer);
                reject(error);
            }
        }
    });
}

async function hasGitMarker(repoRoot: string): Promise<boolean> {
    let current = repoRoot;
    while (true) {
        try {
            await lstat(path.join(current, ".git"));
            return true;
        } catch (error) {
            if (!isMissingFileError(error)) {
                throw error;
            }
        }
        const parent = path.dirname(current);
        if (parent === current) {
            return false;
        }
        current = parent;
    }
}

function normalizeRelativePath(value: string): string {
    const trimmed = value.trim();
    if (
        trimmed.includes("\0") ||
        trimmed.includes("\\") ||
        path.posix.isAbsolute(trimmed) ||
        /^[A-Za-z]:/.test(trimmed)
    ) {
        throw new Error("Repository paths must be relative POSIX paths");
    }
    const parts = trimmed.split("/");
    if (parts.includes("..")) {
        throw new Error("Repository paths must be relative POSIX paths");
    }
    const normalized = path.posix.normalize(trimmed);
    return normalized === "." ? "" : normalized.replace(/^\.\//, "");
}

function normalizeSnapshotPath(value: string): string | undefined {
    try {
        const normalized = normalizeRelativePath(value);
        return normalized.length > 0 ? normalized : undefined;
    } catch {
        return undefined;
    }
}

function validateGlob(value: string): string {
    if (value.length === 0 || value.length > 512) {
        throw new Error("glob must contain between 1 and 512 characters");
    }
    if (
        value.includes("\0") ||
        value.includes("\\") ||
        path.posix.isAbsolute(value) ||
        /^[A-Za-z]:/.test(value) ||
        value.split("/").includes("..")
    ) {
        throw new Error("glob must be repository-relative");
    }
    return value;
}

function compileGlob(pattern: string): RegExp {
    const expanded = expandBraceAlternatives(pattern);
    return new RegExp(`(?:${expanded.map(compileSingleGlob).join("|")})`);
}

function expandBraceAlternatives(pattern: string): string[] {
    const open = pattern.indexOf("{");
    const close = open < 0 ? -1 : pattern.indexOf("}", open + 1);
    if (open < 0 || close < 0) {
        return [pattern];
    }
    const choices = pattern.slice(open + 1, close).split(",");
    if (choices.length < 2 || choices.some((choice) => choice.length === 0)) {
        return [pattern];
    }
    const expanded = choices.flatMap((choice) =>
        expandBraceAlternatives(
            `${pattern.slice(0, open)}${choice}${pattern.slice(close + 1)}`,
        ),
    );
    if (expanded.length > 32) {
        throw new Error("glob has too many brace alternatives");
    }
    return expanded;
}

function compileSingleGlob(pattern: string): string {
    let expression = pattern.includes("/") ? "^" : "^(?:.*/)?";
    for (let index = 0; index < pattern.length; index++) {
        const char = pattern[index];
        if (char === "*") {
            if (pattern[index + 1] === "*") {
                if (pattern[index + 2] === "/") {
                    expression += "(?:.*/)?";
                    index += 2;
                } else {
                    expression += ".*";
                    index++;
                }
            } else {
                expression += "[^/]*";
            }
        } else if (char === "?") {
            expression += "[^/]";
        } else {
            expression += escapeRegexCharacter(char);
        }
    }
    return `${expression}$`;
}

function isWithinListingDepth(
    fileName: string,
    base: string,
    depth: number,
): boolean {
    if (fileName === base) {
        return true;
    }
    if (!isAtOrBelow(fileName, base)) {
        return false;
    }
    const remainder = base ? fileName.slice(base.length + 1) : fileName;
    return remainder.split("/").length <= depth;
}

function isAtOrBelow(fileName: string, base: string): boolean {
    return (
        base.length === 0 ||
        fileName === base ||
        fileName.startsWith(`${base}/`)
    );
}

function isWithinRoot(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    return (
        relative === "" ||
        (!relative.startsWith(`..${path.sep}`) &&
            relative !== ".." &&
            !path.isAbsolute(relative))
    );
}

function isSensitivePath(relativePath: string): boolean {
    const normalizedPath = relativePath.toLowerCase();
    const pathParts = normalizedPath.split("/");
    const baseName = pathParts[pathParts.length - 1];
    if (baseName === ".env" || baseName.startsWith(".env.")) {
        return true;
    }
    if (SENSITIVE_FILE_NAMES.has(baseName)) {
        return true;
    }
    if (
        baseName.startsWith("config.local.") ||
        baseName.startsWith("settings.local.") ||
        baseName.startsWith(".secrets.") ||
        baseName.endsWith(".secret") ||
        baseName.endsWith(".secrets") ||
        baseName.endsWith(".tfvars") ||
        baseName.endsWith(".tfvars.json")
    ) {
        return true;
    }
    if (
        baseName === "config.json" &&
        pathParts[pathParts.length - 2] === ".docker"
    ) {
        return true;
    }
    const extension = path.posix.extname(baseName);
    if (SENSITIVE_CREDENTIAL_EXTENSIONS.has(extension)) {
        const stem = baseName.slice(0, -extension.length);
        if (
            /^(?:credentials|client[-_]?secrets?|google[-_]?credentials|gcp[-_]?credentials|tokens?|access[-_]?token|refresh[-_]?token|oauth[-_]?tokens?|api[-_]?keys?|account[-_]?key)$/.test(
                stem,
            ) ||
            /^service[-_]?account(?:[-_]?(?:key|credentials))?$/.test(stem) ||
            /(?:^|[-_.])private[-_]?key(?:$|[-_.])/.test(stem)
        ) {
            return true;
        }
    }
    return [".pem", ".key", ".p12", ".pfx"].includes(extension);
}

function hasIgnoredDirectory(relativePath: string): boolean {
    const parts = relativePath.split("/");
    parts.pop();
    return parts.some((part) => IGNORED_DIRECTORY_NAMES.has(part));
}

function replacementCharacterRatio(value: string): number {
    if (value.length === 0) {
        return 0;
    }
    return (value.split("\uFFFD").length - 1) / value.length;
}

function truncateOutputLine(value: string): string {
    return value.slice(0, MAX_OUTPUT_LINE_LENGTH);
}

function serializedOutputBytes(value: unknown): number {
    const serialized =
        typeof value === "string" ? value : (JSON.stringify(value) ?? "");
    return Buffer.byteLength(serialized, "utf8");
}

function boundedInteger(
    value: number | undefined,
    defaultValue: number,
    minimum: number,
    maximum: number,
    name: string,
): number {
    const resolved = value ?? defaultValue;
    if (
        !Number.isSafeInteger(resolved) ||
        resolved < minimum ||
        resolved > maximum
    ) {
        throw new Error(
            `${name} must be an integer between ${minimum} and ${maximum}`,
        );
    }
    return resolved;
}

function escapeRegexCharacter(value: string): string {
    return /[\\^$.*+?()[\]{}|]/.test(value) ? `\\${value}` : value;
}

function toPosixPath(value: string): string {
    return value.split(path.sep).join("/");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
    return typeof error === "object" && error !== null && "code" in error;
}

function isMissingFileError(error: unknown): boolean {
    return isNodeError(error) && error.code === "ENOENT";
}

function isSkippableFileError(error: unknown): boolean {
    return (
        isNodeError(error) &&
        (error.code === "ENOENT" ||
            error.code === "EACCES" ||
            error.code === "EPERM" ||
            error.code === "ELOOP")
    );
}
