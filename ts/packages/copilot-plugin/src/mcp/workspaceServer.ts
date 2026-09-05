// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createReadStream, promises as fs } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import path from "node:path";
import { createInterface } from "node:readline";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
    createPinnedLookup,
    resolvePublicIpAddress,
} from "@typeagent/common-utils/network";
import { convert } from "html-to-text";
import { z } from "zod";
import { getMode } from "../shared/plugin-config.js";

const DEFAULT_MAX_BYTES = 64 * 1024;
const MAX_READ_BYTES = 256 * 1024;
const DEFAULT_MAX_RESULTS = 200;
const MAX_RESULTS = 1000;
const MAX_FETCH_BYTES = 1024 * 1024;
const MAX_CONTEXT_LINES = 10;
const WALK_TIMEOUT_MS = 5000;
const FETCH_TIMEOUT_MS = 15000;
const MAX_REDIRECTS = 3;
const IGNORED_DIRECTORIES = new Set([
    ".git",
    ".hg",
    ".svn",
    "node_modules",
    "coverage",
    "dist",
    "out",
]);

type WorkspaceRoots = {
    roots: string[];
    realRoots: string[];
};

type FileMatch = {
    path: string;
    line: number;
    text: string;
    before?: string[];
    after?: string[];
};

function toolResult(value: unknown): CallToolResult {
    return {
        content: [
            {
                type: "text",
                text:
                    typeof value === "string"
                        ? value
                        : JSON.stringify(value, null, 2),
            },
        ],
    };
}

function toolError(error: unknown): CallToolResult {
    return {
        isError: true,
        content: [
            {
                type: "text",
                text: error instanceof Error ? error.message : String(error),
            },
        ],
    };
}

function getConfiguredRoots(): string[] {
    const configured = process.env.TYPEAGENT_WORKSPACE_ROOTS;
    const roots = configured
        ? configured
              .split(path.delimiter)
              .map((root) => root.trim())
              .filter(Boolean)
        : [process.cwd()];
    return [...new Set(roots.map((root) => path.resolve(root)))];
}

export async function resolveWorkspaceRoots(): Promise<WorkspaceRoots> {
    const roots = getConfiguredRoots();
    const realRoots = await Promise.all(
        roots.map(async (root) => {
            const stat = await fs.stat(root);
            if (!stat.isDirectory()) {
                throw new Error(`Workspace root is not a directory: ${root}`);
            }
            return fs.realpath(root);
        }),
    );
    return { roots, realRoots };
}

function isWithinRoot(candidate: string, root: string): boolean {
    const relative = path.relative(root, candidate);
    return (
        relative === "" ||
        (!relative.startsWith(`..${path.sep}`) &&
            relative !== ".." &&
            !path.isAbsolute(relative))
    );
}

async function resolveExistingPath(
    inputPath: string,
    workspace: WorkspaceRoots,
): Promise<{ absolutePath: string; root: string }> {
    if (!inputPath.trim()) {
        throw new Error("Path must not be empty.");
    }

    const candidates = path.isAbsolute(inputPath)
        ? [path.resolve(inputPath)]
        : workspace.roots.map((root) => path.resolve(root, inputPath));

    for (const candidate of candidates) {
        try {
            const realPath = await fs.realpath(candidate);
            const rootIndex = workspace.realRoots.findIndex((root) =>
                isWithinRoot(realPath, root),
            );
            if (rootIndex !== -1) {
                return {
                    absolutePath: realPath,
                    root: workspace.realRoots[rootIndex],
                };
            }
        } catch (error) {
            if (
                !(error instanceof Error) ||
                !("code" in error) ||
                error.code !== "ENOENT"
            ) {
                throw error;
            }
        }
    }

    throw new Error(
        `Path does not exist under an approved workspace root: ${inputPath}`,
    );
}

function workspacePath(absolutePath: string, root: string): string {
    return path.relative(root, absolutePath).split(path.sep).join("/");
}

function clampInteger(
    value: number | undefined,
    defaultValue: number,
    maximum: number,
): number {
    if (value === undefined) {
        return defaultValue;
    }
    if (!Number.isInteger(value) || value < 1 || value > maximum) {
        throw new Error(`Value must be an integer between 1 and ${maximum}.`);
    }
    return value;
}

export async function readWorkspaceFile(args: {
    path: string;
    startLine?: number | undefined;
    endLine?: number | undefined;
    maxBytes?: number | undefined;
}): Promise<{
    path: string;
    startLine: number;
    endLine: number;
    truncated: boolean;
    text: string;
}> {
    const workspace = await resolveWorkspaceRoots();
    const resolved = await resolveExistingPath(args.path, workspace);
    const stat = await fs.stat(resolved.absolutePath);
    if (!stat.isFile()) {
        throw new Error(`Path is not a file: ${args.path}`);
    }

    const maxBytes = clampInteger(
        args.maxBytes,
        DEFAULT_MAX_BYTES,
        MAX_READ_BYTES,
    );
    const startLine = args.startLine ?? 1;
    const requestedEndLine = args.endLine;
    if (
        !Number.isInteger(startLine) ||
        (requestedEndLine !== undefined &&
            (!Number.isInteger(requestedEndLine) ||
                requestedEndLine < startLine)) ||
        startLine < 1
    ) {
        throw new Error(
            "Line range must use positive integers with endLine >= startLine.",
        );
    }

    const stream = createReadStream(resolved.absolutePath, {
        encoding: "utf8",
    });
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    const selected: string[] = [];
    let selectedBytes = 0;
    let lineNumber = 0;
    let truncated = false;

    try {
        for await (const line of lines) {
            lineNumber++;
            if (line.includes("\0")) {
                throw new Error(`Binary files are not supported: ${args.path}`);
            }
            if (
                requestedEndLine !== undefined &&
                lineNumber > requestedEndLine
            ) {
                truncated = true;
                break;
            }
            if (lineNumber < startLine) continue;

            const separatorBytes = selected.length > 0 ? 1 : 0;
            const lineBytes = Buffer.byteLength(line, "utf8");
            if (selectedBytes + separatorBytes + lineBytes > maxBytes) {
                truncated = true;
                break;
            }
            selected.push(line);
            selectedBytes += separatorBytes + lineBytes;
        }
    } finally {
        lines.close();
        stream.destroy();
    }

    const actualEndLine =
        selected.length > 0 ? startLine + selected.length - 1 : startLine - 1;
    if (requestedEndLine !== undefined && actualEndLine < requestedEndLine) {
        truncated ||= lineNumber >= startLine;
    }

    return {
        path: workspacePath(resolved.absolutePath, resolved.root),
        startLine,
        endLine: actualEndLine,
        truncated,
        text: selected.join("\n"),
    };
}

function compileGlob(pattern: string): RegExp {
    const normalized = pattern.replaceAll("\\", "/");
    if (
        !normalized ||
        path.posix.isAbsolute(normalized) ||
        normalized.split("/").includes("..")
    ) {
        throw new Error(
            "Glob patterns must be relative and must not contain '..'.",
        );
    }

    let expression = "";
    for (let i = 0; i < normalized.length; i++) {
        const char = normalized[i];
        if (char === "*") {
            if (normalized[i + 1] === "*") {
                i++;
                if (normalized[i + 1] === "/") {
                    i++;
                    expression += "(?:.*/)?";
                } else {
                    expression += ".*";
                }
            } else {
                expression += "[^/]*";
            }
        } else if (char === "?") {
            expression += "[^/]";
        } else if (char === "{") {
            const close = normalized.indexOf("}", i + 1);
            if (close === -1) {
                expression += "\\{";
            } else {
                const choices = normalized
                    .slice(i + 1, close)
                    .split(",")
                    .map((choice) =>
                        choice.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
                    );
                expression += `(?:${choices.join("|")})`;
                i = close;
            }
        } else {
            expression += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        }
    }
    return new RegExp(`^${expression}$`);
}

async function getSearchRoots(
    requestedPaths: string[] | undefined,
    workspace: WorkspaceRoots,
): Promise<Array<{ absolutePath: string; root: string }>> {
    if (!requestedPaths?.length) {
        return workspace.realRoots.map((root) => ({
            absolutePath: root,
            root,
        }));
    }
    return Promise.all(
        requestedPaths.map(async (requestedPath) => {
            const resolved = await resolveExistingPath(
                requestedPath,
                workspace,
            );
            const stat = await fs.stat(resolved.absolutePath);
            if (!stat.isDirectory() && !stat.isFile()) {
                throw new Error(
                    `Search path is not a file or directory: ${requestedPath}`,
                );
            }
            return resolved;
        }),
    );
}

async function walkFiles(
    searchRoots: Array<{ absolutePath: string; root: string }>,
    onFile: (absolutePath: string, root: string) => Promise<boolean>,
): Promise<void> {
    const deadline = Date.now() + WALK_TIMEOUT_MS;
    const stack = [...searchRoots].reverse();

    while (stack.length > 0) {
        if (Date.now() > deadline) {
            throw new Error("Workspace search exceeded its time limit.");
        }

        const current = stack.pop()!;
        const stat = await fs.lstat(current.absolutePath);
        if (stat.isSymbolicLink()) {
            continue;
        }
        if (stat.isFile()) {
            if (!(await onFile(current.absolutePath, current.root))) {
                return;
            }
            continue;
        }
        if (!stat.isDirectory()) {
            continue;
        }

        const entries = await fs.readdir(current.absolutePath, {
            withFileTypes: true,
        });
        entries.sort((left, right) =>
            left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
        );
        for (let i = entries.length - 1; i >= 0; i--) {
            const entry = entries[i];
            if (
                entry.isSymbolicLink() ||
                (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name))
            ) {
                continue;
            }
            stack.push({
                absolutePath: path.join(current.absolutePath, entry.name),
                root: current.root,
            });
        }
    }
}

export async function globWorkspace(args: {
    pattern: string;
    paths?: string[] | undefined;
    maxResults?: number | undefined;
}): Promise<{ matches: string[]; truncated: boolean }> {
    const workspace = await resolveWorkspaceRoots();
    const searchRoots = await getSearchRoots(args.paths, workspace);
    const matcher = compileGlob(args.pattern);
    const maxResults = clampInteger(
        args.maxResults,
        DEFAULT_MAX_RESULTS,
        MAX_RESULTS,
    );
    const matches: string[] = [];
    let truncated = false;

    await walkFiles(searchRoots, async (absolutePath, root) => {
        const relativePath = workspacePath(absolutePath, root);
        if (matcher.test(relativePath)) {
            if (matches.length === maxResults) {
                truncated = true;
                return false;
            }
            matches.push(relativePath);
        }
        return true;
    });

    matches.sort();
    return { matches, truncated };
}

export async function grepWorkspace(args: {
    pattern: string;
    paths?: string[] | undefined;
    include?: string[] | undefined;
    literal?: boolean | undefined;
    contextLines?: number | undefined;
    maxResults?: number | undefined;
}): Promise<{ matches: FileMatch[]; truncated: boolean }> {
    const workspace = await resolveWorkspaceRoots();
    const searchRoots = await getSearchRoots(args.paths, workspace);
    const includeMatchers = args.include?.map(compileGlob);
    const maxResults = clampInteger(
        args.maxResults,
        DEFAULT_MAX_RESULTS,
        MAX_RESULTS,
    );
    const contextLines = args.contextLines ?? 0;
    if (
        !Number.isInteger(contextLines) ||
        contextLines < 0 ||
        contextLines > MAX_CONTEXT_LINES
    ) {
        throw new Error(
            `contextLines must be an integer between 0 and ${MAX_CONTEXT_LINES}.`,
        );
    }
    let matcher: RegExp;
    try {
        matcher = args.literal
            ? new RegExp(
                  args.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
                  "i",
              )
            : new RegExp(args.pattern, "i");
    } catch (error) {
        throw new Error(
            `Invalid regular expression: ${
                error instanceof Error ? error.message : String(error)
            }`,
        );
    }

    const matches: FileMatch[] = [];
    let truncated = false;
    await walkFiles(searchRoots, async (absolutePath, root) => {
        const relativePath = workspacePath(absolutePath, root);
        if (
            includeMatchers &&
            !includeMatchers.some((include) => include.test(relativePath))
        ) {
            return true;
        }

        const stat = await fs.stat(absolutePath);
        if (stat.size > MAX_READ_BYTES) {
            return true;
        }
        const content = await fs.readFile(absolutePath);
        if (content.includes(0)) {
            return true;
        }
        const lines = content.toString("utf8").split(/\r?\n/);
        for (let index = 0; index < lines.length; index++) {
            matcher.lastIndex = 0;
            if (!matcher.test(lines[index])) {
                continue;
            }
            if (matches.length === maxResults) {
                truncated = true;
                return false;
            }
            const before =
                contextLines > 0
                    ? lines.slice(Math.max(0, index - contextLines), index)
                    : undefined;
            const after =
                contextLines > 0
                    ? lines.slice(index + 1, index + 1 + contextLines)
                    : undefined;
            matches.push({
                path: relativePath,
                line: index + 1,
                text: lines[index],
                ...(before?.length ? { before } : {}),
                ...(after?.length ? { after } : {}),
            });
        }
        return true;
    });

    return { matches, truncated };
}

async function fetchOnce(
    url: URL,
    maxBytes: number,
): Promise<{
    statusCode: number;
    headers: Record<string, string | string[] | undefined>;
    body: Buffer;
}> {
    const resolved = await resolvePublicIpAddress(url.hostname);
    const request = url.protocol === "https:" ? httpsRequest : httpRequest;

    return new Promise((resolve, reject) => {
        const req = request(
            url,
            {
                headers: {
                    accept: "text/plain, text/html, application/json, application/xml;q=0.9, text/xml;q=0.9",
                    "accept-encoding": "identity",
                    "user-agent": "TypeAgent-Workspace-Tools/1.0",
                },
                ...createPinnedLookup(resolved),
                timeout: FETCH_TIMEOUT_MS,
            },
            (response) => {
                const chunks: Buffer[] = [];
                let size = 0;
                response.on("data", (chunk: Buffer) => {
                    size += chunk.length;
                    if (size > maxBytes) {
                        req.destroy(
                            new Error(
                                `Fetch response exceeded ${maxBytes} bytes.`,
                            ),
                        );
                        return;
                    }
                    chunks.push(chunk);
                });
                response.on("end", () => {
                    resolve({
                        statusCode: response.statusCode ?? 0,
                        headers: response.headers,
                        body: Buffer.concat(chunks),
                    });
                });
            },
        );
        req.on("timeout", () => {
            req.destroy(new Error("Fetch request timed out."));
        });
        req.on("error", reject);
        req.end();
    });
}

export async function fetchWorkspaceUrl(args: {
    url: string;
    maxBytes?: number | undefined;
    acceptedContentTypes?: string[] | undefined;
}): Promise<{
    url: string;
    status: number;
    contentType: string;
    text: string;
}> {
    let currentUrl: URL;
    try {
        currentUrl = new URL(args.url);
    } catch {
        throw new Error(`Invalid URL: ${args.url}`);
    }
    if (
        (currentUrl.protocol !== "http:" && currentUrl.protocol !== "https:") ||
        currentUrl.username ||
        currentUrl.password
    ) {
        throw new Error(
            "Fetch supports credential-free HTTP and HTTPS URLs only.",
        );
    }

    const maxBytes = clampInteger(
        args.maxBytes,
        DEFAULT_MAX_BYTES,
        MAX_FETCH_BYTES,
    );
    const acceptedContentTypes = args.acceptedContentTypes?.map((value) =>
        value.toLowerCase(),
    ) ?? ["text/", "application/json", "application/xml"];

    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
        const response = await fetchOnce(currentUrl, maxBytes);
        if (
            response.statusCode >= 300 &&
            response.statusCode < 400 &&
            response.headers.location
        ) {
            if (redirect === MAX_REDIRECTS) {
                throw new Error("Fetch exceeded the redirect limit.");
            }
            currentUrl = new URL(response.headers.location, currentUrl);
            if (
                (currentUrl.protocol !== "http:" &&
                    currentUrl.protocol !== "https:") ||
                currentUrl.username ||
                currentUrl.password
            ) {
                throw new Error(
                    "Fetch redirect used an unsupported or credentialed URL.",
                );
            }
            continue;
        }

        const contentTypeHeader = response.headers["content-type"];
        const contentType = (
            Array.isArray(contentTypeHeader)
                ? contentTypeHeader[0]
                : (contentTypeHeader ?? "application/octet-stream")
        )
            .split(";", 1)[0]
            .trim()
            .toLowerCase();
        if (
            !acceptedContentTypes.some((accepted) =>
                accepted.endsWith("/")
                    ? contentType.startsWith(accepted)
                    : contentType === accepted,
            )
        ) {
            throw new Error(
                `Fetch content type is not allowed: ${contentType}`,
            );
        }

        const rawText = response.body.toString("utf8");
        const text =
            contentType === "text/html"
                ? convert(rawText, {
                      wordwrap: false,
                      selectors: [
                          { selector: "script", format: "skip" },
                          { selector: "style", format: "skip" },
                      ],
                  })
                : rawText;
        return {
            url: currentUrl.toString(),
            status: response.statusCode,
            contentType,
            text,
        };
    }

    throw new Error("Fetch failed.");
}

export class TypeAgentWorkspaceMcpServer {
    private readonly server = new McpServer({
        name: "typeagent-workspace",
        version: "0.1.0",
    });

    constructor() {
        this.registerTools();
    }

    async start(): Promise<void> {
        await this.server.connect(new StdioServerTransport());
        process.stderr.write(
            `[${new Date().toISOString()}] [typeagent-workspace-mcp] started with roots: ${getConfiguredRoots().join(", ")}\n`,
        );
    }

    private registerTools(): void {
        this.server.registerTool(
            "read",
            {
                title: "Read workspace file",
                description:
                    "Read bounded text from a file under the current workspace.",
                inputSchema: z.object({
                    path: z.string(),
                    startLine: z.number().int().positive().optional(),
                    endLine: z.number().int().positive().optional(),
                    maxBytes: z.number().int().positive().optional(),
                }),
                annotations: { readOnlyHint: true },
            },
            async (args) => this.invoke(() => readWorkspaceFile(args)),
        );
        this.server.registerTool(
            "glob",
            {
                title: "Find workspace files",
                description:
                    "Find files under the current workspace using a bounded glob pattern.",
                inputSchema: z.object({
                    pattern: z.string(),
                    paths: z.array(z.string()).optional(),
                    maxResults: z.number().int().positive().optional(),
                }),
                annotations: { readOnlyHint: true },
            },
            async (args) => this.invoke(() => globWorkspace(args)),
        );
        this.server.registerTool(
            "grep",
            {
                title: "Search workspace text",
                description:
                    "Search bounded text files under the current workspace using a regular expression or literal pattern.",
                inputSchema: z.object({
                    pattern: z.string(),
                    paths: z.array(z.string()).optional(),
                    include: z.array(z.string()).optional(),
                    literal: z.boolean().optional(),
                    contextLines: z.number().int().nonnegative().optional(),
                    maxResults: z.number().int().positive().optional(),
                }),
                annotations: { readOnlyHint: true },
            },
            async (args) => this.invoke(() => grepWorkspace(args)),
        );
        this.server.registerTool(
            "fetch",
            {
                title: "Fetch public text URL",
                description:
                    "Fetch bounded public HTTP or HTTPS text without cookies, credentials, or private-network access.",
                inputSchema: z.object({
                    url: z.string(),
                    maxBytes: z.number().int().positive().optional(),
                    acceptedContentTypes: z.array(z.string()).optional(),
                }),
                annotations: { readOnlyHint: true },
            },
            async (args) => this.invoke(() => fetchWorkspaceUrl(args)),
        );
    }

    private async invoke(
        operation: () => Promise<unknown>,
    ): Promise<CallToolResult> {
        if (getMode() === "bypass") {
            return toolError("TypeAgent is disabled in bypass mode.");
        }
        try {
            return toolResult(await operation());
        } catch (error) {
            return toolError(error);
        }
    }
}
