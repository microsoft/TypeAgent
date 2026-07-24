// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { afterEach, describe, expect, it } from "@jest/globals";
import {
    mkdir,
    mkdtemp,
    readFile,
    realpath,
    rm,
    writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
    createDefaultLanguageServers,
    createLanguageServerManager,
    defaultTypeScriptLanguageServerCommand,
    type LanguageServerDefinition,
    type LanguageServerFiles,
    type LanguageServerOptions,
} from "../src/script/languageServer.js";
import { createRepositoryTools } from "../src/script/repositoryApi.js";
import { generateSandboxDeclarations } from "../src/script/sandboxDeclarations.js";
import { validateExploreScript } from "../src/script/scriptValidator.js";

describe("repository language server", () => {
    const tempDirs: string[] = [];

    afterEach(async () => {
        await Promise.all(
            tempDirs
                .splice(0)
                .map((directory) =>
                    rm(directory, { recursive: true, force: true }),
                ),
        );
    });

    it("resolves TypeScript definitions through the real language server", async () => {
        const repoRoot = await makeFixture();
        const tools = await createRepositoryTools({
            repoRoot,
            maxCalls: 3,
            lsp: languageServers(),
        });
        try {
            const locations = await tools.api.lsp!({
                method: "definition",
                path: "src/main.ts",
                line: 12,
                symbol: "target",
            });

            expect(locations).toEqual([
                expect.objectContaining({
                    path: "src/main.ts",
                    startLine: 1,
                }),
            ]);
            expect(tools.trace).toMatchObject({
                totalCalls: 1,
                calls: [
                    {
                        tool: "lsp",
                        input: expect.objectContaining({
                            serverId: "typescript",
                            languageId: "typescript",
                        }),
                        resultCount: 1,
                    },
                ],
            });
            expect(tools.observations).toEqual([]);
            await expect(
                tools.api.lsp!({
                    method: "definition",
                    path: "src/main.ts",
                    line: 5,
                    symbol: "missingSymbol",
                }),
            ).resolves.toEqual([]);
            expect(tools.trace.calls.at(-1)).toMatchObject({
                tool: "lsp",
                resultCount: 0,
                error: expect.stringMatching(/not present/i),
            });
        } finally {
            await tools.close();
        }
    }, 30_000);

    it("dispatches Python through a generic server rooted at its nearest project", async () => {
        const fixture = await makeFakeFixture();
        const server = fakeServer(fixture, "python-fake", [".py"]);
        const manager = createLanguageServerManager(
            fixture.repoRoot,
            fixture.files,
            { servers: [server], requestTimeoutMs: 5_000 },
        );
        try {
            await expect(
                manager.navigate({
                    method: "definition",
                    path: "packages/app/src/main.py",
                    line: 4,
                    symbol: "target",
                }),
            ).resolves.toEqual({
                locations: [
                    {
                        path: "packages/app/src/target.py",
                        startLine: 1,
                        startCharacter: 1,
                        endLine: 1,
                        endCharacter: 7,
                    },
                ],
                serverId: "python-fake",
                languageId: "python",
            });
        } finally {
            await manager.close();
        }

        const events = await readEvents(fixture.logFile);
        const projectRoot = path.join(fixture.repoRoot, "packages/app");
        expect(events).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    event: "initialize",
                    cwd: await realpath(projectRoot),
                    rootUri: pathToFileURL(projectRoot).href,
                }),
                expect.objectContaining({
                    event: "didOpen",
                    languageId: "python",
                    uri: pathToFileURL(
                        path.join(fixture.repoRoot, "packages/app/src/main.py"),
                    ).href,
                }),
                { event: "shutdown" },
                { event: "exit" },
            ]),
        );
    });

    it("suppresses a broken backend and falls back without restarting it", async () => {
        const fixture = await makeFakeFixture();
        const attemptsFile = path.join(fixture.root, "failed-starts.txt");
        const broken: LanguageServerDefinition = {
            id: "broken-python",
            extensions: [".py"],
            rootMarkerGroups: [["pyproject.toml"]],
            requireRoot: true,
            command: {
                command: process.execPath,
                args: [
                    "-e",
                    `require("node:fs").appendFileSync(${JSON.stringify(attemptsFile)}, "attempt\\n"); process.stderr.write("intentional startup failure"); process.exit(23);`,
                ],
            },
        };
        const fallback = fakeServer(fixture, "fallback-python", [".py"]);
        const manager = createLanguageServerManager(
            fixture.repoRoot,
            fixture.files,
            { servers: [broken, fallback], requestTimeoutMs: 5_000 },
        );
        try {
            for (const method of ["definition", "references"] as const) {
                await expect(
                    manager.navigate({
                        method,
                        path: "packages/app/src/main.py",
                        line: 4,
                        symbol: "target",
                    }),
                ).resolves.toMatchObject({
                    serverId: "fallback-python",
                    languageId: "python",
                    locations: [
                        { path: "packages/app/src/target.py", startLine: 1 },
                    ],
                });
            }
        } finally {
            await manager.close();
        }

        expect(await readFile(attemptsFile, "utf8")).toBe("attempt\n");
        const events = await readEvents(fixture.logFile);
        expect(
            events.filter((event) => event.event === "initialize"),
        ).toHaveLength(1);
        expect(
            events.filter((event) => event.event === "definition"),
        ).toHaveLength(1);
        expect(
            events.filter((event) => event.event === "references"),
        ).toHaveLength(1);
    });

    it("falls back when a server executable cannot be spawned", async () => {
        const fixture = await makeFakeFixture();
        const missing: LanguageServerDefinition = {
            id: "missing-python",
            extensions: [".py"],
            rootMarkerGroups: [["pyproject.toml"]],
            requireRoot: true,
            command: {
                command: path.join(fixture.root, "missing-language-server"),
                args: [],
            },
        };
        const fallback = fakeServer(fixture, "fallback-python", [".py"]);
        const manager = createLanguageServerManager(
            fixture.repoRoot,
            fixture.files,
            { servers: [missing, fallback], requestTimeoutMs: 5_000 },
        );
        try {
            await expect(
                manager.navigate({
                    method: "definition",
                    path: "packages/app/src/main.py",
                    line: 4,
                    symbol: "target",
                }),
            ).resolves.toMatchObject({
                serverId: "fallback-python",
                languageId: "python",
                locations: [
                    { path: "packages/app/src/target.py", startLine: 1 },
                ],
            });
        } finally {
            await manager.close();
        }
    });

    it("keeps LSP declarations and validation out of the original arm", () => {
        const program = `async function execute(repo: RepositoryApi, params: ExploreParams): Promise<ExploreProgramResult> {
    await repo.lsp({ method: "definition", path: "src/main.ts", line: 5, symbol: "target" });
    return { success: params.maxResults > 0 };
}`;

        expect(generateSandboxDeclarations()).not.toContain("repo.lsp");
        expect(generateSandboxDeclarations(undefined, true)).toContain(
            "lsp(request: LspRequest)",
        );
        expect(validateExploreScript(program).valid).toBe(false);
        expect(validateExploreScript(program, true)).toEqual({
            valid: true,
            errors: [],
        });
    });

    async function makeFixture(): Promise<string> {
        const repoRoot = await mkdtemp(
            path.join(os.tmpdir(), "typeagent-lsp-tools-"),
        );
        tempDirs.push(repoRoot);
        await mkdir(path.join(repoRoot, "src"), { recursive: true });
        await writeFile(
            path.join(repoRoot, "src", "main.ts"),
            [
                "export function target() {",
                "    return 1;",
                "}",
                "",
                "export const value = target();",
                "// body clue 1",
                "// body clue 2",
                "// body clue 3",
                "// body clue 4",
                "// body clue 5",
                "// body clue 6",
                "// targetExtra body clue 7",
            ].join("\n"),
        );
        await writeFile(
            path.join(repoRoot, "tsconfig.json"),
            JSON.stringify({ compilerOptions: { strict: true } }),
        );
        return repoRoot;
    }

    function languageServers(): LanguageServerOptions {
        return {
            servers: createDefaultLanguageServers({
                typescript: defaultTypeScriptLanguageServerCommand(),
                python: {
                    command: process.execPath,
                    args: ["-e", "process.exit(1)"],
                },
            }),
        };
    }

    async function makeFakeFixture(): Promise<{
        root: string;
        repoRoot: string;
        serverFile: string;
        logFile: string;
        files: LanguageServerFiles;
    }> {
        const root = await mkdtemp(
            path.join(os.tmpdir(), "typeagent-fake-lsp-"),
        );
        tempDirs.push(root);
        const repoRoot = path.join(root, "repo");
        const projectRoot = path.join(repoRoot, "packages/app");
        const sourceRoot = path.join(projectRoot, "src");
        await mkdir(sourceRoot, { recursive: true });
        const sources = new Map([
            ["packages/app/pyproject.toml", "[project]\nname = 'fixture'\n"],
            [
                "packages/app/src/main.py",
                "from .target import target\n\n\nvalue = target()\n",
            ],
            ["packages/app/src/target.py", "def target():\n    return 1\n"],
        ]);
        await Promise.all(
            [...sources].map(async ([relativePath, text]) => {
                const file = path.join(repoRoot, relativePath);
                await mkdir(path.dirname(file), { recursive: true });
                await writeFile(file, text);
            }),
        );
        const serverFile = path.join(root, "fake-language-server.mjs");
        const logFile = path.join(root, "events.jsonl");
        await writeFile(serverFile, fakeLanguageServerSource);
        return {
            root,
            repoRoot,
            serverFile,
            logFile,
            files: {
                get: (relativePath) => sources.get(relativePath),
                has: (relativePath) => sources.has(relativePath),
                paths: () => [...sources.keys()],
            },
        };
    }

    function fakeServer(
        fixture: Awaited<ReturnType<typeof makeFakeFixture>>,
        id: string,
        extensions: string[],
    ): LanguageServerDefinition {
        return {
            id,
            extensions,
            rootMarkerGroups: [["pyproject.toml"]],
            requireRoot: true,
            command: {
                command: process.execPath,
                args: [fixture.serverFile],
                env: {
                    FAKE_LSP_LOG: fixture.logFile,
                    FAKE_LSP_TARGET: path.join(
                        fixture.repoRoot,
                        "packages/app/src/target.py",
                    ),
                },
            },
        };
    }

    async function readEvents(
        logFile: string,
    ): Promise<Array<Record<string, unknown>>> {
        return (await readFile(logFile, "utf8"))
            .trim()
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line) as Record<string, unknown>);
    }
});

const fakeLanguageServerSource = String.raw`
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

let buffer = Buffer.alloc(0);
const logFile = process.env.FAKE_LSP_LOG;
const target = process.env.FAKE_LSP_TARGET;

function log(value) {
    appendFileSync(logFile, JSON.stringify(value) + "\n");
}

function send(value) {
    const body = JSON.stringify(value);
    process.stdout.write(
        "Content-Length: " + Buffer.byteLength(body) + "\r\n\r\n" + body,
    );
}

function respond(id, result) {
    send({ jsonrpc: "2.0", id, result });
}

function location() {
    return {
        uri: pathToFileURL(target).href,
        range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 6 },
        },
    };
}

function handle(message) {
    if (message.method === "initialize") {
        log({
            event: "initialize",
            cwd: process.cwd(),
            rootUri: message.params.rootUri,
        });
        respond(message.id, { capabilities: {} });
        return;
    }
    if (message.method === "initialized") {
        log({ event: "initialized" });
        return;
    }
    if (message.method === "textDocument/didOpen") {
        log({
            event: "didOpen",
            languageId: message.params.textDocument.languageId,
            uri: message.params.textDocument.uri,
        });
        return;
    }
    if (message.method === "textDocument/definition") {
        log({ event: "definition" });
        respond(message.id, [location()]);
        return;
    }
    if (message.method === "textDocument/references") {
        log({ event: "references" });
        respond(message.id, [location()]);
        return;
    }
    if (message.method === "shutdown") {
        log({ event: "shutdown" });
        respond(message.id, null);
        return;
    }
    if (message.method === "exit") {
        log({ event: "exit" });
        setTimeout(() => process.exit(0), 10);
        return;
    }
    if (message.id !== undefined) {
        respond(message.id, null);
    }
}

process.stdin.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
        const headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd < 0) return;
        const header = buffer.subarray(0, headerEnd).toString("utf8");
        const match = /Content-Length:\s*(\d+)/i.exec(header);
        if (!match) process.exit(2);
        const length = Number(match[1]);
        const bodyStart = headerEnd + 4;
        const bodyEnd = bodyStart + length;
        if (buffer.length < bodyEnd) return;
        const message = JSON.parse(
            buffer.subarray(bodyStart, bodyEnd).toString("utf8"),
        );
        buffer = buffer.subarray(bodyEnd);
        handle(message);
    }
});
`;
