// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { afterEach, describe, expect, it } from "@jest/globals";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
    chunkRipgrepTargets,
    createRepositoryTools,
    ripgrepArgumentBudget,
    type RepositoryTools,
    type RepositoryToolsOptions,
} from "../src/script/repositoryApi.js";

describe("repository tools", () => {
    const execFileAsync = promisify(execFile);
    const tempDirs: string[] = [];
    const openTools: RepositoryTools[] = [];

    afterEach(async () => {
        await Promise.all(openTools.splice(0).map((tools) => tools.close()));
        await Promise.all(
            tempDirs
                .splice(0)
                .map((dir) => rm(dir, { recursive: true, force: true })),
        );
    });

    async function makeTools(
        options: RepositoryToolsOptions,
    ): Promise<RepositoryTools> {
        const tools = await createRepositoryTools(options);
        openTools.push(tools);
        return tools;
    }

    async function makeFixture(): Promise<string> {
        const root = await mkdtemp(
            path.join(os.tmpdir(), "typeagent-repository-tools-"),
        );
        tempDirs.push(root);
        const repoRoot = path.join(root, "repo");
        await mkdir(path.join(repoRoot, "src", "nested"), {
            recursive: true,
        });
        await mkdir(path.join(repoRoot, "node_modules", "ignored"), {
            recursive: true,
        });
        await writeFile(path.join(repoRoot, "README.md"), "fixture root\n");
        await writeFile(
            path.join(repoRoot, "src", "auth.ts"),
            [
                "export function authenticate(token: string) {",
                "    return verifyJwtSignature(token);",
                "}",
                "const literal = 'a.*b';",
            ].join("\n"),
        );
        await writeFile(
            path.join(repoRoot, "src", "nested", "token.ts"),
            "export const token = 'valid';\n",
        );
        await writeFile(path.join(repoRoot, ".env"), "JWT_SECRET=hidden\n");
        await writeFile(
            path.join(repoRoot, "node_modules", "ignored", "auth.ts"),
            "export const dependencyMarker = 'authenticate';\n",
        );
        return repoRoot;
    }

    it("lists, searches, and reads deterministic filtered repository content", async () => {
        const repoRoot = await makeFixture();
        const { api, trace, observations } = await makeTools({
            repoRoot,
        });

        await expect(api.ls(undefined, { depth: 1 })).resolves.toEqual([
            "README.md",
        ]);
        await expect(api.ls("src", { depth: 2 })).resolves.toEqual([
            "src/auth.ts",
            "src/nested/token.ts",
        ]);
        await expect(api.grep("authenticate")).resolves.toEqual([
            {
                path: "src/auth.ts",
                line: 1,
                text: "export function authenticate(token: string) {",
            },
        ]);
        await expect(
            api.read("src/auth.ts", { offset: 1, limit: 2 }),
        ).resolves.toBe("2\t    return verifyJwtSignature(token);\n3\t}");

        expect(trace.totalCalls).toBe(4);
        expect(trace.totalOutputBytes).toBeGreaterThan(0);
        expect(trace.calls.map((call) => call.tool)).toEqual([
            "ls",
            "ls",
            "grep",
            "read",
        ]);
        expect(trace.calls[2].input).toMatchObject({
            engine: "ripgrep",
        });
        expect(trace.calls[2].input.ripgrepPath).toMatch(
            /(?:^|[/\\])rg(?:[.]exe)?$/,
        );
        expect(trace.calls.every((call) => call.error === undefined)).toBe(
            true,
        );
        expect(() => JSON.parse(JSON.stringify(trace))).not.toThrow();
        expect(JSON.stringify(trace)).not.toContain("JWT_SECRET");
        expect(observations).toEqual([
            {
                source: "grep",
                callIndex: 2,
                path: "src/auth.ts",
                startLine: 1,
                endLine: 1,
                lines: ["export function authenticate(token: string) {"],
            },
            {
                source: "read",
                callIndex: 3,
                path: "src/auth.ts",
                startLine: 2,
                endLine: 3,
                lines: ["    return verifyJwtSignature(token);", "}"],
            },
        ]);
    });

    it("allows multiple concurrent searches without exceeding the call budget", async () => {
        const repoRoot = await makeFixture();
        const { api, trace } = await makeTools({
            repoRoot,
            maxCalls: 3,
        });

        const results = await Promise.all(
            Array.from({ length: 8 }, () => api.grep("authenticate")),
        );

        expect(results.filter((matches) => matches.length > 0)).toHaveLength(3);
        expect(trace.totalCalls).toBe(3);
        expect(trace.calls).toHaveLength(3);
    });

    it("supports standard brace-alternative globs used by Code Mode", async () => {
        const repoRoot = await makeFixture();
        const { api } = await makeTools({ repoRoot });

        await expect(
            api.grep("authenticate|fixture", {
                glob: "**/*.{ts,md}",
            }),
        ).resolves.toEqual([
            {
                path: "src/auth.ts",
                line: 1,
                text: "export function authenticate(token: string) {",
            },
            {
                path: "README.md",
                line: 1,
                text: "fixture root",
            },
        ]);
    });

    it("globs deterministic bounded repository-relative file paths", async () => {
        const repoRoot = await makeFixture();
        const { api, trace } = await makeTools({ repoRoot });

        await expect(api.glob("*.ts")).resolves.toEqual([
            "src/auth.ts",
            "src/nested/token.ts",
        ]);
        await expect(api.glob("src/*.ts")).resolves.toEqual(["src/auth.ts"]);
        await expect(
            api.glob("**/*.{ts,md}", { maxMatches: 2 }),
        ).resolves.toEqual(["README.md", "src/auth.ts"]);

        expect(trace.calls.map((call) => call.tool)).toEqual([
            "glob",
            "glob",
            "glob",
        ]);
        expect(trace.calls.at(-1)).toMatchObject({
            input: { pattern: "**/*.{ts,md}", maxMatches: 2 },
            resultCount: 2,
            truncated: true,
        });
    });

    it("rejects unsafe glob patterns and shares the repository-call budget", async () => {
        const repoRoot = await makeFixture();
        const { api } = await makeTools({ repoRoot });
        const limited = await makeTools({
            repoRoot,
            maxCalls: 1,
        });

        await expect(api.glob("../*.ts")).rejects.toThrow(
            /repository-relative/i,
        );
        await expect(api.glob("/tmp/*.ts")).rejects.toThrow(
            /repository-relative/i,
        );
        await expect(api.glob("src\\*.ts")).rejects.toThrow(
            /repository-relative/i,
        );
        await expect(
            limited.api.glob("**/*", { maxMatches: 1 }),
        ).resolves.toEqual(["README.md"]);
        await expect(limited.api.glob("**/*")).resolves.toEqual([]);

        expect(limited.trace.totalCalls).toBe(1);
        expect(limited.trace.calls).toHaveLength(1);
        expect(limited.trace.calls[0]).toMatchObject({ tool: "glob" });
        expect(limited.trace.calls[0].error).toBeUndefined();
    });

    it("honors gitignore and excludes secrets, binary files, large files, and symlinks", async () => {
        const repoRoot = await makeFixture();
        const outside = path.join(path.dirname(repoRoot), "outside.txt");
        await writeFile(outside, "outside-marker\n");
        await writeFile(path.join(repoRoot, ".gitignore"), "ignored.txt\n");
        await writeFile(path.join(repoRoot, "ignored.txt"), "ignored-marker\n");
        await writeFile(path.join(repoRoot, "binary.dat"), Buffer.from([0, 1]));
        await writeFile(
            path.join(repoRoot, "large.txt"),
            Buffer.alloc(1024 * 1024 + 1, 97),
        );
        await symlink(outside, path.join(repoRoot, "outside-link.txt"));
        await execFileAsync("git", ["init"], { cwd: repoRoot });

        const { api } = await makeTools({ repoRoot });
        const files = await api.ls(undefined, { depth: 10, maxEntries: 100 });

        expect(files).toContain("src/auth.ts");
        expect(files).not.toContain(".env");
        expect(files).not.toContain("ignored.txt");
        expect(files).not.toContain("binary.dat");
        expect(files).not.toContain("large.txt");
        expect(files).not.toContain("outside-link.txt");
        await expect(
            api.glob("**/*", { maxMatches: 100 }),
        ).resolves.not.toContain("outside-link.txt");
        await expect(api.grep("outside-marker")).resolves.toEqual([]);
        await expect(api.read("outside-link.txt")).rejects.toThrow(
            /not available/i,
        );
    });

    it("rejects path traversal and remains safe if an indexed file is replaced by a symlink", async () => {
        const repoRoot = await makeFixture();
        const outside = path.join(path.dirname(repoRoot), "outside.txt");
        await writeFile(outside, "outside-secret\n");
        const { api, trace } = await makeTools({ repoRoot });

        await expect(api.read("../outside.txt")).rejects.toThrow(/relative/i);
        await expect(api.read("  ../outside.txt  ")).rejects.toThrow(
            /relative/i,
        );
        await expect(api.read(outside)).rejects.toThrow(/relative/i);
        await expect(api.ls("src\\..\\..", { depth: 1 })).rejects.toThrow(
            /relative/i,
        );
        await expect(api.grep("x", { path: "src/../../" })).rejects.toThrow(
            /relative/i,
        );

        const authPath = path.join(repoRoot, "src", "auth.ts");
        await rm(authPath);
        await symlink(outside, authPath);
        const content = await api.read("src/auth.ts", { limit: 1 });
        expect(content).toContain("authenticate");
        expect(content).not.toContain("outside-secret");
        await expect(api.grep("outside-secret")).resolves.toEqual([]);
        expect(trace.calls.filter((call) => call.error)).toHaveLength(5);
    });

    it("keeps valid ripgrep matches when another indexed file is deleted", async () => {
        const repoRoot = await makeFixture();
        await writeFile(
            path.join(repoRoot, "src", "surviving.ts"),
            "export const survivingMarker = true;\n",
        );
        const { api, trace } = await makeTools({ repoRoot });

        await rm(path.join(repoRoot, "src", "auth.ts"));

        await expect(api.grep("survivingMarker")).resolves.toEqual([
            {
                path: "src/surviving.ts",
                line: 1,
                text: "export const survivingMarker = true;",
            },
        ]);
        expect(trace.calls[0]).toMatchObject({
            tool: "grep",
            resultCount: 1,
            truncated: true,
        });
    });

    it("supports literal grep and bounds default regex, results, and line output", async () => {
        const repoRoot = await makeFixture();
        await writeFile(
            path.join(repoRoot, "src", "long.ts"),
            `${"x".repeat(700)} needle\n`,
        );
        const { api, trace } = await makeTools({ repoRoot });

        await expect(api.grep("a.*b", { literal: true })).resolves.toEqual([
            {
                path: "src/auth.ts",
                line: 4,
                text: "const literal = 'a.*b';",
            },
        ]);
        await expect(api.grep("auth.*token")).resolves.toHaveLength(1);
        await expect(api.grep("valid", { glob: "*.ts" })).resolves.toEqual([
            {
                path: "src/nested/token.ts",
                line: 1,
                text: "export const token = 'valid';",
            },
        ]);
        await expect(api.grep("valid", { glob: "src/*.ts" })).resolves.toEqual(
            [],
        );
        await expect(api.grep("(a+)+$")).resolves.toEqual([]);

        await writeFile(
            path.join(repoRoot, "src", "literal-paren.ts"),
            "export const marker = 'needle(';\n",
        );
        const literalFallback = await makeTools({ repoRoot });
        await expect(literalFallback.api.grep("needle(")).resolves.toEqual([
            {
                path: "src/literal-paren.ts",
                line: 1,
                text: "export const marker = 'needle(';",
            },
        ]);

        const matches = await api.grep("needle", { maxMatches: 1 });
        expect(matches).toHaveLength(1);
        expect(matches[0].text.length).toBeLessThanOrEqual(500);
        expect(trace.calls.at(-1)?.outputBytes).toBeLessThan(1024);
        await expect(api.read("src/auth.ts", { limit: 1001 })).rejects.toThrow(
            /limit/i,
        );
    });

    it("prioritizes production source matches before docs and tests", async () => {
        const repoRoot = await makeFixture();
        await mkdir(path.join(repoRoot, "docs"), { recursive: true });
        await mkdir(path.join(repoRoot, "tests"), { recursive: true });
        await writeFile(
            path.join(repoRoot, "docs", "guide.ts"),
            "shared-marker\n",
        );
        await writeFile(
            path.join(repoRoot, "tests", "auth.test.ts"),
            "shared-marker\n",
        );
        await writeFile(
            path.join(repoRoot, "src", "production.ts"),
            "shared-marker\n",
        );
        const { api } = await makeTools({ repoRoot });

        await expect(
            api.grep("shared-marker", { literal: true, maxMatches: 1 }),
        ).resolves.toEqual([
            {
                path: "src/production.ts",
                line: 1,
                text: "shared-marker",
            },
        ]);
    });

    it("returns matches from distinct files before repeats from one file", async () => {
        const repoRoot = await makeFixture();
        await writeFile(
            path.join(repoRoot, "src", "a-many.ts"),
            Array.from({ length: 1500 }, () => "common-marker").join("\n"),
        );
        await writeFile(
            path.join(repoRoot, "src", "z-target.ts"),
            "common-marker\n",
        );
        const { api } = await makeTools({ repoRoot });

        await expect(
            api.grep("common-marker", { literal: true, maxMatches: 2 }),
        ).resolves.toEqual([
            { path: "src/a-many.ts", line: 1, text: "common-marker" },
            { path: "src/z-target.ts", line: 1, text: "common-marker" },
        ]);
    });

    it("bounds broad ripgrep output before applying the result cap", async () => {
        const repoRoot = await makeFixture();
        await writeFile(
            path.join(repoRoot, "src", "dense.ts"),
            Array.from({ length: 5000 }, () => "common-marker").join("\n"),
        );
        const { api, trace } = await makeTools({ repoRoot });

        await expect(
            api.grep("common-marker", { literal: true, maxMatches: 1 }),
        ).resolves.toEqual([
            { path: "src/dense.ts", line: 1, text: "common-marker" },
        ]);
        expect(trace.calls[0]).toMatchObject({
            tool: "grep",
            resultCount: 1,
            truncated: true,
        });
        expect(trace.calls[0].outputBytes).toBeLessThan(1024);
    });

    it("keeps ripgrep target chunks below the Windows command-line budget", () => {
        const budget = ripgrepArgumentBudget("win32");
        const targets = ["a".repeat(7000), "b".repeat(7000)];
        const chunks = chunkRipgrepTargets(targets, budget);

        expect(budget).toBe(12 * 1024);
        expect(chunks).toEqual([[targets[0]], [targets[1]]]);
        expect(
            chunks.every(
                (chunk) =>
                    chunk.reduce(
                        (bytes, target) =>
                            bytes + Buffer.byteLength(target) + 1,
                        0,
                    ) <= budget,
            ),
        ).toBe(true);
        expect(() => chunkRipgrepTargets(["x".repeat(budget)], budget)).toThrow(
            /path exceeds ripgrep argument limit/i,
        );
    });

    it("resolves ripgrep only when grep is used", async () => {
        const previous = process.env.TYPEAGENT_RIPGREP_PATH;
        process.env.TYPEAGENT_RIPGREP_PATH = path.join(
            os.tmpdir(),
            "missing-typeagent-rg",
        );
        try {
            const repoRoot = await makeFixture();
            const { api } = await makeTools({ repoRoot });

            await expect(api.ls("src", { depth: 1 })).resolves.toContain(
                "src/auth.ts",
            );
            await expect(api.grep("authenticate")).rejects.toThrow(
                /ripgrep is required/i,
            );
        } finally {
            if (previous === undefined) {
                delete process.env.TYPEAGENT_RIPGREP_PATH;
            } else {
                process.env.TYPEAGENT_RIPGREP_PATH = previous;
            }
        }
    });

    it("prefers a symbol definition over an earlier reference in the same file", async () => {
        const repoRoot = await makeFixture();
        await writeFile(
            path.join(repoRoot, "src", "definition.ts"),
            [
                "const value = target();",
                "export const unrelated = value;",
                "",
                "export function target() {",
                "    return 1;",
                "}",
            ].join("\n"),
        );
        const { api } = await makeTools({ repoRoot });

        await expect(api.grep("target", { maxMatches: 1 })).resolves.toEqual([
            {
                path: "src/definition.ts",
                line: 4,
                text: "export function target() {",
            },
        ]);
    });

    it("keeps arbitrary regular-expression matches in source order", async () => {
        const repoRoot = await makeFixture();
        await writeFile(
            path.join(repoRoot, "src", "definition.ts"),
            [
                "const value = target();",
                "export function target() {",
                "    return 1;",
                "}",
            ].join("\n"),
        );
        const { api } = await makeTools({ repoRoot });

        await expect(
            api.grep("target|missing", { maxMatches: 1 }),
        ).resolves.toEqual([
            {
                path: "src/definition.ts",
                line: 1,
                text: "const value = target();",
            },
        ]);
    });

    it("enforces call and per-call result caps while tracing failures", async () => {
        const repoRoot = await makeFixture();
        const { api, trace } = await makeTools({
            repoRoot,
            maxCalls: 2,
        });

        await expect(
            api.ls("src", { depth: 10, maxEntries: 1 }),
        ).resolves.toEqual(["src/auth.ts"]);
        expect(trace.calls[0].truncated).toBe(true);
        await expect(
            api.grep("token", { maxMatches: 1 }),
        ).resolves.toHaveLength(1);
        await expect(api.read("README.md")).resolves.toMatch(
            /TOOL_BUDGET_EXHAUSTED/,
        );
        expect(trace.totalCalls).toBe(2);
        expect(trace.calls).toHaveLength(2);
    });

    it("enforces the aggregate output budget", async () => {
        const repoRoot = await makeFixture();
        await writeFile(
            path.join(repoRoot, "bulk.txt"),
            Array.from({ length: 1000 }, () => "x".repeat(500)).join("\n"),
        );
        const { api, trace } = await makeTools({ repoRoot });

        for (let attempt = 0; attempt < 4; attempt++) {
            await expect(
                api.read("bulk.txt", { limit: 1000 }),
            ).resolves.toContain("1\t");
        }
        await expect(api.read("bulk.txt", { limit: 1000 })).rejects.toThrow(
            /output budget/i,
        );
        expect(trace.totalOutputBytes).toBeLessThanOrEqual(2 * 1024 * 1024);
        expect(trace.calls.at(-1)?.error).toMatch(/output budget/i);
    });
});
