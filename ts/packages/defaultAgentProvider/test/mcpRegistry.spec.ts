// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
    createMcpRegistryClient,
    type RegistryServerEntry,
} from "../src/installSources/mcpRegistryClient.js";
import {
    mergeRegistryCache,
    type RegistryCacheData,
} from "../src/installSources/mcpRegistryCache.js";
import { registryEntryToCandidate } from "../src/installSources/mcpRegistryDescriptor.js";
import {
    cleanupOwnedMcpPaths,
    materializeRegistryNpmPackage,
} from "../src/installSources/mcpRegistryMaterializer.js";
import { createMcpRegistrySource } from "../src/installSources/mcpRegistrySource.js";

function entry(
    overrides: Partial<RegistryServerEntry> = {},
): RegistryServerEntry {
    return {
        server: {
            name: "io.example/weather",
            title: "Weather",
            description: "Weather tools",
            version: "1.2.3",
            remotes: [
                {
                    type: "streamable-http",
                    url: "https://example.test/{tenant}/mcp",
                    variables: {
                        tenant: { value: "{tenant}", isRequired: true },
                    },
                    headers: [
                        {
                            name: "Authorization",
                            value: "Bearer {token}",
                            variables: {
                                token: { isSecret: true, isRequired: true },
                            },
                        },
                    ],
                },
            ],
        },
        meta: {
            status: "active",
            publishedAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-02T00:00:00Z",
            isLatest: true,
        },
        ...overrides,
    };
}

function response(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
    });
}

function apiEntry(value = entry()): object {
    return {
        server: value.server,
        _meta: {
            "io.modelcontextprotocol.registry/official": value.meta,
        },
    };
}

describe("MCP Registry v0.1 client", () => {
    it("paginates search/latest/updated_since and bounds page count", async () => {
        const urls: string[] = [];
        const fetchFn: typeof fetch = async (input) => {
            urls.push(String(input));
            return response({
                servers: [apiEntry()],
                metadata:
                    urls.length === 1
                        ? { count: 1, nextCursor: "next/value" }
                        : { count: 1 },
            });
        };
        const client = createMcpRegistryClient(
            "https://registry.example/",
            fetchFn,
        );
        await expect(
            client.list({
                search: "weather server",
                version: "latest",
                updatedSince: "2026-01-01T00:00:00.000Z",
                maxPages: 2,
            }),
        ).resolves.toHaveLength(2);
        expect(urls[0]).toContain("search=weather+server");
        expect(urls[0]).toContain("version=latest");
        expect(urls[0]).toContain("updated_since=2026-01-01T00%3A00%3A00.000Z");
        expect(urls[1]).toContain("cursor=next%2Fvalue");
    });

    it("URL-encodes exact server and version path segments", async () => {
        let requested = "";
        const client = createMcpRegistryClient(
            "https://registry.example/",
            async (input) => {
                requested = String(input);
                return response(apiEntry());
            },
        );
        await client.get("io.example/name with space", "1.0.0+build");
        expect(requested).toContain(
            "/io.example%2Fname%20with%20space/versions/1.0.0%2Bbuild",
        );
    });

    it("rejects malformed response shapes", async () => {
        const client = createMcpRegistryClient(
            "https://registry.example/",
            async () => response({ servers: "wrong", metadata: {} }),
        );
        await expect(client.list()).rejects.toThrow(/invalid servers list/);
    });
});

describe("MCP Registry cache/source", () => {
    it("merges incremental deletions without exposing deleted entries", () => {
        expect(
            mergeRegistryCache(
                [entry()],
                [
                    entry({
                        meta: {
                            ...entry().meta,
                            status: "deleted",
                        },
                    }),
                ],
            ),
        ).toEqual([]);
    });

    it("replaces a cached latest version during incremental refresh", () => {
        const next = entry({
            server: { ...entry().server, version: "2.0.0" },
        });
        expect(mergeRegistryCache([entry()], [next])).toEqual([next]);
    });

    it("keeps the previous cache when refresh fails", async () => {
        const cached: RegistryCacheData = {
            fetchedAt: 1,
            updatedSince: "2026-01-01T00:00:00.000Z",
            entries: [entry()],
        };
        let writes = 0;
        const source = createMcpRegistrySource(
            {
                kind: "registry",
                name: "official",
                baseUrl: "https://registry.example/",
                cacheTtlMs: 1,
            },
            {
                installDir: process.cwd(),
                now: () => 10,
                client: {
                    list: async () => {
                        throw new Error("offline");
                    },
                    get: async () => undefined,
                },
                cacheStorage: {
                    read: () => cached,
                    write: () => {
                        writes++;
                    },
                },
            },
        );
        await expect(source.refresh?.()).rejects.toThrow("offline");
        expect(writes).toBe(0);
        await expect(source.listAgents?.()).resolves.toHaveLength(1);
    });

    it("warns for deprecated and drops unsupported entries per row", async () => {
        const deprecated = entry({
            meta: {
                ...entry().meta,
                status: "deprecated",
                statusMessage: "use v2",
            },
        });
        const unsupported = entry({
            server: {
                ...entry().server,
                name: "io.example/python",
                remotes: undefined,
                packages: [
                    {
                        registryType: "pypi",
                        identifier: "thing",
                        version: "1",
                        transport: { type: "stdio" },
                    },
                ],
            },
        });
        const warnings: string[] = [];
        const source = createMcpRegistrySource(
            {
                kind: "registry",
                name: "official",
                baseUrl: "https://registry.example/",
            },
            {
                installDir: process.cwd(),
                now: () => 1,
                client: {
                    list: async () => [deprecated, unsupported],
                    get: async () => undefined,
                },
                cacheStorage: {
                    read: () => undefined,
                    write: () => {},
                },
            },
        );
        const rows = await source.listAgents?.((warning) =>
            warnings.push(warning),
        );
        expect(rows).toHaveLength(1);
        expect(rows?.[0].description).toContain("DEPRECATED");
        expect(warnings.join("\n")).toMatch(/deprecated.*pypi/is);
    });
});

describe("MCP Registry descriptor conversion/materialization", () => {
    const roots: string[] = [];
    afterEach(() => {
        for (const root of roots.splice(0)) {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    function installDir(): string {
        const root = fs.mkdtempSync(
            path.join(process.cwd(), ".mcp-registry-test-"),
        );
        roots.push(root);
        return root;
    }

    it("builds stable HTTP candidates with provenance and input references", () => {
        const candidate = registryEntryToCandidate(
            entry(),
            "official",
            "https://registry.example/",
            { installDir: installDir() },
        );
        expect(candidate.config.id).toBe("mcp:official:io.example%2Fweather");
        expect(candidate.config.provenance).toMatchObject({
            registryBaseUrl: "https://registry.example/",
            canonicalServerName: "io.example/weather",
            serverVersion: "1.2.3",
            transportType: "streamable-http",
        });
        expect(candidate.config.transport).toMatchObject({
            kind: "http",
            timeoutMs: 30000,
            headers: {
                Authorization: {
                    value: "Bearer {token}",
                    variables: {
                        token: { kind: "input", name: "token" },
                    },
                },
            },
        });
    });

    it("URL-encodes scoped npm package names when resolving metadata", async () => {
        const dir = installDir();
        let requested: string | undefined;
        await expect(
            materializeRegistryNpmPackage(
                registryEntryToCandidate(
                    entry(),
                    "official",
                    "https://registry.example/",
                    { installDir: dir },
                ).config,
                {
                    registryType: "npm",
                    identifier: "@example/weather-mcp",
                    version: "1.2.3",
                    transport: { type: "stdio" },
                },
                "a".repeat(64),
                {
                    installDir: dir,
                    fetchFn: async (input) => {
                        requested = String(input);
                        return response({}, 404);
                    },
                },
            ),
        ).rejects.toThrow(/Could not resolve npm package/);
        expect(requested).toBe(
            "https://registry.npmjs.org/@example%2Fweather-mcp",
        );
    });

    it("materializes exact npm content, verifies hash, and builds argv", async () => {
        const dir = installDir();
        const bytes = Buffer.from("package tar bytes");
        const hash = crypto.createHash("sha256").update(bytes).digest("hex");
        const pkg = {
            registryType: "npm",
            identifier: "weather-mcp",
            version: "1.2.3",
            fileSha256: hash,
            runtimeHint: "npx",
            runtimeArguments: [{ type: "named", name: "--yes", value: "true" }],
            packageArguments: [
                { type: "named", name: "--port", value: "8080" },
            ],
            environmentVariables: [{ name: "TOKEN", isSecret: true }],
            transport: { type: "stdio" },
        };
        const candidate = registryEntryToCandidate(
            entry({
                server: {
                    ...entry().server,
                    remotes: undefined,
                    packages: [pkg],
                },
            }),
            "official",
            "https://registry.example/",
            { installDir: dir },
        );
        const config = await materializeRegistryNpmPackage(
            candidate.config,
            pkg,
            candidate.config.provenance.digest!,
            {
                installDir: dir,
                randomId: () => "fixed",
                npxCliPath: "C:\\npm\\npx-cli.js",
                fetchFn: async (input) =>
                    String(input).endsWith(".tgz")
                        ? new Response(bytes)
                        : response({
                              versions: {
                                  "1.2.3": {
                                      dist: {
                                          tarball:
                                              "https://registry.example/pkg.tgz",
                                      },
                                  },
                              },
                          }),
                npmInstall: async ({ cwd }) => {
                    const pkgDir = path.join(
                        cwd,
                        "node_modules",
                        "weather-mcp",
                    );
                    fs.mkdirSync(path.join(pkgDir, "dist"), {
                        recursive: true,
                    });
                    fs.writeFileSync(
                        path.join(pkgDir, "package.json"),
                        JSON.stringify({
                            name: "weather-mcp",
                            version: "1.2.3",
                            bin: "dist/cli.js",
                        }),
                    );
                    fs.writeFileSync(path.join(pkgDir, "dist", "cli.js"), "");
                },
            },
        );
        expect(config.provenance.packageHash).toBe(hash);
        expect(config.provenance.ownedPaths).toHaveLength(1);
        expect(config.transport).toMatchObject({
            kind: "stdio",
            command: process.execPath,
            env: { TOKEN: { kind: "input", name: "TOKEN" } },
        });
        if (config.transport.kind === "stdio") {
            expect(config.transport.args).toEqual(
                expect.arrayContaining([
                    "C:\\npm\\npx-cli.js",
                    "--yes",
                    "--offline",
                    "--no-install",
                    "weather-mcp",
                    "--port",
                    "8080",
                ]),
            );
        }
        cleanupOwnedMcpPaths(dir, config.provenance.ownedPaths);
        expect(fs.existsSync(config.provenance.ownedPaths![0])).toBe(false);
    });

    it("rejects hash mismatch and arbitrary cleanup paths", async () => {
        const dir = installDir();
        const config = registryEntryToCandidate(
            entry(),
            "official",
            "https://registry.example/",
            { installDir: dir },
        ).config;
        await expect(
            materializeRegistryNpmPackage(
                config,
                {
                    registryType: "npm",
                    identifier: "bad",
                    version: "1.0.0",
                    fileSha256: "0".repeat(64),
                    transport: { type: "stdio" },
                },
                "a".repeat(64),
                {
                    installDir: dir,
                    fetchFn: async (input) =>
                        String(input).endsWith(".tgz")
                            ? new Response("wrong")
                            : response({
                                  versions: {
                                      "1.0.0": {
                                          dist: {
                                              tarball:
                                                  "https://registry.example/bad.tgz",
                                          },
                                      },
                                  },
                              }),
                },
            ),
        ).rejects.toThrow(/SHA-256 mismatch/);
        expect(() =>
            cleanupOwnedMcpPaths(dir, [path.join(dir, "not-mcp")]),
        ).toThrow(/Invalid owned MCP install path/);
    });
});
