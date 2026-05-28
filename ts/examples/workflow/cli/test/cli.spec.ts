// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * CLI integration tests (Phase 6).
 *
 * These tests spawn the CLI as a child process and verify behavior
 * against real workflow files. They exercise the full pipeline:
 * load IR -> validate -> register tasks -> run -> output.
 */

import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { compileFile as compileDslFile, TaskSchemaInfo } from "workflow-dsl";
import { getBuiltinTaskSchemas } from "workflow-engine";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, "../cli.js");
const WORKFLOWS_IR = resolve(__dirname, "../../../workflows/ir");
const WORKFLOWS_DSL = resolve(__dirname, "../../../workflows/dsl");

// Compile .wf sources into a tmp dir so tests don't depend on the
// workflow-examples build having been run.
let WORKFLOWS_BUILT: string;

beforeAll(() => {
    WORKFLOWS_BUILT = mkdtempSync(join(tmpdir(), "wf-built-"));
    const schemas = getBuiltinTaskSchemas() as TaskSchemaInfo[];
    for (const f of readdirSync(WORKFLOWS_DSL)) {
        if (!f.endsWith(".wf")) continue;
        // Skip library files (only consumed via cross-file import).
        if (f === "writing.wf") continue;
        const res = compileDslFile(join(WORKFLOWS_DSL, f), schemas, {
            validate: true,
        });
        if (res.errors.length > 0 || !res.ir) {
            const msg = res.errors
                .map((e) => `${e.line}:${e.col} ${e.message}`)
                .join("\n");
            throw new Error(`Failed to compile ${f}:\n${msg}`);
        }
        writeFileSync(
            join(WORKFLOWS_BUILT, f.replace(/\.wf$/, ".json")),
            JSON.stringify(res.ir, null, 2),
        );
    }
});

afterAll(() => {
    if (WORKFLOWS_BUILT) {
        rmSync(WORKFLOWS_BUILT, { recursive: true, force: true });
    }
});

const WORKFLOW_SOURCE: Record<string, "ir" | "built"> = {
    "d1-standup-prep.json": "built",
    "d4-commit-summary.json": "ir",
    "d5-code-review-prep.json": "ir",
    "d8-summarize-url.json": "built",
};
function workflowPath(name: string): string {
    const source = WORKFLOW_SOURCE[name];
    if (!source) {
        throw new Error(
            `Unknown workflow '${name}'. Add it to WORKFLOW_SOURCE.`,
        );
    }
    const dir = source === "built" ? WORKFLOWS_BUILT : WORKFLOWS_IR;
    return join(dir, name);
}

/** Run the CLI and return { stdout, stderr, code }. */
function runCli(
    args: string[],
): Promise<{ stdout: string; stderr: string; code: number }> {
    return new Promise((resolve) => {
        execFile(
            "node",
            [CLI, ...args],
            { timeout: 30_000, maxBuffer: 1024 * 1024 },
            (err, stdout, stderr) => {
                const code = err && "code" in err ? (err.code as number) : 0;
                resolve({ stdout, stderr, code: code ?? 0 });
            },
        );
    });
}

describe("CLI integration", () => {
    describe("list-tasks", () => {
        it("lists all registered tasks", async () => {
            const { stdout, code } = await runCli(["list-tasks"]);
            expect(code).toBe(0);
            expect(stdout).toContain("shell.exec");
            expect(stdout).toContain("llm.generate");
            expect(stdout).toContain("http.get");
            expect(stdout).toContain("file.read");
            expect(stdout).toContain("file.write");
            expect(stdout).toContain("text.template");
            expect(stdout).toContain("math.add");
        });
    });

    describe("validate", () => {
        it("validates d1-standup-prep.json", async () => {
            const { stdout, code } = await runCli([
                "validate",
                workflowPath("d1-standup-prep.json"),
            ]);
            expect(code).toBe(0);
            expect(stdout).toContain("Valid");
        });

        it("validates d4-commit-summary.json", async () => {
            const { stdout, code } = await runCli([
                "validate",
                workflowPath("d4-commit-summary.json"),
            ]);
            expect(code).toBe(0);
            expect(stdout).toContain("Valid");
        });

        it("validates d5-code-review-prep.json", async () => {
            const { stdout, code } = await runCli([
                "validate",
                workflowPath("d5-code-review-prep.json"),
            ]);
            expect(code).toBe(0);
            expect(stdout).toContain("Valid");
        });

        it("validates d8-summarize-url.json", async () => {
            const { stdout, code } = await runCli([
                "validate",
                workflowPath("d8-summarize-url.json"),
            ]);
            expect(code).toBe(0);
            expect(stdout).toContain("Valid");
        });

        it("rejects invalid workflow file", async () => {
            const tmp = mkdtempSync(join(tmpdir(), "wf-test-"));
            const bad = join(tmp, "bad.json");
            writeFileSync(
                bad,
                JSON.stringify({
                    kind: "workflow",
                    version: "1",
                    entry: "bad",
                    workflows: {
                        bad: {
                            inputSchema: { type: "object" },
                            outputSchema: { type: "object" },
                            inputs: {},
                            nodes: {
                                step: {
                                    kind: "task",
                                    task: "nonexistent.task",
                                    inputSchema: { type: "object" },
                                    outputSchema: { type: "object" },
                                    inputs: {},
                                    bind: "r",
                                },
                            },
                            entry: "step",
                            output: { $from: "scope", name: "r" },
                        },
                    },
                }),
            );

            const { stderr, code } = await runCli(["validate", bad]);
            expect(code).not.toBe(0);
            expect(stderr).toContain("not registered");

            rmSync(tmp, { recursive: true });
        });
    });

    describe("run --dry-run", () => {
        it("d1: denies shell.exec in dry-run mode", async () => {
            const input = JSON.stringify({
                repos: ["/tmp/fake-repo"],
                author: "test@example.com",
            });
            const { stderr, code } = await runCli([
                "run",
                workflowPath("d1-standup-prep.json"),
                "--input",
                input,
                "--dry-run",
            ]);
            expect(code).not.toBe(0);
            expect(stderr).toContain("denied by policy");
        });

        it("d4: denies shell.exec in dry-run mode", async () => {
            const input = JSON.stringify({ repoPath: "/tmp/fake" });
            const { stderr, code } = await runCli([
                "run",
                workflowPath("d4-commit-summary.json"),
                "--input",
                input,
                "--dry-run",
            ]);
            expect(code).not.toBe(0);
            expect(stderr).toContain("denied by policy");
        });

        it("d8: denies http.get in dry-run mode", async () => {
            const input = JSON.stringify({
                url: "https://example.com",
                outputPath: "/tmp/out.md",
            });
            const { stderr, code } = await runCli([
                "run",
                workflowPath("d8-summarize-url.json"),
                "--input",
                input,
                "--dry-run",
            ]);
            expect(code).not.toBe(0);
            expect(stderr).toContain("denied by policy");
        });
    });

    describe("run (D1 end-to-end with real git repo)", () => {
        let repoDir: string;

        beforeAll(() => {
            // Create a temp git repo with a known commit
            repoDir = mkdtempSync(join(tmpdir(), "wf-e2e-"));
            const run = (cmd: string, args: string[]) =>
                execFileSync(cmd, args, { cwd: repoDir, encoding: "utf8" });

            run("git", ["init"]);
            run("git", ["config", "user.email", "test@example.com"]);
            run("git", ["config", "user.name", "Test User"]);
            run("git", ["config", "commit.gpgsign", "false"]);
            // Create a commit
            writeFileSync(join(repoDir, "hello.txt"), "world");
            run("git", ["add", "."]);
            run("git", [
                "commit",
                "-m",
                "Initial commit",
                "--date",
                "2026-05-05T10:00:00",
            ]);
        });

        afterAll(() => {
            rmSync(repoDir, { recursive: true, force: true });
        });

        it("runs D1 and produces markdown with commit info", async () => {
            const input = JSON.stringify({
                repos: [repoDir],
                author: "test@example.com",
            });
            const { stdout, code } = await runCli([
                "run",
                workflowPath("d1-standup-prep.json"),
                "--input",
                input,
                "--allow-all",
            ]);

            expect(code).toBe(0);
            const output = JSON.parse(stdout) as string;
            expect(output).toContain("Initial commit");
            // Output is formatted per-repo with ## headers
            expect(output).toContain("##");
        });
    });

    describe("usage", () => {
        it("prints usage with no args", async () => {
            const { stdout, code } = await runCli([]);
            expect(code).toBe(0);
            expect(stdout).toContain("Usage:");
            expect(stdout).toContain("workflow run");
            expect(stdout).toContain("workflow validate");
            expect(stdout).toContain("workflow list-tasks");
        });
    });
});
