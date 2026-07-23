// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import {
    createMessageConnection,
    StreamMessageReader,
    StreamMessageWriter,
    type MessageConnection,
} from "vscode-jsonrpc/node.js";
import {
    languageIdForPath,
    resolveLanguageServerCandidates,
    type LanguageServerCommand,
    type LanguageServerDefinition,
    type LanguageServerFiles,
    type LanguageServerOptions,
} from "./languageServerRegistry.js";

export {
    createDefaultLanguageServers,
    languageIdForPath,
    resolveLanguageServerCandidates,
    type DefaultLanguageServerCommands,
    type LanguageServerCandidate,
    type LanguageServerCommand,
    type LanguageServerDefinition,
    type LanguageServerFiles,
} from "./languageServerRegistry.js";

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESULTS = 20;
const MAX_RESULTS = 50;
const MAX_STDERR_CHARS = 4_000;

export type { LanguageServerOptions };

export interface LspRequest {
    method: "definition" | "references";
    path: string;
    line: number;
    symbol: string;
    maxResults?: number;
}

export interface LspLocation {
    path: string;
    startLine: number;
    startCharacter: number;
    endLine: number;
    endCharacter: number;
}

export interface LanguageServerManager {
    navigate(request: LspRequest): Promise<{
        locations: LspLocation[];
        serverId: string;
        languageId: string;
    }>;
    close(): Promise<void>;
}

export function defaultTypeScriptLanguageServerCommand(): LanguageServerCommand {
    const require = createRequire(import.meta.url);
    const packageJson = require.resolve(
        "typescript-language-server/package.json",
    );
    return {
        command: process.execPath,
        args: [
            path.join(path.dirname(packageJson), "lib", "cli.mjs"),
            "--stdio",
        ],
    };
}

interface Position {
    line: number;
    character: number;
}

interface Range {
    start: Position;
    end: Position;
}

export function createLanguageServerManager(
    repoRoot: string,
    files: LanguageServerFiles,
    options: LanguageServerOptions,
): LanguageServerManager {
    const clients = new Map<string, LanguageServerClient>();
    const broken = new Set<string>();
    const requestTimeoutMs = boundedInteger(
        options.requestTimeoutMs,
        DEFAULT_REQUEST_TIMEOUT_MS,
        1_000,
        60_000,
        "requestTimeoutMs",
    );

    return { navigate, close };

    async function navigate(request: LspRequest): Promise<{
        locations: LspLocation[];
        serverId: string;
        languageId: string;
    }> {
        const relativePath = normalizeRelativePath(request.path);
        const text = files.get(relativePath);
        if (text === undefined) {
            throw new Error(
                `File is not available to repository tools: ${relativePath}`,
            );
        }
        const lines = text.split(/\r?\n/);
        const line = boundedInteger(
            request.line,
            undefined,
            1,
            lines.length,
            "line",
        );
        const symbol = validateSymbol(request.symbol);
        const position = resolveSymbolPosition(lines, line - 1, symbol);
        if (!position) {
            throw new Error(
                `symbol ${JSON.stringify(symbol)} is not present within 3 lines of ${relativePath}:${line}`,
            );
        }
        const maxResults = boundedInteger(
            request.maxResults,
            DEFAULT_MAX_RESULTS,
            1,
            MAX_RESULTS,
            "maxResults",
        );
        const candidates = resolveLanguageServerCandidates(
            relativePath,
            files,
            options.servers,
        );
        if (candidates.length === 0) {
            throw new Error(
                `No configured language server supports repository path: ${relativePath}`,
            );
        }
        const startupErrors: string[] = [];
        for (const candidate of candidates) {
            const key = `${candidate.server.id}\0${candidate.root}`;
            if (broken.has(key)) {
                continue;
            }
            let client = clients.get(key);
            if (!client) {
                const workspaceRoot = candidate.root
                    ? path.join(repoRoot, candidate.root)
                    : repoRoot;
                client = new LanguageServerClient(
                    repoRoot,
                    workspaceRoot,
                    candidate.server,
                    files,
                    requestTimeoutMs,
                );
                clients.set(key, client);
                try {
                    await client.readyForRequests();
                } catch (error) {
                    clients.delete(key);
                    broken.add(key);
                    await client.close();
                    startupErrors.push(
                        `${candidate.server.id}: ${error instanceof Error ? error.message : String(error)}`,
                    );
                    continue;
                }
            }
            return {
                locations: await client.navigate(
                    request.method,
                    relativePath,
                    position,
                    maxResults,
                ),
                serverId: candidate.server.id,
                languageId: languageIdForPath(relativePath),
            };
        }
        throw new Error(
            `No language server could start for ${relativePath}${startupErrors.length > 0 ? `: ${startupErrors.join("; ")}` : ""}`,
        );
    }

    async function close(): Promise<void> {
        const closing = [...clients.values()].map((client) => client.close());
        clients.clear();
        const results = await Promise.allSettled(closing);
        const errors = results.flatMap((result) =>
            result.status === "rejected" ? [result.reason] : [],
        );
        if (errors.length > 0) {
            throw new AggregateError(
                errors,
                "Failed to close language servers",
            );
        }
    }
}

class LanguageServerClient {
    private child: ChildProcessWithoutNullStreams | undefined;
    private connection: MessageConnection | undefined;
    private ready: Promise<void> | undefined;
    private readonly opened = new Set<string>();
    private stderr = "";
    private closing = false;

    constructor(
        private readonly repoRoot: string,
        private readonly workspaceRoot: string,
        private readonly server: LanguageServerDefinition,
        private readonly files: LanguageServerFiles,
        private readonly timeoutMs: number,
    ) {
        if (!server.command.command.trim()) {
            throw new Error(`${server.id} language server command is empty`);
        }
    }

    public readyForRequests(): Promise<void> {
        return this.ensureReady();
    }

    public async navigate(
        method: LspRequest["method"],
        relativePath: string,
        position: Position,
        maxResults: number,
    ): Promise<LspLocation[]> {
        await this.ensureReady();
        await this.openDocument(relativePath);
        const connection = this.connection!;
        const uri = pathToFileURL(path.join(this.repoRoot, relativePath)).href;
        const result = await withTimeout(
            method === "definition"
                ? connection.sendRequest("textDocument/definition", {
                      textDocument: { uri },
                      position,
                  })
                : connection.sendRequest("textDocument/references", {
                      textDocument: { uri },
                      position,
                      context: { includeDeclaration: true },
                  }),
            this.timeoutMs,
            `${this.server.id} language server ${method} timed out`,
        );
        return normalizeLocations(
            result,
            this.repoRoot,
            this.files,
            maxResults,
        );
    }

    public async close(): Promise<void> {
        if (this.closing) {
            return;
        }
        this.closing = true;
        const child = this.child;
        const connection = this.connection;
        if (!child || !connection) {
            return;
        }
        try {
            if (!hasExited(child)) {
                if (!canWrite(child)) {
                    throw new Error(
                        `${this.server.id} language server input is closed`,
                    );
                }
                await withTimeout(
                    connection.sendRequest("shutdown"),
                    2_000,
                    `${this.server.id} language server shutdown timed out`,
                );
                connection.sendNotification("exit");
                if (!(await waitForExit(child, 2_000))) {
                    throw new Error(
                        `${this.server.id} language server did not exit after shutdown`,
                    );
                }
            }
        } catch {
            if (child.pid !== undefined && !hasExited(child)) {
                child.kill("SIGTERM");
                if (!(await waitForExit(child, 1_000))) {
                    child.kill("SIGKILL");
                    await waitForExit(child, 1_000);
                }
            }
        } finally {
            connection.dispose();
            this.connection = undefined;
            this.child = undefined;
        }
    }

    private ensureReady(): Promise<void> {
        this.ready ??= this.start();
        return this.ready;
    }

    private async start(): Promise<void> {
        const child = spawn(
            this.server.command.command,
            this.server.command.args,
            {
                cwd: this.workspaceRoot,
                env: {
                    ...process.env,
                    ...this.server.command.env,
                    PYTHONUNBUFFERED: "1",
                },
                stdio: ["pipe", "pipe", "pipe"],
            },
        );
        this.child = child;
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk: string) => {
            this.stderr = `${this.stderr}${chunk}`.slice(-MAX_STDERR_CHARS);
        });
        await withTimeout(
            waitForSpawn(child),
            this.timeoutMs,
            `${this.server.id} language server process start timed out`,
        );
        const connection = createMessageConnection(
            new StreamMessageReader(child.stdout),
            new StreamMessageWriter(child.stdin),
        );
        this.connection = connection;
        connection.onRequest("window/workDoneProgress/create", () => null);
        connection.onRequest("workspace/workspaceFolders", () => [
            {
                name: path.basename(this.workspaceRoot),
                uri: pathToFileURL(this.workspaceRoot).href,
            },
        ]);
        connection.onRequest("workspace/configuration", (request) => {
            const items =
                isRecord(request) && Array.isArray(request.items)
                    ? request.items
                    : [];
            return items.map((item) =>
                isRecord(item) && typeof item.section === "string"
                    ? configurationValue(
                          this.server.configuration ??
                              this.server.initialization,
                          item.section,
                      )
                    : (this.server.configuration ??
                      this.server.initialization ??
                      null),
            );
        });
        connection.onRequest("client/registerCapability", () => null);
        connection.onRequest("client/unregisterCapability", () => null);
        connection.listen();
        await withTimeout(
            Promise.race([
                connection.sendRequest("initialize", {
                    processId: process.pid,
                    clientInfo: {
                        name: "typeagent-explorer",
                        version: "0.1.0",
                    },
                    rootUri: pathToFileURL(this.workspaceRoot).href,
                    workspaceFolders: [
                        {
                            uri: pathToFileURL(this.workspaceRoot).href,
                            name: path.basename(this.workspaceRoot),
                        },
                    ],
                    capabilities: {
                        workspace: { workspaceFolders: true },
                        textDocument: {
                            definition: { linkSupport: true },
                            references: {},
                            synchronization: { didSave: false },
                        },
                    },
                    initializationOptions: {
                        preferences: {
                            disableAutomaticTypeAcquisition: true,
                        },
                        ...this.server.initialization,
                    },
                }),
                processFailure(child, () => this.stderr),
            ]),
            this.timeoutMs,
            `${this.server.id} language server initialization timed out`,
        );
        connection.sendNotification("initialized", {});
        if (this.server.configuration) {
            connection.sendNotification("workspace/didChangeConfiguration", {
                settings: this.server.configuration,
            });
        }
    }

    private async openDocument(relativePath: string): Promise<void> {
        if (this.opened.has(relativePath)) {
            return;
        }
        const text = this.files.get(relativePath);
        if (text === undefined) {
            throw new Error(
                `File is not available to repository tools: ${relativePath}`,
            );
        }
        this.connection!.sendNotification("textDocument/didOpen", {
            textDocument: {
                uri: pathToFileURL(path.join(this.repoRoot, relativePath)).href,
                languageId: languageIdForPath(relativePath),
                version: 1,
                text,
            },
        });
        this.opened.add(relativePath);
    }
}

function normalizeLocations(
    raw: unknown,
    repoRoot: string,
    files: LanguageServerFiles,
    maxResults: number,
): LspLocation[] {
    const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const locations = values.flatMap((value) => {
        if (!isRecord(value)) {
            return [];
        }
        const uri =
            typeof value.uri === "string"
                ? value.uri
                : typeof value.targetUri === "string"
                  ? value.targetUri
                  : undefined;
        const range = isRange(value.range)
            ? value.range
            : isRange(value.targetRange)
              ? value.targetRange
              : undefined;
        if (!uri || !range || !uri.startsWith("file:")) {
            return [];
        }
        let absolutePath;
        try {
            absolutePath = fileURLToPath(uri);
        } catch {
            return [];
        }
        const relativePath = path.relative(repoRoot, absolutePath);
        if (
            !relativePath ||
            relativePath.startsWith(`..${path.sep}`) ||
            path.isAbsolute(relativePath)
        ) {
            return [];
        }
        const normalized = relativePath.split(path.sep).join("/");
        if (!files.has(normalized)) {
            return [];
        }
        return [
            {
                path: normalized,
                startLine: range.start.line + 1,
                startCharacter: range.start.character + 1,
                endLine: range.end.line + 1,
                endCharacter: range.end.character + 1,
            },
        ];
    });
    const unique = new Map(
        locations.map((location) => [JSON.stringify(location), location]),
    );
    return [...unique.values()]
        .sort(
            (left, right) =>
                left.path.localeCompare(right.path) ||
                left.startLine - right.startLine ||
                left.startCharacter - right.startCharacter,
        )
        .slice(0, maxResults);
}

function normalizeRelativePath(value: string): string {
    const trimmed = value.trim();
    if (
        !trimmed ||
        trimmed.includes("\0") ||
        trimmed.includes("\\") ||
        path.posix.isAbsolute(trimmed) ||
        /^[A-Za-z]:/.test(trimmed) ||
        trimmed.split("/").includes("..")
    ) {
        throw new Error("LSP paths must be relative POSIX file paths");
    }
    return path.posix.normalize(trimmed).replace(/^\.\//, "");
}

function validateSymbol(value: string): string {
    const symbol = value.trim();
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(symbol)) {
        throw new Error("LSP symbol must be one source identifier");
    }
    return symbol;
}

function resolveSymbolPosition(
    lines: string[],
    lineHint: number,
    symbol: string,
): Position | undefined {
    for (let distance = 0; distance <= 3; distance += 1) {
        const candidates =
            distance === 0
                ? [lineHint]
                : [lineHint - distance, lineHint + distance];
        for (const line of candidates) {
            if (line < 0 || line >= lines.length) {
                continue;
            }
            const character = lines[line].indexOf(symbol);
            if (character >= 0) {
                return { line, character };
            }
        }
    }
    return undefined;
}

function processFailure(
    child: ChildProcessWithoutNullStreams,
    stderr: () => string,
): Promise<never> {
    return new Promise((_, reject) => {
        if (hasExited(child)) {
            reject(startupExitError(child, stderr()));
            return;
        }
        child.once("error", reject);
        child.once("exit", (code, signal) => {
            reject(startupExitError(child, stderr(), code, signal));
        });
    });
}

function waitForSpawn(child: ChildProcessWithoutNullStreams): Promise<void> {
    return new Promise((resolve, reject) => {
        const onSpawn = () => {
            cleanup();
            resolve();
        };
        const onError = (error: Error) => {
            cleanup();
            reject(error);
        };
        const cleanup = () => {
            child.off("spawn", onSpawn);
            child.off("error", onError);
        };
        child.once("spawn", onSpawn);
        child.once("error", onError);
    });
}

function startupExitError(
    child: ChildProcessWithoutNullStreams,
    stderr: string,
    code = child.exitCode,
    signal = child.signalCode,
): Error {
    return new Error(
        `Language server exited during startup: code=${code ?? "none"} signal=${signal ?? "none"}${stderr.trim() ? `: ${stderr.trim()}` : ""}`,
    );
}

function waitForExit(
    child: ChildProcessWithoutNullStreams,
    timeoutMs: number,
): Promise<boolean> {
    if (hasExited(child)) {
        return Promise.resolve(true);
    }
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), timeoutMs);
        child.once("exit", () => {
            clearTimeout(timer);
            resolve(true);
        });
    });
}

function hasExited(child: ChildProcessWithoutNullStreams): boolean {
    return child.exitCode !== null || child.signalCode !== null;
}

function canWrite(child: ChildProcessWithoutNullStreams): boolean {
    return (
        child.stdin.writable &&
        !child.stdin.destroyed &&
        !child.stdin.writableEnded
    );
}

function withTimeout<T>(
    operation: Promise<T>,
    timeoutMs: number,
    message: string,
): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
        operation.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (error) => {
                clearTimeout(timer);
                reject(error);
            },
        );
    });
}

function configurationValue(
    settings: Record<string, unknown> | undefined,
    section: string,
): unknown {
    return section.split(".").reduce<unknown>((value, key) => {
        if (!isRecord(value) || !(key in value)) {
            return null;
        }
        return value[key];
    }, settings ?? null);
}

function boundedInteger(
    value: number | undefined,
    fallback: number | undefined,
    minimum: number,
    maximum: number,
    name: string,
): number {
    const result = value ?? fallback;
    if (
        result === undefined ||
        !Number.isSafeInteger(result) ||
        result < minimum ||
        result > maximum
    ) {
        throw new Error(
            `${name} must be an integer between ${minimum} and ${maximum}`,
        );
    }
    return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRange(value: unknown): value is Range {
    return isRecord(value) && isPosition(value.start) && isPosition(value.end);
}

function isPosition(value: unknown): value is Position {
    return (
        isRecord(value) &&
        Number.isSafeInteger(value.line) &&
        Number.isSafeInteger(value.character) &&
        (value.line as number) >= 0 &&
        (value.character as number) >= 0
    );
}
